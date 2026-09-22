"""Non-destructively import the current SQLite installation into PostgreSQL.

The source database is always opened read-only.  The command is intentionally
idempotent: a target records the complete source fingerprint after a successful
transaction and a repeat run becomes a no-op.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from . import config, db


TABLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("settings", ("key",)),
    ("content", ("key",)),
    ("timeline_periods", ("id",)),
    ("media_assets", ("id",)),
    ("timeline_events", ("id",)),
    ("blog_posts", ("id",)),
    ("comments", ("id",)),
    ("reactions", ("post_id", "visitor_id", "emoji")),
    ("likes", ("post_id", "visitor_id")),
    ("messages", ("id",)),
    ("stat_events", ("id",)),
    ("sessions", ("token",)),
    ("content_revisions", ("id",)),
    ("daily_stats", ("day", "event_type", "path", "source")),
    ("rate_limits", ("subject_hash", "bucket", "window_start")),
    ("legal_settings", ("key",)),
    ("operational_runs", ("id",)),
    ("daily_audience", ("day", "dimension", "value")),
    ("file_blobs", ("key",)),
)


def _table_names(source: sqlite3.Connection) -> set[str]:
    return {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _fingerprint(source_path: Path, upload_dir: Path) -> str:
    digest = hashlib.sha256()
    for database_file in (source_path, Path(str(source_path) + "-wal")):
        if not database_file.is_file():
            continue
        digest.update(database_file.name.encode())
        with database_file.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    if upload_dir.is_dir():
        for path in sorted(item for item in upload_dir.iterdir() if item.is_file()):
            digest.update(path.name.encode())
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
    return digest.hexdigest()


def _upsert(connection, table: str, keys: tuple[str, ...], row: dict) -> None:
    columns = tuple(row)
    placeholders = ",".join("?" for _ in columns)
    updates = [column for column in columns if column not in keys]
    conflict = ",".join(keys)
    action = (
        "DO UPDATE SET " + ",".join(f"{column}=excluded.{column}" for column in updates)
        if updates else "DO NOTHING"
    )
    connection.execute(
        f"INSERT INTO {table}({','.join(columns)}) VALUES({placeholders}) "
        f"ON CONFLICT({conflict}) {action}",
        tuple(row[column] for column in columns),
    )


def _target_has_content(connection) -> bool:
    for table in ("settings", "content", "timeline_periods", "timeline_events", "blog_posts", "messages", "media_assets"):
        if connection.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
            return True
    return False


def _local_file_candidates(source: sqlite3.Connection, names: set[str]) -> dict[str, tuple[str, str]]:
    result: dict[str, tuple[str, str]] = {}
    if "media_assets" in names:
        for row in source.execute("SELECT stored_name,mime_type,original_name FROM media_assets"):
            result[row["stored_name"]] = (row["mime_type"], row["original_name"])
    if "content" in names:
        row = source.execute("SELECT json FROM content WHERE key='resume_pdf'").fetchone()
        if row:
            try:
                metadata = json.loads(row["json"])
            except (TypeError, json.JSONDecodeError):
                metadata = {}
            if isinstance(metadata, dict) and metadata.get("stored_name"):
                result[str(metadata["stored_name"])] = (
                    "application/pdf", str(metadata.get("original_name") or "resume.pdf"),
                )
    return result


def import_sqlite(source_path: str | Path, upload_dir: str | Path | None = None) -> dict:
    source_path = Path(source_path).resolve()
    upload_dir = Path(upload_dir).resolve() if upload_dir else source_path.parent / "uploads"
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    if db.is_sqlite() and config.database_path().resolve() == source_path:
        raise RuntimeError("source and destination databases must be different")
    fingerprint = _fingerprint(source_path, upload_dir)
    db.init_db()

    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        names = _table_names(source)
        with db.connect() as target:
            imported = target.execute(
                "SELECT value FROM settings WHERE key='sqlite_import_sha256'"
            ).fetchone()
            if imported and imported["value"] == fingerprint:
                return {"status": "already_imported", "fingerprint": fingerprint, "tables": {}, "files": 0}
            if imported or _target_has_content(target):
                raise RuntimeError(
                    "destination already contains application data; use a fresh Postgres database "
                    "or restore its backup before importing"
                )

            counts: dict[str, int] = {}
            for table, keys in TABLES:
                if table not in names:
                    continue
                order = ",".join(keys)
                rows = [dict(row) for row in source.execute(f"SELECT * FROM {table} ORDER BY {order}")]
                for row in rows:
                    _upsert(target, table, keys, row)
                counts[table] = len(rows)

            existing_blobs = set()
            if "file_blobs" in names:
                existing_blobs = {row[0] for row in source.execute("SELECT key FROM file_blobs")}
            copied_files = 0
            for key, (mime_type, original_name) in _local_file_candidates(source, names).items():
                if key in existing_blobs:
                    continue
                path = (upload_dir / key).resolve()
                if path.parent != upload_dir or not path.is_file():
                    raise FileNotFoundError(f"required upload is missing: {path}")
                db.put_blob(key, path.read_bytes(), mime_type, original_name=original_name, con=target)
                copied_files += 1

            target.execute(
                "INSERT INTO settings(key,value) VALUES('sqlite_import_sha256',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (fingerprint,),
            )
            if db.is_postgres():
                for table in db_compat_serial_tables():
                    target.execute(
                        f"SELECT setval(pg_get_serial_sequence('{table}','id'), "
                        f"COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM {table}"
                    )
        return {"status": "imported", "fingerprint": fingerprint, "tables": counts, "files": copied_files}
    finally:
        source.close()


def db_compat_serial_tables() -> tuple[str, ...]:
    # Kept local to make the migration report deterministic and avoid relying
    # on set iteration order.
    return (
        "timeline_periods", "media_assets", "timeline_events", "blog_posts", "comments",
        "messages", "stat_events", "content_revisions", "operational_runs",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a portfolio SQLite database into DATABASE_URL")
    parser.add_argument("--sqlite", required=True, help="path to the existing site.db")
    parser.add_argument("--uploads", help="legacy upload directory (defaults beside site.db)")
    arguments = parser.parse_args()
    if config.database_backend() != "postgres":
        raise SystemExit("DATABASE_URL must point to the destination PostgreSQL database")
    result = import_sqlite(arguments.sqlite, arguments.uploads)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
