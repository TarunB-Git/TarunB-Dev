# Production deployment

Copy `.env.example` to `.env`, set an HTTPS domain and your chosen non-empty owner passphrase, then run:

```sh
docker compose up -d --build
docker compose exec portfolio python -m server.ops verify-attribution
docker compose exec portfolio python -m server.ops migrate
```

Caddy obtains and renews HTTPS certificates. The application intentionally runs one Uvicorn worker because SQLite is the persistence layer. Database files, uploaded media, and the cached resume PDF live in `portfolio-data`; consistent daily backups live in the separate `portfolio-backups` volume.

## Backups and retention

Create a consistent online SQLite backup with:

```sh
docker compose exec portfolio python -m server.ops backup
```

Run privacy cleanup with `python -m server.ops retention`. The Compose `maintenance` service runs the 90-day privacy cleanup followed by an online backup every 24 hours, and removes backups older than 90 days. The example systemd timers in `deploy/` are an alternative for non-Compose deployments; do not enable both schedulers. Monitor the maintenance container logs and copy the backup volume to encrypted off-host storage under an equivalent retention policy.

Test a restore against a disposable deployment first. The explicit restore command verifies SQLite integrity, preserves the replaced database as a timestamped safety copy, atomically installs the backup, and applies any newer migrations:

```sh
docker compose stop portfolio
docker compose run --rm portfolio python -m server.ops restore /data/backups/site-YYYYMMDD-HHMMSS.db
docker compose up -d portfolio
```

`/healthz` confirms the HTTP process is alive. `/readyz` confirms the database is reachable and fully migrated. The authenticated `/api/v1/admin/readiness` endpoint separately reports missing real content, timeline entries, and legally required controller settings; do not launch until it returns `ready: true`.

## Owner recovery

Set `ADMIN_PASSPHRASE` to a replacement value and run `python -m server.ops set-passphrase`. This writes a new Argon2id hash and revokes every existing owner session. Never place the passphrase directly in shell history on a shared host.
