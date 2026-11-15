"""Ferramentas de mídia com operações fechadas.

Regra do projeto: FFmpeg e afins só rodam por funções tipadas, com argumentos
montados aqui (lista, sem shell) e caminhos restritos à pasta de trabalho.
Nada de comando livre.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess  # noqa: S404 - uso restrito a binários fixos, sem shell
import unicodedata
import wave
from functools import lru_cache
from pathlib import Path

WORK_ROOT = Path(os.environ.get("MEDIA_WORK_ROOT", "/data/work"))
RHUBARB_BIN = os.environ.get("RHUBARB_BIN", "/opt/rhubarb/rhubarb")

# Voz falsa (espeak-ng): só para testes e modo simulado. Nunca vai para vídeo publicado.
ESPEAK_VOICES = frozenset({"pt-br", "en-us", "es"})
MAX_TTS_CHARS = 2000
TRACK_SAMPLE_RATE = 44100


class MediaToolError(RuntimeError):
    """Falha numa ferramenta de mídia."""


def _binary(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise MediaToolError(f"binário não encontrado: {name}")
    return path


def _rhubarb() -> str:
    if not (os.path.isfile(RHUBARB_BIN) and os.access(RHUBARB_BIN, os.X_OK)):
        raise MediaToolError("Rhubarb não instalado (esperado em /opt/rhubarb)")
    return RHUBARB_BIN


def safe_path(relative: str, root: Path | None = None) -> Path:
    """Resolve um caminho relativo garantindo que fique dentro da pasta de trabalho."""
    base = (root or WORK_ROOT).resolve()
    candidate = (base / relative).resolve()
    if not candidate.is_relative_to(base):
        raise MediaToolError("caminho fora da pasta de trabalho")
    return candidate


def _relative(path: Path) -> str:
    return str(path.relative_to(WORK_ROOT.resolve()))


def _run(args: list[str], timeout: float, stdin: str | None = None) -> str:
    try:
        out = subprocess.run(  # noqa: S603 - binário fixo, argumentos montados aqui
            args, check=True, capture_output=True, text=True, timeout=timeout, input=stdin
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip().splitlines()[-1:] or [""]
        raise MediaToolError(f"{Path(args[0]).name} falhou: {detail[0][:300]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError(f"{Path(args[0]).name} demorou demais") from exc
    return out.stdout


@lru_cache(maxsize=1)
def ffmpeg_version() -> str:
    """Primeira linha de `ffmpeg -version` (cacheada)."""
    out = _run([_binary("ffmpeg"), "-hide_banner", "-version"], timeout=10)
    first = out.splitlines()[0] if out else ""
    parts = first.split()
    return parts[2] if len(parts) > 2 else first


def tool_versions() -> dict[str, str]:
    """Versões das ferramentas opcionais (para o /health)."""
    versions: dict[str, str] = {}
    try:
        versions["espeak"] = _run([_binary("espeak-ng"), "--version"], 10).split()[3]
    except (MediaToolError, IndexError, OSError):
        versions["espeak"] = "indisponível"
    try:
        versions["rhubarb"] = _run([_rhubarb(), "--version"], 10).strip().split()[-1]
    except (MediaToolError, IndexError, OSError):
        versions["rhubarb"] = "indisponível"
    return versions


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def clean_text(text: str) -> str:
    """Texto para a voz: sem caracteres de controle e com espaços normalizados."""
    kept = "".join(
        (" " if ch.isspace() else "") if unicodedata.category(ch)[0] == "C" else ch for ch in text
    )
    return " ".join(kept.split())


def tts_espeak(text: str, out_rel: str, voice: str = "pt-br", speed: int = 165) -> dict:
    """Voz falsa offline (espeak-ng). O texto vai pela entrada padrão, nunca como argumento."""
    if voice not in ESPEAK_VOICES:
        raise MediaToolError(f"voz não permitida: {voice}")
    if not 80 <= speed <= 300:
        raise MediaToolError("velocidade fora do intervalo 80-300")
    spoken = clean_text(text)
    if not spoken:
        raise MediaToolError("texto vazio")
    if len(spoken) > MAX_TTS_CHARS:
        raise MediaToolError(f"texto maior que {MAX_TTS_CHARS} caracteres")
    out = safe_path(out_rel)
    if out.suffix != ".wav":
        raise MediaToolError("a saída precisa ser .wav")
    out.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [_binary("espeak-ng"), "-v", voice, "-s", str(speed), "-w", str(out), "--stdin"],
        timeout=60,
        stdin=spoken,
    )
    return {"path": _relative(out), "duration_sec": round(wav_duration(out), 4)}


def _to_track_pcm(src: Path, dst: Path) -> None:
    """Converte para o formato da trilha (PCM 16 bits, mono, 44,1 kHz)."""
    _run(
        [
            _binary("ffmpeg"),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            str(TRACK_SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            "-map_metadata",
            "-1",
            "-fflags",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            str(dst),
        ],
        timeout=120,
    )


def voice_track(
    segments: list[dict], out_rel: str, lead_in_ms: int = 200, tail_ms: int = 500
) -> dict:
    """Junta os trechos de voz com as pausas pedidas e devolve onde cada um começa e termina.

    Cada trecho é {"path": relativo, "pause_after_ms": int}. Os tempos servem para alinhar
    expressões e gestos do personagem ao áudio.
    """
    if not segments:
        raise MediaToolError("nenhum trecho de voz")
    if len(segments) > 200:
        raise MediaToolError("trechos demais")
    out = safe_path(out_rel)
    if out.suffix != ".wav":
        raise MediaToolError("a saída precisa ser .wav")
    out.parent.mkdir(parents=True, exist_ok=True)
    rate = TRACK_SAMPLE_RATE

    def silence(ms: int) -> bytes:
        return b"\x00\x00" * (rate * max(0, min(ms, 10_000)) // 1000)

    placed: list[dict] = []
    tmp = out.with_suffix(".part.wav")
    with wave.open(str(out), "wb") as track:
        track.setnchannels(1)
        track.setsampwidth(2)
        track.setframerate(rate)
        cursor = 0  # em amostras
        track.writeframes(silence(lead_in_ms))
        cursor += rate * max(0, lead_in_ms) // 1000
        for seg in segments:
            src = safe_path(str(seg["path"]))
            if not src.is_file():
                raise MediaToolError(f"trecho não encontrado: {seg['path']}")
            _to_track_pcm(src, tmp)
            with wave.open(str(tmp), "rb") as part:
                frames = part.readframes(part.getnframes())
            start = cursor
            track.writeframes(frames)
            cursor += len(frames) // 2
            placed.append({"start": round(start / rate, 4), "end": round(cursor / rate, 4)})
            pause = int(seg.get("pause_after_ms", 0))
            track.writeframes(silence(pause))
            cursor += rate * max(0, min(pause, 10_000)) // 1000
        track.writeframes(silence(tail_ms))
        cursor += rate * max(0, tail_ms) // 1000
    tmp.unlink(missing_ok=True)
    return {"path": _relative(out), "duration_sec": round(cursor / rate, 4), "segments": placed}


def lipsync(audio_rel: str) -> dict:
    """Formas de boca (A-H e X, padrão Preston Blair) por instante, via Rhubarb.

    `-r phonetic` porque a fala é em português; `--threads 1` para o resultado não variar.
    """
    src = safe_path(audio_rel)
    if not src.is_file():
        raise MediaToolError("áudio não encontrado")
    duration = wav_duration(src) if src.suffix == ".wav" else 60.0
    raw = _run(
        [_rhubarb(), "-r", "phonetic", "-f", "json", "--threads", "1", "-q", str(src)],
        timeout=max(60.0, duration * 6),
    )
    data = json.loads(raw)
    cues = [
        {"start": float(c["start"]), "end": float(c["end"]), "value": str(c["value"])}
        for c in data.get("mouthCues", [])
    ]
    return {"duration_sec": round(duration, 4), "mouth_cues": cues}


def video_frame_hashes(video_rel: str) -> dict:
    """MD5 de cada quadro decodificado (para provar que dois renders são idênticos)."""
    src = safe_path(video_rel)
    if not src.is_file():
        raise MediaToolError("vídeo não encontrado")
    raw = _run(
        [
            _binary("ffmpeg"),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-map",
            "0:v:0",
            "-f",
            "framemd5",
            "-",
        ],
        timeout=600,
    )
    hashes = [line.split(",")[-1].strip() for line in raw.splitlines() if line and line[0] != "#"]
    return {"frames": len(hashes), "hashes": hashes}
