"""Portfolio FastAPI application and production HTTP boundary."""
from __future__ import annotations

import html
import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import assets, config, db, legal, resume, seed
from .auth import ensure_passphrase
from .ops import cleanup
from .routers import v1


STATIC_DIR = assets.STATIC_DIR
ASSET_NAMESPACE = assets.ASSET_NAMESPACE
logger = logging.getLogger("portfolio.http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    target = config.database_path()
    if target.exists() and db.schema_version() < db.MIGRATIONS[-1][0]:
        backup = db.backup_database()
        logger.info(json.dumps({"event": "pre_migration_backup", "path": str(backup)}))
    db.init_db()
    ensure_passphrase()
    seed.seed_if_empty()
    cleanup()
    yield


app = FastAPI(title="Four-path portfolio", version="1.0.0", docs_url=None, redoc_url=None, lifespan=lifespan)


class BodyLimitMiddleware:
    """Enforce limits for both Content-Length and chunked request bodies."""

    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH", "DELETE"}:
            await self.application(scope, receive, send)
            return
        path = scope.get("path", "")
        maximum = config.MAX_UPLOAD_BYTES + 65536 if path in {"/api/v1/admin/media", "/api/v1/admin/resume-pdf"} else config.MAX_REQUEST_BYTES
        header_map = {key.lower(): value for key, value in scope.get("headers", [])}
        try:
            declared = int(header_map.get(b"content-length", b"0"))
        except ValueError:
            declared = -1
        if declared < 0 or declared > maximum:
            payload = b'{"detail":"request body is too large"}' if declared > maximum else b'{"detail":"invalid Content-Length"}'
            status = 413 if declared > maximum else 400
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
            await send({"type": "http.response.body", "body": payload})
            return
        messages, total = [], 0
        while True:
            message = await receive()
            messages.append(message)
            total += len(message.get("body", b""))
            if total > maximum:
                payload = b'{"detail":"request body is too large"}'
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
                await send({"type": "http.response.body", "body": payload})
                return
            if message.get("type") == "http.disconnect" or not message.get("more_body", False):
                break
        index = 0

        async def replay():
            nonlocal index
            if index < len(messages):
                message = messages[index]
                index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.application(scope, replay, send)


class PublicAssets(StaticFiles):
    """Serve versioned assets while keeping prototype documents unserved."""

    async def get_response(self, path: str, scope):
        prefix, separator, remainder = path.partition("/")
        if prefix.startswith("v-"):
            if prefix != ASSET_NAMESPACE or not separator or not remainder:
                return Response(status_code=404)
            path = remainder
        if Path(path).suffix.lower() in {".html", ".htm"}:
            return Response(status_code=404)
        return await super().get_response(path, scope)


app.add_middleware(BodyLimitMiddleware)

app.include_router(v1.router, prefix="/api")


@app.exception_handler(404)
async def custom_not_found(request: Request, exc):
    """Keep API failures machine-readable and give human visitors a way home."""
    if request.url.path.startswith("/api/"):
        detail = getattr(exc, "detail", "not found")
        return JSONResponse({"detail": detail}, status_code=404)
    source = assets.version_asset_urls((STATIC_DIR / "404.html").read_text(encoding="utf-8"))
    return HTMLResponse(
        source,
        status_code=404,
        headers={"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"},
    )


@app.middleware("http")
async def production_boundary(request: Request, call_next):
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id", "")[:80] or uuid.uuid4().hex
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    nonce = response.headers.get("x-portfolio-csp-nonce", "")
    if nonce:
        del response.headers["x-portfolio-csp-nonce"]
    nonce_source = f" 'nonce-{nonce}'" if nonce else ""
    csp = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        f"script-src 'self'{nonce_source} 'wasm-unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; "
        "media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob:; form-action 'self'"
    )
    if config.secure_cookies():
        csp += "; upgrade-insecure-requests"
    response.headers["Content-Security-Policy"] = csp
    if config.secure_cookies():
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Request-ID"] = request_id
    if request.url.path.startswith((f"/static/{ASSET_NAMESPACE}/", "/media/")):
        response.headers["Cache-Control"] = "public,max-age=31536000,immutable"
    elif request.url.path.startswith("/static/"):
        # Compatibility URLs remain available, but may never be cached as a build.
        response.headers["Cache-Control"] = "no-cache"
    elif request.url.path in {"/", "/recruiter", "/friend", "/viewer", "/personal"}:
        response.headers["Cache-Control"] = "no-cache"
    if request.url.path.startswith("/api/v1/admin"):
        response.headers["Cache-Control"] = "private,no-store"
    elif request.url.path.startswith(("/api/v1/content", "/api/v1/posts", "/api/v1/timelines")):
        # These GETs expose drafts to the owner, so shared caches must never
        # reuse an authenticated representation for a public visitor.
        response.headers["Cache-Control"] = "private,no-cache"
        response.headers["Vary"] = "Cookie"
    if request.url.path.startswith("/admin") or request.url.path.startswith("/api/v1/admin"):
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
    logger.info(json.dumps({
        "event": "request", "request_id": request_id, "method": request.method,
        "path": request.url.path, "status": response.status_code,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }))
    return response


