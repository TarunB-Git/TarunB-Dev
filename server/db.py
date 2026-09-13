"""SQLite connection helpers and non-destructive numbered migrations."""
from __future__ import annotations

import json
import shutil
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import config


# Kept for older imports. New code calls ``config.database_path`` dynamically so
# tests and operational commands can safely point at a temporary database.
DB_PATH = config.database_path()
TIMELINE_PATHS = ("recruiter", "viewer", "friend", "personal")


def utcnow() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    target = Path(path) if path is not None else config.database_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(target, timeout=config.SQLITE_BUSY_TIMEOUT_MS / 1000)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(f"PRAGMA busy_timeout = {config.SQLITE_BUSY_TIMEOUT_MS}")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in con.execute(f'PRAGMA table_info("{table}")')}


def _add_column(con: sqlite3.Connection, table: str, declaration: str) -> None:
    name = declaration.split()[0].strip('"')
    if name not in _columns(con, table):
        con.execute(f'ALTER TABLE "{table}" ADD COLUMN {declaration}')


def _migration_001(con: sqlite3.Connection) -> None:
    """Create the original schema when installing on a fresh database."""
    statements = (
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS content (key TEXT PRIMARY KEY, json TEXT NOT NULL)",
        """CREATE TABLE IF NOT EXISTS timeline_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL CHECK (path IN ('recruiter','viewer','friend','personal')),
            year_label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL, subtitle TEXT DEFAULT '', description TEXT DEFAULT '',
            details TEXT DEFAULT '', links_json TEXT DEFAULT '[]',
            published INTEGER NOT NULL DEFAULT 1)""",
        """CREATE TABLE IF NOT EXISTS blog_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')), published INTEGER NOT NULL DEFAULT 1)""",
        """CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
            parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL DEFAULT 'anonymous', body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), hidden INTEGER NOT NULL DEFAULT 0)""",
        """CREATE TABLE IF NOT EXISTS reactions (
            post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
            visitor_id TEXT NOT NULL, emoji TEXT NOT NULL,
            PRIMARY KEY (post_id, visitor_id, emoji))""",
        """CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
            author_name TEXT NOT NULL DEFAULT 'anonymous', contact TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            approved INTEGER NOT NULL DEFAULT 0)""",
        """CREATE TABLE IF NOT EXISTS stat_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
            path TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'direct',
            created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
        "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE INDEX IF NOT EXISTS idx_timeline_path ON timeline_events(path, sort_order)",
        "CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)",
        "CREATE INDEX IF NOT EXISTS idx_stats_type ON stat_events(event_type, created_at)",
    )
    for statement in statements:
        con.execute(statement)


def _migration_002(con: sqlite3.Connection) -> None:
    """Add grouped timelines, revisions, moderation, analytics and operations."""
    con.execute("""CREATE TABLE IF NOT EXISTS timeline_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL CHECK (path IN ('recruiter','viewer','friend','personal')),
        label TEXT NOT NULL, slug TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        published INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(path, slug))""")
    con.execute("""CREATE TABLE IF NOT EXISTS media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, stored_name TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, alt_text TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')))""")
    for declaration in (
        "period_id INTEGER REFERENCES timeline_periods(id) ON DELETE RESTRICT",
        "slug TEXT", "category TEXT NOT NULL DEFAULT 'story'",
        "summary TEXT NOT NULL DEFAULT ''", "details_md TEXT NOT NULL DEFAULT ''",
        "layout TEXT NOT NULL DEFAULT 'feature'", "accent TEXT NOT NULL DEFAULT 'blue'",
        "media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL",
        "alt_text TEXT NOT NULL DEFAULT ''", "updated_at TEXT",
    ):
        _add_column(con, "timeline_events", declaration)

    # One period per legacy label makes every existing row immediately usable.
    for path in TIMELINE_PATHS:
        rows = con.execute(
            "SELECT year_label, MIN(sort_order) first_order FROM timeline_events "
            "WHERE path=? GROUP BY year_label ORDER BY first_order", (path,),
        ).fetchall()
        for index, row in enumerate(rows):
            base = _slug(row["year_label"]) or f"period-{index + 1}"
            slug = base
            suffix = 2
            while con.execute("SELECT 1 FROM timeline_periods WHERE path=? AND slug=?", (path, slug)).fetchone():
                slug = f"{base}-{suffix}"
                suffix += 1
            con.execute(
                "INSERT OR IGNORE INTO timeline_periods(path,label,slug,sort_order) VALUES(?,?,?,?)",
                (path, row["year_label"], slug, index),
            )
        con.execute(
            "UPDATE timeline_events SET period_id=(SELECT p.id FROM timeline_periods p "
            "WHERE p.path=timeline_events.path AND p.label=timeline_events.year_label LIMIT 1) "
            "WHERE path=? AND period_id IS NULL", (path,),
        )
    for row in con.execute("SELECT id,title,description,details FROM timeline_events").fetchall():
        con.execute(
            "UPDATE timeline_events SET slug=COALESCE(slug,?), summary=CASE WHEN summary='' THEN ? ELSE summary END, "
            "details_md=CASE WHEN details_md='' THEN ? ELSE details_md END, updated_at=COALESCE(updated_at,datetime('now')) "
            "WHERE id=?",
            (f"{_slug(row['title']) or 'event'}-{row['id']}", row["description"] or "", row["details"] or "", row["id"]),
        )
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_slug ON timeline_events(path, slug)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_period_path ON timeline_periods(path, sort_order)")

    for declaration in (
        "published INTEGER NOT NULL DEFAULT 1", "version INTEGER NOT NULL DEFAULT 1",
        "updated_at TEXT", "updated_by TEXT NOT NULL DEFAULT 'owner'",
    ):
        _add_column(con, "content", declaration)
    con.execute("UPDATE content SET updated_at=COALESCE(updated_at,datetime('now'))")
    con.execute("""CREATE TABLE IF NOT EXISTS content_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL DEFAULT '', entity_id INTEGER,
        payload_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')))""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_revisions_entity ON content_revisions(entity_type, entity_key, entity_id, id DESC)")

    for declaration in ("updated_at TEXT", "excerpt TEXT NOT NULL DEFAULT ''"):
        _add_column(con, "blog_posts", declaration)
    con.execute("UPDATE blog_posts SET updated_at=COALESCE(updated_at,created_at)")
    for declaration in (
        "depth INTEGER NOT NULL DEFAULT 0", "moderation_status TEXT NOT NULL DEFAULT 'visible'",
        "visitor_hash TEXT NOT NULL DEFAULT ''", "updated_at TEXT",
    ):
        _add_column(con, "comments", declaration)
    con.execute("UPDATE comments SET moderation_status=CASE WHEN hidden=1 THEN 'hidden' ELSE 'visible' END")
    con.execute("""CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        visitor_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(post_id, visitor_id))""")
    con.execute("INSERT OR IGNORE INTO likes(post_id,visitor_id) SELECT post_id,visitor_id FROM reactions WHERE emoji='❤️'")
    con.execute("DELETE FROM reactions WHERE emoji='❤️'")

    for declaration in (
        "status TEXT NOT NULL DEFAULT 'pending'", "publication_consent INTEGER NOT NULL DEFAULT 0",
        "consent_version TEXT", "consented_at TEXT", "public_display_name TEXT NOT NULL DEFAULT ''",
        "published_at TEXT", "updated_at TEXT",
    ):
        _add_column(con, "messages", declaration)
    con.execute("UPDATE messages SET status=CASE WHEN approved=1 THEN 'approved' ELSE 'pending' END, updated_at=COALESCE(updated_at,created_at)")

    for declaration in (
        "expires_at TEXT", "last_seen_at TEXT", "csrf_hash TEXT NOT NULL DEFAULT ''",
        "session_generation INTEGER NOT NULL DEFAULT 1",
    ):
        _add_column(con, "sessions", declaration)
    con.execute("UPDATE sessions SET expires_at=COALESCE(expires_at,datetime(created_at,'+7 days')), last_seen_at=COALESCE(last_seen_at,created_at)")

    for declaration in (
        "analytics_session TEXT NOT NULL DEFAULT ''", "event_id TEXT NOT NULL DEFAULT ''",
        "consented INTEGER NOT NULL DEFAULT 0",
    ):
        _add_column(con, "stat_events", declaration)
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_event_id ON stat_events(event_id) WHERE event_id!=''")
    con.execute("""CREATE TABLE IF NOT EXISTS daily_stats (
        day TEXT NOT NULL, event_type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(day,event_type,path,source))""")
    con.execute("""CREATE TABLE IF NOT EXISTS rate_limits (
        subject_hash TEXT NOT NULL, bucket TEXT NOT NULL, window_start INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL,
        PRIMARY KEY(subject_hash,bucket,window_start))""")
    con.execute("""CREATE TABLE IF NOT EXISTS legal_settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')))""")
    legal_keys = (
        "controller_name", "controller_contact", "purposes", "lawful_bases",
        "hosting_and_processors", "international_transfers", "retention",
        "data_rights", "consent_withdrawal", "supervisory_authority",
    )
    con.executemany("INSERT OR IGNORE INTO legal_settings(key) VALUES(?)", ((key,) for key in legal_keys))


