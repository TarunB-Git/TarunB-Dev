from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.cookies import SimpleCookie

import pytest
from fastapi import HTTPException, Request, Response

from server import db
from server.auth import (
    CSRF_COOKIE, SESSION_COOKIE, create_session, is_admin, rate_limit,
    require_admin_write, set_passphrase, verify_passphrase,
)


def request(*, cookies: dict[str, str] | None = None, headers: dict[str, str] | None = None) -> Request:
    raw = {key.lower(): value for key, value in (headers or {}).items()}
    if cookies:
        raw["cookie"] = "; ".join(f"{key}={value}" for key, value in cookies.items())
    return Request({
        "type": "http", "method": "POST", "path": "/api/v1/admin/test",
        "headers": [(key.encode(), value.encode()) for key, value in raw.items()],
        "client": ("127.0.0.1", 1234), "server": ("testserver", 80),
        "scheme": "http", "query_string": b"",
    })


def response_cookies(response: Response) -> dict[str, str]:
    jar: dict[str, str] = {}
    for value in response.headers.getlist("set-cookie"):
        parsed = SimpleCookie(); parsed.load(value)
        jar.update({key: morsel.value for key, morsel in parsed.items()})
    return jar


def test_numbered_migration_preserves_and_quarantines_legacy(tmp_path):
    legacy = tmp_path / "legacy.db"
    con = sqlite3.connect(legacy)
    con.execute("CREATE TABLE content(key TEXT PRIMARY KEY,json TEXT NOT NULL)")
    con.execute("INSERT INTO content VALUES('card',?)", (json.dumps({"email": "alex@example.com"}),))
    con.commit(); con.close()
    db.init_db(legacy)
    con = sqlite3.connect(legacy)
    assert con.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == db.MIGRATIONS[-1][0]
    assert con.execute("SELECT json FROM content WHERE key='card'").fetchone() is not None
    assert con.execute("SELECT published FROM content WHERE key='card'").fetchone()[0] == 0
    assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_wal_foreign_keys_and_busy_timeout():
    with db.connect() as con:
        assert con.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert con.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert con.execute("PRAGMA busy_timeout").fetchone()[0] >= 1000


def test_argon_session_csrf_and_origin():
    set_passphrase("correct horse battery staple")
    assert verify_passphrase("correct horse battery staple")
    assert not verify_passphrase("incorrect passphrase")
    assert db.get_setting("passphrase_hash", "").startswith("$argon2id$")
    response = Response()
    csrf = create_session(response)
    cookies = response_cookies(response)
    req = request(cookies=cookies, headers={"X-CSRF-Token": csrf, "Origin": "http://testserver"})
    assert SESSION_COOKIE in cookies and CSRF_COOKIE in cookies and is_admin(req)
    require_admin_write(req)
    with pytest.raises(HTTPException) as missing:
        require_admin_write(request(cookies=cookies, headers={"Origin": "http://testserver"}))
    assert missing.value.status_code == 403
    with pytest.raises(HTTPException) as cross_site:
        require_admin_write(request(cookies=cookies, headers={"X-CSRF-Token": csrf, "Origin": "https://evil.example"}))
    assert cross_site.value.status_code == 403


def test_rate_limit_survives_process_local_state():
    req = request()
    rate_limit(req, "test", limit=2, window=60)
    rate_limit(req, "test", limit=2, window=60)
    with pytest.raises(HTTPException) as limited:
        rate_limit(req, "test", limit=2, window=60)
    assert limited.value.status_code == 429
    with db.connect() as con:
        assert con.execute("SELECT hits FROM rate_limits WHERE bucket='test'").fetchone()[0] == 3


def test_expired_admin_session_is_rejected():
    set_passphrase("correct horse battery staple")
    response = Response()
    csrf = create_session(response)
    cookies = response_cookies(response)
    req = request(cookies=cookies, headers={"X-CSRF-Token": csrf, "Origin": "http://testserver"})
    assert is_admin(req)
    with db.connect() as con:
        con.execute("UPDATE sessions SET expires_at=datetime('now','-1 minute')")
    assert not is_admin(req)
    with pytest.raises(HTTPException) as expired:
        require_admin_write(req)
    assert expired.value.status_code == 401


def test_admin_session_rotates_token_and_csrf_and_checks_generation(monkeypatch):
    monkeypatch.setenv("PORTFOLIO_SECURE_COOKIES", "true")
    set_passphrase("correct horse battery staple")
    initial_response = Response()
    initial_csrf = create_session(initial_response)
    initial = response_cookies(initial_response)
    old_request = request(
        cookies=initial,
        headers={"X-CSRF-Token": initial_csrf, "Origin": "http://testserver"},
    )
    with db.connect() as con:
        con.execute(
            "UPDATE sessions SET created_at=datetime('now','-25 hours'), "
            "expires_at=datetime('now','+6 days'), last_seen_at=datetime('now','-25 hours')"
        )

    rotated_response = Response()
    require_admin_write(old_request, rotated_response)
    replacement = response_cookies(rotated_response)
    assert replacement[SESSION_COOKIE] != initial[SESSION_COOKIE]
    assert replacement[CSRF_COOKIE] != initial[CSRF_COOKIE]
    assert "HttpOnly" in rotated_response.headers.getlist("set-cookie")[0]
    assert "Secure" in rotated_response.headers.getlist("set-cookie")[0]
    assert "SameSite=strict" in rotated_response.headers.getlist("set-cookie")[0]

    # The replacement is usable immediately, while a distinct request with the
    # old token is rejected after the atomic database update.
    assert not is_admin(request(cookies=initial))
    new_request = request(
        cookies=replacement,
        headers={"X-CSRF-Token": replacement[CSRF_COOKIE], "Origin": "http://testserver"},
    )
    assert is_admin(new_request)
    require_admin_write(new_request)
    with db.connect() as con:
        row = con.execute("SELECT created_at,expires_at,last_seen_at,session_generation FROM sessions").fetchone()
        created = datetime.fromisoformat(row["created_at"])
        expires = datetime.fromisoformat(row["expires_at"])
        last_seen = datetime.fromisoformat(row["last_seen_at"])
        assert last_seen >= created
        assert timedelta(days=6, hours=23) < expires - created <= timedelta(days=7)
        con.execute(
            "INSERT INTO settings(key,value) VALUES('session_generation',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(int(row["session_generation"]) + 1),),
        )
    assert not is_admin(request(cookies=replacement))


def test_concurrent_sqlite_writes_complete_under_wal():
    def write(index: int) -> None:
        with db.connect() as con:
            con.execute(
                "INSERT INTO settings(key,value) VALUES(?,?)",
                (f"concurrent-{index}", str(index)),
            )

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(write, range(32)))

    with db.connect() as con:
        count = con.execute(
            "SELECT COUNT(*) FROM settings WHERE key LIKE 'concurrent-%'",
        ).fetchone()[0]
    assert count == 32
