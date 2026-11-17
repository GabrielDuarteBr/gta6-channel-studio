"""Ferramentas de mídia com operações fechadas.

Regra do projeto: FFmpeg e afins só rodam por funções tipadas, com argumentos
montados aqui (lista, sem shell) e caminhos restritos à pasta de trabalho.
Nada de comando livre.
"""

from __future__ import annotations

import base64
import binascii
import io
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


MAX_IMPORT_BYTES = 30 * 1024 * 1024


def import_wav(out_rel: str, data_b64: str) -> dict:
    """Grava um WAV recebido (ex.: voz do provedor real) depois de conferir que é PCM de verdade.

    Escreve num arquivo temporário e troca no fim (nunca deixa um WAV pela metade).
    """
    out = safe_path(out_rel)
    if out.suffix != ".wav":
        raise MediaToolError("a saída precisa ser .wav")
    if len(data_b64) > MAX_IMPORT_BYTES * 4 // 3 + 4:
        raise MediaToolError("áudio grande demais")
    try:
        data = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MediaToolError("áudio não está em base64") from exc
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise MediaToolError("não é um arquivo WAV")
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getsampwidth() != 2 or w.getnframes() == 0:
                raise MediaToolError("WAV precisa ser PCM 16 bits e não vazio")
    except wave.Error as exc:
        raise MediaToolError(f"WAV inválido: {exc}") from exc
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.wav")
    tmp.write_bytes(data)
    tmp.replace(out)
    return {"path": _relative(out), "duration_sec": round(wav_duration(out), 4)}


def audio_info(rel: str) -> dict:
    """Existe? Qual a duração? (cache de voz: o mesmo texto não é pago duas vezes)."""
    path = safe_path(rel)
    if not path.is_file() or path.suffix != ".wav":
        return {"exists": False}
    try:
        return {
            "exists": True,
            "path": _relative(path),
            "duration_sec": round(wav_duration(path), 4),
        }
    except (wave.Error, EOFError):
        return {"exists": False}


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


# ---------------------------------------------------------------------------
# Fase 3: imagens da Biblioteca na pasta de trabalho e quadros para o Revisor visual
# ---------------------------------------------------------------------------

MAX_IMAGE_BYTES = 25 * 1024 * 1024
IMAGE_SUFFIXES = {".png": b"\x89PNG\r\n\x1a\n", ".jpg": b"\xff\xd8", ".webp": b"RIFF"}
MAX_KEYFRAMES = 16


def _run_bytes(args: list[str], timeout: float) -> bytes:
    try:
        out = subprocess.run(  # noqa: S603 - binário fixo, argumentos montados aqui
            args, check=True, capture_output=True, timeout=timeout
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] or [""]
        raise MediaToolError(f"{Path(args[0]).name} falhou: {detail[0][:300]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError(f"{Path(args[0]).name} demorou demais") from exc
    return out.stdout


def import_image(out_rel: str, data_b64: str) -> dict:
    """Grava uma imagem da Biblioteca na pasta de trabalho (para o render), conferindo o tipo."""
    out = safe_path(out_rel)
    magic = IMAGE_SUFFIXES.get(out.suffix)
    if magic is None:
        raise MediaToolError("a saída precisa ser .png, .jpg ou .webp")
    if len(data_b64) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise MediaToolError("imagem grande demais")
    try:
        data = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MediaToolError("imagem não está em base64") from exc
    if not data.startswith(magic) or (out.suffix == ".webp" and data[8:12] != b"WEBP"):
        raise MediaToolError("o conteúdo não bate com a extensão da imagem")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(out)
    return {"path": _relative(out), "bytes": len(data)}


def file_info(rel: str) -> dict:
    """Existe? Quantos bytes? (para não copiar de novo uma imagem que já está lá)."""
    path = safe_path(rel)
    if not path.is_file():
        return {"exists": False}
    return {"exists": True, "path": _relative(path), "bytes": path.stat().st_size}


def _jpeg_b64(args: list[str]) -> str:
    data = _run_bytes(args, timeout=120)
    if not data.startswith(b"\xff\xd8"):
        raise MediaToolError("não saiu JPEG")
    return base64.b64encode(data).decode()


def video_keyframes(video_rel: str, times: list[float], width: int = 768) -> dict:
    """Quadros (JPEG, base64) nos instantes pedidos, reduzidos para o Revisor visual."""
    src = safe_path(video_rel)
    if not src.is_file():
        raise MediaToolError("vídeo não encontrado")
    if not 1 <= len(times) <= MAX_KEYFRAMES:
        raise MediaToolError(f"peça de 1 a {MAX_KEYFRAMES} quadros")
    if not 256 <= width <= 1280:
        raise MediaToolError("largura entre 256 e 1280")
    frames = []
    for t in times:
        if t < 0:
            raise MediaToolError("instante negativo")
        data = _jpeg_b64(
            [
                _binary("ffmpeg"),
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{t:.3f}",
                "-i",
                str(src),
                "-frames:v",
                "1",
                "-vf",
                f"scale={width}:-2",
                "-q:v",
                "4",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-",
            ]
        )
        frames.append({"t": round(t, 3), "jpeg_b64": data})
    return {"frames": frames}


def image_preview(image_rel: str, width: int = 768) -> dict:
    """Prévia JPEG (base64) de uma imagem da pasta de trabalho (ex.: thumbnail para o Revisor)."""
    src = safe_path(image_rel)
    if not src.is_file() or src.suffix not in IMAGE_SUFFIXES:
        raise MediaToolError("imagem não encontrada")
    if not 256 <= width <= 1280:
        raise MediaToolError("largura entre 256 e 1280")
    data = _jpeg_b64(
        [
            _binary("ffmpeg"),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2",
            "-q:v",
            "4",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-",
        ]
    )
    return {"jpeg_b64": data}


# ---------------------------------------------------------------------------
# Fase 4: vídeos de parceiros (dados do arquivo, trocas de cena, corte do trecho)
# ---------------------------------------------------------------------------

VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".mkv", ".webm", ".m4v"})
MAX_VIDEO_SECONDS = 60 * 60
CLIP_BOX = (1280, 720)
CLIP_FPS = 30
MAX_CLIP_SECONDS = 60.0
MAX_SPEECH_RANGES = 400


