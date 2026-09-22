"""Safe operational commands for migration, backup, restore and retention."""
from __future__ import annotations

import argparse
import json
import os
import struct
from datetime import UTC, datetime
from pathlib import Path

from . import config, db
from .auth import set_passphrase
from .legal import attribution_manifest


def migrate() -> None:
    target = config.database_path()
    previous = db.schema_version()
    latest = db.MIGRATIONS[-1][0]
    if db.is_sqlite() and target.exists() and previous < latest:
        backup = db.backup_database()
        print(f"pre-migration backup: {backup}")
    db.init_db()
    copied = db.backfill_local_blobs()
    if copied:
        print(f"legacy uploads copied into database: {copied}")
    print(f"schema version: {db.schema_version()}")


def cleanup() -> dict[str, int]:
    """Apply the documented 90-day privacy and session retention rules."""
    with db.connect() as con:
        private = con.execute(
            """DELETE FROM messages WHERE datetime(created_at) <= datetime('now','-90 days')
                AND (status IN ('pending','rejected') OR (status='approved' AND published_at IS NULL))"""
        ).rowcount
        contacts = con.execute(
            "UPDATE messages SET contact='' WHERE contact!='' AND datetime(created_at) <= datetime('now','-90 days')"
        ).rowcount
        events = con.execute(
            "DELETE FROM stat_events WHERE datetime(created_at) <= datetime('now','-90 days')"
        ).rowcount
        sessions = con.execute("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").rowcount
        limits = con.execute("DELETE FROM rate_limits WHERE datetime(expires_at) <= datetime('now')").rowcount
        detail = {"messages_deleted": private, "contacts_erased": contacts, "events_deleted": events, "sessions_deleted": sessions, "rate_limits_deleted": limits}
        con.execute("INSERT INTO operational_runs(command,detail) VALUES('retention',?)", (json.dumps(detail),))
    return detail


def verify_attribution() -> None:
    failures = []
    for entry in attribution_manifest():
        paths = (
            config.PROJECT_DIR / "reference_assets" / "original_models" / entry["asset"],
            config.PROJECT_DIR / "static" / "assets" / "models" / entry["asset"],
        )
        for path in paths:
            label = str(path.relative_to(config.PROJECT_DIR))
            if not path.is_file():
                failures.append(f"missing {label}")
                continue
            raw = path.read_bytes()
            if raw[:4] != b"glTF":
                failures.append(f"{label} is not a GLB")
                continue
            length, chunk_type = struct.unpack_from("<II", raw, 12)
            if chunk_type != 0x4E4F534A:
                failures.append(f"{label} has no JSON metadata chunk")
                continue
            metadata = json.loads(raw[20:20 + length].rstrip(b" \x00")).get("asset", {}).get("extras", {})
            if metadata.get("title") != entry["title"] or metadata.get("source") != entry["source"]:
                failures.append(f"{label} metadata does not match attribution.json")
            expected_license = entry["license"].replace(" ", "-")
            if expected_license not in metadata.get("license", ""):
                failures.append(f"{label} is missing {entry['license']} metadata")
    if failures:
        raise SystemExit("\n".join(failures))
    print("all model attribution metadata verified")


def main() -> None:
    parser = argparse.ArgumentParser(description="Portfolio database operations")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    backup_parser = sub.add_parser("backup")
    backup_parser.add_argument("destination", nargs="?")
    restore_parser = sub.add_parser("restore")
    restore_parser.add_argument("source")
    sub.add_parser("retention")
    password_parser = sub.add_parser("set-passphrase")
    password_parser.add_argument("--value", help="Prefer ADMIN_PASSPHRASE to avoid shell history")
    reset_parser = sub.add_parser("reset-passphrase")
    reset_parser.add_argument("--confirm", action="store_true", help="Required: return owner access to first-run setup")
    sub.add_parser("verify-attribution")
    args = parser.parse_args()
    if args.command == "migrate":
        migrate()
    elif args.command == "backup":
        print(db.backup_database(args.destination))
    elif args.command == "restore":
        print(f"safety copy: {db.restore_database(args.source)}")
    elif args.command == "retention":
        print(json.dumps(cleanup(), indent=2))
    elif args.command == "set-passphrase":
        value = args.value or os.environ.get("ADMIN_PASSPHRASE", "")
        if not value:
            raise SystemExit("set ADMIN_PASSPHRASE or pass --value")
        db.init_db()
        set_passphrase(value)
        print("passphrase changed; all admin sessions revoked")
    elif args.command == "reset-passphrase":
        if not args.confirm:
            raise SystemExit("pass --confirm to return owner access to first-run setup")
        db.init_db()
        with db.connect() as con:
            con.execute("DELETE FROM sessions")
            con.execute("DELETE FROM settings WHERE key IN ('passphrase_hash','passphrase_salt')")
        print("owner access reset; /admin will ask you to create a new passphrase")
    elif args.command == "verify-attribution":
        verify_attribution()


if __name__ == "__main__":
    main()
