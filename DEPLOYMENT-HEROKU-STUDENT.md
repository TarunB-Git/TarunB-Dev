# Deploying this portfolio to Heroku with GitHub Student credit

This guide deploys the complete FastAPI site with durable content, owner access, blogs, comments, analytics, résumé uploads, and media uploads. It uses only Heroku products covered by the student credit: one Eco web dyno and one Essential-0 Postgres database.

Nothing in this guide requires Vercel or a paid third-party add-on.

## Cost and limits

As checked on 2026-09-22:

| Resource | Monthly price | Purpose |
| --- | ---: | --- |
| Eco dyno plan | US$5 | Runs the FastAPI website; sleeps after 30 minutes without traffic |
| Postgres Essential-0 | US$5 | 1 GB durable database for content and uploaded files |
| Total | **US$10** | Fits within the advertised US$13/month student credit |

The [GitHub Student Developer Pack](https://education.github.com/pack) advertises US$13/month of Heroku credit for 24 months. [Heroku's current pricing](https://www.heroku.com/pricing/) lists Eco at US$5 and Essential-0 at US$5. Confirm both prices and that the credit appears in your Heroku Billing page before provisioning anything.

Uploaded files are stored in Postgres so they survive dyno replacement and are included in database backups. Individual files remain limited to 8 MB. All stored file bytes are capped at 256 MB by default, leaving most of the 1 GB database for records and normal growth. If the site later needs a large video library, move blobs to object storage instead of raising that ceiling casually.

## What has already been prepared in the repository

- `Procfile` starts Uvicorn on Heroku's assigned `PORT` and trusts Heroku's proxy headers.
- Root `requirements.txt` and `.python-version` allow the Heroku Python buildpack to detect the app.
- `DATABASE_URL` automatically selects PostgreSQL; local development still uses SQLite.
- Heroku startup refuses to use disposable SQLite if `DATABASE_URL` or security settings are missing.
- `/readyz` checks the database connection and schema version.
- Existing `/media/...` and `/resume.pdf` URLs continue to work, but their uploaded bytes now come from the database.
- `python -m server.migrate_to_postgres` imports the existing SQLite database and upload directory without modifying either source.

The technical audit is in [HEROKU-AUDIT.md](HEROKU-AUDIT.md).

## Part 1 — Redeem and confirm the student credit

1. Sign in to the [GitHub Student Developer Pack](https://education.github.com/pack).
2. Find Heroku and redeem the offer into your personal Heroku account.
3. Complete Heroku's account and payment verification if requested.
4. Open **Heroku Dashboard → Account settings → Billing**.
5. Confirm that the student credit is active and note its expiry date.
6. Set a calendar reminder one month before expiry. Unused monthly credit does not accumulate.

Do not create review apps or extra databases for this portfolio. They also consume paid resources.

## Part 2 — Prepare and protect the current local data

Run these commands from the repository root:

```bash
python -m pip install -r server/requirements-dev.txt
python -m server.ops migrate
python -m server.ops backup portfolio-before-heroku.db
python -m pytest -q
```

Keep `portfolio-before-heroku.db` somewhere outside the repository as well. Do not delete `server/site.db`, `server/uploads`, or the backup after migration.

The migration command upgrades the local schema and copies legacy upload bytes into SQLite without deleting the original files.

## Part 3 — Install and sign in to the Heroku CLI

Install the CLI using [Heroku's official instructions](https://devcenter.heroku.com/articles/heroku-cli), then run:

```bash
heroku login
```

The command opens a browser. Finish the login there and return to the terminal.

## Part 4 — Create the Heroku app and database

Choose a unique lower-case app name. Replace `YOUR-APP-NAME` in every command below.

```bash
heroku create YOUR-APP-NAME
heroku addons:create heroku-postgresql:essential-0 --app YOUR-APP-NAME
```

Wait until this reports the database as available:

```bash
heroku pg:wait --app YOUR-APP-NAME
heroku pg:info --app YOUR-APP-NAME
```

Heroku creates `DATABASE_URL` automatically. Do not copy it into Git or set a different value in the Heroku dashboard.

## Part 5 — Set the required secrets and public URL

Generate two separate secrets locally:

```bash
python -c "import secrets; print(secrets.token_urlsafe(36))"
python -c "import secrets; print(secrets.token_urlsafe(36))"
```

Use one as the initial admin passphrase and the other as the recovery token. Save both in a password manager.

Set the configuration, substituting your two generated values:

```bash
heroku config:set --app YOUR-APP-NAME \
  ADMIN_PASSPHRASE='FIRST-GENERATED-SECRET' \
  ADMIN_RECOVERY_TOKEN='SECOND-GENERATED-SECRET' \
  PORTFOLIO_BASE_URL='https://YOUR-APP-NAME.herokuapp.com' \
  PORTFOLIO_ALLOWED_ORIGINS='https://YOUR-APP-NAME.herokuapp.com' \
  PORTFOLIO_SECURE_COOKIES='true' \
  PORTFOLIO_TRUST_PROXY_HEADERS='true'
```

Do not put these values in `.env.example`, commit them, paste them into an issue, or send them in chat.

## Part 6 — Import the current SQLite data before the first web deployment

This step preserves the current owner password hash, published content, blogs, comments, messages, analytics, legal settings, résumé, and uploaded media.

Temporarily expose the Heroku database URL only to the migration process:

```bash
export DATABASE_URL="$(heroku config:get DATABASE_URL --app YOUR-APP-NAME)"
python -m server.migrate_to_postgres --sqlite server/site.db --uploads server/uploads
unset DATABASE_URL
```

The command must finish with a JSON result whose `status` is `imported`. It prints row counts and the number of legacy files copied. Running the exact same import again returns `already_imported`; it does not duplicate rows.

The source SQLite database is opened read-only. The importer refuses a non-empty, previously unrelated destination instead of merging ambiguous data. If that happens, stop and inspect the database—do not reset it casually.

On PowerShell, use:

```powershell
$env:DATABASE_URL = heroku config:get DATABASE_URL --app YOUR-APP-NAME
python -m server.migrate_to_postgres --sqlite server/site.db --uploads server/uploads
Remove-Item Env:DATABASE_URL
```

## Part 7 — Deploy from GitHub

First push this prepared repository to your private or public GitHub repository. Make sure `git status` does not show secrets, `server/site.db`, `server/uploads`, or backup files as staged.

In the Heroku dashboard:

1. Open `YOUR-APP-NAME`.
2. Open **Deploy**.
3. Choose **GitHub** as the deployment method.
4. Connect your GitHub account if prompted.
5. Search for and connect this repository.
6. Select the branch containing these deployment changes.
7. Leave automatic deploys off for the first launch.
8. Click **Deploy Branch**.
9. Wait for the build and release to finish successfully.

Then select the Eco dyno type in **Resources**, or use:

```bash
heroku ps:type eco --app YOUR-APP-NAME
heroku ps:scale web=1 --app YOUR-APP-NAME
```

There must be exactly one `web` dyno and no always-on worker or maintenance dyno.

## Part 8 — Verify the complete deployment

Check health first:

```bash
curl https://YOUR-APP-NAME.herokuapp.com/readyz
```

Expected result:

```json
{"status":"ready","schema_version":9}
```

Then open the site:

```bash
heroku open --app YOUR-APP-NAME
```

Complete this checklist:

- Home and Cloud world load.
- Device mode opens and its windows work.
- `/blogs` and at least one `/blog/<slug>` page load.
- `/admin` accepts the existing imported passphrase, or the configured bootstrap passphrase on a genuinely empty database.
- The **forgot passphrase?** recovery flow accepts `ADMIN_RECOVERY_TOKEN` and does not change content.
- `/resume.pdf` downloads correctly.
- Existing Pictures media loads through `/media/...`.
- Upload one small test image from Admin and confirm it appears in Pictures.
- Add or edit one harmless draft item.

Now restart the dyno:

```bash
heroku restart --app YOUR-APP-NAME
```

Repeat the login, draft, résumé, and test-image checks. The data must still be present. If `/readyz` is not ready, inspect logs before doing anything destructive:

```bash
heroku logs --tail --app YOUR-APP-NAME
```

## Part 9 — Configure real database backups

Heroku's dyno filesystem is ephemeral, so the Admin backup button cannot safely create a local Postgres file. It now tells the owner to use Heroku PGBackups.

Capture a first logical backup:

```bash
heroku pg:backups:capture --app YOUR-APP-NAME
heroku pg:backups --app YOUR-APP-NAME
```

Schedule a daily backup (choose a suitable timezone/time):

```bash
heroku pg:backups:schedule DATABASE_URL --at "03:00 Europe/Stockholm" --app YOUR-APP-NAME
heroku pg:backups:schedules --app YOUR-APP-NAME
```

Essential plans currently retain seven daily backups and one weekly backup. Periodically download a portable copy outside Heroku:

```bash
heroku pg:backups:download --app YOUR-APP-NAME
```

Because uploads are stored in Postgres, these backups include both metadata and file bytes.

## Part 10 — Add a custom domain later

Get the DNS target from Heroku:

```bash
heroku domains:add www.example.com --app YOUR-APP-NAME
heroku domains --app YOUR-APP-NAME
```

Create the requested CNAME record at your DNS provider. When HTTPS is active, update both URL settings:

```bash
heroku config:set --app YOUR-APP-NAME \
  PORTFOLIO_BASE_URL='https://www.example.com' \
  PORTFOLIO_ALLOWED_ORIGINS='https://www.example.com'
```

If both the Heroku address and custom domain must submit admin requests temporarily, separate the origins with a comma. Remove the temporary origin after cutover.

## Updating the site later

Before a production update, capture a database backup:

```bash
heroku pg:backups:capture --app YOUR-APP-NAME
```

Then:

1. Make and test changes locally with SQLite.
2. Check `git status`. The local `server/site.db`, `server/uploads/`, `.env`, and backups are ignored and must not be forced into Git.
3. Stage only the source and documentation files you intended to change, commit them, and push the deployment branch to GitHub.
4. If Heroku automatic deploys are enabled, wait for that commit to finish. Otherwise open **Heroku → Deploy → Manual deploy**, choose the same branch, and click **Deploy Branch**.
5. Check `/readyz` and `heroku logs --tail --app YOUR-APP-NAME`.
6. Confirm admin content and one existing uploaded file are still present.

Do **not** run `server.migrate_to_postgres` again for normal code updates. That command is a one-time import for a fresh database and deliberately refuses to overwrite a populated destination.

Code deployments replace the application slug, not the attached Postgres database. The local SQLite file cannot overwrite Heroku merely because source code was pushed: it is ignored by Git, and production connects through Heroku's `DATABASE_URL`. Data is endangered only if you delete/replace the Postgres add-on, change `DATABASE_URL` to a different database, explicitly restore/import over it, or write a destructive migration.

On startup, schema creation is idempotent. The tracked `CARD` and `RESUME` defaults are synchronized field by field: values changed in Admin remain owner-controlled, while fields still equal to the previous code default may follow a new code edit. Editing `ADMIN_PASSPHRASE` after owner access already exists does not replace the saved password hash. Use the recovery flow when you intentionally need to change a forgotten passphrase.

## Cost guardrails

- Keep one Eco web dyno.
- Keep one Essential-0 database.
- Do not provision Redis, object-storage add-ons, review apps, or staging databases unless you accept their separate cost.
- Check **Account → Billing → Current Usage** monthly.
- Keep database blobs under the 256 MB application ceiling.
- Remove test resources immediately.
- Remember that the student credit ends; export a current PGBackup before cancelling the database.

## Common failures

### “Heroku persistence/security configuration is incomplete”

One of the required config vars is missing. Run `heroku config --app YOUR-APP-NAME` and compare the variable names in Part 5. Do not paste their values into support messages.

### `/readyz` returns 503

Inspect `heroku logs --tail`. The usual causes are a missing/unavailable `DATABASE_URL` or an incomplete schema. Do not point the app back at SQLite.

### Import says the destination already contains data

The safety check found records it cannot safely merge. If this is a brand-new disposable database, create a fresh Essential-0 database and repeat the import. If it is not disposable, capture a backup and inspect it before deciding how to reconcile it.

### Upload returns 507

The aggregate database-asset ceiling was reached. Delete unused media or move file blobs to object storage. Do not raise the ceiling beyond what comfortably fits the Essential-0 plan.

### The first request is slow

Eco dynos sleep after 30 minutes without traffic. A cold first request is expected. Use a Basic dyno only if always-on behavior is worth the additional cost.
