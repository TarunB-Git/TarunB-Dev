"""Versioned, typed public and owner APIs."""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import secrets
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile

from .. import config, db, seed
from ..auth import (
    create_session, csrf_token, destroy_session, is_admin, rate_limit,
    initialize_passphrase, recover_passphrase, reject_honeypot, require_admin, require_admin_write, set_passphrase,
    validate_same_origin, verify_passphrase,
)
from ..models import (
    CommentIn, CommentModerationIn, ContentWrite, LegalSettingsIn, MessageIn,
    MessageModerationIn, PostIn, ReactionIn, StatEventIn, TimelineEventIn,
    TimelineOrderIn, TimelinePeriodIn, safe_http_url,
    validate_content_document,
)
from ..visitors import get_visitor_id
from pydantic import BaseModel, Field

router = APIRouter(prefix="/v1")
PATHS = {"recruiter", "viewer", "friend", "personal"}
BLOG_PRIMARY_TAGS = {"work", "thoughts", "dreams", "friends", "travel", "life"}
ANALYTICS_COOKIE = "portfolio_analytics_session"
ANALYTICS_SESSION_MAX_AGE = 30 * 60
CONTENT_KEYS = {
    "site", "card", "resume", "selected_work", "career", "friend_links",
    "friend_trials", "viewer_profile", "personal_profile", "legal",
}
ALLOWED_MEDIA = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/gif": ".gif", "image/avif": ".avif",
    "video/mp4": ".mp4", "video/webm": ".webm",
}


class LoginIn(BaseModel):
    passphrase: str = Field(min_length=1)


class PassphraseChangeIn(BaseModel):
    current_passphrase: str = Field(min_length=1)
    new_passphrase: str = Field(min_length=1)


class PassphraseRecoveryIn(BaseModel):
    recovery_token: str = Field(min_length=1, max_length=512)
    new_passphrase: str = Field(min_length=1, max_length=200)


def _path(value: str) -> str:
    if value not in PATHS:
        raise HTTPException(404, "unknown path")
    return value


def _slug(value: str, fallback: str = "item") -> str:
    result = db._slug(value)  # migration and API deliberately share normalization
    return result or fallback


def _links(raw: str | None) -> list[dict]:
    try:
        items = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    output: list[dict] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        if item.get("kind") == "post" and item.get("slug"):
            output.append({"kind": "post", "slug": str(item["slug"])})
            continue
        url = item.get("url") or item.get("href")
        if not url or url == "#":
            continue
        try:
            safe_http_url(str(url))
        except ValueError:
            continue
        output.append({"kind": "external", "label": str(item.get("label") or "Open"), "url": str(url)})
    return output


def _media(row) -> dict | None:
    if not row["media_id"]:
        return None
    return {
        "id": row["media_id"], "url": f"/media/{row['stored_name']}",
        "mime_type": row["mime_type"], "alt_text": row["event_alt"] or row["asset_alt"] or "",
        "width": row["width"], "height": row["height"],
    }


def _event(row) -> dict:
    return {
        "id": row["id"], "period_id": row["period_id"], "path": row["path"],
        "slug": row["slug"], "category": row["category"], "title": row["title"],
        "subtitle": row["subtitle"] or "", "summary": row["summary"] or "",
        "details_md": row["details_md"] or "", "layout": row["layout"],
        "accent": row["accent"], "media": _media(row), "links": _links(row["links_json"]),
        "sort_order": row["sort_order"], "published": bool(row["published"]),
    }


EVENT_SELECT = """SELECT e.*, e.alt_text event_alt, m.stored_name, m.mime_type,
    m.alt_text asset_alt, m.width, m.height
    FROM timeline_events e LEFT JOIN media_assets m ON m.id=e.media_id"""


@router.get("/timelines/{path}")
def get_timeline(path: str, request: Request):
    path = _path(path)
    drafts = is_admin(request)
    period_filter = "" if drafts else "AND published=1"
    event_filter = "" if drafts else "AND e.published=1"
    with db.connect() as con:
        periods = con.execute(
            f"SELECT * FROM timeline_periods WHERE path=? {period_filter} ORDER BY sort_order,id", (path,),
        ).fetchall()
        result = []
        for period in periods:
            events = con.execute(
                f"{EVENT_SELECT} WHERE e.path=? AND e.period_id=? {event_filter} ORDER BY e.sort_order,e.id",
                (path, period["id"]),
            ).fetchall()
            result.append({
                "id": period["id"], "path": path, "label": period["label"],
                "slug": period["slug"], "sort_order": period["sort_order"],
                "published": bool(period["published"]), "events": [_event(row) for row in events],
            })
    return {"path": path, "periods": result}


def _revision(con, entity_type: str, payload: dict, *, entity_key: str = "", entity_id: int | None = None, note: str = "") -> None:
    con.execute(
        "INSERT INTO content_revisions(entity_type,entity_key,entity_id,payload_json,note) VALUES(?,?,?,?,?)",
        (entity_type, entity_key, entity_id, json.dumps(payload, ensure_ascii=False), note),
    )


@router.post("/admin/timelines/{path}/periods", dependencies=[Depends(require_admin_write)], status_code=201)
def create_period(path: str, body: TimelinePeriodIn):
    path = _path(path)
    slug = body.slug or _slug(body.label, "period")
    with db.connect() as con:
        try:
            cur = con.execute(
                "INSERT INTO timeline_periods(path,label,slug,sort_order,published,updated_at) VALUES(?,?,?,?,?,?)",
                (path, body.label, slug, body.sort_order, int(body.published), db.utcnow()),
            )
        except db.IntegrityError as exc:
            raise HTTPException(409, "period slug already exists") from exc
        period_id = cur.lastrowid
        _revision(con, "timeline_period", {**body.model_dump(), "path": path, "slug": slug}, entity_id=period_id)
    return {"id": period_id, "slug": slug}


