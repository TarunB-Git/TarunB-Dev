# Heroku persistence audit

Audit date: 2026-09-22

## 1. SQLite-specific code found

- `server/db.py`: `sqlite3` connections, `sqlite3.Row`, WAL/busy-timeout/foreign-key PRAGMAs, numbered SQLite migrations, `AUTOINCREMENT`, SQLite online backup, restore, and integrity checking.
- `server/auth.py`, `server/ops.py`, `server/seed.py`, `server/legal.py`, `server/main.py`, and `server/routers/v1.py`: qmark parameters, SQLite date functions, `BEGIN IMMEDIATE`, `lastrowid`, and upsert/date expressions.
- `server/routers/v1.py` and the older router modules: SQLite exception handling and connection type assumptions.
- Tests intentionally exercise the local SQLite backend, WAL behavior, and SQLite backup/restore.

The implemented compatibility boundary is `server/db_compat.py`. SQLite remains the default when `DATABASE_URL` is absent. PostgreSQL uses Psycopg, mapping rows, qmark translation, the small date-expression subset used by this app, statement savepoints, and compatible inserted IDs. Routers no longer depend directly on SQLite exceptions.

## 2. Filesystem writes found

- Active SQLite database, WAL, and shared-memory files.
- Uploaded résumé PDFs and image/video media under `PORTFOLIO_UPLOAD_DIR`.
- Generated `resume-cache.pdf` and its checksum marker.
- SQLite backups, restore safety copies, and restore scratch files.
- Backup-retention deletion in `server/maintenance.py`.
- Build-time vendor/model scripts also write files, but they do not run in the deployed web process.

Uploaded résumé/media bytes now live in `file_blobs`. Generated résumé PDFs are returned from memory. SQLite backup/restore remains available locally; PostgreSQL backup requests direct the owner to Heroku PGBackups.

## 3. Startup and bootstrap assumptions found

The original lifespan expected a local database path, created a local pre-migration backup, ran SQLite migrations, initialized the owner passphrase, synchronized code defaults, seeded an empty installation, and ran privacy cleanup. The repository had dependencies only under `server/`, no root `Procfile`, and no managed-database initialization.

Startup now validates Heroku configuration first, initializes the selected backend idempotently, migrates legacy local uploads into SQLite blobs without deleting their files, and only creates file backups for SQLite. Owner initialization and content synchronization remain unchanged.

## 4. Heroku-incompatible configuration found

- No `DATABASE_URL` support.
- Docker defaults pointed mutable state at `/data`; Heroku dynos do not persist it.
- No root `Procfile` or root Python dependency entrypoint for the native buildpack.
- No production guard against silently falling back to local SQLite.
- Runtime uploads were mounted from a local directory.
- SQLite file-copy backups cannot work across dynos.

The app already respected `PORT`, exposed `/readyz`, supported configurable base/origin values, and had secure-cookie/proxy settings. These were preserved and made mandatory when Heroku's `DYNO` variable is present.

## 5. Data that was at risk on restart

Without this migration, a Heroku restart or deploy could lose owner passphrase hashes and sessions, settings, published content and revisions, timelines, blogs, comments, reactions, messages, media metadata, analytics, legal settings, uploaded résumé/media files, rate limits, operational records, and local backups. Checked-in static assets were never at risk.

## 6. Smallest safe strategy implemented

- One Eco dyno and Heroku Postgres Essential-0.
- SQLite retained for local development and tests.
- All mutable production records and small uploads stored in Postgres.
- Existing public media URLs preserved.
- Per-file validation remains 8 MB by default; aggregate database blobs are capped at 256 MB by default to leave room in the 1 GB Essential-0 database.
- Read-only, fingerprinted, idempotent SQLite-to-Postgres importer that includes legacy uploads and never modifies the source.
- Heroku startup fails clearly if persistence or required security configuration is missing.
- Managed logical backups replace dyno-local database copies.

External object storage was not added because it would add another account/service outside the student credit and is unnecessary for the current low-volume, size-limited portfolio. If stored media approaches the configured 256 MB ceiling, migrate blobs to S3-compatible storage before raising the limit.
