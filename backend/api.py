"""API routes for Visual Manager."""

import hashlib
import os
from pathlib import Path

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

from captioner import describe_images, describe_images_stream
from database import (
    add_photos,
    categorize_photos,
    create_category,
    delete_category,
    get_all_photos,
    get_categories,
    remove_photo,
    rename_category,
    save_descriptions,
    uncategorize_photos,
)
from matcher import match_pairs, scan_directory

router = APIRouter()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".heic", ".heif"}

THUMB_DIR = Path(__file__).resolve().parent / "thumbnails"
THUMB_SIZE = (300, 300)


# ======================================================================
# Thumbnails
# ======================================================================

THUMB_DIR.mkdir(parents=True, exist_ok=True)


def _thumb_path(original_path: str) -> Path:
    """Hash the original path to a stable thumbnail filename."""
    h = hashlib.sha256(original_path.encode()).hexdigest()[:16]
    return THUMB_DIR / f"{h}.jpg"


@router.get("/thumbnails")
def get_thumbnail(path: str):
    """Return a cached thumbnail for the given image path.
    Generates the thumbnail (max 300px) on first request.
    """
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Image not found")

    thumb = _thumb_path(path)

    if not thumb.exists():
        try:
            img = Image.open(path).convert("RGB")
            img.thumbnail(THUMB_SIZE, Image.LANCZOS)
            thumb.parent.mkdir(parents=True, exist_ok=True)
            img.save(thumb, "JPEG", quality=80)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Cannot read image: {e}")

    return FileResponse(thumb, media_type="image/jpeg")


# ======================================================================
# Photos
# ======================================================================

@router.get("/photos")
def list_photos(category_id: int | None = None, q: str | None = None):
    """Return all photos with descriptions and categories. Supports filtering."""
    photos = get_all_photos(category_id=category_id, query=q)
    return {"status": "ok", "count": len(photos), "photos": photos}


@router.post("/photos/add")
def api_add_photos(data: dict):
    """Persist photo paths to the database."""
    paths = data.get("paths", [])
    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided")
    added = add_photos(paths)
    return {"status": "ok", "added": added}


@router.delete("/photos")
def api_remove_photo(data: dict):
    """Remove a photo from the database."""
    path = data.get("path", "")
    if not path:
        raise HTTPException(status_code=400, detail="No path provided")
    deleted = remove_photo(path)
    return {"status": "ok", "deleted": deleted}


@router.post("/photos/categorize")
def api_categorize_photos(data: dict):
    """Assign categories to photos. {paths: [...], category_ids: [...]}"""
    paths = data.get("paths", [])
    category_ids = data.get("category_ids", [])
    if not paths or not category_ids:
        raise HTTPException(status_code=400, detail="paths and category_ids required")
    added = categorize_photos(paths, category_ids)
    return {"status": "ok", "added": added}


@router.delete("/photos/categorize")
def api_uncategorize_photos(data: dict):
    """Remove categories from photos. {paths: [...], category_ids: [...]}"""
    paths = data.get("paths", [])
    category_ids = data.get("category_ids", [])
    if not paths or not category_ids:
        raise HTTPException(status_code=400, detail="paths and category_ids required")
    removed = uncategorize_photos(paths, category_ids)
    return {"status": "ok", "removed": removed}


# ======================================================================
# Categories
# ======================================================================

@router.get("/categories")
def api_get_categories():
    """List all categories with photo counts."""
    categories = get_categories()
    return {"status": "ok", "categories": categories}


@router.post("/categories")
def api_create_category(data: dict):
    """Create a new category. {name: "..."} """
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    result = create_category(name)
    if result is None:
        raise HTTPException(status_code=409, detail="Category already exists")
    return {"status": "ok", "category": result}


@router.put("/categories/{category_id}")
def api_rename_category(category_id: int, data: dict):
    """Rename a category. {name: "..."} """
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    ok = rename_category(category_id, name)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found or name taken")
    return {"status": "ok"}


@router.delete("/categories/{category_id}")
def api_delete_category(category_id: int):
    """Delete a category and all its photo associations."""
    ok = delete_category(category_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"status": "ok"}


# ======================================================================
# Scanning
# ======================================================================

@router.post("/scan")
def scan_photos(data: dict):
    """Scan a directory for photos."""
    directory = data.get("directory", "")
    if not directory or not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Invalid or missing directory")

    photos = []
    for root, _dirs, files in os.walk(directory):
        for fname in sorted(files):
            ext = Path(fname).suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                photos.append(str(Path(root) / fname))

    if photos:
        add_photos(photos)

    return {"status": "ok", "directory": directory, "count": len(photos), "photos": photos}


# ======================================================================
# Description (BLIP)
# ======================================================================

@router.post("/describe")
def describe_photos(data: dict):
    """Describe photos using BLIP captioning. Results saved to DB."""
    paths = data.get("paths", [])
    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided")

    if paths:
        add_photos(paths)

    results = describe_images(paths)
    save_descriptions(results)

    return {"status": "ok", "count": len(results), "results": results}


@router.post("/describe-stream")
async def describe_photos_stream(data: dict):
    """Describe photos with SSE progress events.

    Body: {"paths": [...]}
    Returns: text/event-stream with one event per photo.
    """
    paths = data.get("paths", [])
    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided")

    # Ensure photos are in DB
    add_photos(paths)

    async def event_stream():
        for event in describe_images_stream(paths):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ======================================================================
# Media matching (CLIP-based)
# ======================================================================

@router.post("/match-pairs")
def api_match_pairs(data: dict):
    """Scan a directory and match images to videos via CLIP similarity.

    Body: {"directory": "/path/to/media", "threshold": 0.25}
    threshold = minimum cosine similarity to consider a match (0.0–1.0).
    """
    directory = data.get("directory", "")
    threshold = data.get("threshold", 0.25)

    if not directory or not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Invalid or missing directory")

    files = scan_directory(directory)

    if not files["images"]:
        return {"status": "ok", "pairs": [], "unmatched_images": [],
                "unmatched_videos": files["videos"], "total_images": 0, "total_videos": len(files["videos"])}

    if not files["videos"]:
        return {"status": "ok", "pairs": [], "unmatched_images": files["images"],
                "unmatched_videos": [], "total_images": len(files["images"]), "total_videos": 0}

    result = match_pairs(files["images"], files["videos"], threshold=threshold)

    return {
        "status": "ok",
        **result,
        "total_images": len(files["images"]),
        "total_videos": len(files["videos"]),
    }