@router.put("/admin/timeline-periods/{period_id}", dependencies=[Depends(require_admin_write)])
def update_period(period_id: int, body: TimelinePeriodIn):
    slug = body.slug or _slug(body.label, "period")
    with db.connect() as con:
        row = con.execute("SELECT * FROM timeline_periods WHERE id=?", (period_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such period")
        _revision(con, "timeline_period", dict(row), entity_id=period_id, note="before update")
        try:
            con.execute(
                "UPDATE timeline_periods SET label=?,slug=?,sort_order=?,published=?,updated_at=? WHERE id=?",
                (body.label, slug, body.sort_order, int(body.published), db.utcnow(), period_id),
            )
            con.execute("UPDATE timeline_events SET year_label=? WHERE period_id=?", (body.label, period_id))
        except db.IntegrityError as exc:
            raise HTTPException(409, "period slug already exists") from exc
    return {"ok": True, "slug": slug}


@router.delete("/admin/timeline-periods/{period_id}", dependencies=[Depends(require_admin_write)])
def delete_period(period_id: int):
    with db.connect() as con:
        row = con.execute("SELECT * FROM timeline_periods WHERE id=?", (period_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such period")
        events = con.execute("SELECT * FROM timeline_events WHERE period_id=?", (period_id,)).fetchall()
        for event in events:
            _revision(con, "timeline_event", dict(event), entity_id=event["id"], note="deleted with period")
        con.execute("DELETE FROM timeline_events WHERE period_id=?", (period_id,))
        _revision(con, "timeline_period", dict(row), entity_id=period_id, note="deleted")
        con.execute("DELETE FROM timeline_periods WHERE id=?", (period_id,))
    return {"ok": True, "events_deleted": len(events)}


def _event_values(body: TimelineEventIn, *, path: str, period_id: int, year_label: str, slug: str) -> tuple:
    links = json.dumps([link.model_dump() for link in body.links], ensure_ascii=False)
    return (
        path, period_id, year_label, slug, body.category, body.sort_order, body.title,
        body.subtitle, body.summary, body.summary, body.details_md, body.details_md,
        body.layout, body.accent, body.media_id, body.alt_text, links,
        int(body.published), db.utcnow(),
    )


def _validate_event_relations(con, body: TimelineEventIn) -> None:
    if body.media_id and not con.execute("SELECT 1 FROM media_assets WHERE id=?", (body.media_id,)).fetchone():
        raise HTTPException(400, "unknown media asset")
    for link in body.links:
        if getattr(link, "kind", "") != "post":
            continue
        post = con.execute("SELECT published FROM blog_posts WHERE slug=?", (link.slug,)).fetchone()
        if not post:
            raise HTTPException(400, f"unknown internal post: {link.slug}")
        if body.published and not post["published"]:
            raise HTTPException(409, f"published events cannot link to draft post: {link.slug}")


@router.post("/admin/timeline-periods/{period_id}/events", dependencies=[Depends(require_admin_write)], status_code=201)
def create_event(period_id: int, body: TimelineEventIn):
    with db.connect() as con:
        period = con.execute("SELECT * FROM timeline_periods WHERE id=?", (period_id,)).fetchone()
        if not period:
            raise HTTPException(404, "no such period")
        _validate_event_relations(con, body)
        slug = body.slug or _slug(body.title, "event")
        try:
            cur = con.execute(
                """INSERT INTO timeline_events(
                    path,period_id,year_label,slug,category,sort_order,title,subtitle,
                    description,summary,details,details_md,layout,accent,media_id,alt_text,
                    links_json,published,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                _event_values(body, path=period["path"], period_id=period_id, year_label=period["label"], slug=slug),
            )
        except db.IntegrityError as exc:
            raise HTTPException(409, "event slug already exists in this path") from exc
        event_id = cur.lastrowid
        _revision(con, "timeline_event", {**body.model_dump(mode="json"), "period_id": period_id}, entity_id=event_id)
    return {"id": event_id, "slug": slug}


@router.put("/admin/timeline-events/{event_id}", dependencies=[Depends(require_admin_write)])
def update_event(event_id: int, body: TimelineEventIn):
    with db.connect() as con:
        old = con.execute("SELECT * FROM timeline_events WHERE id=?", (event_id,)).fetchone()
        if not old:
            raise HTTPException(404, "no such event")
        _validate_event_relations(con, body)
        slug = body.slug or _slug(body.title, "event")
        _revision(con, "timeline_event", dict(old), entity_id=event_id, note="before update")
        values = _event_values(
            body, path=old["path"], period_id=old["period_id"], year_label=old["year_label"], slug=slug,
        )
        try:
            con.execute("""UPDATE timeline_events SET
                path=?,period_id=?,year_label=?,slug=?,category=?,sort_order=?,title=?,subtitle=?,
                description=?,summary=?,details=?,details_md=?,layout=?,accent=?,media_id=?,alt_text=?,
                links_json=?,published=?,updated_at=? WHERE id=?""", (*values, event_id))
        except db.IntegrityError as exc:
            raise HTTPException(409, "event slug already exists in this path") from exc
    return {"ok": True, "slug": slug}


@router.delete("/admin/timeline-events/{event_id}", dependencies=[Depends(require_admin_write)])
def delete_event(event_id: int):
    with db.connect() as con:
        row = con.execute("SELECT * FROM timeline_events WHERE id=?", (event_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such event")
        _revision(con, "timeline_event", dict(row), entity_id=event_id, note="deleted")
        con.execute("DELETE FROM timeline_events WHERE id=?", (event_id,))
    return {"ok": True}


@router.put("/admin/timelines/{path}/order", dependencies=[Depends(require_admin_write)])
def reorder_timeline(path: str, body: TimelineOrderIn):
    path = _path(path)
    if len(body.period_ids) != len(set(body.period_ids)):
        raise HTTPException(400, "period_ids contains duplicates")
    with db.connect() as con:
        owned = {row["id"] for row in con.execute("SELECT id FROM timeline_periods WHERE path=?", (path,))}
        if set(body.period_ids) != owned:
            raise HTTPException(400, "period_ids must contain every period in this path exactly once")
        for order, period_id in enumerate(body.period_ids):
            con.execute("UPDATE timeline_periods SET sort_order=?,updated_at=? WHERE id=?", (order, db.utcnow(), period_id))
        for period_id, event_ids in body.event_ids_by_period.items():
            if period_id not in owned or len(event_ids) != len(set(event_ids)):
                raise HTTPException(400, "invalid event ordering")
            actual = {row["id"] for row in con.execute("SELECT id FROM timeline_events WHERE period_id=?", (period_id,))}
            if set(event_ids) != actual:
                raise HTTPException(400, "event list must contain every event in its period")
            for order, event_id in enumerate(event_ids):
                con.execute("UPDATE timeline_events SET sort_order=?,updated_at=? WHERE id=?", (order, db.utcnow(), event_id))
    return {"ok": True}


# ── Content documents and revisions ────────────────────────────────────────

LEGAL_ALIASES = {
    "controller_name": "controller_name", "controller_contact": "controller_contact",
    "purpose": "purposes", "lawful_basis": "lawful_bases",
    "processor_hosting": "hosting_and_processors",
    "international_transfers": "international_transfers", "retention": "retention",
    "rights": "data_rights", "withdrawal": "consent_withdrawal",
    "complaint_authority": "supervisory_authority", "cookie_details": "cookie_details",
    "terms": "terms", "last_updated": "last_updated",
}


def _publish_legal_settings(data: dict) -> None:
    with db.connect() as con:
        for source, destination in LEGAL_ALIASES.items():
            # Published `content/legal` is the source of truth. Clearing an
            # omitted field prevents stale values from making launch readiness
            # look complete after a deliberately incomplete publication.
            value = str(data.get(source) or "").strip()
            con.execute(
                "UPDATE legal_settings SET value=?,updated_at=? WHERE key=?",
                (value, db.utcnow(), destination),
            )

@router.get("/content/{key}")
def public_content(key: str, request: Request):
    if key not in CONTENT_KEYS:
        raise HTTPException(404, "unknown content key")
    record = db.get_content_record(key, include_draft=is_admin(request))
    if record is None:
        raise HTTPException(404, "content is not published")
    return record


@router.get("/attribution")
def public_attribution():
    from ..legal import attribution_manifest
    return {"items": attribution_manifest()}


@router.put("/admin/content/{key}", dependencies=[Depends(require_admin_write)])
def write_content(key: str, body: ContentWrite):
    if key not in CONTENT_KEYS:
        raise HTTPException(404, "unknown content key")
    try:
        validate_content_document(key, body.data)
    except ValueError as exc:
        raise HTTPException(422, f"invalid {key} content: {exc}") from exc
    version = db.set_content(key, body.data, published=body.published, note=body.note)
    if key == "resume" and body.published and isinstance(body.data, dict):
        from ..resume import build_pdf
        build_pdf(body.data)  # validate generation without creating a dyno-local cache
    if key == "legal" and body.published and isinstance(body.data, dict):
        _publish_legal_settings(body.data)
    return {"ok": True, "version": version, "published": body.published}


@router.get("/admin/revisions/{entity_type}/{entity}", dependencies=[Depends(require_admin)])
def list_revisions(entity_type: str, entity: str, limit: int = Query(default=50, ge=1, le=200)):
    entity_type = {"post": "blog_post", "event": "timeline_event", "period": "timeline_period"}.get(entity_type, entity_type)
    if entity_type == "content":
        where, params = "entity_type='content' AND entity_key=?", (entity, limit)
    else:
        try:
            entity_id = int(entity)
        except ValueError as exc:
            raise HTTPException(400, "entity must be a numeric id") from exc
        where, params = "entity_type=? AND entity_id=?", (entity_type, entity_id, limit)
    with db.connect() as con:
        rows = con.execute(
            f"SELECT id,entity_type,entity_key,entity_id,payload_json,note,created_at FROM content_revisions WHERE {where} ORDER BY id DESC LIMIT ?",
            params,
        ).fetchall()
    return [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]


@router.post("/admin/revisions/{revision_id}/restore", dependencies=[Depends(require_admin_write)])
def restore_revision(revision_id: int):
    with db.connect() as con:
        revision = con.execute("SELECT * FROM content_revisions WHERE id=?", (revision_id,)).fetchone()
    if not revision:
        raise HTTPException(404, "no such revision")
    payload = json.loads(revision["payload_json"])
    if revision["entity_type"] == "content":
        restored_data = payload.get("data", payload)
        restored_published = bool(payload.get("published", False))
        key = str(revision["entity_key"] or "")
        if key not in CONTENT_KEYS:
            raise HTTPException(409, "revision belongs to an unsupported content document")
        try:
            validate_content_document(key, restored_data)
        except ValueError as exc:
            raise HTTPException(422, f"revision contains invalid {key} content: {exc}") from exc
        version = db.set_content(
            key, restored_data,
            published=restored_published, note=f"restored revision {revision_id}",
        )
        if key == "legal" and restored_published and isinstance(restored_data, dict):
            _publish_legal_settings(restored_data)
        if key == "resume" and restored_published and isinstance(restored_data, dict):
            from ..resume import build_pdf
            build_pdf(restored_data)
        return {"ok": True, "version": version}
    entity_type = revision["entity_type"]
    entity_id = revision["entity_id"]
    if not entity_id or entity_type not in {"timeline_period", "timeline_event", "blog_post"}:
        raise HTTPException(409, "unsupported revision type")
    try:
        with db.connect() as con:
            if entity_type == "timeline_period":
                path = _path(str(payload.get("path", "")))
                period_data = TimelinePeriodIn.model_validate({
                    "label": payload.get("label") or "Restored period",
                    "slug": payload.get("slug") or None,
                    "sort_order": payload.get("sort_order", 0),
                    "published": bool(payload.get("published", False)),
                })
                label = period_data.label
                slug = period_data.slug or _slug(label, "restored-period")
                con.execute("""INSERT INTO timeline_periods(id,path,label,slug,sort_order,published,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,label=excluded.label,
                    slug=excluded.slug,sort_order=excluded.sort_order,published=excluded.published,updated_at=excluded.updated_at""",
                    (entity_id, path, label, slug, period_data.sort_order, int(period_data.published), payload.get("created_at") or db.utcnow(), db.utcnow()),
                )
            elif entity_type == "timeline_event":
                period_id = int(payload.get("period_id") or 0)
                period = con.execute("SELECT * FROM timeline_periods WHERE id=?", (period_id,)).fetchone()
                if not period:
                    raise HTTPException(409, "restore the event's period first")
                raw_links = payload.get("links", [])
                if "links_json" in payload:
                    try:
                        raw_links = json.loads(payload.get("links_json") or "[]")
                    except json.JSONDecodeError as exc:
                        raise HTTPException(422, "revision contains malformed event links") from exc
                event_data = TimelineEventIn.model_validate({
                    "slug": payload.get("slug") or None,
                    "category": payload.get("category") or "story",
                    "title": payload.get("title") or "Restored event",
                    "subtitle": payload.get("subtitle") or "",
                    "summary": payload.get("summary") or payload.get("description") or "",
                    "details_md": payload.get("details_md") or payload.get("details") or "",
                    "layout": payload.get("layout") or "feature",
                    "accent": payload.get("accent") or "blue",
                    "media_id": payload.get("media_id"),
                    "alt_text": payload.get("alt_text") or "",
                    "links": raw_links,
                    "sort_order": payload.get("sort_order", 0),
                    "published": bool(payload.get("published", False)),
                })
                title = event_data.title
                links_json = json.dumps([link.model_dump() for link in event_data.links], ensure_ascii=False)
                con.execute("""INSERT INTO timeline_events(
                    id,path,period_id,year_label,slug,category,sort_order,title,subtitle,description,
                    summary,details,details_md,layout,accent,media_id,alt_text,links_json,published,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path,period_id=excluded.period_id,year_label=excluded.year_label,slug=excluded.slug,
                    category=excluded.category,sort_order=excluded.sort_order,title=excluded.title,subtitle=excluded.subtitle,
                    description=excluded.description,summary=excluded.summary,details=excluded.details,details_md=excluded.details_md,
                    layout=excluded.layout,accent=excluded.accent,media_id=excluded.media_id,alt_text=excluded.alt_text,
                    links_json=excluded.links_json,published=excluded.published,updated_at=excluded.updated_at""",
                    (
                        entity_id, period["path"], period_id, period["label"],
                        event_data.slug or _slug(title, "restored-event"), event_data.category,
                        event_data.sort_order, title, event_data.subtitle,
                        event_data.summary, event_data.summary,
                        event_data.details_md, event_data.details_md,
                        event_data.layout, event_data.accent,
                        event_data.media_id, event_data.alt_text, links_json,
                        int(event_data.published), db.utcnow(),
                    ),
                )
            else:
                raw_tags = payload.get("tags", [])
                if "tags_json" in payload:
                    try:
                        raw_tags = json.loads(payload.get("tags_json") or "[]")
                    except json.JSONDecodeError as exc:
                        raise HTTPException(422, "revision contains malformed post tags") from exc
                post_data = PostIn.model_validate({
                    "slug": payload.get("slug") or f"restored-post-{entity_id}",
                    "title": payload.get("title") or "Restored post",
                    "body_md": payload.get("body_md") or "",
                    "excerpt": payload.get("excerpt") or "",
                    "tags": raw_tags,
                    "primary_tag": payload.get("primary_tag") or "thoughts",
                    "secondary_tags": json.loads(payload.get("secondary_tags_json") or "[]") if "secondary_tags_json" in payload else payload.get("secondary_tags", []),
                    "series": payload.get("series") or "",
                    "created_at": payload.get("created_at"),
                    "published": bool(payload.get("published", False)),
                })
                con.execute("""INSERT INTO blog_posts(id,slug,title,body_md,excerpt,tags_json,primary_tag,secondary_tags_json,series,created_at,updated_at,published)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,
                    body_md=excluded.body_md,excerpt=excluded.excerpt,tags_json=excluded.tags_json,
                    primary_tag=excluded.primary_tag,secondary_tags_json=excluded.secondary_tags_json,series=excluded.series,
                    created_at=excluded.created_at,updated_at=excluded.updated_at,published=excluded.published""",
                    (
                        entity_id, post_data.slug, post_data.title, post_data.body_md,
                        post_data.excerpt, json.dumps(post_data.tags), post_data.primary_tag,
                        json.dumps(post_data.secondary_tags), post_data.series,
                        _post_time(post_data.created_at), db.utcnow(), int(post_data.published),
                    ),
                )
    except db.IntegrityError as exc:
        raise HTTPException(409, "the revision conflicts with a current slug or relationship") from exc
    except ValueError as exc:
        raise HTTPException(422, f"revision no longer satisfies the current schema: {exc}") from exc
    return {"ok": True, "entity_type": entity_type, "entity_id": entity_id}


# ── Media ──────────────────────────────────────────────────────────────────

def _media_dict(row) -> dict:
    return {
        "id": row["id"], "original_name": row["original_name"],
        "url": f"/media/{row['stored_name']}", "mime_type": row["mime_type"],
        "byte_size": row["byte_size"], "sha256": row["sha256"],
        "alt_text": row["alt_text"], "width": row["width"], "height": row["height"],
        "created_at": row["created_at"],
    }


@router.get("/admin/resume-pdf", dependencies=[Depends(require_admin)])
def resume_pdf_status():
    return db.get_content("resume_pdf") or {"original_name": None}


@router.post("/admin/resume-pdf", dependencies=[Depends(require_admin_write)], status_code=201)
async def upload_resume_pdf(file: UploadFile = File(...)):
    """Publish a separate download without modifying the abridged resume."""
    body = await file.read(config.MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not body or len(body) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"PDF must be between 1 and {config.MAX_UPLOAD_BYTES} bytes")
    if not body.startswith(b"%PDF-") or b"%%EOF" not in body[-1024:]:
        raise HTTPException(415, "Choose a PDF document, not a renamed file")
    # Immutable filenames make replacement atomic for concurrent downloads.
    stored_name = f"resume-{hashlib.sha256(body).hexdigest()[:24]}-{secrets.token_hex(4)}.pdf"
    original_name = Path(file.filename or "resume.pdf").name[:180]
    current = db.get_content("resume_pdf", include_draft=True)
    try:
        db.put_blob(stored_name, body, "application/pdf", original_name=original_name)
    except ValueError as exc:
        raise HTTPException(507, str(exc)) from exc
    metadata = {"stored_name": stored_name, "original_name": original_name, "byte_size": len(body)}
    try:
        db.set_content("resume_pdf", metadata, note="Replaced downloadable resume PDF")
    except Exception:
        db.delete_blob(stored_name)
        raise
    if isinstance(current, dict) and current.get("stored_name") != stored_name:
        db.delete_blob(str(current.get("stored_name") or ""))
    return metadata


@router.delete("/admin/resume-pdf", dependencies=[Depends(require_admin_write)])
def delete_resume_pdf():
    """Return downloads to the editable, generated résumé document."""
    current = db.get_content("resume_pdf", include_draft=True)
    db.set_content("resume_pdf", {}, note="Use generated resume PDF")
    if isinstance(current, dict) and current.get("stored_name"):
        db.delete_blob(str(current["stored_name"]))
    return {"ok": True, "original_name": None}


@router.get("/admin/media", dependencies=[Depends(require_admin)])
def list_media():
    with db.connect() as con:
        rows = con.execute("SELECT * FROM media_assets ORDER BY created_at DESC,id DESC").fetchall()
    return {"items": [_media_dict(row) for row in rows]}


@router.get("/media")
def public_media():
    """Expose the public asset library to the Device Pictures folder."""
    with db.connect() as con:
        rows = con.execute("SELECT * FROM media_assets ORDER BY created_at DESC,id DESC").fetchall()
    return {"items": [_media_dict(row) for row in rows]}


@router.post("/admin/media", dependencies=[Depends(require_admin_write)], status_code=201)
async def upload_media(
    file: UploadFile = File(...), alt_text: str = Form(min_length=1, max_length=300),
):
    alt_text = alt_text.strip()
    if not alt_text:
        raise HTTPException(422, "alt text cannot be blank")
    declared = (file.content_type or "").lower()
    if declared not in ALLOWED_MEDIA:
        raise HTTPException(415, "unsupported image or video type")
    body = await file.read(config.MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not body or len(body) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file must be between 1 and {config.MAX_UPLOAD_BYTES} bytes")
    width = height = None
    detected = declared
    if declared.startswith("image/"):
        try:
            from PIL import Image
            with Image.open(BytesIO(body)) as image:
                image.verify()
            with Image.open(BytesIO(body)) as image:
                width, height = image.size
                detected = Image.MIME.get(image.format, declared).lower()
        except Exception as exc:
            raise HTTPException(415, "file content is not a valid supported image") from exc
        if not width or not height or width > 12000 or height > 12000 or width * height > 40_000_000:
            raise HTTPException(413, "image dimensions are too large")
    elif declared == "video/mp4":
        if len(body) < 12 or body[4:8] != b"ftyp":
            raise HTTPException(415, "file content is not a valid MP4")
    elif declared == "video/webm":
        if not body.startswith(b"\x1aE\xdf\xa3"):
            raise HTTPException(415, "file content is not a valid WebM")
    if detected not in ALLOWED_MEDIA:
        raise HTTPException(415, "detected image format is not supported")
    digest = hashlib.sha256(body).hexdigest()
    stored_name = f"{digest[:24]}-{secrets.token_hex(4)}{ALLOWED_MEDIA[detected]}"
    original = Path(file.filename or "upload").name[:180]
    try:
        with db.connect() as con:
            db.put_blob(stored_name, body, detected, original_name=original, con=con)
            cur = con.execute(
                "INSERT INTO media_assets(stored_name,original_name,mime_type,byte_size,sha256,alt_text,width,height) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (stored_name, original, detected, len(body), digest, alt_text, width, height),
            )
            row = con.execute("SELECT * FROM media_assets WHERE id=?", (cur.lastrowid,)).fetchone()
    except ValueError as exc:
        raise HTTPException(507, str(exc)) from exc
    except Exception:
        raise
    return _media_dict(row)


@router.delete("/admin/media/{media_id}", dependencies=[Depends(require_admin_write)])
def delete_media(media_id: int):
    with db.connect() as con:
        row = con.execute("SELECT * FROM media_assets WHERE id=?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such media asset")
        if con.execute("SELECT 1 FROM timeline_events WHERE media_id=?", (media_id,)).fetchone():
            raise HTTPException(409, "media is still used by a timeline event")
        con.execute("DELETE FROM media_assets WHERE id=?", (media_id,))
        db.delete_blob(row["stored_name"], con=con)
    return {"ok": True}


# ── Blog, likes, reactions and comments ────────────────────────────────────

def _visitor_cookie(request: Request) -> str:
    value = request.cookies.get("visitor_id", "")
    return value if len(value) <= 64 else ""


def _post_summary(row, con, visitor: str = "") -> dict:
    likes = con.execute("SELECT COUNT(*) c FROM likes WHERE post_id=?", (row["id"],)).fetchone()["c"]
    comments = con.execute(
        "SELECT COUNT(*) c FROM comments WHERE post_id=? AND hidden=0 AND moderation_status='visible'", (row["id"],),
    ).fetchone()["c"]
    reaction_count = con.execute("SELECT COUNT(*) c FROM reactions WHERE post_id=?", (row["id"],)).fetchone()["c"]
    liked = bool(visitor and con.execute("SELECT 1 FROM likes WHERE post_id=? AND visitor_id=?", (row["id"], visitor)).fetchone())
    secondary_tags = json.loads(row["secondary_tags_json"] or "[]")
    path_tags = json.loads(row["tags_json"] or "[]")
    word_count = len(str(row["body_md"] or "").split())
    result = {
        "id": row["id"], "slug": row["slug"], "title": row["title"],
        "tags": path_tags, "path_tags": path_tags,
        "primary_tag": row["primary_tag"] or "thoughts",
        "secondary_tags": secondary_tags, "series": row["series"] or "",
        "all_tags": [row["primary_tag"] or "thoughts", *secondary_tags, *path_tags],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"], "published": bool(row["published"]),
        "likes": likes, "liked": liked, "reaction_count": reaction_count,
        "comments": comments, "popularity": likes + reaction_count + 2 * comments,
        "excerpt": row["excerpt"] or row["body_md"][:220],
        "word_count": word_count, "reading_minutes": max(1, (word_count + 199) // 200),
    }
    if config.code_content_preview():
        preview = next((post for post in seed.POSTS if post["slug"] == row["slug"]), None)
        if preview:
            result.update(
                title=preview["title"], tags=preview["tags"],
                excerpt=preview["body_md"].split("\n\n")[-1][:180],
            )
    return result


def _encode_cursor(created_at: str, row_id: int) -> str:
    return base64.urlsafe_b64encode(f"{created_at}|{row_id}".encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, int]:
    try:
        value = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created, row_id = value.rsplit("|", 1)
        return created, int(row_id)
    except Exception as exc:
        raise HTTPException(400, "invalid cursor") from exc


def _encode_popular_cursor(post: dict) -> str:
    value = f"{post['popularity']}|{post['created_at']}|{post['id']}"
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def _decode_popular_cursor(cursor: str) -> tuple[int, str, int]:
    try:
        value = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        score, created, row_id = value.split("|", 2)
        return int(score), created, int(row_id)
    except Exception as exc:
        raise HTTPException(400, "invalid popularity cursor") from exc


def _post_time(value: str | None) -> str:
    """Validate an owner-editable publication time and store it as UTC ISO-8601."""
    if not value:
        return db.utcnow()
    candidate = value.strip()
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, "publication time must be a valid date and time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@router.get("/posts")
def list_posts(
    request: Request, tag: str | None = None, sort: str = Query(default="new", pattern="^(new|popular)$"),
    cursor: str | None = None, limit: int = Query(default=20, ge=1, le=50), q: str | None = None,
):
    tag = (tag or "").strip().lower() or None
    q = (q or "").strip().lower()[:120]
    admin = is_admin(request)
    params: list = []
    conditions = [] if admin else ["published=1"]
    if cursor and sort == "new":
        created, row_id = _decode_cursor(cursor)
        conditions.append("(created_at < ? OR (created_at=? AND id<?))")
        params.extend((created, created, row_id))
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    with db.connect() as con:
        rows = con.execute(f"SELECT * FROM blog_posts {where} ORDER BY created_at DESC,id DESC", params).fetchall()
        if q:
            rows = [row for row in rows if q in " ".join((
                str(row["title"] or ""), str(row["body_md"] or ""), str(row["excerpt"] or ""),
                str(row["primary_tag"] or ""), str(row["secondary_tags_json"] or ""),
                str(row["tags_json"] or ""), str(row["series"] or ""),
            )).lower()]
        posts = [_post_summary(row, con, _visitor_cookie(request)) for row in rows]
    if tag:
        posts = [post for post in posts if tag in post["all_tags"]]
    if sort == "popular":
        posts.sort(key=lambda post: (post["popularity"], post["created_at"], post["id"]), reverse=True)
        if cursor:
            boundary = _decode_popular_cursor(cursor)
            posts = [post for post in posts if (post["popularity"], post["created_at"], post["id"]) < boundary]
    page = posts[:limit]
    next_cursor = None
    if len(posts) > limit and page:
        next_cursor = (
            _encode_cursor(page[-1]["created_at"], page[-1]["id"])
            if sort == "new" else _encode_popular_cursor(page[-1])
        )
    return {"items": page, "next_cursor": next_cursor}


@router.get("/posts/{slug}")
def get_post(slug: str, request: Request):
    visitor = _visitor_cookie(request)
    with db.connect() as con:
        row = con.execute("SELECT * FROM blog_posts WHERE slug=?", (slug,)).fetchone()
        if not row or (not row["published"] and not is_admin(request)):
            raise HTTPException(404, "no such post")
        result = _post_summary(row, con, visitor)
        result["body_md"] = row["body_md"]
        if config.code_content_preview():
            preview = next((post for post in seed.POSTS if post["slug"] == slug), None)
            if preview:
                result["body_md"] = preview["body_md"]
        counts = con.execute(
            "SELECT emoji,COUNT(*) count FROM reactions WHERE post_id=? GROUP BY emoji", (row["id"],),
        ).fetchall()
        mine = con.execute(
            "SELECT emoji FROM reactions WHERE post_id=? AND visitor_id=?", (row["id"], visitor),
        ).fetchall() if visitor else []
        visible = "" if is_admin(request) else "AND published=1"
        neighbors = con.execute(
            f"SELECT * FROM blog_posts WHERE id!=? {visible} ORDER BY created_at DESC,id DESC", (row["id"],),
        ).fetchall()
        summaries = [_post_summary(item, con, visitor) for item in neighbors]
        ordered = [*summaries, result]
        ordered.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
        current_index = next(index for index, item in enumerate(ordered) if item["id"] == result["id"])
        result["newer"] = ordered[current_index - 1] if current_index > 0 else None
        result["older"] = ordered[current_index + 1] if current_index + 1 < len(ordered) else None
        related = [item for item in summaries if (
            (result["series"] and item["series"] == result["series"])
            or item["primary_tag"] == result["primary_tag"]
            or set(item["secondary_tags"]) & set(result["secondary_tags"])
        )]
        related.sort(key=lambda item: (
            bool(result["series"] and item["series"] == result["series"]),
            len(set(item["secondary_tags"]) & set(result["secondary_tags"])),
            item["created_at"],
        ), reverse=True)
        result["related"] = related[:4]
        result["recent"] = summaries[:5]
    result["reactions"] = {item["emoji"]: item["count"] for item in counts}
    result["my_reactions"] = [item["emoji"] for item in mine]
    return result


@router.post("/admin/posts", dependencies=[Depends(require_admin_write)], status_code=201)
def create_post(body: PostIn):
    created_at = _post_time(body.created_at)
    with db.connect() as con:
        try:
            cur = con.execute(
                "INSERT INTO blog_posts(slug,title,body_md,excerpt,tags_json,primary_tag,secondary_tags_json,series,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (body.slug, body.title, body.body_md, body.excerpt, json.dumps(body.tags), body.primary_tag,
                 json.dumps(body.secondary_tags), body.series, int(body.published), created_at, db.utcnow()),
            )
        except db.IntegrityError as exc:
            raise HTTPException(409, "post slug already exists") from exc
        _revision(con, "blog_post", body.model_dump(mode="json"), entity_id=cur.lastrowid)
    return {"id": cur.lastrowid}


@router.put("/admin/posts/{post_id}", dependencies=[Depends(require_admin_write)])
def update_post(post_id: int, body: PostIn):
    with db.connect() as con:
        old = con.execute("SELECT * FROM blog_posts WHERE id=?", (post_id,)).fetchone()
        if not old:
            raise HTTPException(404, "no such post")
        created_at = _post_time(body.created_at) if body.created_at else old["created_at"]
        _revision(con, "blog_post", dict(old), entity_id=post_id, note="before update")
        try:
            con.execute(
                "UPDATE blog_posts SET slug=?,title=?,body_md=?,excerpt=?,tags_json=?,primary_tag=?,secondary_tags_json=?,series=?,published=?,created_at=?,updated_at=? WHERE id=?",
                (body.slug, body.title, body.body_md, body.excerpt, json.dumps(body.tags), body.primary_tag,
                 json.dumps(body.secondary_tags), body.series, int(body.published), created_at, db.utcnow(), post_id),
            )
        except db.IntegrityError as exc:
            raise HTTPException(409, "post slug already exists") from exc
    return {"ok": True}


@router.delete("/admin/posts/{post_id}", dependencies=[Depends(require_admin_write)])
def delete_post(post_id: int):
    with db.connect() as con:
        old = con.execute("SELECT * FROM blog_posts WHERE id=?", (post_id,)).fetchone()
        if not old:
            raise HTTPException(404, "no such post")
        _revision(con, "blog_post", dict(old), entity_id=post_id, note="deleted")
        con.execute("DELETE FROM blog_posts WHERE id=?", (post_id,))
    return {"ok": True}


@router.post("/posts/{post_id}/like")
def toggle_like(post_id: int, request: Request, response: Response):
    rate_limit(request, "like", limit=40)
    visitor = get_visitor_id(request, response)
    with db.connect() as con:
        if not con.execute("SELECT 1 FROM blog_posts WHERE id=? AND published=1", (post_id,)).fetchone():
            raise HTTPException(404, "no such post")
        active = not bool(con.execute("SELECT 1 FROM likes WHERE post_id=? AND visitor_id=?", (post_id, visitor)).fetchone())
        if active:
            con.execute("INSERT INTO likes(post_id,visitor_id) VALUES(?,?)", (post_id, visitor))
        else:
            con.execute("DELETE FROM likes WHERE post_id=? AND visitor_id=?", (post_id, visitor))
        count = con.execute("SELECT COUNT(*) c FROM likes WHERE post_id=?", (post_id,)).fetchone()["c"]
    return {"active": active, "count": count}


@router.post("/posts/{post_id}/reactions")
def toggle_reaction(post_id: int, body: ReactionIn, request: Request, response: Response):
    rate_limit(request, "reaction", limit=40)
    visitor = get_visitor_id(request, response)
    with db.connect() as con:
        if not con.execute("SELECT 1 FROM blog_posts WHERE id=? AND published=1", (post_id,)).fetchone():
            raise HTTPException(404, "no such post")
        active = not bool(con.execute(
            "SELECT 1 FROM reactions WHERE post_id=? AND visitor_id=? AND emoji=?", (post_id, visitor, body.emoji),
        ).fetchone())
        if active:
            con.execute("INSERT INTO reactions(post_id,visitor_id,emoji) VALUES(?,?,?)", (post_id, visitor, body.emoji))
        else:
            con.execute("DELETE FROM reactions WHERE post_id=? AND visitor_id=? AND emoji=?", (post_id, visitor, body.emoji))
        count = con.execute("SELECT COUNT(*) c FROM reactions WHERE post_id=? AND emoji=?", (post_id, body.emoji)).fetchone()["c"]
    return {"emoji": body.emoji, "active": active, "count": count}


def _comment_tree(rows) -> list[dict]:
    nodes = {
        row["id"]: {
            "id": row["id"], "post_id": row["post_id"], "parent_id": row["parent_id"],
            "depth": row["depth"], "author_name": row["author_name"], "body": row["body"],
            "created_at": row["created_at"], "hidden": bool(row["hidden"]),
            "moderation_status": row["moderation_status"], "replies": [],
        }
        for row in rows
    }
    roots: list[dict] = []
    for node in nodes.values():
        parent = nodes.get(node["parent_id"])
        if parent:
            parent["replies"].append(node)
        elif node["parent_id"] is None:
            roots.append(node)
    # Root threads are newest-first for discovery. Replies retain the query's
    # chronological order so each conversation still reads top to bottom.
    roots.sort(key=lambda node: (node["created_at"], node["id"]), reverse=True)
    return roots


@router.get("/posts/{post_id}/comments")
def list_comments(
    post_id: int, request: Request, cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
):
    drafts = is_admin(request)
    visibility = "" if drafts else "AND hidden=0 AND moderation_status='visible'"
    with db.connect() as con:
        post = con.execute("SELECT published FROM blog_posts WHERE id=?", (post_id,)).fetchone()
        if not post or (not drafts and not post["published"]):
            raise HTTPException(404, "no such post")
        rows = con.execute(
            f"SELECT * FROM comments WHERE post_id=? {visibility} ORDER BY created_at,id", (post_id,),
        ).fetchall()
    roots = _comment_tree(rows)
    if cursor:
        created, row_id = _decode_cursor(cursor)
        roots = [root for root in roots if (root["created_at"], root["id"]) < (created, row_id)]
    page = roots[:limit]
    next_cursor = None
    if len(roots) > limit and page:
        next_cursor = _encode_cursor(page[-1]["created_at"], page[-1]["id"])
    return {"items": page, "next_cursor": next_cursor}


@router.post("/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: int, body: CommentIn, request: Request):
    reject_honeypot(body.website)
    rate_limit(request, "comment", limit=8, window=300)
    author_name = (body.author_name or "anonymous").strip()
    if author_name.casefold() == "admin" and not is_admin(request):
        raise HTTPException(403, "the Admin name is reserved for the site owner")
    with db.connect() as con:
        if not con.execute("SELECT 1 FROM blog_posts WHERE id=? AND published=1", (post_id,)).fetchone():
            raise HTTPException(404, "no such post")
        depth = 0
        if body.parent_id is not None:
            parent = con.execute(
                "SELECT depth FROM comments WHERE id=? AND post_id=?", (body.parent_id, post_id),
            ).fetchone()
            if not parent:
                raise HTTPException(400, "parent comment is not on this post")
            depth = int(parent["depth"]) + 1
            if depth > 2:
                raise HTTPException(400, "comments support at most three levels")
        cur = con.execute(
            "INSERT INTO comments(post_id,parent_id,author_name,body,depth,moderation_status,updated_at) VALUES(?,?,?,?,?,'visible',?)",
            (post_id, body.parent_id, author_name, body.body, depth, db.utcnow()),
        )
    return {"id": cur.lastrowid, "depth": depth, "status": "visible"}


@router.patch("/admin/comments/{comment_id}", dependencies=[Depends(require_admin_write)])
def moderate_comment(comment_id: int, body: CommentModerationIn):
    with db.connect() as con:
        cur = con.execute(
            "UPDATE comments SET hidden=?,moderation_status=?,updated_at=? WHERE id=?",
            (int(body.hidden), "hidden" if body.hidden else "visible", db.utcnow(), comment_id),
        )
    if not cur.rowcount:
        raise HTTPException(404, "no such comment")
    return {"ok": True, "hidden": body.hidden}


@router.delete("/admin/comments/{comment_id}", dependencies=[Depends(require_admin_write)])
def permanently_delete_comment(comment_id: int):
    with db.connect() as con:
        row = con.execute("SELECT 1 FROM comments WHERE id=?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such comment")
        # The foreign key is ON DELETE CASCADE, matching the admin confirmation
        # that replies beneath this comment are permanently removed as well.
        con.execute("DELETE FROM comments WHERE id=?", (comment_id,))
    return {"ok": True}


# ── Private inbox and consented public wall ────────────────────────────────

@router.post("/messages", status_code=201)
def create_message(body: MessageIn, request: Request):
    reject_honeypot(body.website)
    rate_limit(request, "message", limit=5, window=600)
    consented_at = db.utcnow() if body.publication_consent else None
    with db.connect() as con:
        cur = con.execute(
            """INSERT INTO messages(
                path,author_name,contact,body,status,publication_consent,consent_version,
                consented_at,public_display_name,updated_at)
                VALUES(?,?,?,?, 'pending',?,?,?,?,?)""",
            (
                body.path, body.author_name or "anonymous", body.contact, body.body,
                int(body.publication_consent), body.consent_version, consented_at,
                body.author_name or "anonymous", db.utcnow(),
            ),
        )
    return {"id": cur.lastrowid, "status": "pending", "publication_consent": body.publication_consent}


@router.get("/messages")
def message_wall(limit: int = Query(default=100, ge=1, le=200)):
    with db.connect() as con:
        rows = con.execute(
            """SELECT id,path,public_display_name,body,published_at FROM messages
                WHERE status='approved' AND approved=1 AND publication_consent=1 AND published_at IS NOT NULL
                ORDER BY published_at DESC,id DESC LIMIT ?""", (limit,),
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


@router.get("/admin/messages", dependencies=[Depends(require_admin)])
def admin_messages(path: str | None = None, status: str | None = None):
    conditions, params = [], []
    if path:
        conditions.append("path=?")
        params.append(_path(path))
    if status:
        if status not in {"pending", "approved", "rejected"}:
            raise HTTPException(400, "unknown moderation status")
        conditions.append("status=?")
        params.append(status)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    with db.connect() as con:
        rows = con.execute(f"SELECT * FROM messages {where} ORDER BY created_at DESC,id DESC", params).fetchall()
    return {"items": [{**dict(row), "publication_consent": bool(row["publication_consent"])} for row in rows]}


@router.patch("/admin/messages/{message_id}", dependencies=[Depends(require_admin_write)])
def moderate_message(message_id: int, body: MessageModerationIn):
    with db.connect() as con:
        row = con.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such message")
        if body.publish and (body.status != "approved" or not row["publication_consent"] or not row["consented_at"]):
            raise HTTPException(409, "message cannot be published without recorded publication consent and approval")
        published_at = (row["published_at"] or db.utcnow()) if body.publish else None
        display = body.public_display_name or row["author_name"] or "anonymous"
        con.execute(
            "UPDATE messages SET status=?,approved=?,public_display_name=?,published_at=?,updated_at=? WHERE id=?",
            (body.status, int(body.status == "approved"), display, published_at, db.utcnow(), message_id),
        )
    return {"ok": True, "status": body.status, "published": bool(published_at)}


@router.delete("/admin/messages/{message_id}", dependencies=[Depends(require_admin_write)])
def delete_message(message_id: int):
    with db.connect() as con:
        cur = con.execute("DELETE FROM messages WHERE id=?", (message_id,))
    if not cur.rowcount:
        raise HTTPException(404, "no such message")
    return {"ok": True}


# ── Consent-gated statistics ───────────────────────────────────────────────

SOURCE_BUCKETS = {
    "linkedin": "LinkedIn", "github": "GitHub", "twitter": "Social",
    "x.com": "Social", "t.co": "Social", "google": "Search", "bing": "Search",
    "duckduckgo": "Search",
}
SOURCE_LABELS = {"Direct / QR", "LinkedIn", "GitHub", "Social", "Search", "Other"}


def _source(referrer: str) -> str:
    if not referrer:
        return "Direct / QR"
    # New clients bucket before transmission; accepting legacy URLs here keeps
    # rolling upgrades compatible without ever persisting the raw referrer.
    if referrer in SOURCE_LABELS:
        return referrer
    try:
        host = (urlparse(referrer).hostname or "").lower()
    except ValueError:
        return "Other"
    for needle, bucket in SOURCE_BUCKETS.items():
        if needle in host:
            return bucket
    return "Other"


@router.post("/stats/events")
def stats_event(
    body: StatEventIn, request: Request, response: Response,
    analytics_consent: str | None = Header(default=None, alias="X-Analytics-Consent"),
):
    if (analytics_consent or "").lower() != "true":
        raise HTTPException(403, "analytics consent is required")
    rate_limit(request, "stats", limit=90, window=60)
    source = _source(body.landing_referrer) if body.type == "view" else ""
    day = datetime.now(UTC).date().isoformat()
    analytics_session = request.cookies.get(ANALYTICS_COOKIE, "")
    if not (
        8 <= len(analytics_session) <= 100
        and all(char.isalnum() or char in "_-" for char in analytics_session)
    ):
        analytics_session = secrets.token_urlsafe(24)
    # This cookie is created only after an explicit consented event and expires
    # quickly; it is HttpOnly because no client feature needs to inspect it.
    response.set_cookie(
        ANALYTICS_COOKIE, analytics_session, max_age=ANALYTICS_SESSION_MAX_AGE,
        httponly=True, secure=config.secure_cookies(), samesite="strict", path="/",
    )
    try:
        with db.connect() as con:
            con.execute(
                """INSERT INTO stat_events(
                    event_type,path,source,analytics_session,event_id,consented,created_at)
                    VALUES(?,?,?,?,?,1,?)""",
                (body.type, body.path, source, analytics_session, body.event_id, db.utcnow()),
            )
            con.execute(
                """INSERT INTO daily_stats(day,event_type,path,source,count) VALUES(?,?,?,?,1)
                    ON CONFLICT(day,event_type,path,source) DO UPDATE SET count=daily_stats.count+1""",
                (day, body.type, body.path, source),
            )
            if body.type == "view":
                audience = {
                    "device": body.device_class,
                    "browser": body.browser_family,
                    "language": body.language,
                    "timezone_region": body.timezone_region,
                }
                con.executemany(
                    """INSERT INTO daily_audience(day,dimension,value,count) VALUES(?,?,?,1)
                        ON CONFLICT(day,dimension,value) DO UPDATE SET count=daily_audience.count+1""",
                    ((day, dimension, value) for dimension, value in audience.items()),
                )
    except db.IntegrityError:
        return {"ok": True, "deduplicated": True}
    return {"ok": True, "deduplicated": False}


@router.delete("/stats/session", status_code=204)
def withdraw_analytics_session(request: Request, response: Response):
    """Remove the optional short-lived analytics cookie on consent withdrawal."""

    validate_same_origin(request)
    response.delete_cookie(
        ANALYTICS_COOKIE, path="/", secure=config.secure_cookies(),
        httponly=True, samesite="strict",
    )
    response.status_code = 204
    return response


def _public_stats() -> dict:
    with db.connect() as con:
        totals = {row["event_type"]: row["count"] for row in con.execute(
            "SELECT event_type,SUM(count) count FROM daily_stats GROUP BY event_type")}
        week = {row["event_type"]: row["count"] for row in con.execute(
            "SELECT event_type,SUM(count) count FROM daily_stats WHERE day>=date('now','-6 days') GROUP BY event_type")}
        paths = {row["path"]: row["count"] for row in con.execute(
            "SELECT path,SUM(count) count FROM daily_stats WHERE event_type='path_enter' AND path!='' GROUP BY path")}
        source_rows = con.execute(
            "SELECT source,SUM(count) count FROM daily_stats WHERE event_type='view' AND source!='' "
            "AND day>=date('now','-29 days') GROUP BY source",
        ).fetchall()
        daily = [dict(row) for row in con.execute(
            "SELECT day,event_type,SUM(count) count FROM daily_stats WHERE day>=date('now','-89 days') "
            "GROUP BY day,event_type ORDER BY day")]
    return {
        "totals": totals, "this_week": week, "paths": paths,
        "sources": {row["source"]: row["count"] for row in source_rows if row["count"] >= 5},
        "daily": daily,
    }


@router.get("/stats/public")
def public_stats():
    return _public_stats()


@router.get("/admin/stats", dependencies=[Depends(require_admin)])
def admin_stats():
    with db.connect() as con:
        raw = con.execute("SELECT COUNT(*) count FROM stat_events WHERE consented=1").fetchone()["count"]
        sources = {row["source"]: row["count"] for row in con.execute(
            """SELECT source,SUM(count) count FROM daily_stats
               WHERE event_type='view' AND source!='' AND day>=date('now','-89 days')
               GROUP BY source ORDER BY count DESC"""
        )}
        audience: dict[str, dict[str, int]] = {}
        for row in con.execute(
            """SELECT dimension,value,SUM(count) count FROM daily_audience
               WHERE day>=date('now','-89 days')
               GROUP BY dimension,value ORDER BY dimension,count DESC"""
        ):
            audience.setdefault(row["dimension"], {})[row["value"]] = row["count"]
        engagement = dict(con.execute(
            """SELECT (SELECT COUNT(*) FROM likes) likes,
                      (SELECT COUNT(*) FROM reactions) reactions,
                      (SELECT COUNT(*) FROM comments WHERE hidden=0 AND moderation_status='visible') comments,
                      (SELECT COUNT(*) FROM blog_posts WHERE published=1) published_posts"""
        ).fetchone())
        posts = [dict(row) for row in con.execute(
            """SELECT title,slug,likes,reactions,comments FROM (
                    SELECT p.title,p.slug,p.created_at,
                           (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes,
                           (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) reactions,
                           (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.hidden=0 AND c.moderation_status='visible') comments
                    FROM blog_posts p WHERE p.published=1
               ) ranked ORDER BY (likes+reactions+comments) DESC,created_at DESC LIMIT 12"""
        )]
    return {
        **_public_stats(), "raw_events_retained": raw,
        "source_details": sources, "audience": audience,
        "engagement": engagement, "top_posts": posts,
    }


# ── Owner session helpers, legal settings and launch readiness ─────────────

@router.get("/admin/setup-status")
def admin_setup_status():
    return {
        "needs_setup": not bool(db.get_setting("passphrase_hash")),
        "recovery_available": bool(config.admin_recovery_token()),
    }


@router.post("/admin/setup")
def admin_setup(body: LoginIn, request: Request, response: Response):
    validate_same_origin(request)
    rate_limit(request, "admin-setup", limit=5, window=300)
    if not initialize_passphrase(body.passphrase):
        raise HTTPException(409, "owner access is already configured")
    token = create_session(response)
    return {"ok": True, "csrf_token": token}

@router.post("/admin/login")
def admin_login(body: LoginIn, request: Request, response: Response):
    validate_same_origin(request)
    rate_limit(request, "admin-login", limit=5, window=300)
    if not verify_passphrase(body.passphrase):
        raise HTTPException(401, "wrong passphrase")
    token = create_session(response)
    return {"ok": True, "csrf_token": token}


@router.post("/admin/recover")
def admin_recover(body: PassphraseRecoveryIn, request: Request, response: Response):
    validate_same_origin(request)
    rate_limit(request, "admin-recover", limit=5, window=900)
    if not recover_passphrase(body.recovery_token, body.new_passphrase):
        raise HTTPException(401, "recovery credentials are incorrect")
    token = create_session(response)
    return {"ok": True, "csrf_token": token}


@router.get("/admin/me")
def admin_me(request: Request, response: Response):
    return {"admin": is_admin(request, response)}


@router.post("/admin/logout", dependencies=[Depends(require_admin_write)])
def admin_logout(request: Request, response: Response, all_sessions: bool = False):
    destroy_session(request, response, all_sessions=all_sessions)
    return {"ok": True}


@router.post("/admin/sessions/revoke", dependencies=[Depends(require_admin_write)])
def revoke_all_sessions(request: Request, response: Response):
    destroy_session(request, response, all_sessions=True)
    return {"ok": True, "revoked": "all"}


@router.post("/admin/passphrase", dependencies=[Depends(require_admin_write)])
def change_passphrase(body: PassphraseChangeIn, request: Request, response: Response):
    if not verify_passphrase(body.current_passphrase):
        raise HTTPException(403, "current passphrase is incorrect")
    set_passphrase(body.new_passphrase, revoke_sessions=True)
    destroy_session(request, response, all_sessions=True)
    return {"ok": True, "reauthenticate": True}


@router.get("/admin/csrf")
def get_csrf(request: Request, response: Response):
    return {"csrf_token": csrf_token(request, response)}


@router.get("/admin/legal", dependencies=[Depends(require_admin)])
def get_legal_settings():
    with db.connect() as con:
        rows = con.execute("SELECT key,value,required,updated_at FROM legal_settings ORDER BY key").fetchall()
    return {"values": {row["key"]: row["value"] for row in rows}, "complete": all(not row["required"] or row["value"].strip() for row in rows)}


@router.put("/admin/legal", dependencies=[Depends(require_admin_write)])
def put_legal_settings(body: LegalSettingsIn):
    with db.connect() as con:
        known = {row["key"] for row in con.execute("SELECT key FROM legal_settings")}
        unknown = set(body.values) - known
        if unknown:
            raise HTTPException(400, f"unknown legal settings: {', '.join(sorted(unknown))}")
        for key, value in body.values.items():
            con.execute("UPDATE legal_settings SET value=?,updated_at=? WHERE key=?", (value.strip(), db.utcnow(), key))
    return {"ok": True}


@router.get("/admin/readiness", dependencies=[Depends(require_admin)])
def launch_readiness():
    with db.connect() as con:
        missing_legal = [row["key"] for row in con.execute("SELECT key FROM legal_settings WHERE required=1 AND trim(value)='' ")]
        published_content = {
            row["key"]: json.loads(row["json"])
            for row in con.execute("SELECT key,json FROM content WHERE published=1")
        }
        timelines = {row["path"]: row["count"] for row in con.execute(
            """SELECT e.path,COUNT(*) count FROM timeline_events e
                JOIN timeline_periods p ON p.id=e.period_id AND p.path=e.path
                WHERE e.published=1 AND p.published=1 GROUP BY e.path""")}
    missing_content: list[str] = []
    site = published_content.get("site")
    if not isinstance(site, dict):
        missing_content.append("site")
        site = {}
    else:
        for field in ("site_title", "canonical_url", "owner_name", "owner_contact"):
            if not str(site.get(field, "")).strip():
                missing_content.append(f"site.{field}")
        if site.get("friend_story_consent_confirmed") is not True:
            missing_content.append("site.friend_story_consent_confirmed")
    card = published_content.get("card")
    if not isinstance(card, dict):
        missing_content.append("card")
    else:
        for field in ("name", "role", "email"):
            if not str(card.get(field, "")).strip():
                missing_content.append(f"card.{field}")
        if "alex@example.com" in json.dumps(card).lower():
            missing_content.append("card.demo_content")
        selected_work = card.get("selected_work")
        if not isinstance(selected_work, list) or not any(
            isinstance(item, dict) and str(item.get("title") or "").strip()
            for item in selected_work
        ):
            missing_content.append("card.selected_work")
        career = card.get("career")
        if not isinstance(career, list) or not any(
            isinstance(item, dict) and str(item.get("role") or item.get("title") or "").strip()
            for item in career
        ):
            missing_content.append("card.career")
    resume_data = published_content.get("resume")
    if not isinstance(resume_data, dict):
        missing_content.append("resume")
    else:
        for field in ("name", "headline", "summary"):
            if not str(resume_data.get(field, "")).strip():
                missing_content.append(f"resume.{field}")
        contact = resume_data.get("contact")
        if not isinstance(contact, list) or not any(
            isinstance(item, dict) and str(item.get("value") or "").strip()
            for item in contact
        ):
            missing_content.append("resume.contact")
        for field in ("experience", "education"):
            entries = resume_data.get(field)
            if not isinstance(entries, list) or not any(
                isinstance(item, dict) and str(item.get("role") or item.get("title") or "").strip()
                for item in entries
            ):
                missing_content.append(f"resume.{field}")
        skills = resume_data.get("skills")
        if not isinstance(skills, list) or not any(str(item).strip() for item in skills if isinstance(item, str)):
            missing_content.append("resume.skills")
        projects = resume_data.get("projects") or resume_data.get("notable")
        if not isinstance(projects, list) or not any(
            isinstance(item, dict) and str(item.get("title") or item.get("role") or "").strip()
            for item in projects
        ):
            missing_content.append("resume.projects")
    missing_timelines = sorted(PATHS - {path for path, count in timelines.items() if count})
    infrastructure: list[str] = []
    if not config.base_url().startswith("https://"):
        infrastructure.append("https_base_url")
    canonical_url = str(site.get("canonical_url") or "").strip().rstrip("/")
    if canonical_url and not canonical_url.startswith("https://"):
        infrastructure.append("site_canonical_https")
    if canonical_url and canonical_url != config.base_url():
        infrastructure.append("canonical_base_url_mismatch")
    try:
        from ..legal import attribution_manifest
        credits = attribution_manifest()
        if not credits or any(not item["asset_present"] or item.get("license") != "CC BY 4.0" for item in credits):
            infrastructure.append("model_attribution")
    except (OSError, ValueError, json.JSONDecodeError):
        infrastructure.append("model_attribution")
    if isinstance(resume_data, dict) and "resume" not in missing_content:
        try:
            from ..resume import build_pdf
            if not build_pdf(resume_data).startswith(b"%PDF-"):
                infrastructure.append("resume_pdf")
        except (OSError, ValueError):
            infrastructure.append("resume_pdf")
    ready = not missing_legal and not missing_content and not missing_timelines and not infrastructure
    issues = [
        *(f"legal:{item}" for item in missing_legal),
        *(f"content:{item}" for item in missing_content),
        *(f"timeline:{item}" for item in missing_timelines),
        *(f"infrastructure:{item}" for item in infrastructure),
    ]
    return {
        "ready": ready, "missing_legal": missing_legal,
        "missing_content": missing_content, "missing_timelines": missing_timelines,
        "missing_infrastructure": infrastructure,
        "missing": issues, "issues": issues,
    }


@router.get("/admin/export", dependencies=[Depends(require_admin)])
def export_content():
    """Portable content-only export; deliberately excludes private submissions."""
    from ..legal import attribution_manifest
    with db.connect() as con:
        documents = [
            {"key": row["key"], "data": json.loads(row["json"]), "published": bool(row["published"]), "version": row["version"]}
            for row in con.execute("SELECT * FROM content ORDER BY key")
        ]
        periods = [dict(row) for row in con.execute("SELECT * FROM timeline_periods ORDER BY path,sort_order,id")]
        events = []
        for row in con.execute("SELECT * FROM timeline_events ORDER BY path,sort_order,id"):
            event = dict(row)
            event["links"] = _links(event.pop("links_json", "[]"))
            events.append(event)
        posts = []
        for row in con.execute("SELECT * FROM blog_posts ORDER BY created_at,id"):
            post = dict(row)
            post["tags"] = json.loads(post.pop("tags_json") or "[]")
            posts.append(post)
        legal_rows = con.execute("SELECT key,value,required FROM legal_settings ORDER BY key").fetchall()
        media = [_media_dict(row) for row in con.execute("SELECT * FROM media_assets ORDER BY id")]
    payload = {
        "format": "four-path-portfolio", "version": 1, "exported_at": db.utcnow(),
        "content": documents, "timeline_periods": periods, "timeline_events": events,
        "posts": posts, "media_metadata": media,
        "legal_settings": {row["key"]: row["value"] for row in legal_rows},
        "attribution": attribution_manifest(),
    }
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="portfolio-content-{stamp}.json"'},
    )


@router.post("/admin/backup", dependencies=[Depends(require_admin_write)])
def create_backup():
    if db.is_postgres():
        detail = {"provider": "heroku-postgres", "command": "heroku pg:backups:capture"}
        with db.connect() as con:
            con.execute("INSERT INTO operational_runs(command,detail) VALUES('backup-requested',?)", (json.dumps(detail),))
        return {
            "ok": True, "provider": "heroku-postgres",
            "message": "Capture the managed backup with `heroku pg:backups:capture --app YOUR_APP`.",
        }
    target = db.backup_database()
    with db.connect() as con:
        con.execute("INSERT INTO operational_runs(command,detail) VALUES('backup',?)", (json.dumps({"filename": target.name}),))
    return {"ok": True, "filename": target.name}
