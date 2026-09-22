from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException, Request, Response

from server import db
from server.auth import create_session, is_admin, rate_limit, set_passphrase, verify_passphrase
from server.migrate_to_postgres import import_sqlite
from server.models import PostIn
from server.routers import v1


POSTGRES_BIN = Path("/usr/lib/postgresql/14/bin")


@pytest.fixture
def postgres_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    initdb = POSTGRES_BIN / "initdb"
    pg_ctl = POSTGRES_BIN / "pg_ctl"
    if not initdb.is_file() or not pg_ctl.is_file():
        pytest.skip("local PostgreSQL binaries are unavailable")
    cluster = tmp_path / "pgdata"
    socket_dir = tmp_path / "pgsocket"
    socket_dir.mkdir()
    log = tmp_path / "postgres.log"
    port = 5432
    subprocess.run(
        [
            str(initdb), "-D", str(cluster), "--auth=trust", "--username=postgres",
            "--no-locale", "--encoding=UTF8",
        ],
        check=True, capture_output=True, text=True,
    )
    try:
        subprocess.run(
            [
                str(pg_ctl), "-D", str(cluster), "-l", str(log),
                "-o", f"-F -c listen_addresses='' -k {socket_dir} -p {port}", "-w", "start",
            ],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError:
        pytest.skip("the test sandbox does not allow a local PostgreSQL socket")
    url = f"postgresql:///postgres?host={socket_dir}&port={port}&user=postgres"
    monkeypatch.setenv("DATABASE_URL", url)
    try:
        yield url
    finally:
        subprocess.run(
            [str(pg_ctl), "-D", str(cluster), "-m", "fast", "-w", "stop"],
            check=False, capture_output=True, text=True,
        )


def test_postgres_schema_sqlite_import_and_restart_persistence(postgres_url, tmp_path):
    source = tmp_path / "legacy.db"
    uploads = tmp_path / "legacy-uploads"
    uploads.mkdir()
    db.init_db(source)
    body = b"durable postgres upload"
    stored_name = "legacy-upload.png"
    (uploads / stored_name).write_bytes(body)
    with db.connect(source) as con:
        con.execute("INSERT INTO settings(key,value) VALUES('passphrase_hash','legacy-owner-hash')")
        con.execute(
            "INSERT INTO content(key,json,published,version) VALUES('site',?,1,4)",
            (json.dumps({"site_title": "Postgres portfolio"}),),
        )
        con.execute(
            "INSERT INTO media_assets(stored_name,original_name,mime_type,byte_size,sha256,alt_text) "
            "VALUES(?,?,?,?,?,?)",
            (
                stored_name, "legacy.png", "image/png", len(body),
                hashlib.sha256(body).hexdigest(), "Legacy upload",
            ),
        )

    imported = import_sqlite(source, uploads)
    assert imported["status"] == "imported" and imported["files"] == 1
    assert db.schema_version() == db.MIGRATIONS[-1][0]
    assert db.get_content("site") == {"site_title": "Postgres portfolio"}
    assert db.get_blob(stored_name)["data"] == body

    # Exercise PostgreSQL inserts/RETURNING, a caught unique violation, auth,
    # and a second initialization that represents a fresh dyno process.
    created = v1.create_post(PostIn(slug="postgres-post", title="Postgres", body_md="Body", published=True))
    assert created["id"] > 0
    with pytest.raises(HTTPException) as duplicate:
        v1.create_post(PostIn(slug="postgres-post", title="Duplicate", body_md="Body", published=True))
    assert duplicate.value.status_code == 409
    set_passphrase("postgres owner passphrase")
    assert verify_passphrase("postgres owner passphrase")
    session_response = Response()
    create_session(session_response)
    session_cookie = session_response.headers.getlist("set-cookie")[0].split(";", 1)[0]
    request = Request({
        "type": "http", "method": "GET", "path": "/api/v1/admin/me",
        "headers": [(b"cookie", session_cookie.encode())], "query_string": b"",
        "client": ("127.0.0.1", 1234), "server": ("testserver", 80), "scheme": "http",
    })
    assert is_admin(request)
    rate_limit(request, "postgres-test", limit=1, window=60)
    with pytest.raises(HTTPException) as limited:
        rate_limit(request, "postgres-test", limit=1, window=60)
    assert limited.value.status_code == 429
    db.init_db()
    assert db.get_content("site") == {"site_title": "Postgres portfolio"}
    assert db.get_blob(stored_name)["data"] == body
    assert verify_passphrase("postgres owner passphrase")
