# Zero-paid-plan deployment plan

## Recommendation

Run the existing Docker Compose deployment on one **Oracle Cloud Always Free** Ubuntu VM.

This is the least disruptive free route for this particular site. The application is not a static site: it has an admin login and passphrase recovery, a SQLite database, user uploads, comments, messages, analytics, and scheduled backups. A normal free static host such as GitHub Pages or Vercel's static tier cannot preserve all of that state.

Oracle documents an Always Free Ampere A1 allowance equivalent to 2 OCPUs and 12 GB of RAM, plus 200 GB of combined boot/block storage and five volume backups. Always Free compute must be created in the account's home region and capacity may temporarily be unavailable. Always select resources marked **Always Free eligible**. See [Oracle's current Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

### Expected result

- One small public VM runs the existing `portfolio`, `maintenance`, and `caddy` containers.
- SQLite, uploaded files, and application backups remain on persistent Docker volumes on the VM disk.
- Caddy handles HTTPS automatically when a domain or free DNS hostname points to the VM.
- Hosting cost remains zero while every selected Oracle resource stays inside the Always Free allowance.

### Important trade-offs

- This is a self-managed server. You are responsible for updates, security, monitoring, and recovery.
- Oracle may reclaim an Always Free VM that it considers idle. Its documentation currently defines an idle seven-day period using low CPU, network, and, for A1, memory utilization. Do not try to manufacture traffic; keep recoverable backups and be ready to recreate the VM.
- Oracle may ask for identity/payment verification during signup even though the chosen resources are free.
- A free hostname can be used if you do not own a domain, but the address will be less professional.

## Phase 1 — Prepare the accounts and secrets

1. Create an Oracle Cloud account and choose the home region closest to most visitors. The home region cannot be casually changed later.
2. In **Governance & Administration → Limits, Quotas and Usage**, confirm the Always Free allowance before creating anything.
3. Create or choose a GitHub repository for this project. Keep it private if it contains work that should not be public.
4. Prepare a domain name:
   - If you already own a domain, plan a hostname such as `portfolio.example.com`.
   - Otherwise, register a free DNS hostname with a reputable dynamic-DNS provider.
5. Generate two different secrets locally. Do not put either in Git:

   ```bash
   openssl rand -base64 36
   openssl rand -base64 48
   ```

   Use the first as `ADMIN_PASSPHRASE` and the second as `ADMIN_RECOVERY_TOKEN`. Store both in a password manager. The recovery token is the emergency way to reset a forgotten passphrase.

## Phase 2 — Create the free VM

1. In Oracle Cloud, create a compute instance named `portfolio`.
2. Select an Ubuntu LTS image that is marked **Always Free eligible**.
3. Select `VM.Standard.A1.Flex`, with **1 OCPU and 6 GB RAM**. This is enough for the site and stays below the documented allowance. If A1 capacity is unavailable, retry another availability domain later; do not silently select a paid shape.
4. Keep the boot volume at about 50 GB and make sure it is marked Always Free eligible.
5. Create and download an SSH key, or upload the public half of an existing key. Keep the private key safe.
6. Assign a public IPv4 address. Reserve it if Oracle offers an Always Free eligible reserved address; otherwise update DNS if the address changes.
7. In the subnet security list or network security group, allow:
   - TCP 22 only from your own IP address, where practical.
   - TCP 80 from anywhere.
   - TCP 443 from anywhere.
   - UDP 443 from anywhere for HTTP/3; this is optional.
8. Create a budget alert at a very low threshold, such as US$1. A budget is a warning, not a hard spending cap, so still verify every resource label.

## Phase 3 — Install the server software

1. Connect from your computer:

   ```bash
   ssh -i /path/to/private-key ubuntu@VM_PUBLIC_IP
   ```

2. Update Ubuntu:

   ```bash
   sudo apt update
   sudo apt upgrade -y
   ```

3. Install Docker Engine and its Compose plugin using Docker's official [Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/). Use the repository method, not a random third-party script.
4. Add the `ubuntu` user to Docker's group, then sign out and reconnect:

   ```bash
   sudo usermod -aG docker ubuntu
   exit
   ```

5. Reconnect and confirm both commands work:

   ```bash
   docker --version
   docker compose version
   ```

## Phase 4 — Put the site on the VM

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
   cd YOUR-REPOSITORY
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

