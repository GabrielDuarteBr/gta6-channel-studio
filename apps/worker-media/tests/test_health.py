from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.media_tools import MediaToolError, safe_path


def test_health_reporta_ffmpeg_e_python():
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "worker-media"
    assert body["python"].startswith("3.11")
    assert body["ffmpeg"]


def test_safe_path_bloqueia_fuga_da_pasta(tmp_path: Path):
    assert safe_path("a/b.mp4", root=tmp_path) == (tmp_path / "a/b.mp4").resolve()
    with pytest.raises(MediaToolError):
        safe_path("../../etc/passwd", root=tmp_path)
    with pytest.raises(MediaToolError):
        safe_path("/etc/passwd", root=tmp_path)


def test_sem_documentacao_publica_da_api():
    client = TestClient(app)
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
