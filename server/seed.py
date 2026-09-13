"""Clearly labelled preview content for a new portfolio installation."""
import json

from . import db

CARD = {
    "name": "Tarun Boddeda",
    "role": "SENIOR PRODUCT ENGINEER",
    "status": "Open to opportunities",
    "updated": "Updated May 2026",
    "chips": ["Full-time", "Consulting", "Open Source"],
    "email": "alex@example.com",
    "phone": "+15550001234",
    "phone_display": "+1 (555) 000-1234",
    "url": "https://alex.me",
    "cal_link": "https://cal.com",
    "tagline": "Building things\nthat actually matter.",
    "logos": ["STRIPE", "VERCEL", "LINEAR"],
    "recs": [
        {"q": "Alex has a rare ability to ship fast without cutting corners. One of the most reliable engineers I've worked with.", "a": "Sarah Chen, CTO @ Acme Corp"},
        {"q": "Genuinely one of the best technical minds I've hired. Ships features that feel inevitable in hindsight.", "a": "James Park, VP Eng @ Vercel"},
        {"q": "Alex turned a week-long fire into a solved architecture problem. Stays calm, thinks clearly, delivers.", "a": "Mia Torres, Head of Platform @ Stripe"},
    ],
    "selected_work": [
        {"num": "01", "title": "OpenCache", "sub": "Distributed cache layer · MIT Open Source", "stat": "★ 12,000 GitHub stars", "year": "2023"},
        {"num": "02", "title": "DevBridge", "sub": "Figma → Code automation plugin", "stat": "↓ 45,000 installs", "year": "2022"},
        {"num": "03", "title": "\"Why Your API Is Lying to You\"", "sub": "Essay · Hacker News #1", "stat": "◎ 280,000 reads", "year": "2021"},
    ],
    "career": [
        {"year": "2022 — PRESENT", "role": "Staff Engineer", "co": "Stripe", "desc": "Platform infrastructure · 3M+ merchants"},
        {"year": "2019 — 2022", "role": "Senior Engineer", "co": "Vercel", "desc": "Next.js edge runtime · shipped ISR"},
        {"year": "2017 — 2019", "role": "Software Engineer", "co": "Linear", "desc": "Real-time collaboration layer"},
        {"year": "2013 — 2017", "role": "B.S. Computer Science", "co": "UC Berkeley", "desc": ""},
    ],
    "footer": "alex.me · made with care",
}

RESUME = {
    "stub": "SENIOR PRODUCT ENGINEER · alex@example.com · +1 (555) 000-1234 · alex.me",
    "experience": [
        {"role": "Staff Engineer", "co": "Stripe", "dates": "2022 — Present",
         "desc": "Led platform infrastructure serving 3M+ merchants. Reduced API latency 40% through distributed caching redesign. Mentored engineers across three teams."},
        {"role": "Senior Engineer", "co": "Vercel", "dates": "2019 — 2022",
         "desc": "Core contributor to Next.js edge runtime. Shipped Incremental Static Regeneration — now used by 800k+ sites worldwide."},
        {"role": "Software Engineer", "co": "Linear", "dates": "2017 — 2019",
         "desc": "Built real-time collaboration layer and keyboard shortcut system. Led REST → GraphQL migration."},
    ],
    "education": [
        {"role": "B.S. Computer Science", "co": "UC Berkeley", "dates": "2013 — 2017", "desc": ""},
    ],
    "notable": [
        {"title": "OpenCache", "desc": "distributed cache library, 12k GitHub stars"},
        {"title": "DevBridge", "desc": "Figma plugin for design-to-code, 45k installs"},
        {"title": "\"Why Your API Is Lying to You\"", "desc": "280k reads, #1 Hacker News"},
    ],
}

FRIEND_LINKS = [
    {"icon": "🐙", "label": "GitHub", "href": "#"},
    {"icon": "🎮", "label": "Steam", "href": "#"},
    {"icon": "🎵", "label": "Spotify", "href": "#"},
    {"icon": "📸", "label": "Instagram", "href": "#"},
    {"icon": "💬", "label": "Discord", "href": "#"},
    {"icon": "📚", "label": "Letterboxd", "href": "#"},
]

