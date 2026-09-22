"""Canonical PostgreSQL schema for fresh managed-database installations."""

NOW_TEXT = "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"

STATEMENTS = (
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS content (
        key TEXT PRIMARY KEY, json TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1, updated_at TEXT,
        updated_by TEXT NOT NULL DEFAULT 'owner')""",
    f"""CREATE TABLE IF NOT EXISTS timeline_periods (
        id BIGSERIAL PRIMARY KEY,
        path TEXT NOT NULL CHECK (path IN ('recruiter','viewer','friend','personal')),
        label TEXT NOT NULL, slug TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        published INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}),
        updated_at TEXT NOT NULL DEFAULT ({NOW_TEXT}), UNIQUE(path,slug))""",
    f"""CREATE TABLE IF NOT EXISTS media_assets (
        id BIGSERIAL PRIMARY KEY, stored_name TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, alt_text TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER,
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}))""",
    """CREATE TABLE IF NOT EXISTS timeline_events (
        id BIGSERIAL PRIMARY KEY,
        path TEXT NOT NULL CHECK (path IN ('recruiter','viewer','friend','personal')),
        year_label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL, subtitle TEXT DEFAULT '', description TEXT DEFAULT '',
        details TEXT DEFAULT '', links_json TEXT DEFAULT '[]', published INTEGER NOT NULL DEFAULT 1,
        period_id BIGINT REFERENCES timeline_periods(id) ON DELETE RESTRICT,
        slug TEXT, category TEXT NOT NULL DEFAULT 'story', summary TEXT NOT NULL DEFAULT '',
        details_md TEXT NOT NULL DEFAULT '', layout TEXT NOT NULL DEFAULT 'feature',
        accent TEXT NOT NULL DEFAULT 'blue', media_id BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
        alt_text TEXT NOT NULL DEFAULT '', updated_at TEXT)""",
    f"""CREATE TABLE IF NOT EXISTS blog_posts (
        id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        body_md TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}), published INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT, excerpt TEXT NOT NULL DEFAULT '', primary_tag TEXT NOT NULL DEFAULT 'thoughts',
        secondary_tags_json TEXT NOT NULL DEFAULT '[]', series TEXT NOT NULL DEFAULT '')""",
    f"""CREATE TABLE IF NOT EXISTS comments (
        id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL DEFAULT 'anonymous', body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}), hidden INTEGER NOT NULL DEFAULT 0,
        depth INTEGER NOT NULL DEFAULT 0, moderation_status TEXT NOT NULL DEFAULT 'visible',
        visitor_hash TEXT NOT NULL DEFAULT '', updated_at TEXT)""",
    """CREATE TABLE IF NOT EXISTS reactions (
        post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        visitor_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(post_id,visitor_id,emoji))""",
    f"""CREATE TABLE IF NOT EXISTS likes (
        post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        visitor_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}),
        PRIMARY KEY(post_id,visitor_id))""",
    f"""CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY, path TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT 'anonymous',
        contact TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}), approved INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', publication_consent INTEGER NOT NULL DEFAULT 0,
        consent_version TEXT, consented_at TEXT, public_display_name TEXT NOT NULL DEFAULT '',
        published_at TEXT, updated_at TEXT)""",
    f"""CREATE TABLE IF NOT EXISTS stat_events (
        id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'direct', created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}),
        analytics_session TEXT NOT NULL DEFAULT '', event_id TEXT NOT NULL DEFAULT '',
        consented INTEGER NOT NULL DEFAULT 0)""",
    f"""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}), expires_at TEXT,
        last_seen_at TEXT, csrf_hash TEXT NOT NULL DEFAULT '', session_generation INTEGER NOT NULL DEFAULT 1)""",
    f"""CREATE TABLE IF NOT EXISTS content_revisions (
        id BIGSERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL DEFAULT '',
        entity_id BIGINT, payload_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}))""",
    """CREATE TABLE IF NOT EXISTS daily_stats (
        day TEXT NOT NULL, event_type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(day,event_type,path,source))""",
    """CREATE TABLE IF NOT EXISTS rate_limits (
        subject_hash TEXT NOT NULL, bucket TEXT NOT NULL, window_start BIGINT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL,
        PRIMARY KEY(subject_hash,bucket,window_start))""",
    f"""CREATE TABLE IF NOT EXISTS legal_settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT ({NOW_TEXT}))""",
    f"""CREATE TABLE IF NOT EXISTS operational_runs (
        id BIGSERIAL PRIMARY KEY, command TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}))""",
    """CREATE TABLE IF NOT EXISTS daily_audience (
        day TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,dimension,value))""",
    f"""CREATE TABLE IF NOT EXISTS file_blobs (
        key TEXT PRIMARY KEY, data BYTEA NOT NULL, mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}))""",
    "CREATE INDEX IF NOT EXISTS idx_timeline_path ON timeline_events(path,sort_order)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_slug ON timeline_events(path,slug)",
    "CREATE INDEX IF NOT EXISTS idx_period_path ON timeline_periods(path,sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)",
    "CREATE INDEX IF NOT EXISTS idx_stats_type ON stat_events(event_type,created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_event_id ON stat_events(event_id) WHERE event_id!=''",
    "CREATE INDEX IF NOT EXISTS idx_revisions_entity ON content_revisions(entity_type,entity_key,entity_id,id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_messages_retention ON messages(status,created_at)",
    "CREATE INDEX IF NOT EXISTS idx_stats_cleanup ON stat_events(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_blog_published_created ON blog_posts(published,created_at DESC,id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_blog_primary_created ON blog_posts(primary_tag,created_at DESC,id DESC)",
)

LEGAL_KEYS = (
    "controller_name", "controller_contact", "purposes", "lawful_bases",
    "hosting_and_processors", "international_transfers", "retention", "data_rights",
    "consent_withdrawal", "supervisory_authority", "cookie_details", "terms", "last_updated",
)
