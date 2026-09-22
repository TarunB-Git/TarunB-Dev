"""Small DB-API compatibility layer for the application's existing SQL.

SQLite remains the local/test backend.  PostgreSQL is selected only when
``DATABASE_URL`` is present.  This module intentionally translates the narrow
SQL surface used by the portfolio instead of pretending the two databases are
fully interchangeable.
"""
from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from typing import Any

try:  # Local SQLite-only development must not require libpq at import time.
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - exercised in minimal local installs
    psycopg = None
    dict_row = None


SERIAL_TABLES = {
    "timeline_events", "blog_posts", "comments", "messages", "stat_events",
    "timeline_periods", "media_assets", "content_revisions", "operational_runs",
}


class CompatRow(Mapping[str, Any]):
    """Mapping row that also supports SQLite's positional indexing."""

    def __init__(self, values: Mapping[str, Any]):
        self._values = dict(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self._values.values())[key]
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)


class CursorAdapter:
    def __init__(self, cursor, *, lastrowid: int | None = None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def _row(self, value):
        return None if value is None else CompatRow(value)

    def fetchone(self):
        return self._row(self._cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self._cursor.fetchall()]

    def __iter__(self):
        for row in self._cursor:
            yield self._row(row)


def _replace_placeholders(sql: str) -> str:
    """Replace qmark parameters outside quoted SQL literals."""
    output: list[str] = []
    quote = ""
    index = 0
    while index < len(sql):
        char = sql[index]
        if quote:
            output.append(char)
            if char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    output.append(sql[index + 1])
                    index += 1
                else:
                    quote = ""
        elif char in {"'", '"'}:
            quote = char
            output.append(char)
        elif char == "?":
            output.append("%s")
        else:
            output.append(char)
        index += 1
    return "".join(output)


def postgres_sql(sql: str) -> str:
    """Translate the deliberately small set of SQLite expressions we use."""
    statement = sql.strip()
    if statement.upper() == "BEGIN IMMEDIATE":
        return "BEGIN"
    statement = re.sub(
        r"datetime\(\s*'now'\s*,\s*'-(\d+) days'\s*\)",
        lambda match: f"(CURRENT_TIMESTAMP - INTERVAL '{match.group(1)} days')",
        statement, flags=re.IGNORECASE,
    )
    statement = re.sub(r"datetime\(\s*'now'\s*\)", "CURRENT_TIMESTAMP", statement, flags=re.IGNORECASE)
    statement = re.sub(
        r"datetime\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)",
        r"CAST(NULLIF(\1,'') AS TIMESTAMPTZ)", statement, flags=re.IGNORECASE,
    )
    statement = re.sub(
        r"date\(\s*'now'\s*,\s*'-(\d+) days'\s*\)",
        lambda match: f"to_char(CURRENT_DATE - {match.group(1)}, 'YYYY-MM-DD')",
        statement, flags=re.IGNORECASE,
    )
    statement = re.sub(
        r"date\(\s*'now'\s*\)", "to_char(CURRENT_DATE, 'YYYY-MM-DD')",
        statement, flags=re.IGNORECASE,
    )
    statement = re.sub(
        r"date\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)",
        r"to_char(CAST(\1 AS TIMESTAMPTZ), 'YYYY-MM-DD')", statement, flags=re.IGNORECASE,
    )
    ignored = re.match(r"INSERT\s+OR\s+IGNORE\s+INTO\s+", statement, flags=re.IGNORECASE)
    if ignored:
        statement = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO\s+", "INSERT INTO ", statement, count=1, flags=re.IGNORECASE)
        statement = statement.rstrip("; ") + " ON CONFLICT DO NOTHING"
    return _replace_placeholders(statement)


class PostgresConnection:
    backend = "postgres"

    def __init__(self, database_url: str):
        if psycopg is None:
            raise RuntimeError("PostgreSQL requires psycopg; install server/requirements.txt")
        self._connection = psycopg.connect(database_url, row_factory=dict_row)
        self._connection.execute("BEGIN")
        self._savepoint = 0

    def _statement(self, operation):
        """Keep caught constraint errors from poisoning the outer transaction."""
        self._savepoint += 1
        name = f"portfolio_statement_{self._savepoint}"
        self._connection.execute(f"SAVEPOINT {name}")
        try:
            result = operation()
        except Exception:
            self._connection.execute(f"ROLLBACK TO SAVEPOINT {name}")
            self._connection.execute(f"RELEASE SAVEPOINT {name}")
            raise
        self._connection.execute(f"RELEASE SAVEPOINT {name}")
        return result

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        translated = postgres_sql(sql)
        if translated.upper() == "BEGIN":
            cursor = self._connection.execute("SELECT 1 AS ignored WHERE FALSE")
            return CursorAdapter(cursor)
        insert = re.match(r"\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)", translated, flags=re.IGNORECASE)
        capture_id = bool(insert and insert.group(1).lower() in SERIAL_TABLES and " RETURNING " not in translated.upper())
        if capture_id:
            translated = translated.rstrip("; ") + " RETURNING id"
        def run():
            cursor = self._connection.execute(translated, tuple(params or ()))
            lastrowid = None
            if capture_id:
                row = cursor.fetchone()
                if row is not None:
                    lastrowid = int(row["id"])
            return CursorAdapter(cursor, lastrowid=lastrowid)
        return self._statement(run)

    def executemany(self, sql: str, params_seq):
        def run():
            cursor = self._connection.cursor()
            cursor.executemany(postgres_sql(sql), params_seq)
            return CursorAdapter(cursor)
        return self._statement(run)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()
        return False


def integrity_errors():
    errors = [sqlite3.IntegrityError]
    if psycopg is not None:
        errors.append(psycopg.IntegrityError)
    return tuple(errors)


def database_errors():
    errors = [sqlite3.Error]
    if psycopg is not None:
        errors.append(psycopg.Error)
    return tuple(errors)
