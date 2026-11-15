# syntax=docker/dockerfile:1.7
# Worker de mídia: Python 3.11 + FFmpeg + espeak-ng (voz falsa) + Rhubarb Lip Sync
# (+ faster-whisper e PySceneDetect nas próximas fases).
ARG PYTHON_IMAGE=python:3.11-slim-bookworm
ARG UBUNTU_IMAGE=ubuntu:24.04

# uv (gerenciador de pacotes Python) instalado do PyPI numa etapa descartável.
FROM ${PYTHON_IMAGE} AS uv
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca pip install --no-cache-dir uv==0.11.32

# Rhubarb Lip Sync (MIT, github.com/DanielSWolf/rhubarb-lip-sync): baixado do release
# oficial e conferido pelo SHA-256 antes de extrair. Só o binário e os recursos (res/).
FROM ${PYTHON_IMAGE} AS rhubarb
ARG RHUBARB_VERSION=1.14.0
ARG RHUBARB_SHA256=a9a9074862cff47b2d59b8bf399a678a3b0b74f9452ad6ad94cb292913dd8667
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca
RUN --mount=type=secret,id=extra_ca,required=false with-ca python - <<'PY'
import hashlib, io, os, stat, urllib.request, zipfile
version, expected = os.environ["RHUBARB_VERSION"], os.environ["RHUBARB_SHA256"]
base = f"Rhubarb-Lip-Sync-{version}-Linux/"
url = f"https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v{version}/{base[:-1]}.zip"
data = urllib.request.urlopen(url, timeout=600).read()
digest = hashlib.sha256(data).hexdigest()
if digest != expected:
    raise SystemExit(f"SHA-256 do Rhubarb não confere: {digest}")
with zipfile.ZipFile(io.BytesIO(data)) as z:
    for name in z.namelist():
        rel = name[len(base):]
        if not name.startswith(base) or not (rel == "rhubarb" or rel.startswith("res/") or rel == "LICENSE.md"):
            continue
        target = os.path.join("/opt/rhubarb", rel)
        if name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(z.read(name))
binary = "/opt/rhubarb/rhubarb"
os.chmod(binary, os.stat(binary).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
print("Rhubarb", version, "ok")
PY

# ---------------------------------------------------------------- runtime (servidor)
FROM ${UBUNTU_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive TZ=America/Sao_Paulo \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata ffmpeg espeak-ng \
 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /usr/local/bin/uv /usr/local/bin/uv
COPY --from=rhubarb /opt/rhubarb /opt/rhubarb
ENV RHUBARB_BIN=/opt/rhubarb/rhubarb
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca
WORKDIR /srv
COPY apps/worker-media/pyproject.toml apps/worker-media/uv.lock ./
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca uv python install 3.11 && with-ca uv sync --frozen --no-dev --python 3.11
COPY apps/worker-media/app ./app
RUN useradd --create-home --uid 1001 media && mkdir -p /data/work && chown -R media:media /data
USER media
EXPOSE 4300
# O teste ignora proxy de propósito: o Docker Desktop repassa o proxy do Windows aos containers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request as u,sys; sys.exit(0 if u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:4300/health', timeout=4).status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4300", "--no-server-header"]

# ---------------------------------------------------------------- test (pytest + ruff)
FROM runtime AS test
USER root
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca uv sync --frozen --python 3.11
COPY apps/worker-media/tests ./tests
COPY apps/worker-media/pyproject.toml ./
USER media
ENV RUFF_NO_CACHE=true
CMD ["sh", "-c", "ruff check . && ruff format --check . && pytest -q -p no:cacheprovider"]

# ---------------------------------------------------------------- worker-media (padrão)
# Última etapa = imagem usada quando ninguém escolhe um alvo: sempre o servidor.
FROM runtime AS worker-media
