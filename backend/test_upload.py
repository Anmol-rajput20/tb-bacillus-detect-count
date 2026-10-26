from typing import List
from fastapi import FastAPI, File, UploadFile

app = FastAPI()

@app.post("/test-upload")
async def test_upload(files: List[UploadFile] = File(...)):
    return {"count": len(files)}