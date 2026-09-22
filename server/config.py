"""Runtime configuration.

All mutable state lives below ``PORTFOLIO_DATA_DIR`` unless a more specific
path is supplied.  Keeping this module deliberately small makes it easy for
commands and tests to use the same configuration as the web process.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


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


def database_url() -> str:
    """Return the managed database URL, if one was configured."""
    return os.environ.get("DATABASE_URL", "").strip()


def database_backend() -> str:
    value = database_url()
    if not value:
        return "sqlite"
    scheme = urlparse(value).scheme.lower()
    if scheme in {"postgres", "postgresql"}:
        return "postgres"
    raise RuntimeError("DATABASE_URL must use postgres:// or postgresql://")


def is_heroku() -> bool:
    return bool(os.environ.get("DYNO"))


def validate_runtime() -> None:
    """Fail closed before a Heroku web process can use disposable storage."""
    if not is_heroku():
        return
    missing = []
    if not database_url():
        missing.append("DATABASE_URL")
    for name in (
        "ADMIN_PASSPHRASE", "ADMIN_RECOVERY_TOKEN", "PORTFOLIO_BASE_URL",
        "PORTFOLIO_ALLOWED_ORIGINS",
    ):
        if not os.environ.get(name, "").strip():
            missing.append(name)
    if missing:
        raise RuntimeError("Heroku persistence/security configuration is incomplete: " + ", ".join(missing))
    if not secure_cookies():
        raise RuntimeError("PORTFOLIO_SECURE_COOKIES must be true on Heroku")
    if not trust_proxy_headers():
        raise RuntimeError("PORTFOLIO_TRUST_PROXY_HEADERS must be true on Heroku")


def upload_dir() -> Path:
    return Path(os.environ.get("PORTFOLIO_UPLOAD_DIR", data_dir() / "uploads")).resolve()


def backup_dir() -> Path:
    return Path(os.environ.get("PORTFOLIO_BACKUP_DIR", data_dir() / "backups")).resolve()


def base_url() -> str:
    return os.environ.get(
        "PORTFOLIO_BASE_URL",
        os.environ.get("RENDER_EXTERNAL_URL", f"http://localhost:{os.environ.get('PORT', '8800')}"),
    ).rstrip("/")


def allowed_origins() -> set[str]:
    configured = os.environ.get("PORTFOLIO_ALLOWED_ORIGINS", "")
    origins = {item.strip().rstrip("/") for item in configured.split(",") if item.strip()}
    origins.add(base_url())
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    if render_url:
        origins.add(render_url)
    return origins


def secure_cookies() -> bool:
    return _env_bool("PORTFOLIO_SECURE_COOKIES", base_url().startswith("https://"))


def trust_proxy_headers() -> bool:
    return _env_bool("PORTFOLIO_TRUST_PROXY_HEADERS", False)


def admin_recovery_token() -> str:
    """Return the deployment-owned credential used for passphrase recovery."""
    return os.environ.get("ADMIN_RECOVERY_TOKEN", "").strip()


def code_content_preview() -> bool:
    """Read-only preview of code-defined text; persisted owner data is untouched."""
    return os.environ.get("PORTFOLIO_CONTENT_SOURCE", "database").strip().lower() == "code"


MAX_UPLOAD_BYTES = int(os.environ.get("PORTFOLIO_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
MAX_DATABASE_ASSET_BYTES = int(os.environ.get("PORTFOLIO_MAX_DATABASE_ASSET_BYTES", str(256 * 1024 * 1024)))
MAX_REQUEST_BYTES = int(os.environ.get("PORTFOLIO_MAX_REQUEST_BYTES", str(128 * 1024)))
SQLITE_BUSY_TIMEOUT_MS = int(os.environ.get("PORTFOLIO_SQLITE_BUSY_TIMEOUT_MS", "5000"))
