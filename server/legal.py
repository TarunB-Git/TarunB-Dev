"""Legal-document and immutable attribution rendering."""
from __future__ import annotations

import html
import json
from pathlib import Path

from . import assets, config, db


MANIFEST_PATH = Path(__file__).with_name("attribution.json")


def _site_settings() -> dict:
    value = db.get_content("site")
    return value if isinstance(value, dict) else {}


def _canonical(path: str) -> str:
    candidate = str(_site_settings().get("canonical_url") or "").strip().rstrip("/")
    base = candidate if candidate.startswith(("https://", "http://")) else config.base_url()
    return base + path


def attribution_manifest() -> list[dict]:
    entries = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for entry in entries:
        original = config.PROJECT_DIR / entry["asset"]
        served = config.PROJECT_DIR / "static" / "assets" / "models" / entry["asset"]
        entry["url"] = assets.asset_url(f"assets/models/{entry['asset']}")
        entry["asset_present"] = original.is_file() and served.is_file()
    return entries


def legal_values() -> tuple[dict[str, str], list[str]]:
    with db.connect() as con:
        rows = con.execute("SELECT key,value,required FROM legal_settings ORDER BY key").fetchall()
    values = {row["key"]: row["value"] for row in rows}
    missing = [row["key"] for row in rows if row["required"] and not row["value"].strip()]
    return values, missing


def _layout(title: str, body: str, canonical: str, missing: list[str] | None = None) -> str:
    warning = ""
    if missing:
        warning = '<aside role="status"><strong>Draft:</strong> the owner must complete the legal settings before launch.</aside>'
    robots = "noindex,nofollow" if missing else "index,follow"
    site_title = str(_site_settings().get("site_title") or "Choose Your Path").strip()
    page_title = f"{title} — {site_title}"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="{robots}">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<title>{html.escape(page_title)}</title><link rel="canonical" href="{html.escape(canonical, quote=True)}">
<meta name="description" content="{html.escape(title, quote=True)} for {html.escape(site_title, quote=True)}">
<meta property="og:title" content="{html.escape(page_title, quote=True)}"><meta property="og:type" content="website">
<meta property="og:url" content="{html.escape(canonical, quote=True)}"><meta property="og:site_name" content="{html.escape(site_title, quote=True)}">
<link rel="stylesheet" href="/static/vendor/fonts/fonts.css"><link rel="stylesheet" href="/static/css/legal.css">
</head><body><div class="legal-mode" role="group" aria-label="Portfolio mode"><button data-set-shell="directory">Device</button><button data-set-shell="world">Cloud</button></div><div class="legal-shell"><header class="legal-titlebar"><strong>Legal — Read only</strong><a href="/" aria-label="Close legal document">×</a></header><nav aria-label="Legal"><a href="/">Portfolio</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/terms">Terms</a><a href="/credits">Credits</a></nav>
<main><p class="legal-kicker">READ ONLY DOCUMENT</p><h1>{html.escape(title)}</h1>{warning}{body}</main></div><script src="/static/js/surface-mode.js"></script></body></html>"""


def privacy_html() -> str:
    values, missing = legal_values()
    labels = (
        ("controller_name", "Controller"), ("controller_contact", "Contact"),
        ("purposes", "Purposes and data collected"), ("lawful_bases", "Lawful bases"),
        ("hosting_and_processors", "Hosting and processors"),
        ("international_transfers", "International transfers"), ("retention", "Retention"),
        ("data_rights", "Your rights"), ("consent_withdrawal", "Withdraw consent"),
        ("supervisory_authority", "Complaints"),
    )
    updated = values.get("last_updated", "")
    body = "<p>This notice explains how information submitted to this portfolio is handled.</p>"
    if updated:
        body += f"<p><strong>Last updated:</strong> {html.escape(updated)}</p>"
    body += "<dl>"
    for key, label in labels:
        value = values.get(key, "")
        body += f"<dt>{html.escape(label)}</dt><dd>{html.escape(value) if value else 'Not configured.'}</dd>"
    body += "</dl>"
    return _layout("Privacy policy", body, _canonical("/privacy"), missing)


def cookies_html() -> str:
    values, missing = legal_values()
    configured = values.get("cookie_details", "")
    body = """<p>Necessary owner-session, CSRF and anonymous interaction cookies support administration,
likes and reactions. They are first-party and are not used for advertising.</p>
<h2>Optional analytics</h2><p>First-party aggregate analytics remain disabled until you choose Accept.
Rejecting analytics does not disable the portfolio, messages, comments or accessibility features.
They count broad referral source and coarse device class, browser family, language, and time-zone world region.
They do not infer age, gender, ethnicity, or precise location, and dimensions are never combined into visitor profiles.
You can reopen privacy choices from the site footer.</p>
<h2>Retention</h2><p>The analytics session is short-lived. Raw consented events are aggregated and removed after 90 days.</p>"""
    if configured:
        body += "<h2>Cookie details</h2><p>" + html.escape(configured).replace("\n", "<br>") + "</p>"
    if values.get("last_updated"):
        body += "<p><strong>Last updated:</strong> " + html.escape(values["last_updated"]) + "</p>"
    return _layout("Cookie policy", body, _canonical("/cookies"), missing)


def terms_html() -> str:
    values, missing = legal_values()
    configured = values.get("terms", "")
    body = """<p>The portfolio content is provided for general information. External links lead to services
operated by others. Do not use message or comment forms for unlawful, abusive or confidential material.</p>
<p>User submissions may be moderated or removed. A private message is never placed on the public wall
unless its sender separately consented and the owner approved publication.</p>"""
    if configured:
        body += "<h2>Owner terms</h2><p>" + html.escape(configured).replace("\n", "<br>") + "</p>"
    if values.get("last_updated"):
        body += "<p><strong>Last updated:</strong> " + html.escape(values["last_updated"]) + "</p>"
    return _layout("Terms of use", body, _canonical("/terms"), missing)


def credits_html() -> str:
    items = []
    for entry in attribution_manifest():
        items.append(
            "<li><strong>" + html.escape(entry["title"]) + "</strong> by "
            f'<a href="{html.escape(entry["creator_url"], quote=True)}">{html.escape(entry["creator"])}</a>. '
            f'<a href="{html.escape(entry["source"], quote=True)}">Source</a>; '
            f'<a href="{html.escape(entry["license_url"], quote=True)}">{html.escape(entry["license"])}</a>. '
            + html.escape(entry["notice"]) + "</li>"
        )
    body = "<p>Creative Commons model attribution:</p><ul>" + "".join(items) + "</ul>"
    return _layout("Credits", body, _canonical("/credits"))


def combined_html() -> str:
    _, missing = legal_values()
    body = """<p>These documents are also available separately.</p><ul>
<li id="privacy"><a href="/privacy">Privacy policy</a></li><li id="cookies"><a href="/cookies">Cookie policy</a></li>
<li id="terms"><a href="/terms">Terms of use</a></li><li id="attribution"><a href="/credits">Creative Commons credits</a></li></ul>"""
    return _layout("Legal and credits", body, _canonical("/legal"), missing)
