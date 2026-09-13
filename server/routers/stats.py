"""Stat event ingestion + public aggregate counts."""
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import db
from ..auth import rate_limit, require_admin

router = APIRouter()

EVENT_TYPES = {"view", "path_enter", "resume_open", "share", "vcard", "stats_open", "chat_book", "booking_click", "card_flip"}

SOURCE_BUCKETS = {
    "linkedin": "LinkedIn",
    "github": "GitHub",
    "twitter": "Twitter / X",
    "x.com": "Twitter / X",
    "t.co": "Twitter / X",
    "google": "Search",
    "bing": "Search",
    "duckduckgo": "Search",
}


def _bucket_referrer(referer: str) -> str:
    if not referer:
        return "Direct / QR"
    host = urlparse(referer).netloc.lower()
    for needle, bucket in SOURCE_BUCKETS.items():
        if needle in host:
            return bucket
    return "Other"


class StatEvent(BaseModel):
    type: str
    path: str = ""


@router.post("/stats/event")
def record_event(ev: StatEvent, request: Request):
    if request.headers.get("x-analytics-consent", "").lower() != "true":
        raise HTTPException(403, "analytics consent is required")
    rate_limit(request, "stats", limit=60)
    if ev.type not in EVENT_TYPES:
        raise HTTPException(400, "unknown event type")
    source = _bucket_referrer(request.headers.get("referer", "")) if ev.type == "view" else ""
    with db.connect() as con:
        con.execute(
            "INSERT INTO stat_events(event_type,path,source,consented) VALUES(?,?,?,1)",
            (ev.type, ev.path[:24], source))
        con.execute(
            "INSERT INTO daily_stats(day,event_type,path,source,count) VALUES(date('now'),?,?,?,1) "
            "ON CONFLICT(day,event_type,path,source) DO UPDATE SET count=count+1",
            (ev.type, ev.path[:24], source),
        )
    return {"ok": True}


@router.get("/stats/public")
def public_stats():
    from .v1 import _public_stats
    return _public_stats()


@router.get("/stats/full", dependencies=[Depends(require_admin)])
def full_stats():
    with db.connect() as con:
        daily = [dict(r) for r in con.execute(
            "SELECT date(created_at) day, event_type, COUNT(*) c FROM stat_events "
            "WHERE consented=1 AND created_at > datetime('now','-90 days') "
            "GROUP BY day, event_type ORDER BY day DESC")]
    return {"daily": daily, **public_stats()}
