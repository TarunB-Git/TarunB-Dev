"""Content-addressed URLs for checked-in browser assets."""
from __future__ import annotations

import hashlib
from pathlib import Path

from . import config


STATIC_DIR = config.PROJECT_DIR / "static"


def _asset_version() -> str:
    """Return a stable build id for every browser-executable static asset."""
    digest = hashlib.sha256()
    for target in sorted(path for path in STATIC_DIR.rglob("*") if path.is_file()):
        # HTML is served dynamically and never receives immutable caching.
        if target.suffix.lower() in {".html", ".htm"}:
            continue
        relative = target.relative_to(STATIC_DIR).as_posix().encode()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        with target.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()[:16]


ASSET_NAMESPACE = f"v-{_asset_version()}"


def asset_url(path: str) -> str:
    return f"/static/{ASSET_NAMESPACE}/{path.lstrip('/')}"


def version_asset_urls(source: str) -> str:
    """Place checked-in assets behind a content-derived immutable URL."""
    return source.replace("/static/", f"/static/{ASSET_NAMESPACE}/")
