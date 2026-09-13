"""Admin session endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..auth import (create_session, destroy_session, is_admin, rate_limit,
                    require_admin_write, validate_same_origin, verify_passphrase)

router = APIRouter()


class LoginIn(BaseModel):
    passphrase: str = Field(min_length=1, max_length=200)


@router.post("/admin/login")
def login(body: LoginIn, request: Request, response: Response):
    validate_same_origin(request)
    rate_limit(request, "login", limit=5, window=300)
    if not verify_passphrase(body.passphrase):
        raise HTTPException(401, "wrong passphrase")
    create_session(response)
    return {"ok": True}


@router.post("/admin/logout", dependencies=[Depends(require_admin_write)])
def logout(request: Request, response: Response):
    destroy_session(request, response)
    return {"ok": True}


@router.get("/admin/me")
def me(request: Request, response: Response):
    return {"admin": is_admin(request, response)}
