from __future__ import annotations

import asyncio
from io import BytesIO
from tempfile import SpooledTemporaryFile

import pytest
from fastapi import HTTPException, Request, Response, UploadFile
from pydantic import ValidationError
from starlette.datastructures import Headers

from server import db
from server.models import CardDocument, CommentIn, MessageIn, PostIn, ReactionIn, StatEventIn, TimelineEventIn, TimelinePeriodIn
from server.routers import v1


def request(*, cookie: str = "", path: str = "/") -> Request:
    headers = [(b"cookie", cookie.encode())] if cookie else []
    return Request({
        "type": "http", "method": "POST", "path": path, "headers": headers,
        "client": ("127.0.0.2", 1234), "server": ("testserver", 80),
        "scheme": "http", "query_string": b"",
    })


def test_business_card_social_profile_urls():
    card = CardDocument(github_url="https://github.com/example", linkedin_url="https://www.linkedin.com/in/example")
    assert card.github_url == "https://github.com/example"
    assert card.linkedin_url == "https://www.linkedin.com/in/example"
    assert CardDocument().github_url == ""
    for field in ("github_url", "linkedin_url"):
        with pytest.raises(ValidationError):
            CardDocument(**{field: "javascript:alert(1)"})


def test_grouped_timeline_order_and_validated_links():
    p2 = v1.create_period("viewer", TimelinePeriodIn(label="Later", sort_order=1, published=True))
    p1 = v1.create_period("viewer", TimelinePeriodIn(label="First", sort_order=0, published=True))
    event = TimelineEventIn(
        slug="first-launch", category="identity", title="First launch", summary="A turning point.",
        details_md="More detail", layout="upper", accent="gold",
        links=[{"kind": "external", "label": "Project", "url": "https://example.com"}], published=True,
    )
    created = v1.create_event(p1["id"], event)
    timeline = v1.get_timeline("viewer", request())
    assert [period["label"] for period in timeline["periods"]] == ["First", "Later"]
    assert timeline["periods"][0]["events"][0]["slug"] == created["slug"]
    assert timeline["periods"][0]["events"][0]["links"][0]["url"] == "https://example.com"
    v1.reorder_timeline("viewer", v1.TimelineOrderIn(period_ids=[p2["id"], p1["id"]], event_ids_by_period={p2["id"]: [], p1["id"]: [created["id"]]}))
    assert [period["label"] for period in v1.get_timeline("viewer", request())["periods"]] == ["Later", "First"]
    with pytest.raises(ValidationError):
        TimelineEventIn(title="Unsafe", links=[{"kind": "external", "label": "bad", "url": "javascript:alert(1)"}])
    with pytest.raises(HTTPException) as missing_post:
        v1.create_event(
            p1["id"],
            TimelineEventIn(
                title="Broken internal link",
                links=[{"kind": "post", "slug": "not-published"}],
                published=True,
            ),
        )
    assert missing_post.value.status_code == 400


def test_media_upload_requires_real_file_and_alt_text():
    from PIL import Image
    image = Image.new("RGB", (3, 2), "red")
    encoded = BytesIO(); image.save(encoded, "PNG")
    upload_file = SpooledTemporaryFile(); upload_file.write(encoded.getvalue()); upload_file.seek(0)
    upload = UploadFile(file=upload_file, filename="tiny.png", headers=Headers({"content-type": "image/png"}))
    result = asyncio.run(v1.upload_media(file=upload, alt_text="A tiny red rectangle"))
    assert result["mime_type"] == "image/png" and result["width"] == 3
    assert (v1.config.upload_dir() / result["url"].rsplit("/", 1)[-1]).is_file()
    bad_file = SpooledTemporaryFile(); bad_file.write(b"not an image"); bad_file.seek(0)
    bad = UploadFile(file=bad_file, filename="bad.png", headers=Headers({"content-type": "image/png"}))
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(v1.upload_media(file=bad, alt_text="Bad image"))
    assert invalid.value.status_code == 415