def _migration_003(con: sqlite3.Connection) -> None:
    """Quarantine only exact prototype/demo material; never delete it."""
    con.execute(
        "UPDATE content SET published=0 WHERE key IN ('card','resume') "
        "AND (json LIKE '%alex@example.com%' OR json LIKE '%+15550001234%')"
    )
    demo_posts = (
        ("hello-world", "Hello, World (Again)", "Every developer rebuilds their personal site roughly every three years.%"),
        ("breaking-the-moon", "Why You Can Break the Moon", "Somewhere in the sky of this site there is a moon.%"),
        ("recruiter-mode", "Recruiter Mode: A Confession", "There is a toggle on my business card that turns the whole site light%"),
    )
    con.executemany(
        "UPDATE blog_posts SET published=0 WHERE slug=? AND title=? AND body_md LIKE ?", demo_posts,
    )
    demo_events = (
        ("B.S. Computer Science", "Systems focus; graphics electives that started the WebGL obsession."),
        ("Software Engineer", "Built real-time collaboration layer and keyboard shortcut system. Led REST → GraphQL migration."),
        ("Senior Engineer", "Core contributor to Next.js edge runtime. Shipped Incremental Static Regeneration — now used by 800k+ sites."),
        ("Staff Engineer", "Platform infrastructure serving 3M+ merchants. 40% API latency reduction via distributed caching redesign."),
        ('"Why Your API Is Lying to You"', "280,000 reads. An argument about honest interface design."),
        ("DevBridge", "45,000 installs. Automates the design-handoff busywork."),
        ("OpenCache", "Distributed cache layer, 12,000 GitHub stars."),
        ("The First Machine", "A hand-me-down computer, a broken game, and the discovery that the rules of a world are written by someone — and could be rewritten."),
        ("Falling for the Web", "The browser as the most democratic runtime ever shipped. JavaScript, TypeScript, React, Three.js — tools for building places, not pages."),
        ("From Pages to Experiences", "The moment a UI became invisible because it felt natural. Interfaces should disappear; the thought should remain."),
        ("The Architect", "Building software at the intersection of craft and experience. Long enough at it to know the work; still curious enough to be surprised."),
        ("[First crew]", "[Who they were, what you played, what you still remember. The inside jokes that survived.]"),
        ("[The lunch table]", "[Interests you shared, the projects and schemes, what each of them is doing now.]"),
        ("[The late-night lab]", "[The all-nighters, the terrible cafeteria, the people who made it survivable. Messages from each.]"),
        ("[The group chat]", "[Where everyone ended up. The annual meetup that happens every two years.]"),
        ("[First fun project]", "[The thing you built for no reason except that it was cool.]"),
        ("[A book that rewired you]", "[What it was, what it changed.]"),
        ("[A milestone]", "[First job, first ship, first user who wasn't your mom.]"),
        ("This website", "A 3D world with four doors, a moon you can break, and bamboo slips that insult your judgment."),
    )
    con.executemany("UPDATE timeline_events SET published=0 WHERE title=? AND description=?", demo_events)
    con.execute(
        "UPDATE timeline_periods SET published=0 WHERE NOT EXISTS ("
        "SELECT 1 FROM timeline_events e WHERE e.period_id=timeline_periods.id AND e.published=1)"
    )


