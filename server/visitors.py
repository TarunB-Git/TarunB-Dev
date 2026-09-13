"""Anonymous visitor identity: a random UUID cookie, used to de-dupe reactions."""
import uuid

from fastapi import Request, Response

from . import config

VISITOR_COOKIE = "visitor_id"
VISITOR_MAX_AGE = 60 * 60 * 24 * 90


def get_visitor_id(request: Request, response: Response) -> str:
    vid = request.cookies.get(VISITOR_COOKIE)
    if not vid or len(vid) > 64:
        vid = uuid.uuid4().hex
        response.set_cookie(
            VISITOR_COOKIE, vid, max_age=VISITOR_MAX_AGE, samesite="lax",
            secure=config.secure_cookies(), httponly=True, path="/",
        )
    return vid
