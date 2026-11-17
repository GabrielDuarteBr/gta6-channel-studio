"""Vídeos de parceiros (Fase 4): dados do arquivo, cenas, corte com só a voz, zip e transcrição."""

import math
import shutil
import struct
import subprocess
import wave
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import media_tools, transcribe
from app.main import app
from app.media_tools import MediaToolError, cut_clip, extract_videos, scene_changes, video_probe

HAS_FFMPEG = shutil.which("ffmpeg") is not None
HAS_ESPEAK = shutil.which("espeak-ng") is not None


@pytest.fixture(autouse=True)
def work_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(media_tools, "WORK_ROOT", tmp_path)
    return tmp_path


def _tone_wav(path: Path, seconds: float, freq: float = 440.0, rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(int(seconds * rate))
        )
        w.writeframes(frames)


def _make_clip(work_root: Path, name: str = "parceiro.mp4", speech: Path | None = None) -> Path:
    """Vídeo de 9 s com 3 cenas (6, 3 s...) e áudio: fala (ou tom) + tom de "música"."""
    voice = speech or work_root / "voz.wav"
    if speech is None:
        _tone_wav(voice, 3.0, 300)
    music = work_root / "musica.wav"
    _tone_wav(music, 4.0, 660)
    out = work_root / name
    subprocess.run(  # noqa: S603, S607 - teste
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
            "-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=3",
            "-f", "lavfi", "-i", "color=c=magenta:size=640x360:rate=30:duration=3",
            "-i", str(voice), "-i", str(music),
            "-filter_complex",
            "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v];"
            "[3:a]aresample=44100,apad=pad_dur=0.5[a1];[4:a]aresample=44100[a2];"
            "[a1][a2]concat=n=2:v=0:a=1,apad[a]",
            "-map", "[v]", "-map", "[a]", "-t", "9",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(out),
        ],
        check=True,
    )  # fmt: skip
    return out


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg ausente")
def test_dados_do_video_e_trocas_de_cena(work_root: Path) -> None:
    _make_clip(work_root)
    probe = video_probe("parceiro.mp4")
    assert probe["width"] == 640 and probe["height"] == 360
    assert probe["has_audio"] is True
    assert 8.9 <= probe["duration_sec"] <= 9.2
    scenes = scene_changes("parceiro.mp4")["scenes"]
    assert any(abs(t - 3) < 0.2 for t in scenes) and any(abs(t - 6) < 0.2 for t in scenes)
    with pytest.raises(MediaToolError, match="não encontrado"):
        video_probe("nao-existe.mp4")
    (work_root / "texto.txt").write_text("oi")
    with pytest.raises(MediaToolError, match="formato"):
        video_probe("texto.txt")


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg ausente")
def test_corte_so_com_a_voz_deixa_o_resto_mudo(work_root: Path) -> None:
    _make_clip(work_root)
    r = cut_clip("parceiro.mp4", "react/c1.mp4", 1.0, 8.0, "voice", [[0.0, 3.0]])
    assert r["speech_ranges"] == [[0.0, 2.0]]
    assert 6.9 <= r["duration_sec"] <= 7.2
    # Sempre cabendo em 1280x720 (amplia vídeos pequenos, sem distorcer).
    assert (r["width"], r["height"]) == (1280, 720)

    def mean_volume(rel: str, ss: float, t: float) -> float:
        out = subprocess.run(  # noqa: S603, S607 - teste
            [
                "ffmpeg", "-hide_banner", "-nostats", "-ss", str(ss), "-t", str(t),
                "-i", str(work_root / rel), "-af", "volumedetect", "-f", "null", "-",
            ],
            capture_output=True, text=True, check=True,
        )  # fmt: skip
        line = next(x for x in out.stderr.splitlines() if "mean_volume" in x)
        return float(line.split("mean_volume:")[1].split("dB")[0])

    # Fala (0-2 s do corte) audível; "música" (depois de 3 s) muda.
    assert mean_volume("react/c1.mp4", 0.2, 1.5) > -40
    assert mean_volume("react/c1.mp4", 3.5, 3.0) < -70
    full = cut_clip("parceiro.mp4", "react/c2.mp4", 1.0, 8.0, "full")
    assert full["audio_mode"] == "full"
    assert mean_volume("react/c2.mp4", 3.5, 3.0) > -40
    mute = cut_clip("parceiro.mp4", "react/c3.mp4", 0.0, 2.0, "mute")
    assert video_probe(mute["path"])["has_audio"] is False
    with pytest.raises(MediaToolError, match="trecho maior"):
        cut_clip("parceiro.mp4", "react/x.mp4", 0, 61, "voice")
    with pytest.raises(MediaToolError, match="inválido"):
        cut_clip("parceiro.mp4", "react/x.mp4", 0, 2, "musica")
    with pytest.raises(MediaToolError, match="fora da pasta"):
        cut_clip("parceiro.mp4", "../x.mp4", 0, 2, "voice")


