"""Editable content: card/resume documents and per-path timelines."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import db
from ..auth import is_admin, require_admin_write
from ..models import validate_document_urls

router = APIRouter()

CONTENT_KEYS = {"card", "resume", "friend_links"}
TIMELINE_PATHS = {"recruiter", "viewer", "friend", "personal"}


@router.get("/content/{key}")
def get_content(key: str, request: Request):
    if key == "attribution":
        from ..legal import attribution_manifest
        return attribution_manifest()
    if key not in CONTENT_KEYS:
        raise HTTPException(404, "unknown content key")
    data = db.get_content(key, include_draft=is_admin(request))
    if data is None:
        raise HTTPException(404, "no content")
    return data


@router.put("/content/{key}", dependencies=[Depends(require_admin_write)])
async def put_content(key: str, request: Request):
    if key not in CONTENT_KEYS:
        raise HTTPException(404, "unknown content key")
    data = await request.json()
    try:
        validate_document_urls(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    db.set_content(key, data)
    if key == "resume" and isinstance(data, dict):
        from ..resume import cached_pdf, invalidate_cache
        invalidate_cache()
        try:
            cached_pdf(data)
        except OSError:
            pass
    return {"ok": True}


class TimelineEvent(BaseModel):
    year_label: str = Field(max_length=40)
    sort_order: int = 0
    title: str = Field(max_length=200)
    subtitle: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=2000)
    details: str = Field(default="", max_length=8000)
    links: list[dict] = []
    published: bool = True


def _event_row(row) -> dict:
    d = dict(row)
    d["links"] = json.loads(d.pop("links_json") or "[]")
    d["published"] = bool(d["published"])
    return d


@router.get("/timeline/{path}")
def get_timeline(path: str, request: Request):
    if path not in TIMELINE_PATHS:
        raise HTTPException(404, "unknown timeline")
    from ..auth import is_admin
    where = "" if is_admin(request) else "AND published=1"
    with db.connect() as con:
        rows = con.execute(
            f"SELECT * FROM timeline_events WHERE path=? {where} "
            "ORDER BY sort_order, id", (path,),
        ).fetchall()
    return [_event_row(r) for r in rows]


@router.post("/timeline/{path}", dependencies=[Depends(require_admin_write)])
def add_event(path: str, ev: TimelineEvent):
    if path not in TIMELINE_PATHS:
        raise HTTPException(404, "unknown timeline")
    with db.connect() as con:
        period = con.execute(
            "SELECT * FROM timeline_periods WHERE path=? AND label=? ORDER BY id LIMIT 1",
            (path, ev.year_label),
        ).fetchone()
        if period is None:
            cur_period = con.execute(
                "INSERT INTO timeline_periods(path,label,slug,sort_order,published) VALUES(?,?,?,?,?)",
                (path, ev.year_label, f"legacy-{path}-{abs(hash(ev.year_label))}", ev.sort_order, int(ev.published)),
            )
            period_id = cur_period.lastrowid
        else:
            period_id = period["id"]
        cur = con.execute(
            "INSERT INTO timeline_events(path,year_label,sort_order,title,subtitle,"
            "description,details,links_json,published,period_id,slug,category,summary,details_md,layout,accent,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (path, ev.year_label, ev.sort_order, ev.title, ev.subtitle,
             ev.description, ev.details, json.dumps(ev.links), int(ev.published), period_id,
             f"legacy-event-{path}-{abs(hash((ev.title,ev.sort_order)))}", ev.subtitle.lower().replace(" ", "-")[:40] or "story",
             ev.description, ev.details, "feature", "blue", db.utcnow()),
        )
        return {"id": cur.lastrowid}


@router.put("/timeline/event/{event_id}", dependencies=[Depends(require_admin_write)])
def update_event(event_id: int, ev: TimelineEvent):
    with db.connect() as con:
        cur = con.execute(
            "UPDATE timeline_events SET year_label=?,sort_order=?,title=?,subtitle=?,"
            "description=?,details=?,links_json=?,published=?,summary=?,details_md=?,updated_at=? WHERE id=?",
            (ev.year_label, ev.sort_order, ev.title, ev.subtitle, ev.description,
             ev.details, json.dumps(ev.links), int(ev.published), ev.description, ev.details, db.utcnow(), event_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "no such event")
    return {"ok": True}


@router.delete("/timeline/event/{event_id}", dependencies=[Depends(require_admin_write)])
def delete_event(event_id: int):
    with db.connect() as con:
        cur = con.execute("DELETE FROM timeline_events WHERE id=?", (event_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such event")
    return {"ok": True}
