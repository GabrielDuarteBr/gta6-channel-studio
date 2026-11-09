"""Ferramentas de mídia com operações fechadas.

Regra do projeto: FFmpeg e afins só rodam por funções tipadas, com argumentos
montados aqui (lista, sem shell) e caminhos restritos à pasta de trabalho.
Nada de comando livre.
"""

from __future__ import annotations

import shutil
import subprocess  # noqa: S404 - uso restrito a binários fixos, sem shell
from functools import lru_cache
from pathlib import Path

WORK_ROOT = Path("/data/work")


class MediaToolError(RuntimeError):
    """Falha numa ferramenta de mídia."""


def _binary(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise MediaToolError(f"binário não encontrado: {name}")
    return path


def safe_path(relative: str, root: Path = WORK_ROOT) -> Path:
    """Resolve um caminho relativo garantindo que fique dentro da pasta de trabalho."""
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()):
        raise MediaToolError("caminho fora da pasta de trabalho")
    return candidate


@lru_cache(maxsize=1)
def ffmpeg_version() -> str:
    """Primeira linha de `ffmpeg -version` (cacheada)."""
    out = subprocess.run(  # noqa: S603 - argumentos fixos
        [_binary("ffmpeg"), "-hide_banner", "-version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    first = out.stdout.splitlines()[0] if out.stdout else ""
    parts = first.split()
    return parts[2] if len(parts) > 2 else first
