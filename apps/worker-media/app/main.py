"""API interna do worker de mídia (sem porta publicada; só a rede interna do Compose)."""

from __future__ import annotations

import os
import platform

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.media_tools import MediaToolError, ffmpeg_version

PROFILE = os.environ.get("APP_PROFILE", "notebook")

app = FastAPI(title="worker-media", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> JSONResponse:
    try:
        ffmpeg = ffmpeg_version()
        status, code = "ok", 200
    except (MediaToolError, OSError) as exc:
        ffmpeg, status, code = f"indisponível: {exc}", "degraded", 503
    return JSONResponse(
        status_code=code,
        content={
            "status": status,
            "service": "worker-media",
            "profile": PROFILE,
            "python": platform.python_version(),
            "ffmpeg": ffmpeg,
        },
    )
