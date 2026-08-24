"""Paths and env loading. Credentials stay in dev/admin/.env."""

from __future__ import annotations

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent
ADMIN_ROOT = REPO_ROOT / "dev" / "admin"
ADMIN_SERVER = ADMIN_ROOT / "server"
ADMIN_ENV = ADMIN_ROOT / ".env"


def corpus_dir() -> Path:
    override = os.environ.get("FLYWHEEL_CORPUS_DIR", "").strip()
    if override:
        return Path(override)
    return PACKAGE_DIR / "corpus"


def env_file() -> Path:
    override = os.environ.get("FLYWHEEL_ENV_FILE", "").strip()
    if override:
        return Path(override)
    return ADMIN_ENV


def load_env_file_into_environ(path: Path) -> None:
    """Load KEY=VALUE lines into os.environ without overriding existing vars."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
