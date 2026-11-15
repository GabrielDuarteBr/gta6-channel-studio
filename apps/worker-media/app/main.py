"""API interna do worker de mídia (sem porta publicada; só a rede interna do Compose).

Cada rota chama UMA operação fechada de `media_tools`. Caminhos são sempre relativos
à pasta de trabalho (/data/work); nada de comando ou caminho livre.
"""

from __future__ import annotations

import os
import platform

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.media_tools import (
    MediaToolError,
    ffmpeg_version,
    lipsync,
    tool_versions,
    tts_espeak,
    video_frame_hashes,
    voice_track,
)

PROFILE = os.environ.get("APP_PROFILE", "notebook")
# Relativo à pasta de trabalho: não começa com "/" nem com "." (o safe_path confere o resto).
RelPath = Field(min_length=1, max_length=300, pattern=r"^[A-Za-z0-9_-][A-Za-z0-9._/-]*$")

app = FastAPI(title="worker-media", docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(MediaToolError)
def media_error(_request, exc: MediaToolError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


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
            **tool_versions(),
        },
    )


class EspeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    out: str = RelPath
    voice: str = "pt-br"
    speed: int = 165


@app.post("/tts/espeak")
def tts_espeak_route(body: EspeakIn) -> dict:
    return tts_espeak(body.text, body.out, voice=body.voice, speed=body.speed)


class SegmentIn(BaseModel):
    path: str = RelPath
    pause_after_ms: int = Field(default=0, ge=0, le=10_000)


class VoiceTrackIn(BaseModel):
    segments: list[SegmentIn] = Field(min_length=1, max_length=200)
    out: str = RelPath
    lead_in_ms: int = Field(default=200, ge=0, le=5000)
    tail_ms: int = Field(default=500, ge=0, le=5000)


@app.post("/audio/voice-track")
def voice_track_route(body: VoiceTrackIn) -> dict:
    return voice_track(
        [s.model_dump() for s in body.segments],
        body.out,
        lead_in_ms=body.lead_in_ms,
        tail_ms=body.tail_ms,
    )


class AudioIn(BaseModel):
    audio: str = RelPath


@app.post("/lipsync")
def lipsync_route(body: AudioIn) -> dict:
    return lipsync(body.audio)


class VideoIn(BaseModel):
    video: str = RelPath


@app.post("/video/frame-hashes")
def frame_hashes_route(body: VideoIn) -> dict:
    return video_frame_hashes(body.video)