def _migration_004(con: sqlite3.Connection) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS operational_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, command TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_messages_retention ON messages(status, created_at)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_stats_cleanup ON stat_events(created_at)")


def _migration_005(con: sqlite3.Connection) -> None:
    """Retire mutable/placeholder attribution and social-link documents."""
    con.execute("UPDATE content SET published=0 WHERE key='attribution'")
    con.execute("UPDATE content SET published=0 WHERE key='friend_links' AND json LIKE '%\"href\": \"#\"%'")


def _migration_006(con: sqlite3.Connection) -> None:
    """Complete the mandatory editable legal-document fields."""
    con.executemany(
        "INSERT OR IGNORE INTO legal_settings(key,required) VALUES(?,1)",
        ((key,) for key in ("cookie_details", "terms", "last_updated")),
    )


def _migration_007(con: sqlite3.Connection) -> None:
    """Store only coarse, consented audience aggregates.

    Each dimension is counted separately. No visitor-level demographic
    profile or sensitive-trait inference is retained.
    """
    con.execute("""CREATE TABLE IF NOT EXISTS daily_audience (
        day TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(day,dimension,value))""")


MIGRATIONS: tuple[tuple[int, str, Callable[[sqlite3.Connection], None]], ...] = (
    (1, "legacy baseline", _migration_001),
    (2, "content platform", _migration_002),
    (3, "quarantine prototype content", _migration_003),
    (4, "operations indexes", _migration_004),
    (5, "immutable credits and draft links", _migration_005),
    (6, "complete legal document fields", _migration_006),
    (7, "coarse audience aggregates", _migration_007),
)


