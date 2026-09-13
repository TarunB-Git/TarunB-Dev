"""Runtime configuration.

All mutable state lives below ``PORTFOLIO_DATA_DIR`` unless a more specific
path is supplied.  Keeping this module deliberately small makes it easy for
commands and tests to use the same configuration as the web process.
"""
from __future__ import annotations

import os
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def data_dir() -> Path:
    return Path(os.environ.get("PORTFOLIO_DATA_DIR", Path(__file__).resolve().parent)).resolve()


def database_path() -> Path:
    return Path(os.environ.get("PORTFOLIO_DB_PATH", data_dir() / "site.db")).resolve()


def upload_dir() -> Path:
    return Path(os.environ.get("PORTFOLIO_UPLOAD_DIR", data_dir() / "uploads")).resolve()


def backup_dir() -> Path:
    return Path(os.environ.get("PORTFOLIO_BACKUP_DIR", data_dir() / "backups")).resolve()


def base_url() -> str:
    return os.environ.get("PORTFOLIO_BASE_URL", "http://localhost:8000").rstrip("/")


def allowed_origins() -> set[str]:
    configured = os.environ.get("PORTFOLIO_ALLOWED_ORIGINS", "")
    origins = {item.strip().rstrip("/") for item in configured.split(",") if item.strip()}
    origins.add(base_url())
    return origins


def secure_cookies() -> bool:
    return _env_bool("PORTFOLIO_SECURE_COOKIES", base_url().startswith("https://"))


def trust_proxy_headers() -> bool:
    return _env_bool("PORTFOLIO_TRUST_PROXY_HEADERS", False)


MAX_UPLOAD_BYTES = int(os.environ.get("PORTFOLIO_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
MAX_REQUEST_BYTES = int(os.environ.get("PORTFOLIO_MAX_REQUEST_BYTES", str(128 * 1024)))
SQLITE_BUSY_TIMEOUT_MS = int(os.environ.get("PORTFOLIO_SQLITE_BUSY_TIMEOUT_MS", "5000"))

