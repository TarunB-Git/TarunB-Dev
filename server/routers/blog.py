"""Blog: posts, threaded comments, likes/emoji reactions."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import db
from ..auth import is_admin, rate_limit, reject_honeypot, require_admin_write
from ..visitors import get_visitor_id

router = APIRouter()

ALLOWED_EMOJI = ["❤️", "👍", "😂", "🤯", "✨", "🔥"]
LIKE_EMOJI = "❤️"


def _post_summary(row, con) -> dict:
    likes = con.execute("SELECT COUNT(*) c FROM likes WHERE post_id=?", (row["id"],)).fetchone()["c"]
    n_comments = con.execute(
        "SELECT COUNT(*) c FROM comments WHERE post_id=? AND hidden=0",
        (row["id"],)).fetchone()["c"]
    return {
        "id": row["id"], "slug": row["slug"], "title": row["title"],
        "tags": json.loads(row["tags_json"]), "created_at": row["created_at"],
        "published": bool(row["published"]),
        "likes": likes, "comments": n_comments, "popularity": likes + 2 * n_comments,
        "excerpt": row["body_md"][:220],
    }


@router.get("/posts")
def list_posts(request: Request, tag: str | None = None, sort: str = "new"):
    where = "" if is_admin(request) else "WHERE published=1"
    with db.connect() as con:
        rows = con.execute(f"SELECT * FROM blog_posts {where} ORDER BY created_at DESC").fetchall()
        posts = [_post_summary(r, con) for r in rows]
    if tag:
        posts = [p for p in posts if tag in p["tags"]]
    if sort == "popular":
        posts.sort(key=lambda p: -p["popularity"])  # stable: newest-first within ties
    return posts


@router.get("/posts/{slug}")
def get_post(slug: str, request: Request):
    visitor = request.cookies.get("visitor_id", "")
    with db.connect() as con:
        row = con.execute("SELECT * FROM blog_posts WHERE slug=?", (slug,)).fetchone()
        if not row or (not row["published"] and not is_admin(request)):
            raise HTTPException(404, "no such post")
        post = _post_summary(row, con)
        post["body_md"] = row["body_md"]
        counts = con.execute(
            "SELECT emoji, COUNT(*) c FROM reactions WHERE post_id=? GROUP BY emoji",
            (row["id"],)).fetchall()
        mine = con.execute(
            "SELECT emoji FROM reactions WHERE post_id=? AND visitor_id=?",
            (row["id"], visitor)).fetchall()
        liked = bool(visitor and con.execute(
            "SELECT 1 FROM likes WHERE post_id=? AND visitor_id=?", (row["id"], visitor)).fetchone())
    post["reactions"] = {r["emoji"]: r["c"] for r in counts}
    post["reactions"][LIKE_EMOJI] = post["likes"]
    post["my_reactions"] = [r["emoji"] for r in mine] + ([LIKE_EMOJI] if liked else [])
    return post


class PostIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    title: str = Field(max_length=200)
    body_md: str = Field(max_length=60000)
    tags: list[str] = []
    published: bool = True


@router.post("/posts", dependencies=[Depends(require_admin_write)])
def create_post(p: PostIn):
    with db.connect() as con:
        try:
            cur = con.execute(
                "INSERT INTO blog_posts(slug,title,body_md,tags_json,published) VALUES(?,?,?,?,?)",
                (p.slug, p.title, p.body_md, json.dumps(p.tags), int(p.published)))
        except db.sqlite3.IntegrityError:
            raise HTTPException(409, "slug already exists")
        return {"id": cur.lastrowid}


@router.put("/posts/{post_id}", dependencies=[Depends(require_admin_write)])
def update_post(post_id: int, p: PostIn):
    with db.connect() as con:
        cur = con.execute(
            "UPDATE blog_posts SET slug=?,title=?,body_md=?,tags_json=?,published=? WHERE id=?",
            (p.slug, p.title, p.body_md, json.dumps(p.tags), int(p.published), post_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such post")
    return {"ok": True}


@router.delete("/posts/{post_id}", dependencies=[Depends(require_admin_write)])
def delete_post(post_id: int):
    with db.connect() as con:
        cur = con.execute("DELETE FROM blog_posts WHERE id=?", (post_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such post")
    return {"ok": True}


# ── Comments ──────────────────────────────────────────────

@router.get("/posts/{post_id}/comments")
def list_comments(post_id: int, request: Request):
    admin = is_admin(request)
    where = "" if admin else "AND hidden=0"
    with db.connect() as con:
        rows = con.execute(
            f"SELECT * FROM comments WHERE post_id=? {where} ORDER BY created_at",
            (post_id,)).fetchall()
    by_id: dict[int, dict] = {}
    roots: list[dict] = []
    for r in rows:
        c = {"id": r["id"], "parent_id": r["parent_id"], "author_name": r["author_name"],
             "body": r["body"], "created_at": r["created_at"], "hidden": bool(r["hidden"]),
             "replies": []}
        by_id[c["id"]] = c
        (by_id.get(c["parent_id"], {"replies": roots})["replies"]).append(c)
    return roots


class CommentIn(BaseModel):
    author_name: str = Field(default="anonymous", max_length=60)
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = None
    website: str = Field(default="", max_length=500)


@router.post("/posts/{post_id}/comments")
def add_comment(post_id: int, c: CommentIn, request: Request):
    reject_honeypot(c.website)
    rate_limit(request, "comment", limit=10)
    with db.connect() as con:
        if not con.execute("SELECT 1 FROM blog_posts WHERE id=? AND published=1", (post_id,)).fetchone():
            raise HTTPException(404, "no such post")
        depth = 0
        if c.parent_id is not None:
            parent = con.execute(
                "SELECT depth FROM comments WHERE id=? AND post_id=?", (c.parent_id, post_id)).fetchone()
            if not parent:
                raise HTTPException(400, "bad parent comment")
            depth = int(parent["depth"]) + 1
            if depth > 2:
                raise HTTPException(400, "comments support at most three levels")
        cur = con.execute(
            "INSERT INTO comments(post_id,parent_id,author_name,body,depth,moderation_status,updated_at) VALUES(?,?,?,?,?,'visible',?)",
            (post_id, c.parent_id, c.author_name.strip() or "anonymous", c.body.strip(), depth, db.utcnow()))
        return {"id": cur.lastrowid}


@router.delete("/comments/{comment_id}", dependencies=[Depends(require_admin_write)])
def hide_comment(comment_id: int):
    with db.connect() as con:
        cur = con.execute("UPDATE comments SET hidden=1 WHERE id=?", (comment_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such comment")
    return {"ok": True}


# ── Reactions ─────────────────────────────────────────────

class ReactionIn(BaseModel):
    emoji: str


@router.post("/posts/{post_id}/reactions")
def toggle_reaction(post_id: int, r: ReactionIn, request: Request, response: Response):
    rate_limit(request, "reaction", limit=40)
    if r.emoji not in ALLOWED_EMOJI:
        raise HTTPException(400, "unknown emoji")
    visitor = get_visitor_id(request, response)
    with db.connect() as con:
        if not con.execute("SELECT 1 FROM blog_posts WHERE id=?", (post_id,)).fetchone():
            raise HTTPException(404, "no such post")
        table = "likes" if r.emoji == LIKE_EMOJI else "reactions"
        existing = con.execute(
            f"SELECT 1 FROM {table} WHERE post_id=? AND visitor_id=?" + ("" if table == "likes" else " AND emoji=?"),
            (post_id, visitor) if table == "likes" else (post_id, visitor, r.emoji)).fetchone()
        if existing:
            con.execute(
                f"DELETE FROM {table} WHERE post_id=? AND visitor_id=?" + ("" if table == "likes" else " AND emoji=?"),
                (post_id, visitor) if table == "likes" else (post_id, visitor, r.emoji))
            active = False
        else:
            if table == "likes":
                con.execute("INSERT INTO likes(post_id,visitor_id) VALUES(?,?)", (post_id, visitor))
            else:
                con.execute("INSERT INTO reactions(post_id,visitor_id,emoji) VALUES(?,?,?)", (post_id, visitor, r.emoji))
            active = True
        count = con.execute(
            f"SELECT COUNT(*) c FROM {table} WHERE post_id=?" + ("" if table == "likes" else " AND emoji=?"),
            (post_id,) if table == "likes" else (post_id, r.emoji)).fetchone()["c"]
    return {"emoji": r.emoji, "active": active, "count": count}
