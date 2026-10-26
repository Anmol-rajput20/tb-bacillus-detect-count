
import os

from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime, timezone
from pymongo.errors import PyMongoError

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("MONGODB_DATABASE", "tb_bacillus_vision")
COLLECTION_NAME = os.getenv("MONGODB_COLLECTION", "analysis_history")

if not MONGODB_URI:
    raise RuntimeError(
        "MONGODB_URI is missing. Check your backend/.env file."
    )

client = MongoClient(
    MONGODB_URI,
    serverSelectionTimeoutMS=5000,
)

database = client[DATABASE_NAME]
analysis_collection = database[COLLECTION_NAME]


def test_database_connection():
    """Check whether MongoDB Atlas is reachable."""
    client.admin.command("ping")
    return True


def save_analysis(result):
    """Save analysis metadata without storing image data."""
    document = {
        "filename": result.get("filename"),
        "predicted_count": result.get("predicted_count"),
        "confidence_threshold": result.get("confidence_threshold"),
        "mean_confidence": result.get("mean_confidence"),
        "detections": result.get("detections", []),
        "status": result.get("status", "success"),
        "created_at": datetime.now(timezone.utc),
    }

    try:
        saved = analysis_collection.insert_one(document)
        return str(saved.inserted_id)
    except PyMongoError as exc:
        print(f"Failed to save analysis to MongoDB: {exc}")
        raise