def _slug(value: str) -> str:
    chars: list[str] = []
    dash = False
    for char in value.lower():
        if char.isalnum():
            chars.append(char)
            dash = False
        elif chars and not dash:
            chars.append("-")
            dash = True
    return "".join(chars).strip("-")[:72]


def init_db(path: str | Path | None = None) -> None:
    target = Path(path) if path is not None else config.database_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    config.upload_dir().mkdir(parents=True, exist_ok=True)
    with connect(target) as con:
        con.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY, name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')))""")
        applied = {row["version"] for row in con.execute("SELECT version FROM schema_migrations")}
        for version, name, migration in MIGRATIONS:
            if version in applied:
                continue
            con.execute("BEGIN IMMEDIATE")
            try:
                migration(con)
                con.execute("INSERT INTO schema_migrations(version,name) VALUES(?,?)", (version, name))
            except Exception:
                con.rollback()
                raise
            else:
                con.commit()


def schema_version() -> int:
    try:
        with connect() as con:
            row = con.execute("SELECT MAX(version) version FROM schema_migrations").fetchone()
        return int(row["version"] or 0)
    except sqlite3.Error:
        return 0


def get_setting(key: str, default: str | None = None) -> str | None:
    with connect() as con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value),
        )


def get_content_record(key: str, include_draft: bool = False) -> dict[str, Any] | None:
    with connect() as con:
        row = con.execute("SELECT * FROM content WHERE key=?", (key,)).fetchone()
    if not row or (not include_draft and not bool(row["published"])):
        return None
    return {
        "key": row["key"], "data": json.loads(row["json"]),
        "published": bool(row["published"]), "version": row["version"],
        "updated_at": row["updated_at"],
    }


def get_content(key: str, include_draft: bool = False) -> dict | list | None:
    record = get_content_record(key, include_draft=include_draft)
    return record["data"] if record else None


def set_content(
    key: str, data: Any, *, published: bool = True, note: str = "", actor: str = "owner",
) -> int:
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with connect() as con:
        current = con.execute("SELECT * FROM content WHERE key=?", (key,)).fetchone()
        version = int(current["version"] if current else 0) + 1
        con.execute(
            "INSERT INTO content(key,json,published,version,updated_at,updated_by) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET json=excluded.json,published=excluded.published,"
            "version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
            (key, encoded, int(published), version, utcnow(), actor),
        )
        con.execute(
            "INSERT INTO content_revisions(entity_type,entity_key,payload_json,note) VALUES('content',?,?,?)",
            (key, json.dumps({"data": data, "published": published, "version": version}, ensure_ascii=False), note),
        )
    return version


def backup_database(destination: str | Path | None = None) -> Path:
    source = config.database_path()
    if not source.exists():
        raise FileNotFoundError(source)
    if destination is None:
        config.backup_dir().mkdir(parents=True, exist_ok=True)
        destination = config.backup_dir() / f"site-{datetime.now(UTC):%Y%m%d-%H%M%S-%f}.db"
    target = Path(destination).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target == source.resolve():
        raise ValueError("backup destination must differ from the active database")
    with connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    return target


def restore_database(source: str | Path) -> Path:
    """Restore a validated backup, preserving the replaced DB beside it."""
    backup = Path(source).resolve()
    target = config.database_path().resolve()
    if not backup.is_file() or backup == target:
        raise ValueError("restore source must be a separate SQLite file")
    with sqlite3.connect(f"file:{backup}?mode=ro", uri=True) as con:
        if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("backup failed SQLite integrity_check")
    safety = target.with_suffix(f".before-restore-{datetime.now(UTC):%Y%m%d-%H%M%S}.db")
    if target.exists():
        with connect(target) as current, sqlite3.connect(safety) as safety_db:
            current.backup(safety_db)
    temporary = target.with_suffix(".restore-tmp")
    shutil.copy2(backup, temporary)
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    temporary.replace(target)
    init_db(target)
    return safety