def test_zip_so_tira_videos_e_nao_escapa_da_pasta(work_root: Path) -> None:
    archive = work_root / "pasta.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Clipes/corte 1.mp4", b"\x00" * 100)
        zf.writestr("../../fora.mp4", b"\x00" * 50)
        zf.writestr("leia-me.txt", b"oi")
        zf.writestr("Clipes/.oculto.mp4", b"\x00")
    r = extract_videos("pasta.zip", "imports/x")
    names = sorted(f["name"] for f in r["files"])
    assert names == ["corte 1.mp4", "fora.mp4"]
    assert all(f["path"].startswith("imports/x/") for f in r["files"])
    assert not (work_root.parent / "fora.mp4").exists()
    (work_root / "ruim.zip").write_bytes(b"isso nao e zip")
    with pytest.raises(MediaToolError, match="corrompido"):
        extract_videos("ruim.zip", "imports/y")


def test_rotas_validam_entrada() -> None:
    client = TestClient(app)
    assert client.post("/video/probe", json={"video": "/etc/passwd"}).status_code == 422
    bad = client.post(
        "/video/cut",
        json={"video": "a.mp4", "out": "b.mp4", "start": 0, "end": 2, "audio_mode": "tudo"},
    )
    assert bad.status_code == 422
    assert (
        client.post("/video/analyze", json={"video": "a.mp4", "language": "pt-BR"}).status_code
        == 422
    )


def test_nivel_de_audio_por_segundo() -> None:
    np = pytest.importorskip("numpy")
    rate = 16000
    t = np.arange(rate * 2) / rate
    samples = np.concatenate([np.zeros(rate), 0.5 * np.sin(2 * np.pi * 440 * t[:rate])])
    levels = transcribe.loudness_per_second(samples.astype("float32"))
    assert levels[0] == -90.0
    assert -10 < levels[1] < -5


HAS_MODEL = (transcribe.WHISPER_MODEL_DIR / transcribe.WHISPER_MODEL / "model.bin").is_file()


@pytest.mark.skipif(
    not (HAS_FFMPEG and HAS_ESPEAK and HAS_MODEL), reason="espeak-ng/modelo Whisper fora da imagem"
)
def test_analise_transcreve_a_fala_e_separa_o_que_nao_e_voz(work_root: Path) -> None:
    fala = work_root / "fala.wav"
    subprocess.run(  # noqa: S603, S607 - teste
        ["espeak-ng", "-v", "pt-br", "-s", "150", "-w", str(fala), "--stdin"],
        input="A polícia está chegando pela ponte de Leonida.",
        text=True,
        check=True,
    )
    _make_clip(work_root, speech=fala)
    r = TestClient(app).post("/video/analyze", json={"video": "parceiro.mp4", "language": "pt"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["language"] == "pt"
    text = " ".join(s["text"] for s in data["segments"]).lower()
    assert "polícia" in text or "ponte" in text
    # Fala no começo; o tom de "música" (5-9 s) não é fala.
    assert data["speech"] and data["speech"][0][0] < 0.6
    assert all(b < 5.2 for _, b in data["speech"])
    assert 9 <= len(data["loudness"]) <= 10
    assert len(data["scenes"]) >= 2
