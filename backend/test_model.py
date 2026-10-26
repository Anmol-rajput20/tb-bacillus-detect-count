
from pathlib import Path
from ultralytics import YOLO

weights = Path(__file__).parent / "models" / "best.pt"

if not weights.exists():
    raise FileNotFoundError(f"Checkpoint not found: {weights}")

model = YOLO(str(weights))

print("Model loaded successfully!")
print("Task:", model.task)
print("Classes:", model.names)