def _site_settings() -> dict:
    value = db.get_content("site")
    return value if isinstance(value, dict) else {}


def _canonical_base(site: dict | None = None) -> str:
    site = site or _site_settings()
    candidate = str(site.get("canonical_url") or "").strip().rstrip("/")
    if candidate.startswith(("https://", "http://")):
        return candidate
    return config.base_url()


def _recruiter_fallback() -> str:
    """Small semantic recruiter view for no-script clients and crawlers."""
    card = db.get_content("card")
    card = card if isinstance(card, dict) else {}
    name = str(card.get("name") or "Recruiter path").strip()
    role = str(card.get("role") or "").strip()
    tagline = str(card.get("tagline") or "").strip()
    email = str(card.get("email") or "").strip()
    body = [f"<main><header><h1>{html.escape(name)}</h1>"]
    if role:
        body.append(f"<p>{html.escape(role)}</p>")
    if tagline:
        body.append(f"<p>{html.escape(tagline)}</p>")
    if email:
        body.append(f"<p>{html.escape(email)}</p>")
    body.append('<p><a href="/resume">Open the accessible resume</a> · <a href="/resume.pdf">Download PDF</a></p></header>')
    for key, heading in (("selected_work", "Selected work"), ("career", "Career")):
        items = card.get(key)
        if not isinstance(items, list) or not items:
            continue
        body.append(f"<section><h2>{heading}</h2><ul>")
        for item in items:
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("role") or "Entry"
            detail = item.get("sub") or item.get("desc") or item.get("co") or ""
            year = item.get("year") or ""
            line = " — ".join(str(value).strip() for value in (title, detail, year) if str(value).strip())
            body.append(f"<li>{html.escape(line)}</li>")
        body.append("</ul></section>")
    body.append("</main>")
    return "".join(body)


def _spa_html(
    *, title: str | None = None, description: str | None = None,
    canonical_path: str = "/", fallback: str = "", structured: dict | None = None,
    og_type: str = "website",
) -> HTMLResponse:
    source = assets.version_asset_urls((STATIC_DIR / "index.html").read_text(encoding="utf-8"))
    site = _site_settings()
    site_title = str(site.get("site_title") or "Choose Your Path").strip()
    title = title or site_title
    description = description or "An interactive four-path portfolio."
    canonical = _canonical_base(site) + canonical_path
    nonce = secrets.token_urlsafe(18)
    source = source.replace(
        '<script type="importmap">', f'<script type="importmap" nonce="{nonce}">', 1,
    )
    metadata = (
        f'<link rel="canonical" href="{html.escape(canonical, quote=True)}">'
        f'<meta property="og:title" content="{html.escape(title, quote=True)}">'
        f'<meta property="og:description" content="{html.escape(description, quote=True)}">'
        f'<meta property="og:url" content="{html.escape(canonical, quote=True)}">'
        f'<meta property="og:site_name" content="{html.escape(site_title, quote=True)}">'
        f'<meta property="og:type" content="{html.escape(og_type, quote=True)}">'
    )
    structured = structured or {"@context": "https://schema.org", "@type": "WebSite", "name": title, "url": canonical}
    metadata += f'<script type="application/ld+json" nonce="{nonce}">' + json.dumps(structured, ensure_ascii=False).replace("<", "\\u003c") + "</script>"
    source = source.replace("</head>", metadata + "</head>", 1)
    source = source.replace("<title>Choose Your Path</title>", f"<title>{html.escape(title)}</title>", 1)
    source = source.replace(
        '<meta name="description" content="An interactive four-path portfolio: recruiter, friend, curious viewer, or personal.">',
        f'<meta name="description" content="{html.escape(description, quote=True)}">', 1,
    )
    if fallback:
        source = source.replace("<body>", f"<body><noscript>{fallback}</noscript>", 1)
    return HTMLResponse(source, headers={"X-Portfolio-CSP-Nonce": nonce})


@app.get("/", response_class=HTMLResponse)
def index():
    return _spa_html()


@app.get("/recruiter", response_class=HTMLResponse)
@app.get("/friend", response_class=HTMLResponse)
@app.get("/viewer", response_class=HTMLResponse)
@app.get("/personal", response_class=HTMLResponse)
def path_page(request: Request):
    path_name = request.url.path.strip("/")
    site = _site_settings()
    title = f"{path_name.title()} path — {site.get('site_title') or 'Portfolio'}"
    fallback = _recruiter_fallback() if path_name == "recruiter" else f"<main><h1>{html.escape(path_name.title())} path</h1><p>This experience requires JavaScript. Return to the <a href=\"/\">path chooser</a>.</p></main>"
    structured = {
        "@context": "https://schema.org", "@type": "ProfilePage" if path_name == "recruiter" else "WebPage",
        "name": title, "url": _canonical_base(site) + f"/{path_name}",
    }
    if path_name == "recruiter" and site.get("owner_name"):
        structured["mainEntity"] = {"@type": "Person", "name": site["owner_name"]}
        card = db.get_content("card")
        if isinstance(card, dict) and card.get("role"):
            structured["mainEntity"]["jobTitle"] = str(card["role"])
    description = None
    if path_name == "recruiter":
        card = db.get_content("card")
        if isinstance(card, dict):
            description = str(card.get("tagline") or card.get("role") or "").strip() or None
    return _spa_html(
        title=title, description=description, canonical_path=f"/{path_name}",
        fallback=fallback, structured=structured,
    )


