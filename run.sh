#!/usr/bin/env bash
# Start the portfolio site. On an interactive first run, open /admin and choose
# the owner passphrase there. Keep a separate recovery token available, e.g.
#   ADMIN_RECOVERY_TOKEN='choose-a-different-long-secret' ./run.sh
# ADMIN_PASSPHRASE is an optional non-interactive bootstrap and only takes effect
# when the database does not already contain owner access.
# Code defaults are synchronized into SQLite without overwriting fields changed
# in Admin, so both editing workflows show the same published content.
cd "$(dirname "$0")"
export PORTFOLIO_CONTENT_SOURCE="${PORTFOLIO_CONTENT_SOURCE:-database}"
exec python3 -m uvicorn server.main:app --host 0.0.0.0 --port "${PORT:-8800}" "$@"
