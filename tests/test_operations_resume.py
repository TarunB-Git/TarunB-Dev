from __future__ import annotations

import json
import asyncio
from tempfile import SpooledTemporaryFile

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from server import db, resume
from server.maintenance import run_once
from server.ops import cleanup, verify_attribution
from server.routers import v1
from server.models import PostIn


def test_uploaded_resume_pdf_is_separate_and_replaceable(isolated_data):
    from server.main import resume_pdf
    def upload(body, name):
        file = SpooledTemporaryFile(max_size=1024 * 1024)
        file.write(body)
        file.seek(0)
        return asyncio.run(v1.upload_resume_pdf(UploadFile(file, filename=name)))
    abridged = {"name": "Abridged name", "summary": "Keep this editable content"}
    db.set_content("resume", abridged)
    first = resume.build_pdf({"name": "Full PDF one"})
    result = upload(first, "my-resume.pdf")
    assert result["original_name"] == "my-resume.pdf"
    assert db.get_content("resume") == abridged
    assert resume_pdf().path.read_bytes() == first
    second = resume.build_pdf({"name": "Full PDF two"})
    upload(second, "updated.pdf")
    response = resume_pdf()
    assert response.path.read_bytes() == second
    assert response.headers["cache-control"] == "no-store"
    assert db.get_content("resume") == abridged
    with pytest.raises(HTTPException) as invalid:
        upload(b"not a pdf", "fake.pdf")
    assert invalid.value.status_code == 415
    assert resume_pdf().path.read_bytes() == second


def test_resume_html_and_pdf_share_one_source(isolated_data):
    source = {
        "name": "Ada Example", "headline": "Engineer", "summary": "Builds careful systems.",
        "experience": [{"role": "Engineer", "co": "Example", "dates": "2024–", "desc": "Shipped things."}],
    }
    page = resume.render_html(source, canonical="https://example.com/resume")
    pdf = resume.build_pdf(source)
    assert "Ada Example" in page and "Engineer" in page
    assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF\n")
    first = resume.cached_pdf(source)
    assert first.is_file() and first.read_bytes() == pdf


def test_revisions_restore_deleted_post():
    post_id = v1.create_post(PostIn(slug="restorable", title="Restorable", body_md="Original", tags=["personal"], published=False))["id"]
    v1.update_post(post_id, PostIn(slug="restorable", title="Changed", body_md="Changed", tags=["personal"], published=False))
    v1.delete_post(post_id)
    with db.connect() as con:
        revision_id = con.execute(
            "SELECT id FROM content_revisions WHERE entity_type='blog_post' AND entity_id=? ORDER BY id DESC", (post_id,),
        ).fetchone()["id"]
    result = v1.restore_revision(revision_id)
    assert result["entity_id"] == post_id
    with db.connect() as con:
        assert con.execute("SELECT title FROM blog_posts WHERE id=?", (post_id,)).fetchone()["title"] == "Changed"


def test_revision_restore_revalidates_historical_entity_payloads():
    with db.connect() as con:
        revision_id = con.execute(
            "INSERT INTO content_revisions(entity_type,entity_id,payload_json,note) VALUES(?,?,?,?)",
            (
                "blog_post", 987,
                json.dumps({"slug": "Unsafe Slug", "title": "<script>bad</script>", "tags": ["personal"]}),
                "malformed historical row",
            ),
        ).lastrowid
    with pytest.raises(HTTPException) as invalid:
        v1.restore_revision(revision_id)
    assert invalid.value.status_code == 422


def test_backup_restore_round_trip(isolated_data):
    db.set_content("site", {"title": "before"}, published=True)
    backup = db.backup_database()
    db.set_content("site", {"title": "after"}, published=True)
    safety = db.restore_database(backup)
    assert safety.is_file()
    assert db.get_content("site") == {"title": "before"}


def test_daily_maintenance_creates_backup_and_applies_retention(isolated_data):
    with db.connect() as con:
        con.execute(
            "INSERT INTO stat_events(event_type,consented,created_at) "
            "VALUES('view',1,datetime('now','-91 days'))"
        )
    result = run_once()
    backup = isolated_data / "backups" / result["backup"]
    assert backup.is_file()
    with db.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM stat_events").fetchone()[0] == 0
    with db.connect(backup) as con:
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert con.execute("SELECT COUNT(*) FROM stat_events").fetchone()[0] == 0


def test_retention_erases_private_data_but_keeps_published_wall_text():
    with db.connect() as con:
        con.execute("INSERT INTO messages(path,body,contact,status,created_at,updated_at) VALUES('friend','pending','secret','pending',datetime('now','-91 days'),datetime('now'))")
        con.execute("""INSERT INTO messages(path,body,contact,status,approved,publication_consent,consented_at,published_at,created_at,updated_at)
            VALUES('friend','public','secret','approved',1,1,datetime('now','-100 days'),datetime('now','-100 days'),datetime('now','-100 days'),datetime('now'))""")
        con.execute("INSERT INTO stat_events(event_type,consented,created_at) VALUES('view',1,datetime('now','-91 days'))")
    result = cleanup()
    assert result["messages_deleted"] == 1 and result["contacts_erased"] == 1 and result["events_deleted"] == 1
    with db.connect() as con:
        kept = con.execute("SELECT body,contact FROM messages").fetchone()
    assert tuple(kept) == ("public", "")


def test_cc_attribution_matches_embedded_glb_metadata():
    verify_attribution()