def test_blog_popularity_likes_reactions_and_three_comment_levels():
    post_id = v1.create_post(PostIn(slug="real-post", title="Real post", body_md="Body", tags=["personal"], published=True))["id"]
    v1.update_post(
        post_id,
        PostIn(slug="real-post", title="Updated real post", body_md="Body", tags=["personal"], published=True),
    )
    assert v1.get_post("real-post", request())["title"] == "Updated real post"
    like_response = Response()
    liked = v1.toggle_like(post_id, request(), like_response)
    cookie = like_response.headers.get("set-cookie").split(";", 1)[0]
    assert liked == {"active": True, "count": 1}
    assert v1.toggle_reaction(post_id, ReactionIn(emoji="🔥"), request(cookie=cookie), Response())["active"]
    root = v1.add_comment(post_id, CommentIn(author_name="Ada", body="Root"), request())
    child = v1.add_comment(post_id, CommentIn(author_name="Ben", body="Reply", parent_id=root["id"]), request())
    grandchild = v1.add_comment(post_id, CommentIn(author_name="Cy", body="Nested", parent_id=child["id"]), request())
    with pytest.raises(HTTPException) as too_deep:
        v1.add_comment(post_id, CommentIn(author_name="Dee", body="Too deep", parent_id=grandchild["id"]), request())
    assert too_deep.value.status_code == 400
    page = v1.list_posts(request(), tag=None, sort="popular", cursor=None, limit=20)
    assert page["items"][0]["popularity"] == 1 + 1 + 2 * 3
    with pytest.raises(ValidationError):
        CommentIn(author_name="x", body="<script>alert(1)</script>")
    with pytest.raises(HTTPException) as reserved_admin:
        v1.add_comment(post_id, CommentIn(author_name="aDmIn", body="Impersonation"), request())
    assert reserved_admin.value.status_code == 403


def test_comment_cursor_pages_complete_root_threads():
    post_id = v1.create_post(PostIn(slug="thread-pages", title="Threads", body_md="Body", published=True))["id"]
    root_ids = []
    for name in ("A", "B", "C"):
        root_ids.append(v1.add_comment(post_id, CommentIn(author_name=name, body=f"Root {name}"), request())["id"])
    v1.add_comment(post_id, CommentIn(author_name="reply", body="Attached reply", parent_id=root_ids[2]), request())
    first = v1.list_comments(post_id, request(), cursor=None, limit=2)
    assert len(first["items"]) == 2 and first["next_cursor"]
    assert [item["author_name"] for item in first["items"]] == ["C", "B"]
    assert first["items"][0]["replies"][0]["body"] == "Attached reply"
    second = v1.list_comments(post_id, request(), cursor=first["next_cursor"], limit=2)
    assert [item["author_name"] for item in second["items"]] == ["A"]


def test_comments_for_unpublished_posts_are_not_public():
    post_id = v1.create_post(PostIn(slug="draft-thread", title="Draft", body_md="Body", published=False))["id"]
    with db.connect() as con:
        con.execute(
            "INSERT INTO comments(post_id,author_name,body,moderation_status) VALUES(?,?,?,'visible')",
            (post_id, "Private reviewer", "Draft feedback"),
        )
    with pytest.raises(HTTPException) as hidden:
        v1.list_comments(post_id, request(), cursor=None, limit=20)
    assert hidden.value.status_code == 404


def test_message_publication_requires_recorded_consent():
    private = v1.create_message(MessageIn(path="friend", body="Private", publication_consent=False), request())
    with pytest.raises(HTTPException) as no_consent:
        v1.moderate_message(private["id"], v1.MessageModerationIn(status="approved", publish=True, public_display_name="Friend"))
    assert no_consent.value.status_code == 409
    public = v1.create_message(MessageIn(path="friend", author_name="A", body="For the wall", publication_consent=True, consent_version="2026-08-20"), request())
    v1.moderate_message(public["id"], v1.MessageModerationIn(status="approved", publish=True, public_display_name="A"))
    with db.connect() as con:
        first_published = con.execute("SELECT published_at FROM messages WHERE id=?", (public["id"],)).fetchone()["published_at"]
    v1.moderate_message(public["id"], v1.MessageModerationIn(status="approved", publish=True, public_display_name="Updated A"))
    with db.connect() as con:
        assert con.execute("SELECT published_at FROM messages WHERE id=?", (public["id"],)).fetchone()["published_at"] == first_published
    wall = v1.message_wall(100)
    assert [item["body"] for item in wall["items"]] == ["For the wall"]
    assert "contact" not in wall["items"][0]


def test_legal_draft_does_not_change_live_settings():
    legal = {
        "controller_name": "Ada", "controller_contact": "ada@example.test",
        "purpose": "Reply to messages", "lawful_basis": "Consent",
        "processor_hosting": "EU host", "international_transfers": "None",
        "retention": "90 days", "rights": "Access and erasure",
        "withdrawal": "Email the controller", "complaint_authority": "IMY",
        "cookie_details": "Necessary and optional first-party cookies", "terms": "Be kind",
        "last_updated": "2026-08-20",
    }
    v1.write_content("legal", v1.ContentWrite(data=legal, published=False, note="draft"))
    with db.connect() as con:
        assert con.execute("SELECT value FROM legal_settings WHERE key='controller_name'").fetchone()["value"] == ""
    v1.write_content("legal", v1.ContentWrite(data=legal, published=True, note="publish"))
    with db.connect() as con:
        assert con.execute("SELECT value FROM legal_settings WHERE key='cookie_details'").fetchone()["value"] == legal["cookie_details"]
    incomplete = {**legal}
    incomplete.pop("cookie_details")
    v1.write_content("legal", v1.ContentWrite(data=incomplete, published=True, note="incomplete publication"))
    with db.connect() as con:
        assert con.execute("SELECT value FROM legal_settings WHERE key='cookie_details'").fetchone()["value"] == ""


