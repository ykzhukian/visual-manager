"""Zero-shot image classification using OpenAI CLIP model.

Classifies images against user-provided category labels.
Model is loaded once at import time and cached.
"""

from pathlib import Path

import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

# Load model once at module import (lazy, only when first used)
_model = None
_processor = None
_device = None


def _get_device() -> str:
    """Pick best available device."""
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model():
    """Load CLIP model and processor. Called once on first use."""
    global _model, _processor, _device
    if _model is not None:
        return

    _device = _get_device()
    model_name = "openai/clip-vit-base-patch32"

    print(f"[classifier] Loading {model_name} on {_device}...")
    _processor = CLIPProcessor.from_pretrained(model_name)
    _model = CLIPModel.from_pretrained(model_name).to(_device)
    print("[classifier] Model loaded.")


def classify_image(image_path: str | Path, categories: list[str]) -> dict:
    """Classify an image against a list of category labels.

    Args:
        image_path: Path to an image file (JPG, PNG, etc.)
        categories: List of category strings, e.g. ["cat", "dog", "car"]

    Returns:
        Dict with path, categories (sorted by score desc), and status.
    """
    _load_model()

    image = Image.open(image_path).convert("RGB")
    inputs = _processor(
        text=categories,
        images=image,
        return_tensors="pt",
        padding=True,
    ).to(_device)

    with torch.no_grad():
        outputs = _model(**inputs)
        logits_per_image = outputs.logits_per_image  # shape: (1, num_categories)
        probs = logits_per_image.softmax(dim=1)       # probabilities

    scores = probs[0].tolist()
    results = [
        {"category": cat, "score": round(score, 4)}
        for cat, score in sorted(
            zip(categories, scores), key=lambda x: x[1], reverse=True
        )
    ]
    return {"path": str(image_path), "categories": results, "status": "ok"}


def classify_images(image_paths: list[str], categories: list[str]) -> list[dict]:
    """Classify multiple images against the same set of categories.

    Args:
        image_paths: List of image file paths.
        categories: List of category label strings.

    Returns:
        List of dicts with {'path': ..., 'categories': ..., 'status': ...}
    """
    _load_model()
    results = []
    for path in image_paths:
        try:
            result = classify_image(path, categories)
            results.append(result)
        except Exception as exc:
            results.append({
                "path": path,
                "categories": [],
                "status": "error",
                "error": str(exc),
            })
    return results
