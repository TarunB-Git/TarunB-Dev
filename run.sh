#!/usr/bin/env bash
# Start the portfolio site. First run: set ADMIN_PASSPHRASE to enable the admin panel, e.g.
#   ADMIN_PASSPHRASE='choose-something-long' ./run.sh
cd "$(dirname "$0")"
exec python3 -m uvicorn server.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
