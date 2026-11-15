"""Voz falsa (espeak-ng), trilha de voz, Rhubarb e hash de quadros.

Os testes que dependem dos binários rodam na imagem de teste (make test), onde eles
estão instalados; fora dela são pulados.
"""

import math
import os
import shutil
import struct
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import media_tools
from app.main import app
from app.media_tools import MediaToolError, clean_text, tts_espeak, voice_track, wav_duration

HAS_FFMPEG = shutil.which("ffmpeg") is not None
HAS_ESPEAK = shutil.which("espeak-ng") is not None
HAS_RHUBARB = os.path.isfile(media_tools.RHUBARB_BIN)


@pytest.fixture(autouse=True)
def work_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(media_tools, "WORK_ROOT", tmp_path)
    return tmp_path


def make_tone(path: Path, seconds: float, rate: int = 22050, freq: float = 220.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(seconds * rate)
        w.writeframes(
            b"".join(
                struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate)))
                for i in range(n)
            )
        )


def test_texto_limpo_sem_controle():
    assert clean_text("  Fala,\tgalera!\n\x07 Zeca ") == "Fala, galera! Zeca"


def test_espeak_recusa_entradas_fora_da_regra():
    with pytest.raises(MediaToolError, match="voz não permitida"):
        tts_espeak("oi", "a.wav", voice="xx")
    with pytest.raises(MediaToolError, match="vazio"):
        tts_espeak("\n\t", "a.wav")
    with pytest.raises(MediaToolError, match="maior que"):
        tts_espeak("a" * 2001, "a.wav")
    with pytest.raises(MediaToolError, match="fora da pasta"):
        tts_espeak("oi", "../fora.wav")
    with pytest.raises(MediaToolError, match=".wav"):
        tts_espeak("oi", "a.mp3")


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg ausente")
def test_trilha_junta_trechos_com_pausas_e_marca_os_tempos(work_root: Path):
    make_tone(work_root / "job/s0.wav", 1.0)
    make_tone(work_root / "job/s1.wav", 0.5, rate=16000)
    res = voice_track(
        [{"path": "job/s0.wav", "pause_after_ms": 300}, {"path": "job/s1.wav"}],
        "job/voz.wav",
        lead_in_ms=200,
        tail_ms=500,
    )
    assert res["path"] == "job/voz.wav"
    s0, s1 = res["segments"]
    assert s0 == {"start": 0.2, "end": 1.2}
    assert s1["start"] == pytest.approx(1.5, abs=0.001)
    assert s1["end"] == pytest.approx(2.0, abs=0.002)
    assert res["duration_sec"] == pytest.approx(2.5, abs=0.002)
    assert wav_duration(work_root / "job/voz.wav") == pytest.approx(res["duration_sec"], abs=0.001)
    assert not (work_root / "job/voz.part.wav").exists()


def test_trilha_recusa_trecho_inexistente_ou_fora_da_pasta():
    with pytest.raises(MediaToolError, match="não encontrado"):
        voice_track([{"path": "nada.wav"}], "voz.wav")
    with pytest.raises(MediaToolError, match="fora da pasta"):
        voice_track([{"path": "../../etc/passwd"}], "voz.wav")


def test_rotas_recusam_caminho_absoluto_ou_com_caracteres_estranhos():
    client = TestClient(app)
    assert client.post("/tts/espeak", json={"text": "oi", "out": "/etc/x.wav"}).status_code == 422
    assert client.post("/lipsync", json={"audio": "a b.wav"}).status_code == 422
    res = client.post("/tts/espeak", json={"text": "oi", "out": "a.wav", "voice": "xx"})
    assert res.status_code == 400
    assert "voz não permitida" in res.json()["error"]


@pytest.mark.skipif(
    not (HAS_FFMPEG and HAS_ESPEAK and HAS_RHUBARB), reason="espeak-ng/Rhubarb fora da imagem"
)
def test_texto_vira_voz_trilha_e_bocas_sempre_iguais(work_root: Path):
    client = TestClient(app)
    trechos = ["Fala, galera! Aqui é o Zeca Neon.", "E hoje tem notícia quente de GTA seis."]
    for i, texto in enumerate(trechos):
        res = client.post("/tts/espeak", json={"text": texto, "out": f"job/s{i}.wav"})
        assert res.status_code == 200, res.text
        assert res.json()["duration_sec"] > 0.5
    body = {
        "segments": [{"path": "job/s0.wav", "pause_after_ms": 250}, {"path": "job/s1.wav"}],
        "out": "job/voz.wav",
    }
    track = client.post("/audio/voice-track", json=body).json()
    assert len(track["segments"]) == 2
    first = client.post("/lipsync", json={"audio": "job/voz.wav"}).json()
    second = client.post("/lipsync", json={"audio": "job/voz.wav"}).json()
    assert first == second  # determinístico
    shapes = {c["value"] for c in first["mouth_cues"]}
    assert len(first["mouth_cues"]) > 10
    assert shapes <= set("ABCDEFGHX")
    assert len(shapes - {"X"}) >= 3  # a boca mexe de verdade
    health = client.get("/health").json()
    assert health["espeak"] != "indisponível"
    assert health["rhubarb"].startswith("1.14")


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg ausente")
def test_hash_de_quadros_igual_para_o_mesmo_video(work_root: Path):
    import subprocess

    out = work_root / "v.mp4"
    subprocess.run(  # noqa: S603
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x64:rate=10:duration=1",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        check=True,
    )
    client = TestClient(app)
    a = client.post("/video/frame-hashes", json={"video": "v.mp4"}).json()
    b = client.post("/video/frame-hashes", json={"video": "v.mp4"}).json()
    assert a["frames"] == 10
    assert a == b