def _video_src(rel: str) -> Path:
    src = safe_path(rel)
    if not src.is_file():
        raise MediaToolError("vídeo não encontrado")
    if src.suffix.lower() not in VIDEO_SUFFIXES:
        raise MediaToolError("formato de vídeo não aceito (mp4, mov, mkv, webm, m4v)")
    return src


def _fps(rate: str) -> float:
    try:
        num, _, den = rate.partition("/")
        value = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0
    return round(value, 3)


def video_probe(rel: str) -> dict:
    """Dados do vídeo (duração, tamanho, quadros por segundo, áudio) pelo ffprobe."""
    src = _video_src(rel)
    raw = _run(
        [
            _binary("ffprobe"),
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(src),
        ],
        timeout=60,
    )
    data = json.loads(raw)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise MediaToolError("o arquivo não tem vídeo")
    try:
        duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    except ValueError:
        duration = 0.0
    if duration <= 0:
        raise MediaToolError("não consegui ler a duração do vídeo")
    if duration > MAX_VIDEO_SECONDS:
        raise MediaToolError("vídeo com mais de 1 hora")
    return {
        "path": _relative(src),
        "duration_sec": round(duration, 3),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "fps": _fps(str(video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1")),
        "video_codec": str(video.get("codec_name") or ""),
        "has_audio": audio is not None,
        "audio_codec": str(audio.get("codec_name") or "") if audio else "",
        "bytes": src.stat().st_size,
    }


def scene_changes(rel: str, threshold: float = 10.0) -> dict:
    """Instantes de troca de cena (filtro scdet do FFmpeg, em vídeo reduzido para ir rápido)."""
    src = _video_src(rel)
    if not 1.0 <= threshold <= 50.0:
        raise MediaToolError("limiar de cena entre 1 e 50")
    out = _run(
        [
            _binary("ffmpeg"),
            "-hide_banner",
            "-nostats",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-an",
            "-vf",
            f"scale=320:-2,scdet=threshold={threshold:g}:sc_pass=0,"
            "metadata=print:key=lavfi.scd.time:file=-",
            "-f",
            "null",
            "-",
        ],
        timeout=900,
    )
    times: list[float] = []
    for line in out.splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "lavfi.scd.time":
            try:
                times.append(round(float(value), 3))
            except ValueError:
                continue
    return {"scenes": sorted(set(times))}


def _gain_expression(ranges: list[tuple[float, float]]) -> str:
    """Volume 1 dentro dos trechos de fala e 0 fora (expressão do filtro volume)."""
    if not ranges:
        return "0"
    parts = [f"between(t,{a:.3f},{b:.3f})" for a, b in ranges]
    return f"min(1,{'+'.join(parts)})"


def cut_clip(
    src_rel: str,
    out_rel: str,
    start: float,
    end: float,
    audio_mode: str,
    speech_ranges: list[list[float]] | None = None,
) -> dict:
    """Corta um trecho do vídeo do parceiro para o Short de react.

    Vídeo: 30 quadros/s, cabendo em 1280x720 sem distorcer. Áudio (regra 2):
    - "voice": só os trechos de fala do parceiro (o resto, como música e TV, fica mudo);
    - "full": áudio original inteiro (o dono marcou que não há música/filme/TV de terceiros);
    - "mute": sem áudio.
    """
    src = _video_src(src_rel)
    out = safe_path(out_rel)
    if out.suffix != ".mp4":
        raise MediaToolError("a saída precisa ser .mp4")
    if audio_mode not in {"voice", "full", "mute"}:
        raise MediaToolError("modo de áudio inválido")
    if not video_probe(src_rel)["has_audio"]:
        audio_mode = "mute"
    if start < 0 or end <= start:
        raise MediaToolError("trecho inválido")
    if end - start > MAX_CLIP_SECONDS:
        raise MediaToolError(f"trecho maior que {MAX_CLIP_SECONDS:.0f} s")
    ranges: list[tuple[float, float]] = []
    for item in speech_ranges or []:
        if len(item) != 2:
            raise MediaToolError("trecho de fala inválido")
        a, b = max(float(item[0]), start), min(float(item[1]), end)
        if b > a:
            ranges.append((round(a - start, 3), round(b - start, 3)))
    if len(ranges) > MAX_SPEECH_RANGES:
        raise MediaToolError("trechos de fala demais")
    w, h = CLIP_BOX
    vf = (
        f"scale=w={w}:h={h}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
        f"fps={CLIP_FPS},format=yuv420p"
    )
    args = [
        _binary("ffmpeg"),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(src),
        "-map",
        "0:v:0",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-map_metadata",
        "-1",
    ]
    if audio_mode == "mute":
        args += ["-an"]
    else:
        gain = "1" if audio_mode == "full" else _gain_expression(ranges)
        args += [
            "-map",
            "0:a:0?",
            "-af",
            f"volume='{gain}':eval=frame,loudnorm=I=-16:TP=-1.5:LRA=11,"
            "aresample=48000,aformat=channel_layouts=stereo",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ]
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.stem}.tmp.mp4")
    _run([*args, "-movflags", "+faststart", str(tmp)], timeout=600)
    tmp.replace(out)
    probe = video_probe(_relative(out))
    return {
        "path": _relative(out),
        "duration_sec": probe["duration_sec"],
        "width": probe["width"],
        "height": probe["height"],
        "audio_mode": audio_mode,
        "speech_ranges": [[a, b] for a, b in ranges],
    }


MAX_ARCHIVE_FILES = 50
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024


def extract_videos(zip_rel: str, out_dir_rel: str, max_files: int = 20) -> dict:
    """Tira os vídeos de uma pasta baixada em .zip (link de pasta do Dropbox).

    Só arquivos de vídeo, sem subpastas no destino (nada escapa da pasta de trabalho) e com
    limite de quantidade e de tamanho descompactado.
    """
    import zipfile

    src = safe_path(zip_rel)
    if not src.is_file() or src.suffix != ".zip":
        raise MediaToolError("arquivo .zip não encontrado")
    if not 1 <= max_files <= MAX_ARCHIVE_FILES:
        raise MediaToolError(f"de 1 a {MAX_ARCHIVE_FILES} arquivos")
    out_dir = safe_path(out_dir_rel)
    out_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[dict] = []
    total = 0
    try:
        with zipfile.ZipFile(src) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = Path(info.filename).name
                suffix = Path(name).suffix.lower()
                if suffix not in VIDEO_SUFFIXES or name.startswith("."):
                    continue
                if len(extracted) >= max_files:
                    break
                total += info.file_size
                if total > MAX_ARCHIVE_BYTES:
                    raise MediaToolError("pasta grande demais depois de descompactada")
                safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[-120:]
                target = safe_path(f"{out_dir_rel}/{len(extracted):02d}-{safe_name}")
                with zf.open(info) as fin, target.open("wb") as fout:
                    shutil.copyfileobj(fin, fout, length=1024 * 1024)
                extracted.append(
                    {"path": _relative(target), "name": name, "bytes": target.stat().st_size}
                )
    except zipfile.BadZipFile as exc:
        raise MediaToolError("o .zip está corrompido") from exc
    return {"files": extracted}
