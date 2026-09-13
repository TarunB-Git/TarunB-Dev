from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def isolated_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data = tmp_path / "data"
    monkeypatch.setenv("PORTFOLIO_DATA_DIR", str(data))
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(data / "site.db"))
    monkeypatch.setenv("PORTFOLIO_UPLOAD_DIR", str(data / "uploads"))
    monkeypatch.setenv("PORTFOLIO_BACKUP_DIR", str(data / "backups"))
    monkeypatch.setenv("PORTFOLIO_BASE_URL", "http://testserver")
    monkeypatch.setenv("PORTFOLIO_SECURE_COOKIES", "false")
    from server import db
    db.init_db()
    yield data
