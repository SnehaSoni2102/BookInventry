# Runbook

Everything here assumes the production layout from `05-DEPLOYMENT.md`: one Oracle Cloud Always-Free ARM VM, Docker Compose in `/opt/bookstall`, Caddy for HTTPS, nightly restic backups to Backblaze B2.
Commands run as the `deploy` user on the server. `DC="docker compose -f /opt/bookstall/docker-compose.prod.yml"`.

> Status: the files in `infra/` and `.github/workflows/` are written but **have not been run against a real server** (no OCI/domain/B2 accounts were available while building). Work through the go-live checklist in `05-DEPLOYMENT.md` §11 and fix anything that differs on the real machine.

## 1. First-time setup
Follow `05-DEPLOYMENT.md` §5 steps 1–7 (OCI, network, VM, hardening, Docker, DNS). Then:
1. `sudo mkdir -p /opt/bookstall/{public/app,public/well-known,secrets} && sudo chown -R deploy: /opt/bookstall`
2. Copy `infra/compose/docker-compose.prod.yml`, `infra/scripts/deploy.sh`, `.env.example` → `.env`, `.env.backup.example` → `.env.backup`. `chmod 600 .env .env.backup`. Fill every value (generate secrets with `openssl rand -base64 48`).
3. GitHub repo secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (a key whose `authorized_keys` line is restricted with `command="/opt/bookstall/deploy.sh ${SSH_ORIGINAL_COMMAND##* }"`; or simply a dedicated deploy key). Make the GHCR packages readable by the VM (`docker login ghcr.io` with a read-only PAT once).
4. Tag `v0.1.0` → the `deploy` workflow builds arm64 images and runs `deploy.sh`. First run: `cd /opt/bookstall && ./deploy.sh v0.1.0`.
5. Seed the first admin **once**: `$DC run --rm api node dist/db/seed.js` (uses `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` from `.env`). Log in, change the password, create named admin accounts, then blank `SEED_ADMIN_PASSWORD` in `.env`.
6. Backups: create a private B2 bucket and a bucket-scoped key, fill `.env.backup`, `$DC up -d backup`, run `$DC exec backup backup.sh manual`, then do the **restore drill** (§4).
7. Monitoring: UptimeRobot on `/api/v1/health/ready` (keyword `ok`), `/` and SSL expiry; Healthchecks.io check (daily, 1 h grace).
8. Android: build the APK (`eas build --profile production`), put it at `/opt/bookstall/public/app/bookstall.apk`; write `/opt/bookstall/public/well-known/assetlinks.json` with package `org.ngo.bookstall` (or your `ANDROID_PACKAGE`) and the **release** signing SHA-256 from `eas credentials`.

## 2. Deploy / roll back
- Deploy: push tag `vX.Y.Z` (production) or run the workflow manually (staging). `deploy.sh` backs up the DB, pulls, starts, waits for `/health/ready` for 90 s and **rolls back by itself** if unhealthy.
- Manual rollback: `echo vOLD > /opt/bookstall/.last_version; ./deploy.sh vOLD`. Migrations are not undone, so they must stay backward compatible (expand → migrate → contract).
- Logs: `$DC logs -f api worker`.

## 3. Everyday admin tasks
- **Add a user / reset a password:** in the app, Users page (admin). The temporary password is shown **once**. Emergency (no admin can log in): `$DC exec api node dist/db/seed.js` does not reset existing admins; instead create a new admin via SQL-free path: set `SEED_ADMIN_USERNAME=rescue`, `SEED_ADMIN_PASSWORD=<temp>` and run the seed (it creates the user if missing, forced password change on first login).
- **Rotate secrets:** change `JWT_ACCESS_SECRET` in `.env` → `$DC up -d api worker` (everyone must log in again; refresh tokens stay valid). DB password: change in Postgres (`ALTER USER`) and `PG_PASSWORD` together, restart. restic password: never change without `restic key` procedure; keep two copies.
- **Add disk space / check usage:** `df -h`, `docker system df`.

## 4. Backups and restore drill (monthly)
- Backups run 02:00 IST; Healthchecks.io alerts if one is missed. List: `$DC exec backup restic snapshots`.
- Drill: `$DC exec backup restore.sh latest restore_test /tmp/restore-storage` → compare the printed `copies`/`sales`/`last sale` with production (`$DC exec db psql -U bookstall -c "select count(*) from copies"`). Drop the test DB afterwards (`DROP DATABASE restore_test`). Record date and result in the table at the end of this file.

## 5. Disaster recovery (new server; target RTO 2 h)
1. Do §1 steps 1–2 on a new VM (same `.env`, `.env.backup` from the password manager), point DNS at the new IP.
2. `$DC up -d db`; restore: `$DC run --rm backup restore.sh latest bookstall /data/restore` (stop `api`/`worker` first if running; the script drops and recreates the target database). Copy `/data/restore/data/storage/*` into the `app_storage` volume.
3. `./deploy.sh <last good version>`; verify `/health/ready`, log in, spot-check a sale and a cover image.

## 6. Staging (optional)
A second compose project in `/opt/bookstall-staging` with its own `.env` (`DOMAIN=staging.<domain>`), services named `staging-api`/`staging-caddy` attached to the production Caddy's network (`docker network connect`). Remove the `staging.` block from `infra/caddy/Caddyfile` if you do not run staging.

## 7. Domain
The domain is printed inside every QR label. Keep **auto-renew on**, expiry reminders to two people, and never switch domains without a redirect plan.

## Restore drill log
| Date | Snapshot | Result |
|---|---|---|
