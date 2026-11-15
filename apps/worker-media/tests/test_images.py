"""Imagens da Biblioteca na pasta de trabalho e quadros para o Revisor visual (Fase 3)."""

import base64
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import media_tools
from app.main import app
from app.media_tools import MediaToolError, import_image, video_keyframes

HAS_FFMPEG = shutil.which("ffmpeg") is not None
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def work_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(media_tools, "WORK_ROOT", tmp_path)
    return tmp_path


def test_import_image_confere_tipo_e_caminho(work_root: Path) -> None:
    r = import_image("assets/abc.png", base64.b64encode(PNG).decode())
    assert r == {"path": "assets/abc.png", "bytes": len(PNG)}
    assert (work_root / "assets/abc.png").read_bytes() == PNG
    with pytest.raises(MediaToolError, match="não bate"):
        import_image("assets/x.jpg", base64.b64encode(PNG).decode())
    with pytest.raises(MediaToolError, match=".png, .jpg ou .webp"):
        import_image("assets/x.svg", base64.b64encode(PNG).decode())
    with pytest.raises(MediaToolError, match="fora da pasta"):
        import_image("../fora.png", base64.b64encode(PNG).decode())


def test_rotas_de_imagem_e_info(work_root: Path) -> None:
    client = TestClient(app)
    data = base64.b64encode(PNG).decode()
    assert client.post("/image/import", json={"out": "assets/a.png", "data_b64": data}).json()[
        "bytes"
    ] == len(PNG)
    assert client.post("/file/info", json={"path": "assets/a.png"}).json()["exists"] is True
    assert client.post("/file/info", json={"path": "assets/b.png"}).json() == {"exists": False}
    bad = client.post("/image/import", json={"out": "/etc/x.png", "data_b64": data})
    assert bad.status_code == 422


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg ausente")
def test_quadros_chave_e_previa(work_root: Path) -> None:
    video = work_root / "v.mp4"
    subprocess.run(  # noqa: S603, S607 - teste
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=10:duration=2",
            "-pix_fmt",
            "yuv420p",
            str(video),
        ],
        check=True,
    )
    r = video_keyframes("v.mp4", [0.2, 1.5], width=320)
    assert [f["t"] for f in r["frames"]] == [0.2, 1.5]
    assert all(base64.b64decode(f["jpeg_b64"])[:2] == b"\xff\xd8" for f in r["frames"])
    with pytest.raises(MediaToolError, match="1 a 16"):
        video_keyframes("v.mp4", [0.1] * 17)
    png = work_root / "thumb.png"
    subprocess.run(  # noqa: S603, S607 - teste
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720",
            "-frames:v",
            "1",
            str(png),
        ],
        check=True,
    )
    prev = TestClient(app).post("/image/preview", json={"image": "thumb.png", "width": 512}).json()
    assert base64.b64decode(prev["jpeg_b64"])[:2] == b"\xff\xd8"