def test_content_documents_reject_active_url_schemes():
    with pytest.raises(HTTPException) as unsafe:
        v1.write_content(
            "card",
            v1.ContentWrite(data={"name": "Ada", "url": "javascript:alert(1)"}, published=False),
        )
    assert unsafe.value.status_code == 422


def test_content_documents_and_revisions_enforce_structured_shapes():
    with pytest.raises(HTTPException) as malformed_card:
        v1.write_content(
            "card",
            v1.ContentWrite(data={"name": "Ada", "chips": [{"not": "text"}]}, published=False),
        )
    assert malformed_card.value.status_code == 422
    with pytest.raises(HTTPException) as malformed_links:
        v1.write_content(
            "friend_links",
            v1.ContentWrite(data={"links": []}, published=False),
        )
    assert malformed_links.value.status_code == 422

    # Revisions are untrusted historical input too: restoring cannot bypass
    # the current document models merely because an old row already exists.
    db.set_content("resume", {"skills": [{}]}, published=False, note="malformed legacy revision")
    with db.connect() as con:
        revision_id = con.execute(
            "SELECT id FROM content_revisions WHERE entity_type='content' AND entity_key='resume' ORDER BY id DESC"
        ).fetchone()["id"]
    with pytest.raises(HTTPException) as malformed_revision:
        v1.restore_revision(revision_id)
    assert malformed_revision.value.status_code == 422


def test_launch_readiness_requires_friend_story_publication_permission():
    site = {
        "site_title": "Real portfolio", "canonical_url": "https://portfolio.example",
        "owner_name": "Ada", "owner_contact": "ada@example.test",
    }
    db.set_content("site", site, published=True)
    assert "site.friend_story_consent_confirmed" in v1.launch_readiness()["missing_content"]
    db.set_content("site", {**site, "friend_story_consent_confirmed": True}, published=True)
    assert "site.friend_story_consent_confirmed" not in v1.launch_readiness()["missing_content"]


def test_launch_readiness_rejects_empty_list_placeholders():
    db.set_content(
        "card",
        {"name": "Ada", "role": "Engineer", "email": "ada@example.test", "selected_work": [{}], "career": [{}]},
        published=True,
    )
    db.set_content(
        "resume",
        {
            "name": "Ada", "headline": "Engineer", "summary": "Builds systems.",
            "contact": [{}], "experience": [{}], "education": [{}], "skills": [""], "projects": [{}],
        },
        published=True,
    )
    missing = set(v1.launch_readiness()["missing_content"])
    assert {
        "card.selected_work", "card.career", "resume.contact", "resume.experience",
        "resume.education", "resume.skills", "resume.projects",
    }.issubset(missing)


def test_stats_require_consent_and_deduplicate():
    event = StatEventIn(
        type="view", path="world", session_id="session_1234", event_id="event_123456",
        landing_referrer="https://www.linkedin.com/feed", device_class="mobile",
        browser_family="Firefox", language="en", timezone_region="Europe",
    )
    with pytest.raises(HTTPException) as denied:
        v1.stats_event(event, request(), Response(), analytics_consent=None)
    assert denied.value.status_code == 403
    consented_response = Response()
    assert v1.stats_event(event, request(), consented_response, analytics_consent="true")["deduplicated"] is False
    analytics_cookie = consented_response.headers.get("set-cookie")
    assert "portfolio_analytics_session=" in analytics_cookie and "HttpOnly" in analytics_cookie
    assert v1.stats_event(event, request(), Response(), analytics_consent="true")["deduplicated"] is True
    stats = v1.public_stats()
    assert stats["totals"]["view"] == 1
    assert stats["sources"] == {}  # low-volume source buckets are suppressed below five
    with db.connect() as con:
        audience = {(row["dimension"], row["value"]): row["count"] for row in con.execute("SELECT * FROM daily_audience")}
    assert audience[("device", "mobile")] == 1
    assert audience[("browser", "Firefox")] == 1

    withdrawal = Response()
    v1.withdraw_analytics_session(
        request(cookie="portfolio_analytics_session=session_cookie", path="/api/v1/stats/session"),
        withdrawal,
    )
    cleared = withdrawal.headers.get("set-cookie")
    assert "portfolio_analytics_session=" in cleared and "Max-Age=0" in cleared
