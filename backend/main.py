"""Visual Manager — Python backend service.

Runs a FastAPI server on localhost:8765.
Called by Electron on startup, killed on exit.
"""

import os
import sys
from pathlib import Path

# Force all model caches onto A: drive
os.environ.setdefault("HF_HOME", r"A:\cache\huggingface")
os.environ.setdefault("TORCH_HOME", r"A:\cache\torch")
# Use HF mirror for model downloads (hf.co blocked from this network)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
# Windows symlink warning is harmless, suppress it
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

# Ensure backend/ is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import router as api_router
from database import init_db

# Initialize SQLite database
init_db()

app = FastAPI(title="Visual Manager Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


app.include_router(api_router, prefix="/api")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
