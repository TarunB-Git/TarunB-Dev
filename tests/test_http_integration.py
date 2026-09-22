import re

from fastapi.testclient import TestClient

from server import config, db, seed
from server.auth import set_passphrase
from server.main import ASSET_NAMESPACE, app
from server.models import PostIn
from server.routers import v1


def test_http_deep_links_security_headers_and_csrf():
    set_passphrase("integration test passphrase")
    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        assert client.get("/viewer").status_code == 200
        ready = client.get("/readyz")
        assert ready.status_code == 200
        assert ready.headers["x-content-type-options"] == "nosniff"
        cross_origin = client.post(
            "/api/v1/admin/login", json={"passphrase": "integration test passphrase"},
            headers={"Origin": "https://attacker.example"},
        )
        assert cross_origin.status_code == 403
        login = client.post("/api/v1/admin/login", json={"passphrase": "integration test passphrase"})
        assert login.status_code == 200
        no_csrf = client.post("/api/v1/admin/timelines/viewer/periods", json={"label": "2026"})
        assert no_csrf.status_code == 403
        csrf = login.json()["csrf_token"]
        created = client.post(
            "/api/v1/admin/timelines/viewer/periods",
            json={"label": "2026", "published": True}, headers={"X-CSRF-Token": csrf},
        )
        assert created.status_code == 201
        admin = client.get("/admin")
        assert admin.status_code == 200 and "noindex" in admin.headers["x-robots-tag"]
        admin_api = client.get("/api/v1/admin/me")
        assert admin_api.status_code == 200
        assert admin_api.headers["cache-control"] == "private,no-store"

        # The pre-v1 surface is intentionally retired: it must not provide a
        # weaker path around draft, moderation, or analytics guarantees.
        for method, route in (
            ("GET", "/api/content/card"),
            ("GET", "/api/posts"),
            ("POST", "/api/stats/event"),
            ("GET", "/api/messages"),
        ):
            assert client.request(method, route).status_code == 404

        oversized = client.post(
            "/api/v1/messages",
            content=b"x" * (config.MAX_REQUEST_BYTES + 1),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert oversized.status_code == 413


def test_owner_first_run_setup_is_one_time_and_accepts_any_nonempty_passphrase():
    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        status = client.get("/api/v1/admin/setup-status")
        assert status.status_code == 200 and status.json() == {"needs_setup": True, "recovery_available": False}
        # Local requests are allowed at the actual browser origin even when it
        # differs from PORTFOLIO_BASE_URL (for example 127.0.0.1:8800).
        created = client.post(
            "/api/v1/admin/setup", json={"passphrase": "x"},
            headers={"Origin": "http://testserver"},
        )
        assert created.status_code == 200 and created.json()["csrf_token"]
        assert client.get("/api/v1/admin/me").json() == {"admin": True}
        assert client.get("/api/v1/admin/setup-status").json() == {"needs_setup": False, "recovery_available": False}
        assert client.post("/api/v1/admin/setup", json={"passphrase": "another"}).status_code == 409


def test_owner_can_recover_a_forgotten_passphrase_after_deployment(monkeypatch):
    monkeypatch.setenv("ADMIN_RECOVERY_TOKEN", "render-keeps-this-token-outside-the-database")
    set_passphrase("forgotten passphrase")
    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        assert client.get("/api/v1/admin/setup-status").json() == {
            "needs_setup": False, "recovery_available": True,
        }
        denied = client.post("/api/v1/admin/recover", json={
            "recovery_token": "wrong-token", "new_passphrase": "replacement passphrase",
        })
        assert denied.status_code == 401
        recovered = client.post("/api/v1/admin/recover", json={
            "recovery_token": "render-keeps-this-token-outside-the-database",
            "new_passphrase": "replacement passphrase",
        })
        assert recovered.status_code == 200 and recovered.json()["csrf_token"]
        assert client.get("/api/v1/admin/me").json() == {"admin": True}
        assert client.post("/api/v1/admin/login", json={"passphrase": "forgotten passphrase"}).status_code == 401
        assert client.post("/api/v1/admin/login", json={"passphrase": "replacement passphrase"}).status_code == 200


def test_code_preview_reads_source_text_without_overwriting_saved_content(monkeypatch):
    db.set_content("card", {"name": "Saved owner name", "role": "Saved owner role"})
    monkeypatch.setenv("PORTFOLIO_CONTENT_SOURCE", "code")
    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        assert 'data-content-source="code"' in client.get("/").text
        posts = client.get("/api/v1/posts").json()["items"]
        sample = seed.POSTS[0]
        assert next(post for post in posts if post["slug"] == sample["slug"])["title"] == sample["title"]
        assert client.get(f'/api/v1/posts/{sample["slug"]}').json()["body_md"] == sample["body_md"]
    assert db.get_content("card")["name"] == "Saved owner name"


def test_strict_csp_local_assets_and_ssr_metadata_on_every_deep_route():
    db.set_content(
        "site",
        {
            "site_title": "Ada's Paths", "canonical_url": "https://portfolio.example",
            "owner_name": "Ada Example", "owner_contact": "ada@example.test",
        },
        published=True,
    )
    db.set_content(
        "card",
        {
            "name": "Ada Example", "role": "Systems Engineer", "email": "ada@example.test",
            "tagline": "Careful systems, clearly explained.",
            "selected_work": [{"title": "Reliable service", "sub": "Production platform", "year": "2026"}],
            "career": [{"role": "Engineer", "co": "Example", "year": "2024–"}],
        },
        published=True,
    )
    post_id = v1.create_post(PostIn(
        slug="a-real-post", title="A real post", body_md="A public article.",
        excerpt="An article summary.", tags=["personal"], published=True,
    ))["id"]
    assert post_id
    db.set_content(
        "resume",
        {
            "name": "Ada Example", "headline": "Engineer", "summary": "Builds careful systems.",
            "experience": [{"role": "Engineer", "co": "Example", "dates": "2024–", "desc": "Shipped."}],
        },
        published=True,
    )
    exact_import_map = (
        '{"imports":{"three":"/static/' + ASSET_NAMESPACE
        + '/vendor/three/build/three.module.js","three/addons/":"/static/'
        + ASSET_NAMESPACE + '/vendor/three/examples/jsm/"}}'
    )

    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        for route in ("/", "/recruiter?mode=light", "/friend", "/viewer", "/personal?event=turning-point"):
            response = client.get(route)
            assert response.status_code == 200
            importmap_nonce = re.search(
                r'<script type="importmap" nonce="([^"]+)">'
                + re.escape(exact_import_map) + r'</script>', response.text,
            )
            assert importmap_nonce
            assert f'<script type="module" src="/static/{ASSET_NAMESPACE}/js/main.js"></script>' in response.text
            assert "cdn.jsdelivr.net" not in response.text and "fonts.googleapis.com" not in response.text
            csp = response.headers["content-security-policy"]
            script_directive = next(part.strip() for part in csp.split(";") if part.strip().startswith("script-src"))
            assert "'self'" in script_directive
            assert "'unsafe-inline'" not in script_directive and "https:" not in script_directive
            nonce = re.search(r'<script type="application/ld\+json" nonce="([^"]+)">', response.text)
            assert nonce and f"'nonce-{nonce.group(1)}'" in script_directive
            assert importmap_nonce.group(1) == nonce.group(1)
            assert "x-portfolio-csp-nonce" not in response.headers

        recruiter = client.get("/recruiter")
        assert "Recruiter path — Ada&#x27;s Paths" in recruiter.text
        assert 'href="https://portfolio.example/recruiter"' in recruiter.text
        assert '"mainEntity": {"@type": "Person", "name": "Ada Example", "jobTitle": "Systems Engineer"}' in recruiter.text
        assert "Reliable service — Production platform — 2026" in recruiter.text

        article = client.get("/blog/a-real-post")
        assert article.status_code == 200
        assert '<meta property="og:type" content="article">' in article.text
        assert 'href="https://portfolio.example/blog/a-real-post"' in article.text
        assert '"@type": "BlogPosting"' in article.text

        resume_page = client.get("/resume")
        assert resume_page.status_code == 200
        resume_nonce = re.search(r'<script type="application/ld\+json" nonce="([^"]+)">', resume_page.text)
        assert resume_nonce and f"'nonce-{resume_nonce.group(1)}'" in resume_page.headers["content-security-policy"]
        assert 'href="https://portfolio.example/resume"' in resume_page.text

        cookies = client.get("/legal/cookies")
        assert cookies.status_code == 200
        assert 'href="https://portfolio.example/cookies"' in cookies.text
        assert client.get("/static/index.html").status_code == 404
        assert client.get("/static/legal.html").status_code == 404
        versioned_asset = client.get(f"/static/{ASSET_NAMESPACE}/js/main.js")
        assert versioned_asset.status_code == 200
        assert versioned_asset.headers["cache-control"] == "public,max-age=31536000,immutable"
        versioned_model = client.get(f"/static/{ASSET_NAMESPACE}/assets/models/moon.glb")
        assert versioned_model.status_code == 200 and versioned_model.content.startswith(b"glTF")
        assert versioned_model.headers["cache-control"] == "public,max-age=31536000,immutable"
        credits = client.get("/api/v1/attribution").json()["items"]
        assert credits and all(item["url"].startswith(f"/static/{ASSET_NAMESPACE}/") for item in credits)
        assert client.get("/static/js/main.js").headers["cache-control"] == "no-cache"
        assert client.get("/static/v-stale-build/js/main.js").status_code == 404

        admin = client.get("/admin")
        assert f'src="/static/{ASSET_NAMESPACE}/js/admin.js"' in admin.text
        assert admin.headers["cache-control"] == "no-store"
