"""Accessible resume rendering and dependency-free cached PDF generation."""
from __future__ import annotations

import hashlib
import html
import json
import textwrap
from pathlib import Path
from typing import Any

from . import config, db


def _text(value: Any) -> str:
    return str(value or "").strip()


def _items(value: Any) -> list[dict]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def normalize(data: dict) -> dict:
    """Accept the established resume document while exposing one stable shape."""
    identity = data.get("identity") if isinstance(data.get("identity"), dict) else {}
    return {
        "name": _text(identity.get("name") or data.get("name")),
        "headline": _text(identity.get("headline") or data.get("headline") or data.get("stub")),
        "summary": _text(data.get("summary")),
        "contact": _items(data.get("contact")),
        "experience": _items(data.get("experience")),
        "education": _items(data.get("education")),
        "projects": _items(data.get("projects") or data.get("notable")),
        "skills": [str(item) for item in data.get("skills", [])] if isinstance(data.get("skills"), list) else [],
    }


def _entry_html(item: dict) -> str:
    title = html.escape(_text(item.get("role") or item.get("title")))
    org = html.escape(_text(item.get("company") or item.get("co") or item.get("organization")))
    dates = html.escape(_text(item.get("dates") or item.get("year")))
    description = html.escape(_text(item.get("description") or item.get("desc"))).replace("\n", "<br>")
    return (
        '<article class="entry"><header><h3>' + title + "</h3>"
        + (f"<p><strong>{org}</strong></p>" if org else "")
        + (f'<p class="dates">{dates}</p>' if dates else "")
        + "</header>" + (f"<p>{description}</p>" if description else "") + "</article>"
    )


def render_html(data: dict, *, canonical: str, nonce: str = "") -> str:
    resume = normalize(data)
    name = html.escape(resume["name"] or "Resume")
    sections = []
    for key, label in (("experience", "Experience"), ("projects", "Selected work"), ("education", "Education")):
        entries = "".join(_entry_html(item) for item in resume[key])
        if entries:
            sections.append(f"<section><h2>{label}</h2>{entries}</section>")
    if resume["skills"]:
        sections.append("<section><h2>Skills</h2><p>" + html.escape(" · ".join(resume["skills"])) + "</p></section>")
    contacts = []
    for item in resume["contact"]:
        label, value = _text(item.get("label")), _text(item.get("value"))
        if label or value:
            contacts.append(html.escape(f"{label}: {value}".strip(": ")))
    structured = json.dumps({
        "@context": "https://schema.org", "@type": "Person",
        "name": resume["name"] or "Portfolio owner", "description": resume["headline"],
        "url": canonical,
    }, ensure_ascii=False).replace("<", "\\u003c")
    nonce_attribute = f' nonce="{html.escape(nonce, quote=True)}"' if nonce else ""
    description = resume["summary"] or resume["headline"] or f"Resume for {resume['name'] or 'the portfolio owner'}"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} — Resume</title><meta name="robots" content="index,follow">
<meta name="description" content="{html.escape(description, quote=True)}">
<link rel="canonical" href="{html.escape(canonical, quote=True)}">
<meta property="og:title" content="{name} — Resume"><meta property="og:type" content="profile">
<meta property="og:description" content="{html.escape(description, quote=True)}">
<meta property="og:url" content="{html.escape(canonical, quote=True)}">
<script type="application/ld+json"{nonce_attribute}>{structured}</script>
<style>
body{{font:16px/1.55 system-ui,sans-serif;color:#171717;max-width:860px;margin:0 auto;padding:3rem 1.5rem}}
h1{{font-size:2.4rem;margin:0}}h2{{border-bottom:1px solid #bbb;padding-bottom:.3rem;margin-top:2rem}}
.headline,.contact{{color:#555}}.entry{{break-inside:avoid;margin:1.3rem 0}}.entry h3,.entry p{{margin:.15rem 0}}.dates{{font-size:.9rem;color:#666}}
.actions{{display:flex;gap:1rem}}a{{color:#174ea6}}@media print{{.actions{{display:none}}body{{padding:0;max-width:none}}}}
</style></head><body><main>
<div class="actions"><a href="/">Portfolio</a><a href="/resume.pdf">Download PDF</a></div>
<header><h1>{name}</h1><p class="headline">{html.escape(resume['headline'])}</p>
<p class="contact">{' · '.join(contacts)}</p></header>
{f'<section><h2>Profile</h2><p>{html.escape(resume["summary"])}</p></section>' if resume['summary'] else ''}
{''.join(sections)}</main></body></html>"""


def _plain_lines(data: dict) -> list[str]:
    resume = normalize(data)
    lines = [resume["name"] or "Resume", resume["headline"], ""]
    if resume["summary"]:
        lines.extend(("PROFILE", resume["summary"], ""))
    for key, label in (("experience", "EXPERIENCE"), ("projects", "SELECTED WORK"), ("education", "EDUCATION")):
        if not resume[key]:
            continue
        lines.extend((label, ""))
        for item in resume[key]:
            title = _text(item.get("role") or item.get("title"))
            org = _text(item.get("company") or item.get("co") or item.get("organization"))
            dates = _text(item.get("dates") or item.get("year"))
            lines.append(" — ".join(part for part in (title, org, dates) if part))
            lines.append(_text(item.get("description") or item.get("desc")))
            lines.append("")
    if resume["skills"]:
        lines.extend(("SKILLS", ", ".join(resume["skills"])))
    wrapped: list[str] = []
    for line in lines:
        wrapped.extend(textwrap.wrap(line, width=92, replace_whitespace=True) or [""])
    return wrapped


def _pdf_escape(value: str) -> str:
    return value.encode("cp1252", "replace").decode("latin1").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(data: dict) -> bytes:
    """Build a standards-compliant text PDF without a system PDF dependency."""
    lines = _plain_lines(data)
    pages = [lines[index:index + 48] for index in range(0, max(1, len(lines)), 48)] or [[]]
    # object 1 catalog, 2 pages, 3 font, then page/content object pairs
    page_ids = [4 + index * 2 for index in range(len(pages))]
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{' '.join(f'{item} 0 R' for item in page_ids)}] /Count {len(pages)} >>".encode(),
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for index, page_lines in enumerate(pages):
        page_id = page_ids[index]
        content_id = page_id + 1
        commands = ["BT", "/F1 10 Tf", "54 770 Td", "14 TL"]
        for line in page_lines:
            commands.append(f"({_pdf_escape(line)}) Tj")
            commands.append("T*")
        commands.append("ET")
        stream = "\n".join(commands).encode("latin1")
        objects[page_id] = f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode()
        objects[content_id] = f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_id in range(1, max(objects) + 1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode())
        output.extend(objects[object_id])
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(output)


def cached_pdf(data: dict) -> Path:
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    target = config.data_dir() / "resume-cache.pdf"
    marker = config.data_dir() / "resume-cache.sha256"
    if not target.exists() or not marker.exists() or marker.read_text().strip() != digest:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(build_pdf(data))
        temporary.replace(target)
        marker.write_text(digest + "\n")
    return target


def invalidate_cache() -> None:
    (config.data_dir() / "resume-cache.sha256").unlink(missing_ok=True)