3. Edit `.env` and set all of these values:

   ```dotenv
   ADMIN_PASSPHRASE=your-long-owner-passphrase
   ADMIN_RECOVERY_TOKEN=your-different-long-recovery-token
   PORTFOLIO_DOMAIN=portfolio.example.com
   PORTFOLIO_BASE_URL=https://portfolio.example.com
   PORTFOLIO_ALLOWED_ORIGINS=https://portfolio.example.com
   PORTFOLIO_TRUST_PROXY_HEADERS=true
   PORTFOLIO_SECURE_COOKIES=true
   ```

4. Never add `.env` to Git. Check with `git status` before every commit.
5. Start the site:

   ```bash
   docker compose up -d --build
   ```

6. Inspect the first startup:

   ```bash
   docker compose ps
   docker compose logs --tail=200 portfolio caddy maintenance
   ```

The current Compose setup stores live data in named volumes, so rebuilding the application container must not erase the database or uploads.

## Phase 5 — Connect the hostname and HTTPS

1. Copy the VM's public IP from Oracle Cloud.
2. At the DNS provider, create an `A` record for the chosen hostname pointing to that IP.
3. Wait for DNS to update. It may take minutes or, occasionally, several hours.
4. Leave ports 80 and 443 open. Caddy needs them to obtain and renew the HTTPS certificate.
5. Visit `https://YOUR_HOSTNAME/readyz`. It should return a healthy response over HTTPS.
6. Visit the main site and `/admin`. Sign in with the passphrase stored in the password manager.

Do not expose the application container's port 8000 publicly. Caddy should be the only public entry point.

## Phase 6 — Verify every stateful feature

Complete this checklist before announcing the deployment:

- [ ] Desktop and mobile home/directory views load normally.
- [ ] The cloud world and its local assets load without mixed-content errors.
- [ ] Admin login works in a private browser window.
- [ ] Passphrase reset works with the recovery token, and the new passphrase still works after `docker compose restart`.
- [ ] Creating and deleting a notice-board post works.
- [ ] Comments, messages, and analytics behave as expected.
- [ ] A PDF résumé upload survives a container restart.
- [ ] An image/media upload survives a container restart.
- [ ] `https://YOUR_HOSTNAME/readyz` stays healthy.
- [ ] No secret appears in the GitHub repository or browser source.

## Phase 7 — Backups and recovery

The maintenance container creates application backups, but a backup on the same VM is not sufficient by itself.

1. Confirm the maintenance container is running and inspect its logs weekly.
2. Once a week, make an Oracle boot-volume backup. Retain no more than the five backups included in the documented Always Free allowance.
3. Once a month, download an application backup and the uploads directory to a computer or another free storage location.
4. Test restoration before relying on it. A useful backup is one that has been restored successfully.
5. Write down the VM shape, region, DNS records, and `.env` variable names. Store the actual secret values only in the password manager.

Recovery order after a VM loss:

1. Create another Always Free Ubuntu VM.
2. Install Docker and clone the repository.
3. Restore the data volume or the latest database and uploads backup.
4. Recreate `.env` from the password manager.
5. Start Compose and point DNS to the new IP.

## Phase 8 — Routine updates

For a normal release:

```bash
cd YOUR-REPOSITORY
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 portfolio
```

Then repeat the health, login, reset, upload, and notice-board smoke tests. If a release is bad, deploy the previous known-good Git commit; do not delete the data volumes.

Also schedule:

- Weekly Ubuntu security updates and a reboot when required.
- Weekly review of application/Caddy logs and remaining disk space.
- Monthly check of Oracle **Cost Analysis** and Always Free usage.
- Quarterly restore test.

## Zero-cost guardrails

- Create resources only in the Oracle home region when the free allowance requires it.
- Select only items explicitly labelled **Always Free eligible**.
- Use one A1 VM at 1 OCPU/6 GB and its normal boot volume.
- Do not add a paid load balancer; Caddy already terminates HTTPS on the VM.
- Do not enable extra paid observability, database, or marketplace products.
- Treat the budget notification as an alarm, not a spending cap.
- Check Oracle's limits again on deployment day because cloud offers can change.

## Contingency if Oracle has no free capacity

Do not put the current SQLite/upload build on a serverless static host and assume it is safe. If Oracle cannot allocate an Always Free VM, the no-paid-plan fallback is a separate migration project to Cloudflare Python Workers, D1, and R2. Cloudflare currently documents [FastAPI support on Python Workers](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/), but the database, filesystem uploads, sessions, password hashing, backups, and maintenance jobs would all need redesigning for Workers limits. That is a port, not a simple deployment, so it should be estimated and tested separately.

## Definition of done

This plan is complete when the public HTTPS site passes every stateful verification item, a recovery-token password reset survives a restart, an off-VM backup has been restored in a test, and Oracle Cost Analysis shows no billable resources.