@app.get("/blog/{slug}", response_class=HTMLResponse)
def blog_page(slug: str):
    with db.connect() as con:
        row = con.execute("SELECT * FROM blog_posts WHERE slug=? AND published=1", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "no such post")
    excerpt = row["excerpt"] or row["body_md"][:220]
    fallback = (
        f'<article><h1>{html.escape(row["title"])}</h1>'
        + "".join(f"<p>{html.escape(paragraph)}</p>" for paragraph in row["body_md"].split("\n\n"))
        + "</article>"
    )
    site = _site_settings()
    structured = {
        "@context": "https://schema.org", "@type": "BlogPosting", "headline": row["title"],
        "datePublished": row["created_at"], "dateModified": row["updated_at"] or row["created_at"],
        "url": _canonical_base(site) + f"/blog/{slug}",
    }
    if site.get("owner_name"):
        structured["author"] = {"@type": "Person", "name": site["owner_name"]}
    return _spa_html(
        title=row["title"], description=excerpt, canonical_path=f"/blog/{slug}",
        fallback=fallback, structured=structured, og_type="article",
    )


@app.get("/resume", response_class=HTMLResponse)
def resume_page():
    data = db.get_content("resume")
    if not isinstance(data, dict):
        raise HTTPException(404, "resume has not been published")
    nonce = secrets.token_urlsafe(18)
    return HTMLResponse(
        resume.render_html(data, canonical=_canonical_base() + "/resume", nonce=nonce),
        headers={"X-Portfolio-CSP-Nonce": nonce},
    )


@app.get("/resume.pdf")
def resume_pdf():
    uploaded = db.get_content("resume_pdf")
    if isinstance(uploaded, dict) and uploaded.get("stored_name"):
        target = (config.upload_dir() / uploaded["stored_name"]).resolve()
        if target.parent == config.upload_dir().resolve() and target.is_file():
            return FileResponse(target, media_type="application/pdf", filename="resume.pdf", headers={"Cache-Control": "no-store"})
    data = db.get_content("resume")
    if not isinstance(data, dict):
        raise HTTPException(404, "resume has not been published")
    try:
        target = resume.cached_pdf(data)
    except OSError:
        # Read-only deployments still get a valid generated PDF response.
        return Response(
            resume.build_pdf(data), media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="resume.pdf"'},
        )
    return FileResponse(target, media_type="application/pdf", filename="resume.pdf", content_disposition_type="inline")


@app.get("/legal", response_class=HTMLResponse)
def legal_page():
    return HTMLResponse(legal.combined_html())


@app.get("/privacy", response_class=HTMLResponse)
@app.get("/legal/privacy", response_class=HTMLResponse, include_in_schema=False)
def privacy_page():
    return HTMLResponse(legal.privacy_html())


@app.get("/cookies", response_class=HTMLResponse)
@app.get("/legal/cookies", response_class=HTMLResponse, include_in_schema=False)
def cookie_page():
    return HTMLResponse(legal.cookies_html())


@app.get("/terms", response_class=HTMLResponse)
@app.get("/legal/terms", response_class=HTMLResponse, include_in_schema=False)
def terms_page():
    return HTMLResponse(legal.terms_html())


@app.get("/credits", response_class=HTMLResponse)
@app.get("/legal/credits", response_class=HTMLResponse, include_in_schema=False)
def credits_page():
    return HTMLResponse(legal.credits_html())


@app.get("/admin")
def admin_page():
    source = assets.version_asset_urls((STATIC_DIR / "admin.html").read_text(encoding="utf-8"))
    return HTMLResponse(
        source,
        headers={"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"},
    )


@app.get("/healthz")
def health():
    return {"status": "ok"}


@app.get("/readyz")
def readiness():
    try:
        with db.connect() as con:
            ok = con.execute("SELECT 1").fetchone()[0] == 1
        if not ok or db.schema_version() != db.MIGRATIONS[-1][0]:
            raise RuntimeError("database is not migrated")
    except Exception as exc:
        return JSONResponse({"status": "not ready", "detail": str(exc)}, status_code=503)
    return {"status": "ready", "schema_version": db.schema_version()}


# Uploaded media is isolated from executable static assets and MIME-sniffing is disabled.
app.mount("/media", StaticFiles(directory=config.upload_dir(), check_dir=False), name="media")
app.mount("/static", PublicAssets(directory=STATIC_DIR), name="static")
