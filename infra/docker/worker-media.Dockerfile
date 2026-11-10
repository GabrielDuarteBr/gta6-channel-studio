# syntax=docker/dockerfile:1.7
# Worker de mídia: Python 3.11 + FFmpeg (+ faster-whisper, PySceneDetect e Rhubarb nas próximas fases).
ARG PYTHON_IMAGE=python:3.11-slim-bookworm
ARG UBUNTU_IMAGE=ubuntu:24.04

# uv (gerenciador de pacotes Python) instalado do PyPI numa etapa descartável.
FROM ${PYTHON_IMAGE} AS uv
COPY infra/docker/with-ca.sh /usr/local/bin/with-ca
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca pip install --no-cache-dir uv==0.11.32

FROM ${UBUNTU_IMAGE} AS worker-media
ENV DEBIAN_FRONTEND=noninteractive TZ=America/Sao_Paulo \
    UV_PYTHON_INSTALL_DIR=/opt/python UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /usr/local/bin/uv /usr/local/bin/uv
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
FROM worker-media AS test
USER root
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca uv sync --frozen --python 3.11
COPY apps/worker-media/tests ./tests
COPY apps/worker-media/pyproject.toml ./
USER media
ENV RUFF_NO_CACHE=true
CMD ["sh", "-c", "ruff check . && ruff format --check . && pytest -q -p no:cacheprovider"]
