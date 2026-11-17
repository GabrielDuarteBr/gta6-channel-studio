"""Análise do vídeo do parceiro com o faster-whisper (CPU, int8).

- trechos de fala (Silero VAD, que vem com o faster-whisper): o modo "só a voz" do corte deixa
  o áudio só nesses trechos;
- transcrição (o Comentarista entende o que o parceiro disse e o Cortador escolhe os trechos);
- música: trechos que o Whisper marca com ♪ ou [música] (música cantada com letra também aparece
  como texto com ♪). Esses trechos ficam fora do corte;
- nível de áudio por segundo (para achar os momentos mais animados).

Nada é baixado em tempo de execução: o modelo vem dentro da imagem (WHISPER_MODEL_DIR).
"""

from __future__ import annotations

import os
import re
import threading
from functools import lru_cache
from pathlib import Path

from app.media_tools import MediaToolError, _relative, _video_src, scene_changes, video_probe

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_MODEL_DIR = Path(os.environ.get("WHISPER_MODEL_DIR", "/opt/whisper"))
WHISPER_THREADS = int(os.environ.get("WHISPER_THREADS", "2"))
SAMPLE_RATE = 16000
MAX_SEGMENTS = 2000

# Idiomas dos parceiros: português por padrão; inglês ou espanhol só com detecção confiante
# (voz sintética ou ruído de jogo às vezes faz o Whisper "achar" latim e não transcrever nada).
PARTNER_LANGUAGES = ("pt", "en", "es")
LANGUAGE_CONFIDENCE = 0.6

MUSIC_MARK = re.compile(r"♪|♫|\[(m[uú]sica|music)\]|\((m[uú]sica|music)\)", re.IGNORECASE)

# Uma análise por vez: o modelo ocupa ~1 GB e o container tem 2 GB.
_lock = threading.Lock()


def model_path() -> Path:
    path = WHISPER_MODEL_DIR / WHISPER_MODEL
    if not (path / "model.bin").is_file():
        raise MediaToolError(f"modelo Whisper '{WHISPER_MODEL}' não está na imagem ({path})")
    return path


@lru_cache(maxsize=1)
def _model():  # pragma: no cover - carregado só quando há modelo
    from faster_whisper import WhisperModel

    return WhisperModel(
        str(model_path()), device="cpu", compute_type="int8", cpu_threads=WHISPER_THREADS
    )


def whisper_status() -> str:
    try:
        return f"{WHISPER_MODEL} (int8)" if model_path() else "indisponível"
    except MediaToolError:
        return "indisponível"


def _merge(ranges: list[tuple[float, float]], gap: float) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for a, b in sorted(ranges):
        if merged and a - merged[-1][1] <= gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def pick_language(audio, speech: list[tuple[float, float]]) -> str:
    """Português (idioma do canal e dos parceiros), salvo inglês ou espanhol com confiança alta.

    A detecção automática erra com voz sintética ou ruído de jogo (já "achou" latim), então só
    troca de idioma quando tem certeza.
    """
    if speech:
        a, b = speech[0][0], min(speech[0][0] + 30.0, speech[-1][1])
        sample = audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)]
        if len(sample) > SAMPLE_RATE:
            audio = sample
    lang, prob, _probs = _model().detect_language(audio)
    if lang in PARTNER_LANGUAGES and lang != "pt" and prob >= LANGUAGE_CONFIDENCE:
        return lang
    return "pt"


def loudness_per_second(samples, rate: int = SAMPLE_RATE) -> list[float]:
    """Nível RMS de cada segundo em dBFS (-90 = silêncio)."""
    import numpy as np

    n = len(samples) // rate
    out: list[float] = []
    for i in range(n + (1 if len(samples) % rate else 0)):
        chunk = samples[i * rate : (i + 1) * rate]
        if len(chunk) == 0:
            break
        rms = float(np.sqrt(np.mean(np.square(chunk, dtype=np.float64))))
        out.append(round(max(-90.0, 20 * np.log10(rms)) if rms > 0 else -90.0, 1))
    return out


def analyze_video(rel: str, language: str | None = None) -> dict:
    """Transcrição, fala, música, cenas e nível de áudio do vídeo do parceiro."""
    src = _video_src(rel)
    probe = video_probe(rel)
    scenes = scene_changes(rel)["scenes"]
    if not probe["has_audio"]:
        return {
            "path": _relative(src),
            "probe": probe,
            "language": None,
            "speech": [],
            "segments": [],
            "music": [],
            "loudness": [],
            "scenes": scenes,
            "model": None,
        }
    if language is not None and not re.fullmatch(r"[a-z]{2}", language):
        raise MediaToolError("idioma inválido")
    from faster_whisper import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    with _lock:
        audio = decode_audio(str(src), sampling_rate=SAMPLE_RATE)
        stamps = get_speech_timestamps(
            audio, VadOptions(min_silence_duration_ms=400, speech_pad_ms=150)
        )
        speech = _merge(
            [(s["start"] / SAMPLE_RATE, s["end"] / SAMPLE_RATE) for s in stamps], gap=0.25
        )
        if language is None:
            language = pick_language(audio, speech)
        segments_iter, info = _model().transcribe(
            audio,
            language=language,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
        )
        segments = []
        for seg in segments_iter:
            if len(segments) >= MAX_SEGMENTS:
                break
            text = seg.text.strip()
            segments.append(
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": text,
                    "no_speech": round(seg.no_speech_prob, 2),
                    "music": bool(MUSIC_MARK.search(text)),
                }
            )
        loud = loudness_per_second(audio)
    music = _merge([(s["start"], s["end"]) for s in segments if s["music"]], gap=1.0)
    return {
        "path": _relative(src),
        "probe": probe,
        "language": info.language,
        "speech": [[round(a, 2), round(b, 2)] for a, b in speech],
        "segments": segments,
        "music": [[round(a, 2), round(b, 2)] for a, b in music],
        "loudness": loud,
        "scenes": scenes,
        "model": f"faster-whisper {WHISPER_MODEL} int8",
    }
