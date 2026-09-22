"""Single-owner Argon2id authentication, CSRF and durable rate limiting."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher, Type
try:  # argon2-cffi renamed this exception in newer releases
    from argon2.exceptions import InvalidHashError
except ImportError:  # pragma: no cover - compatibility with argon2-cffi 21.x
    from argon2.exceptions import InvalidHash as InvalidHashError
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import HTTPException, Request, Response

from . import config, db


SESSION_COOKIE = "portfolio_admin_session"
LEGACY_SESSION_COOKIE = "admin_session"
CSRF_COOKIE = "portfolio_admin_csrf"
SESSION_MAX_AGE = 60 * 60 * 24 * 7
SESSION_ROTATE_AFTER = 60 * 60 * 24
_PBKDF2_ITERS = 200_000
_PH = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16, type=Type.ID)


@dataclass(frozen=True)
class _RotatedSession:
    """Request-local replacement values after the database token changes."""

    csrf: str
    row: dict


def _legacy_hash(passphrase: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, _PBKDF2_ITERS)


def set_passphrase(passphrase: str, *, revoke_sessions: bool = True) -> None:
    if not passphrase:
        raise ValueError("admin passphrase cannot be empty")
    db.set_setting("passphrase_hash", _PH.hash(passphrase))
    db.set_setting("passphrase_salt", "")  # retained only for legacy migration compatibility
    if revoke_sessions:
        with db.connect() as con:
            con.execute("DELETE FROM sessions")
            generation = int(db.get_setting("session_generation", "1") or "1") + 1
            con.execute(
                "INSERT INTO settings(key,value) VALUES('session_generation',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(generation),),
            )


def initialize_passphrase(passphrase: str) -> bool:
    """Set first-run owner access exactly once, even under concurrent requests."""
    if not passphrase:
        raise ValueError("admin passphrase cannot be empty")
    encoded = _PH.hash(passphrase)
    with db.connect() as con:
        if db.is_postgres():
            # Serialize the one-time setup decision across overlapping dynos.
            con.execute("SELECT pg_advisory_xact_lock(703621842)")
        else:
            con.execute("BEGIN IMMEDIATE")
        if con.execute("SELECT 1 FROM settings WHERE key='passphrase_hash' AND value!=''").fetchone():
            con.rollback()
            return False
        con.execute(
            "INSERT INTO settings(key,value) VALUES('passphrase_hash',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (encoded,),
        )
        con.execute(
            "INSERT INTO settings(key,value) VALUES('passphrase_salt','') "
            "ON CONFLICT(key) DO UPDATE SET value=''"
        )
        con.execute("DELETE FROM sessions")
        generation_row = con.execute("SELECT value FROM settings WHERE key='session_generation'").fetchone()
        generation = int(generation_row["value"] if generation_row else "1") + 1
        con.execute(
            "INSERT INTO settings(key,value) VALUES('session_generation',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(generation),),
        )
        con.commit()
    return True


def ensure_passphrase() -> None:
    """Initialize the owner passphrase from the environment on first run."""
    if db.get_setting("passphrase_hash"):
        return
    passphrase = os.environ.get("ADMIN_PASSPHRASE")
    if passphrase:
        set_passphrase(passphrase, revoke_sessions=False)


def recover_passphrase(recovery_token: str, new_passphrase: str) -> bool:
    """Replace owner access only when the deployment recovery secret matches."""
    expected = config.admin_recovery_token()
    if not expected or not hmac.compare_digest(recovery_token, expected):
        return False
    set_passphrase(new_passphrase, revoke_sessions=True)
    return True


def verify_passphrase(passphrase: str) -> bool:
    stored = db.get_setting("passphrase_hash")
    if not stored:
        return False
    if stored.startswith("$argon2"):
        try:
            valid = _PH.verify(stored, passphrase)
        except (VerificationError, VerifyMismatchError, InvalidHashError):
            return False
        if valid and _PH.check_needs_rehash(stored):
            db.set_setting("passphrase_hash", _PH.hash(passphrase))
        return bool(valid)

    # Seamlessly upgrade the original PBKDF2 record after a successful login.
    salt = db.get_setting("passphrase_salt")
    try:
        valid = bool(salt) and hmac.compare_digest(_legacy_hash(passphrase, bytes.fromhex(salt)), bytes.fromhex(stored))
    except ValueError:
        valid = False
    if valid:
        set_passphrase(passphrase, revoke_sessions=True)
    return valid


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _session_cookie(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE) or request.cookies.get(LEGACY_SESSION_COOKIE)


def _session_row(request: Request):
    # Rotation invalidates the request's original cookie in SQLite. Keep the
    # replacement row available only to later checks in this same request;
    # another request presenting the old token must perform a fresh lookup and
    # fail authentication.
    rotated = getattr(request.state, "portfolio_rotated_session", None)
    if isinstance(rotated, _RotatedSession):
        return rotated.row
    token = _session_cookie(request)
    if not token:
        return None
    hashed = _digest(token)
    generation = int(db.get_setting("session_generation", "1") or "1")
    with db.connect() as con:
        # New tokens are stored hashed. The second lookup keeps already-issued
        # legacy sessions valid until their normal seven-day expiry.
        row = con.execute(
            "SELECT * FROM sessions WHERE (token=? OR token=?) "
            "AND datetime(expires_at) > datetime('now')", (hashed, token),
        ).fetchone()
        if row is None:
            return None
        if int(row["session_generation"] or 1) != generation:
            # A generation change is an explicit global revocation. Removing a
            # stale row also prevents it from accumulating until retention.
            con.execute("DELETE FROM sessions WHERE token=?", (row["token"],))
            return None
        con.execute(
            "UPDATE sessions SET last_seen_at=? WHERE token=?",
            (datetime.now(UTC).isoformat(), row["token"]),
        )
    return row


def _cookie_options() -> dict:
    return {
        "max_age": SESSION_MAX_AGE,
        "secure": config.secure_cookies(),
        "samesite": "strict",
        "path": "/",
    }


def _set_session_cookies(response: Response, token: str, csrf: str) -> None:
    cookie = _cookie_options()
    response.set_cookie(SESSION_COOKIE, token, httponly=True, **cookie)
    # The CSRF value is not an authentication credential. Keeping this cookie
    # readable preserves the established double-submit contract, while the
    # server additionally binds its digest to the HttpOnly session token.
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, **cookie)
    response.delete_cookie(LEGACY_SESSION_COOKIE, path="/")


def _as_utc(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=UTC)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _rotate_if_due(request: Request, response: Response | None, row) -> str | None:
    if response is None or datetime.now(UTC) - _as_utc(row["created_at"]) < timedelta(seconds=SESSION_ROTATE_AFTER):
        return None
    old_token = _session_cookie(request)
    if not old_token:
        return None
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    expiry = now + timedelta(seconds=SESSION_MAX_AGE)
    generation = int(db.get_setting("session_generation", "1") or "1")
    replacement = {
        **dict(row),
        "token": _digest(token),
        "created_at": now.isoformat(),
        "expires_at": expiry.isoformat(),
        "last_seen_at": now.isoformat(),
        "csrf_hash": _digest(csrf),
        "session_generation": generation,
    }
    with db.connect() as con:
        updated = con.execute(
            "UPDATE sessions SET token=?,created_at=?,expires_at=?,last_seen_at=?,csrf_hash=?,session_generation=? "
            "WHERE token IN (?,?)",
            (
                replacement["token"], replacement["created_at"], replacement["expires_at"],
                replacement["last_seen_at"], replacement["csrf_hash"], generation,
                _digest(old_token), old_token,
            ),
        ).rowcount
    # Concurrent requests may both notice an old token. Only the request that
    # atomically replaced the database row is allowed to issue replacement
    # cookies; the other response cannot overwrite them with a losing token.
    if not updated:
        return None
    request.state.portfolio_rotated_session = _RotatedSession(csrf=csrf, row=replacement)
    _set_session_cookies(response, token, csrf)
    return csrf


def create_session(response: Response) -> str:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    expiry = now + timedelta(seconds=SESSION_MAX_AGE)
    generation = int(db.get_setting("session_generation", "1") or "1")
    with db.connect() as con:
        con.execute("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')")
        con.execute(
            "INSERT INTO sessions(token,created_at,expires_at,last_seen_at,csrf_hash,session_generation) "
            "VALUES(?,?,?,?,?,?)",
            (_digest(token), now.isoformat(), expiry.isoformat(), now.isoformat(), _digest(csrf), generation),
        )
    _set_session_cookies(response, token, csrf)
    return csrf


def destroy_session(request: Request, response: Response, *, all_sessions: bool = False) -> None:
    token = _session_cookie(request)
    rotated = getattr(request.state, "portfolio_rotated_session", None)
    with db.connect() as con:
        if all_sessions:
            con.execute("DELETE FROM sessions")
        elif token:
            candidates = [_digest(token), token]
            if isinstance(rotated, _RotatedSession):
                candidates.append(rotated.row["token"])
            placeholders = ",".join("?" for _ in candidates)
            con.execute(f"DELETE FROM sessions WHERE token IN ({placeholders})", candidates)
    for name in (SESSION_COOKIE, LEGACY_SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/")


def is_admin(request: Request, response: Response | None = None) -> bool:
    row = _session_row(request)
    if row is None:
        return False
    _rotate_if_due(request, response, row)
    return True


def require_admin(request: Request, response: Response = None) -> None:
    if not is_admin(request, response):
        raise HTTPException(status_code=401, detail="admin session required")


def validate_same_origin(request: Request) -> None:
    fetch_site = request.headers.get("sec-fetch-site", "")
    if fetch_site == "cross-site":
        raise HTTPException(status_code=403, detail="cross-site request rejected")
    origin = request.headers.get("origin")
    # A browser request made to the server's own scheme and Host is same-origin
    # even when the local URL uses 127.0.0.1, a custom PORT, or another hostname
    # not listed in deployment configuration. Explicit configured origins remain
    # necessary for trusted reverse-proxy/public URLs.
    allowed = config.allowed_origins()
    allowed.add(str(request.base_url).rstrip("/"))
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="origin not allowed")


def require_admin_write(request: Request, response: Response = None) -> None:
    row = _session_row(request)
    if row is None:
        raise HTTPException(status_code=401, detail="admin session required")
    validate_same_origin(request)
    header = request.headers.get("x-csrf-token", "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not header or not cookie or not hmac.compare_digest(header, cookie):
        raise HTTPException(status_code=403, detail="valid X-CSRF-Token required")
    if not row["csrf_hash"] or not hmac.compare_digest(row["csrf_hash"], _digest(header)):
        raise HTTPException(status_code=403, detail="CSRF token does not match session")
    # Validate the request against the old CSRF binding first, then rotate. The
    # successful response carries the replacement token and CSRF value.
    _rotate_if_due(request, response, row)


def csrf_token(request: Request, response: Response | None = None) -> str:
    token = request.cookies.get(CSRF_COOKIE, "")
    row = _session_row(request)
    if not token or row is None or not hmac.compare_digest(row["csrf_hash"], _digest(token)):
        raise HTTPException(status_code=401, detail="session must be renewed")
    return _rotate_if_due(request, response, row) or token


def _client_subject(request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    if config.trust_proxy_headers():
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            host = forwarded
    pepper = db.get_setting("rate_limit_pepper")
    if not pepper:
        pepper = secrets.token_hex(32)
        db.set_setting("rate_limit_pepper", pepper)
    return hashlib.sha256(f"{pepper}:{host}".encode()).hexdigest()


def rate_limit(request: Request, bucket: str, limit: int = 20, window: float = 60.0) -> None:
    """Fixed-window limiter persisted in SQLite so restarts do not reset it."""
    now = int(time.time())
    seconds = max(1, int(window))
    start = now - now % seconds
    subject = _client_subject(request)
    expiry = datetime.fromtimestamp(start + seconds * 2, UTC).isoformat()
    with db.connect() as con:
        con.execute("DELETE FROM rate_limits WHERE datetime(expires_at) <= datetime('now')")
        con.execute(
            "INSERT INTO rate_limits(subject_hash,bucket,window_start,hits,expires_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(subject_hash,bucket,window_start) DO UPDATE SET hits=rate_limits.hits+1",
            (subject, bucket[:40], start, 1, expiry),
        )
        hits = con.execute(
            "SELECT hits FROM rate_limits WHERE subject_hash=? AND bucket=? AND window_start=?",
            (subject, bucket[:40], start),
        ).fetchone()["hits"]
    if hits > limit:
        raise HTTPException(status_code=429, detail="slow down", headers={"Retry-After": str(start + seconds - now)})


def reject_honeypot(value: str | None) -> None:
    # Return a validation-style error instead of revealing bot detection rules.
    if value and value.strip():
        raise HTTPException(status_code=422, detail="submission could not be accepted")
