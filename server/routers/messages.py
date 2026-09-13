"""Per-path message boxes + the personal-path message wall."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import db
from ..auth import rate_limit, require_admin, require_admin_write

router = APIRouter()

MESSAGE_PATHS = {"recruiter", "viewer", "friend", "personal"}


class MessageIn(BaseModel):
    path: str
    author_name: str = Field(default="anonymous", max_length=60)
    contact: str = Field(default="", max_length=120)
    body: str = Field(min_length=1, max_length=4000)


@router.post("/messages")
def send_message(m: MessageIn, request: Request):
    rate_limit(request, "message", limit=5)
    if m.path not in MESSAGE_PATHS:
        raise HTTPException(400, "unknown path")
    with db.connect() as con:
        cur = con.execute(
            "INSERT INTO messages(path,author_name,contact,body) VALUES(?,?,?,?)",
            (m.path, m.author_name.strip() or "anonymous", m.contact.strip(), m.body.strip()))
        return {"id": cur.lastrowid, "note": "held for approval"}


@router.get("/messages")
def wall():
    """Public wall: approved messages only, contact info withheld."""
    with db.connect() as con:
        rows = con.execute(
            "SELECT id, path, author_name, body, created_at FROM messages "
            "WHERE approved=1 AND status='approved' AND publication_consent=1 "
            "AND published_at IS NOT NULL ORDER BY created_at DESC LIMIT 200").fetchall()
    return [dict(r) for r in rows]


@router.get("/messages/all", dependencies=[Depends(require_admin)])
def all_messages(path: str | None = None):
    where, params = "", ()
    if path:
        where, params = "WHERE path=?", (path,)
    with db.connect() as con:
        rows = con.execute(
            f"SELECT * FROM messages {where} ORDER BY created_at DESC", params).fetchall()
    return [dict(r) for r in rows]


@router.put("/messages/{message_id}/approve", dependencies=[Depends(require_admin_write)])
def approve(message_id: int, approved: bool = True):
    with db.connect() as con:
        row = con.execute("SELECT publication_consent FROM messages WHERE id=?", (message_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such message")
        if approved and not row["publication_consent"]:
            raise HTTPException(409, "message has no recorded publication consent")
        cur = con.execute(
            "UPDATE messages SET approved=?,status=?,published_at=?,updated_at=? WHERE id=?",
            (int(approved), "approved" if approved else "pending", db.utcnow() if approved else None, db.utcnow(), message_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "no such message")
    return {"ok": True}


@router.delete("/messages/{message_id}", dependencies=[Depends(require_admin_write)])
def delete(message_id: int):
    with db.connect() as con:
        cur = con.execute("DELETE FROM messages WHERE id=?", (message_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such message")
    return {"ok": True}
