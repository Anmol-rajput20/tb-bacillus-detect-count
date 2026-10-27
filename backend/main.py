
from pathlib import Path
from tempfile import NamedTemporaryFile
from contextlib import asynccontextmanager
from typing import Annotated
from database import save_analysis
from pymongo.errors import PyMongoError
import base64
import os

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import WithJsonSchema
from ultralytics import YOLO

BASE_DIR = Path(__file__).resolve().parent
WEIGHTS_PATH = BASE_DIR / "models" / "best.pt"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
MAX_FILE_SIZE = 15 * 1024 * 1024
MAX_BATCH_FILES = 20
CONFIDENCE_THRESHOLD = 0.25

model = None

# Make Swagger UI display file upload controls for batch uploads.
UploadFileForDocs = Annotated[
    UploadFile,
    WithJsonSchema({"type": "string", "format": "binary"}),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model

    if not WEIGHTS_PATH.exists():
        raise RuntimeError(f"Model checkpoint not found: {WEIGHTS_PATH}")

    model = YOLO(str(WEIGHTS_PATH))
    print("YOLO26m loaded successfully!")

    yield

    model = None


app = FastAPI(
    title="TB Bacillus Detection API",
    description="Single and multiple microscopy image analysis",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://tb-bacillus-detect-count.vercel.app",
        "https://tb-bacillus-detect-count-d9u7t3mf6-anmol-rajput20s-projects.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "TB Bacillus Detection API is running"}


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model_class": "TBbacillus",
    }


async def analyze_upload(file: UploadFile):
    """Validate and analyze one uploaded microscopy image."""
    temp_path = None

    try:
        filename = Path(file.filename or "unnamed").name
        extension = Path(filename).suffix.lower()

        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="Upload a JPG, JPEG, PNG, or BMP image.",
            )

        contents = await file.read(MAX_FILE_SIZE + 1)

        if not contents:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Image exceeds the 15 MB limit.",
            )

        image_array = cv2.imdecode(
            np.frombuffer(contents, dtype=np.uint8),
            cv2.IMREAD_COLOR,
        )

        if image_array is None:
            raise HTTPException(
                status_code=400,
                detail="The file is not a valid supported image.",
            )

        with NamedTemporaryFile(
            suffix=extension,
            delete=False,
        ) as temp_file:
            temp_file.write(contents)
            temp_path = temp_file.name

        results = model.predict(
            source=temp_path,
            imgsz=640,
            conf=CONFIDENCE_THRESHOLD,
            verbose=False,
        )

        result = results[0]
        boxes = result.boxes

        confidences = (
            boxes.conf.cpu().tolist()
            if boxes is not None and len(boxes) > 0
            else []
        )

        annotated_image = result.plot()
        success, encoded_image = cv2.imencode(
            ".jpg",
            annotated_image,
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Could not generate the annotated image.",
            )

        response =  {
            "filename": filename,
            "predicted_count": len(confidences),
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "mean_confidence": (
                sum(confidences) / len(confidences)
                if confidences else 0.0
            ),
            "detections": [
                {"confidence": round(float(score), 4)}
                for score in confidences
            ],
            "annotated_image": base64.b64encode(
                encoded_image.tobytes()
            ).decode("utf-8"),
            "image_format": "jpeg",
            "status": "success",
        }

        try:
            save_analysis(response)
        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Image analysis completed saving to the database"
                    "failed. Please try again."
                ),
            )
        return response

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

        await file.close()


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """Analyze one microscopy image."""
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded.",
        )

    return await analyze_upload(file)


@app.post("/predict/batch")
async def predict_batch(
    files: list[UploadFileForDocs] = File(...)
):
    """Analyze multiple microscopy images and summarize the results."""
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded.",
        )

    if not files:
        raise HTTPException(
            status_code=400,
            detail="Upload at least one microscopy image.",
        )

    if len(files) > MAX_BATCH_FILES:
        for file in files:
            await file.close()

        raise HTTPException(
            status_code=400,
            detail=f"Upload no more than {MAX_BATCH_FILES} images at once.",
        )

    results = []
    errors = []

    try:
        for file in files:
            filename = Path(file.filename or "unnamed").name

            try:
                image_result = await analyze_upload(file)
                results.append(image_result)

            except HTTPException as exc:
                errors.append({
                    "filename": filename,
                    "error": exc.detail,
                })

            except Exception:
                errors.append({
                    "filename": filename,
                    "error": "Unexpected processing error.",
                })

        total_detections = sum(
            item["predicted_count"] for item in results
        )

        all_confidences = [
            detection["confidence"]
            for item in results
            for detection in item["detections"]
        ]

        return {
            "total_images_received": len(files),
            "successful_images": len(results),
            "failed_images": len(errors),
            "total_detected_objects": total_detections,
            "mean_confidence": (
                sum(all_confidences) / len(all_confidences)
                if all_confidences else 0.0
            ),
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "results": results,
            "errors": errors,
            "message": (
                "Experimental model detections only; "
                "not a clinically validated count or diagnosis."
            ),
        }

    finally:
        for file in files:
            if not file.file.closed:
                await file.close()
