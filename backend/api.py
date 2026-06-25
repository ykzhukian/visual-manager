"""API routes for Visual Manager."""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from captioner import describe_images

router = APIRouter()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".heic", ".heif"}


@router.post("/scan")
def scan_photos(data: dict):
    """Scan a directory for photos. Returns list of found image paths."""
    directory = data.get("directory", "")
    if not directory or not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Invalid or missing directory")

    photos = []
    for root, _dirs, files in os.walk(directory):
        for fname in sorted(files):
            ext = Path(fname).suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                photos.append(str(Path(root) / fname))

    return {"status": "ok", "directory": directory, "count": len(photos), "photos": photos}


@router.post("/describe")
def describe_photos(data: dict):
    """Describe photos using BLIP image captioning.

    Accepts: {"paths": ["path/to/photo1.jpg", ...]}
    Returns: {"results": [{"path": ..., "description": ..., "status": "ok"}, ...]}
    """
    paths = data.get("paths", [])
    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided")

    results = describe_images(paths)
    return {"status": "ok", "count": len(results), "results": results}


@router.post("/classify")
def classify_photos(data: dict):
    """Classify photos using CLIP model."""
    paths = data.get("paths", [])
    categories = data.get("categories", [])
    # TODO: implement CLIP classification
    return {"status": "ok", "classified": len(paths), "categories": categories}
