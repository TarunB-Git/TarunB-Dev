# Four-path portfolio

An interactive portfolio with four routes: birds → Recruiter, scroll → Library,
ship → About, and the unlocked moon → Friends. FastAPI serves a no-build
JavaScript/Three.js frontend and a single-owner SQLite content platform.

## Local setup

Use Python 3.13 (3.11 or newer is required) and Node 20 or newer:

```sh
python -m pip install -r server/requirements-dev.txt
npm install
./run.sh
```

Open `http://localhost:8000`. The unlinked owner panel is at `/admin`; a fresh
local database presents a one-time screen to create owner access. Any non-empty
passphrase is accepted and stored only as an Argon2id hash. `ADMIN_PASSPHRASE`
remains available as a non-interactive production bootstrap.
Mutable local data defaults to `server/`; set `PORTFOLIO_DATA_DIR` to keep it
elsewhere. Production uses the persistent `/data` volume described in
[DEPLOYMENT.md](DEPLOYMENT.md).

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
the generated résumé. Uploaded versions remain in the persistent uploads
directory; include that directory along with the database in backups.

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
