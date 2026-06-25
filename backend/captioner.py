"""Image captioning using Salesforce BLIP model.

Generates natural language descriptions for images.
Model is loaded once at import time and cached.
"""

from pathlib import Path

import torch
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration

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
    """Load BLIP model and processor. Called once on first use."""
    global _model, _processor, _device
    if _model is not None:
        return

    _device = _get_device()
    model_name = "Salesforce/blip-image-captioning-base"

    print(f"[captioner] Loading {model_name} on {_device}...")
    _processor = BlipProcessor.from_pretrained(model_name)
    _model = BlipForConditionalGeneration.from_pretrained(model_name).to(_device)
    print("[captioner] Model loaded.")


def describe_image(image_path: str | Path) -> str:
    """Generate a natural language description of an image.

    Args:
        image_path: Path to an image file (JPG, PNG, etc.)

    Returns:
        A short description string, e.g. "a dog sitting on a beach"
    """
    _load_model()

    image = Image.open(image_path).convert("RGB")
    inputs = _processor(image, return_tensors="pt").to(_device)

    with torch.no_grad():
        output = _model.generate(**inputs, max_length=50, num_beams=3)

    caption = _processor.decode(output[0], skip_special_tokens=True)
    return caption


def describe_images(image_paths: list[str]) -> list[dict]:
    """Describe multiple images.

    Args:
        image_paths: List of image file paths.

    Returns:
        List of dicts with {'path': ..., 'description': ...}
    """
    _load_model()
    results = []
    for path in image_paths:
        try:
            desc = describe_image(path)
            results.append({"path": path, "description": desc, "status": "ok"})
        except Exception as exc:
            results.append({"path": path, "description": "", "status": "error", "error": str(exc)})
    return results
