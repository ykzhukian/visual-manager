"""Media matcher: pair images with corresponding videos using CLIP embeddings.

Extracts keyframes from videos, embeds both images and frames with CLIP,
then greedily matches by cosine similarity.
"""

from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv"}

# Lazy-loaded CLIP
_clip_model = None
_clip_processor = None
_clip_device = None


def _get_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_clip():
    global _clip_model, _clip_processor, _clip_device
    if _clip_model is not None:
        return
    _clip_device = _get_device()
    from transformers import CLIPModel, CLIPProcessor
    model_name = "openai/clip-vit-base-patch32"
    print(f"[matcher] Loading {model_name} on {_clip_device}...")
    _clip_processor = CLIPProcessor.from_pretrained(model_name)
    _clip_model = CLIPModel.from_pretrained(model_name).to(_clip_device)
    _clip_model.eval()
    print("[matcher] CLIP model loaded.")


def scan_directory(directory: str) -> dict[str, list[str]]:
    """Scan a directory for images and videos.

    Returns: {"images": [path, ...], "videos": [path, ...]}
    """
    base = Path(directory)
    images = []
    videos = []
    for f in sorted(base.iterdir()):
        if f.is_file():
            ext = f.suffix.lower()
            if ext in IMAGE_EXTS:
                images.append(str(f))
            elif ext in VIDEO_EXTS:
                videos.append(str(f))
    return {"images": images, "videos": videos}


def extract_frame(video_path: str, position: float = 0.5) -> Optional[Image.Image]:
    """Extract a single frame from a video at the given position (0.0–1.0)."""
    cap = cv2.VideoCapture(video_path)
    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            return None
        target = int(total_frames * position)
        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        ok, frame = cap.read()
        if not ok:
            return None
        # BGR → RGB, numpy → PIL
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(frame_rgb)
    finally:
        cap.release()


def embed_images(paths: list[str]) -> np.ndarray:
    """Compute CLIP image embeddings for a list of image paths.

    Returns: (N, 512) float32 array, L2-normalized.
    """
    _load_clip()
    embeddings = []
    for p in paths:
        try:
            img = Image.open(p).convert("RGB")
            inputs = _clip_processor(images=img, return_tensors="pt").to(_clip_device)
            with torch.no_grad():
                vec = _clip_model.get_image_features(**inputs)
            vec = vec.cpu().numpy().astype(np.float32).flatten()
            vec = vec / (np.linalg.norm(vec) + 1e-8)
            embeddings.append(vec)
        except Exception as exc:
            print(f"[matcher] Failed to embed image {p}: {exc}")
            embeddings.append(np.full(512, np.nan, dtype=np.float32))
    return np.stack(embeddings)


def embed_videos(paths: list[str]) -> np.ndarray:
    """Compute CLIP embeddings for videos (using the middle frame).

    Returns: (M, 512) float32 array, L2-normalized.
    """
    _load_clip()
    embeddings = []
    for p in paths:
        try:
            frame = extract_frame(p, position=0.5)
            if frame is None:
                raise RuntimeError("Could not extract frame")
            inputs = _clip_processor(images=frame, return_tensors="pt").to(_clip_device)
            with torch.no_grad():
                vec = _clip_model.get_image_features(**inputs)
            vec = vec.cpu().numpy().astype(np.float32).flatten()
            vec = vec / (np.linalg.norm(vec) + 1e-8)
            embeddings.append(vec)
        except Exception as exc:
            print(f"[matcher] Failed to embed video {p}: {exc}")
            embeddings.append(np.full(512, np.nan, dtype=np.float32))
    return np.stack(embeddings)


def match_pairs(
    images: list[str],
    videos: list[str],
    threshold: float = 0.25,
) -> list[dict]:
    """Match images to videos by CLIP cosine similarity.

    Uses greedy matching: highest-similarity pairs first, each item used at most once.

    Args:
        images: List of image file paths.
        videos: List of video file paths.
        threshold: Minimum cosine similarity to consider a match.

    Returns:
        List of dicts: {"image": path, "video": path, "similarity": float, "unmatched_images": [...], "unmatched_videos": [...]}
    """
    if not images or not videos:
        return {
            "pairs": [],
            "unmatched_images": images,
            "unmatched_videos": videos,
        }

    img_embs = embed_images(images)   # (N, 512)
    vid_embs = embed_videos(videos)   # (M, 512)

    # Cosine similarity matrix
    sim = img_embs @ vid_embs.T  # (N, M), already L2-normalized so dot = cosine

    # Flatten into candidate pairs, sorted by similarity descending
    candidates = []
    for i in range(len(images)):
        for j in range(len(videos)):
            s = float(sim[i, j])
            if not np.isnan(s) and s >= threshold:
                candidates.append((s, i, j))

    candidates.sort(key=lambda x: x[0], reverse=True)

    used_img = set()
    used_vid = set()
    pairs = []

    for s, i, j in candidates:
        if i not in used_img and j not in used_vid:
            pairs.append({
                "image": images[i],
                "video": videos[j],
                "similarity": round(s, 4),
            })
            used_img.add(i)
            used_vid.add(j)

    unmatched_images = [images[i] for i in range(len(images)) if i not in used_img]
    unmatched_videos = [videos[j] for j in range(len(videos)) if j not in used_vid]

    return {
        "pairs": pairs,
        "unmatched_images": unmatched_images,
        "unmatched_videos": unmatched_videos,
    }