# CC-BY-4.0 attributions read from the GLB asset.extras metadata.
ATTRIBUTION = [
    {"title": "Ship in Clouds", "author": "Bastien Genbrugge",
     "author_url": "https://sketchfab.com/bastienBGR",
     "source": "https://sketchfab.com/3d-models/ship-in-clouds-c475323dc7f24e26ba2009c08c8e1941",
     "license": "CC-BY-4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    {"title": "Old / Ancient Scroll", "author": "Kigha",
     "author_url": "https://sketchfab.com/Kigha",
     "source": "https://sketchfab.com/3d-models/old-ancient-scroll-73e9333251c7490786f99e67beb41d6e",
     "license": "CC-BY-4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    {"title": "Moon", "author": "Akshat (shooter24994)",
     "author_url": "https://sketchfab.com/shooter24994",
     "source": "https://sketchfab.com/3d-models/moon-4db2273f6dd943b8ad7fa5e3b1b2431a",
     "license": "CC-BY-4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    {"title": "Bird", "author": "Blender Artist (moizmuhammad373)",
     "author_url": "https://sketchfab.com/moizmuhammad373",
     "source": "https://sketchfab.com/3d-models/bird-e93a906eb38343c4a14458a637136329",
     "license": "CC-BY-4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
]

TIMELINES = {
    "recruiter": [
        ("2013 — 2017", "B.S. Computer Science", "UC Berkeley", "Systems focus; graphics electives that started the WebGL obsession.", []),
        ("2017 — 2019", "Software Engineer", "Linear", "Built real-time collaboration layer and keyboard shortcut system. Led REST → GraphQL migration.", [{"label": "Company", "href": "https://linear.app"}]),
        ("2019 — 2022", "Senior Engineer", "Vercel", "Core contributor to Next.js edge runtime. Shipped Incremental Static Regeneration — now used by 800k+ sites.", [{"label": "Company", "href": "https://vercel.com"}]),
        ("2021", "\"Why Your API Is Lying to You\"", "Essay · #1 Hacker News", "280,000 reads. An argument about honest interface design.", []),
        ("2022", "DevBridge", "Figma → Code plugin", "45,000 installs. Automates the design-handoff busywork.", [{"label": "Project", "href": "#"}]),
        ("2022 — Present", "Staff Engineer", "Stripe", "Platform infrastructure serving 3M+ merchants. 40% API latency reduction via distributed caching redesign.", [{"label": "Company", "href": "https://stripe.com"}]),
        ("2023", "OpenCache", "Open source · MIT", "Distributed cache layer, 12,000 GitHub stars.", [{"label": "GitHub", "href": "#"}]),
    ],
    "viewer": [
        ("The Beginning", "The First Machine", "where it started", "A hand-me-down computer, a broken game, and the discovery that the rules of a world are written by someone — and could be rewritten.", []),
        ("The Craft", "Falling for the Web", "code that runs everywhere", "The browser as the most democratic runtime ever shipped. JavaScript, TypeScript, React, Three.js — tools for building places, not pages.", []),
        ("The Turn", "From Pages to Experiences", "what changed", "The moment a UI became invisible because it felt natural. Interfaces should disappear; the thought should remain.", []),
        ("Now", "The Architect", "present day", "Building software at the intersection of craft and experience. Long enough at it to know the work; still curious enough to be surprised.", []),
    ],
    "friend": [
        ("The Early Years", "[First crew]", "[hometown]", "[Who they were, what you played, what you still remember. The inside jokes that survived.]", []),
        ("School Days", "[The lunch table]", "[school]", "[Interests you shared, the projects and schemes, what each of them is doing now.]", []),
        ("University", "[The late-night lab]", "[university]", "[The all-nighters, the terrible cafeteria, the people who made it survivable. Messages from each.]", []),
        ("Now", "[The group chat]", "scattered across timezones", "[Where everyone ended up. The annual meetup that happens every two years.]", []),
    ],
    "personal": [
        ("[Year]", "[First fun project]", "fun project", "[The thing you built for no reason except that it was cool.]", []),
        ("[Year]", "[A book that rewired you]", "books", "[What it was, what it changed.]", []),
        ("[Year]", "[A milestone]", "milestone", "[First job, first ship, first user who wasn't your mom.]", []),
        ("Now", "This website", "fun project", "A 3D world with four doors, a moon you can break, and bamboo slips that insult your judgment.", []),
    ],
}

POSTS = [
    {"slug": "hello-world", "title": "A Place, Not a Page — Sample Post",
     "tags": ["personal", "viewer"],
     "body_md": "*Sample content — replace this from the owner console.*\n\nI wanted this portfolio to feel less like a catalogue and more like a place: somewhere you can wander, notice details, and decide how much to uncover.\n\nThe Cloud and Device views tell the same story at different speeds."},
    {"slug": "breaking-the-moon", "title": "Why the Moon Falls — Sample Post",
     "tags": ["personal", "friend"],
     "body_md": "*Sample content — replace this from the owner console.*\n\nThe moon stays out of reach until the other landmarks have been found. Then it descends and opens a quieter record of people, collaborations, and shared work.\n\nIt is a small reward for curiosity rather than another menu item."},
    {"slug": "recruiter-mode", "title": "Designing for Two Speeds — Sample Post",
     "tags": ["personal", "recruiter"],
     "body_md": "*Sample content — replace this from the owner console.*\n\nSome visitors want to explore. Others need experience, projects, and contact details in under a minute. Good interface design respects both.\n\nThat is why the portfolio has a playful Cloud view and a direct Device view."},
]

SAMPLE_MESSAGES = [
    ("recruiter", "Sample visitor", "The work reads clearly, and the short project notes make it easy to ask a useful follow-up question."),
    ("viewer", "Sample reader", "The turning-point entry stayed with me. I would enjoy reading the longer version as a post."),
    ("personal", "Sample bookworm", "Adding the books beside the small experiments makes this feel like a real working notebook."),
    ("friend", "Sample collaborator", "A warm record of shared work, late calls, and the people behind the finished projects."),
]

SAMPLE_COMMENTS = [
    ("hello-world", "Sample reader", "The two-speed idea works: I can browse quickly, then return to explore."),
    ("breaking-the-moon", "Sample friend", "The delayed moon makes the final path feel earned."),
    ("recruiter-mode", "Sample reviewer", "A concise view first, with details available when wanted, is the right balance."),
]


def seed_if_empty() -> None:
    """Install idempotent sample posts and walls once; owner content is never replaced."""
    if db.get_content_record("friend_links", include_draft=True) is None:
        db.set_content("friend_links", [], published=False, note="first-run scaffold")
    if db.get_setting("sample_content_seeded_v1"):
        return
    now = db.utcnow()
    with db.connect() as con:
        for post in POSTS:
            con.execute(
                """INSERT INTO blog_posts(slug,title,body_md,excerpt,tags_json,published,created_at,updated_at)
                   VALUES(?,?,?,?,?,1,?,?)
                   ON CONFLICT(slug) DO UPDATE SET title=excluded.title,body_md=excluded.body_md,
                   excerpt=excluded.excerpt,tags_json=excluded.tags_json,published=1,updated_at=excluded.updated_at""",
                (
                    post["slug"], post["title"], post["body_md"],
                    post["body_md"].split("\n\n")[-1][:180], json.dumps(post["tags"]), now, now,
                ),
            )
        for slug, author, body in SAMPLE_COMMENTS:
            post = con.execute("SELECT id FROM blog_posts WHERE slug=?", (slug,)).fetchone()
            if post and not con.execute(
                "SELECT 1 FROM comments WHERE post_id=? AND author_name=? AND body=?", (post["id"], author, body),
            ).fetchone():
                con.execute(
                    """INSERT INTO comments(post_id,author_name,body,hidden,depth,moderation_status,updated_at)
                       VALUES(?,?,?,0,0,'visible',?)""", (post["id"], author, body, now),
                )
        for path, author, body in SAMPLE_MESSAGES:
            if con.execute("SELECT 1 FROM messages WHERE path=? AND author_name=? AND body=?", (path, author, body)).fetchone():
                continue
            con.execute(
                """INSERT INTO messages(path,author_name,contact,body,approved,status,publication_consent,
                   consent_version,consented_at,public_display_name,published_at,updated_at)
                   VALUES(?,?, '',?,1,'approved',1,'sample-v1',?,?,?,?)""",
                (path, author, body, now, author, now, now),
            )
        con.execute(
            "INSERT INTO settings(key,value) VALUES('sample_content_seeded_v1','1') "
            "ON CONFLICT(key) DO UPDATE SET value='1'"
        )
