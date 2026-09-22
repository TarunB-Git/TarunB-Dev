"""Daily in-container backup and privacy-retention scheduler.

The deployment also ships systemd timers for operators who prefer host-level
scheduling.  This process makes the default Compose deployment safe on hosts
without systemd and uses SQLite's online backup API, so the web worker stays up.
"""
from __future__ import annotations

import json
import logging
import signal
import threading
import time
from datetime import UTC, datetime

from . import db
from .ops import cleanup


INTERVAL_SECONDS = 24 * 60 * 60
BACKUP_RETENTION_DAYS = 90
logger = logging.getLogger("portfolio.maintenance")


def run_once() -> dict:
    # Apply privacy deletion before copying the database so a fresh backup
    # cannot extend the lifetime of data that has reached its deletion date.
    retention = cleanup()
    expired_backups = 0
    if db.is_postgres():
        backup_name = "managed-by-heroku-pgbackups"
    else:
        backup = db.backup_database()
        backup_name = backup.name
        cutoff = time.time() - BACKUP_RETENTION_DAYS * 24 * 60 * 60
        for candidate in backup.parent.glob("site-*.db"):
            if candidate != backup and candidate.is_file() and candidate.stat().st_mtime < cutoff:
                candidate.unlink()
                expired_backups += 1
    result = {
        "event": "daily_maintenance",
        "backup": backup_name,
        "expired_backups_deleted": expired_backups,
        "retention": retention,
        "completed_at": datetime.now(UTC).isoformat(),
    }
    logger.info(json.dumps(result, sort_keys=True))
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    db.init_db()
    stopped = threading.Event()

    def stop(_signum, _frame) -> None:
        stopped.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not stopped.is_set():
        try:
            run_once()
        except Exception:  # keep the scheduler alive and make failure visible
            logger.exception(json.dumps({"event": "daily_maintenance_failed"}))
        stopped.wait(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
