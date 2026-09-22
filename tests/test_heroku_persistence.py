from __future__ import annotations

import json
import hashlib

import pytest

from server import config, db
from server.db_compat import postgres_sql
from server.migrate_to_postgres import import_sqlite


def test_postgres_sql_compatibility_translation():
    translated = postgres_sql(
        "SELECT date(created_at) day FROM stat_events "
        "WHERE datetime(expires_at)>datetime('now') AND day>=date('now','-6 days') AND event_type=?"
    )
    assert "TIMESTAMPTZ" in translated
    assert "CURRENT_TIMESTAMP" in translated
    assert "CURRENT_DATE - 6" in translated
    assert "event_type=%s" in translated
    assert postgres_sql("BEGIN IMMEDIATE") == "BEGIN"


def test_sqlite_import_is_read_only_idempotent_and_copies_uploads(tmp_path, monkeypatch):
    source = tmp_path / "source.db"
    uploads = tmp_path / "source-uploads"
    uploads.mkdir()
    db.init_db(source)
    media_body = b"small durable image payload"
    media_name = "asset-123.png"
    (uploads / media_name).write_bytes(media_body)
    with db.connect(source) as con:
        con.execute("INSERT INTO settings(key,value) VALUES('passphrase_hash','owner-hash')")
        con.execute(
            "INSERT INTO content(key,json,published,version) VALUES('site',?,1,3)",
            (json.dumps({"site_title": "Imported portfolio"}),),
        )
        con.execute(
            "INSERT INTO media_assets(stored_name,original_name,mime_type,byte_size,sha256,alt_text) "
            "VALUES(?,?,?,?,?,?)",
            (media_name, "photo.png", "image/png", len(media_body), hashlib.sha256(media_body).hexdigest(), "Imported photo"),
        )
    source_before = source.read_bytes()

    result = import_sqlite(source, uploads)
    assert result["status"] == "imported" and result["files"] == 1
    assert source.read_bytes() == source_before
    assert db.get_setting("passphrase_hash") == "owner-hash"
    assert db.get_content("site") == {"site_title": "Imported portfolio"}
    assert db.get_blob(media_name)["data"] == media_body

    repeated = import_sqlite(source, uploads)
    assert repeated["status"] == "already_imported"
    db.init_db()  # a simulated process restart must not reset imported state
    assert db.get_setting("passphrase_hash") == "owner-hash"
    assert db.get_blob(media_name)["data"] == media_body


def test_heroku_without_managed_persistence_fails_closed(monkeypatch):
    monkeypatch.setenv("DYNO", "web.1")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ADMIN_PASSPHRASE", "deployment-passphrase")
    monkeypatch.setenv("ADMIN_RECOVERY_TOKEN", "separate-recovery-token")
    monkeypatch.setenv("PORTFOLIO_BASE_URL", "https://example.herokuapp.com")
    monkeypatch.setenv("PORTFOLIO_ALLOWED_ORIGINS", "https://example.herokuapp.com")
    monkeypatch.setenv("PORTFOLIO_SECURE_COOKIES", "true")
    monkeypatch.setenv("PORTFOLIO_TRUST_PROXY_HEADERS", "true")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        config.validate_runtime()
