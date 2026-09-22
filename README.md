# Four-path portfolio

An interactive portfolio with four routes: birds → Recruiter, scroll → Library,
ship → About, and the unlocked moon → Friends. FastAPI serves a no-build
JavaScript/Three.js frontend and a single-owner content platform. Local work
uses SQLite; production can use managed PostgreSQL through `DATABASE_URL`.

## Local setup

Use Python 3.13 (3.11 or newer is required) and Node 20 or newer:

```sh
python -m pip install -r server/requirements-dev.txt
npm install
./run.sh
```

Open `http://localhost:8800`. The unlinked owner panel is at `/admin`; a fresh
local database presents a one-time screen to create owner access. Any non-empty
passphrase is accepted and stored only as an Argon2id hash. `ADMIN_PASSPHRASE`
remains available as a non-interactive production bootstrap. Set a separate
`ADMIN_RECOVERY_TOKEN` in production; the **forgot passphrase?** flow uses it to
replace a lost passphrase, revoke older sessions, and preserve all site content.
Mutable local data defaults to `server/`; set `PORTFOLIO_DATA_DIR` to keep it
elsewhere. For Heroku, use the managed Postgres deployment described in
[DEPLOYMENT-HEROKU-STUDENT.md](DEPLOYMENT-HEROKU-STUDENT.md). Heroku startup
fails instead of silently creating disposable SQLite data when `DATABASE_URL`
is missing.

`./run.sh` now uses one content flow for both code and Admin. The tracked card
and résumé defaults live in `server/seed.py`. After changing `CARD` or `RESUME`,
restart the server: fields that still match the previous code defaults update
in SQLite and appear in Admin, while fields already changed through Admin are
preserved. New Admin saves are immediately the published source of truth. The
small `SAMPLE_TIMELINE` constants in each path module remain visual fallbacks
only when a timeline cannot be loaded.
Changing the admin passphrase only changes owner authentication and revokes
sessions; it does not change card, résumé, timelines, posts, or uploads.
The card and Device calendar use the same booking destination: the published
Site `booking_url`, or the Card `cal_link` if the Site URL is absent. For a
local override, set `CODE_BOOKING_URL` in `static/js/booking.js`.

Render with a persistent `/data` disk remains supported by `render.yaml`.
Heroku uses one Eco dyno plus Essential-0 Postgres. Vercel alone is not suitable
for the stateful FastAPI application.

## First launch

Clearly labelled sample posts, comments, and wall notes are installed once so
the layouts can be evaluated, then edited or removed in the admin panel. Use
the admin setup flow to publish site identity, the card and structured resume, Selected Work/Career,
all four timelines, and the required legal/controller details. The authenticated
launch check also requires an explicit friend-story publication-permission
confirmation and must report `ready: true`; it verifies HTTPS configuration,
the generated PDF, and model attribution.

### Résumé downloads

In **Admin → Resume → Downloadable résumé PDF**, upload the full PDF (up to
8 MB by default; configure `PORTFOLIO_MAX_UPLOAD_BYTES`). The card download and
Device → Downloads both use `/resume.pdf`. This upload is independent of the
structured, abridged résumé editor. Until a PDF is uploaded, the download uses
the generated résumé. Uploaded versions are stored in the database alongside
their metadata, so they survive dyno replacement and are included in Postgres
backups. Choose
**Use editable résumé** to remove an uploaded PDF and regenerate the download
from the structured résumé fields.

### Writing and media

`/blogs` is the public writing archive. Posts are created and edited in
**Admin → Posts**, where publication time, Markdown, the required primary tag,
secondary tags, series, and the in-world scroll paths can all be changed.
Individual posts use `/blog/<slug>` and include reading progress, reading time,
related/recent posts, adjacent-post navigation, and comments.

Files uploaded through **Admin → Files & Media** are stored as size-limited
database blobs. They also appear in **Device → Home → Guest → Pictures** and
keep the established `/media/<name>` URLs. Legacy local upload files are copied
into SQLite on startup without deleting the originals.

## Verification

```sh
python -m pytest -q
npm run test:e2e
python -m server.ops verify-attribution
```

Playwright includes desktop/mobile, reduced-motion, keyboard, no-WebGL,
timeline visual-regression, admin, and accessibility coverage. Rebuild vendored
browser dependencies with `npm run vendor`; optimize source GLBs with
`npm run models:optimize` after checking their attribution metadata.
