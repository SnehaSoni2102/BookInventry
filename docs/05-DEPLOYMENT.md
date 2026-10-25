# 05 — Deployment, Operations & CI/CD Plan

> Prerequisites: `00-OVERVIEW.md` (decision D14), `02-BACKEND.md` (env vars).
> Goal: the **cheapest reliable setup that is free or open source**, simple enough for one NGO tech volunteer to run. The total running cost is the domain name only.

---

## 1. Final hosting decision (D14)

| Need | Choice | Cost | Why this, and not the alternatives |
|---|---|---|---|
| Server | **Oracle Cloud Infrastructure (OCI) Always Free**, Ampere A1 ARM VM. Use **2 OCPU / 12 GB RAM** (the free allowance is 4 OCPU / 24 GB in total), **Ubuntu 24.04**, a 100 GB boot volume (free allowance 200 GB), region **ap-mumbai-1** or **ap-hyderabad-1** (low latency in India) | ₹0 | It's by far the biggest free VM available and permanently free. Free PaaS tiers (Render, Railway, Fly) sleep, expire or are too small to run Postgres + API + worker together. |
| Database | **PostgreSQL** (latest stable major, ≥16) in Docker **on the same VM**, data on a Docker volume | ₹0 | Managed free tiers are too limited: Neon's free tier is about 0.5 GB, and Supabase pauses inactive free projects. With nightly off-site backups, a self-hosted DB is safe at this scale. |
| File storage (covers, import files) | **Local disk** (Docker volume, `STORAGE_DRIVER=local`) | ₹0 | About 1–2 GB in total, so object storage isn't needed. MinIO isn't used because its community edition no longer ships maintained images. |
| Off-site backups | **restic → Backblaze B2** (10 GB free, no card needed) | ₹0 | It's a different provider from the host, so if the OCI account is lost the backup survives. restic encrypts and deduplicates, which keeps the size small. |
| TLS + reverse proxy + static web | **Caddy** | ₹0 | Automatic Let's Encrypt certificates, one small config file. |
| DNS | **Cloudflare DNS** (free plan, "DNS only", grey cloud) or the registrar's DNS | ₹0 | |
| Domain | `.org` / `.in` / `.org.in` from any registrar, **auto-renew ON** | about ₹800–1,200/yr | **The domain is printed inside every QR label**, so it must never lapse. Don't use free dynamic-DNS subdomains. |
| Uptime alerts | **UptimeRobot** (free tier, 5-minute checks) → email / Telegram | ₹0 | It has to run *outside* the VM, so it can tell you when the VM itself is down. |
| Backup monitoring | **Healthchecks.io** (open source, free tier): the backup script pings it, and you get an alert if a night is missed | ₹0 | |
| CI/CD + image registry | **GitHub Actions** + **GitHub Container Registry (GHCR)** | ₹0 within free minutes | |
| Android distribution | **APK** hosted on our own domain (`/app/bookstall.apk`) | ₹0 | The Play Store is optional (US$25 one-time). |

### 1.1 OCI caveats the agent/operator must handle
1. **Upgrade the account to Pay-As-You-Go** (it stays ₹0 while you're within the Always Free limits). This is strongly recommended: OCI may **reclaim idle Always Free VMs** on free-trial-only accounts, and PAYG accounts also get A1 capacity more reliably. Immediately add a **budget alert at ₹1** so any accidental paid resource is noticed.
2. Only create resources labelled **"Always Free eligible"** (A1 Flex shape within limits, ≤200 GB block storage in total, 1 VCN).
3. **The home region can't be changed later.** Choose Mumbai or Hyderabad at sign-up.
4. If you get "Out of host capacity" when creating the A1 VM, retry later or in another availability domain. Upgrading to PAYG usually fixes it.
5. Open ports in **both** the VCN Security List (ingress 80/443 TCP + 443 UDP) **and** the host firewall. OCI Ubuntu images ship with `iptables` rules that block everything except 22, so either add rules before the REJECT line and persist them with `netfilter-persistent`, or switch to `ufw` carefully.

### 1.2 Fallback host (only if OCI isn't possible)
**Hetzner Cloud CAX11** (ARM, 2 vCPU / 4 GB, about €4–5/month, EU region). Because it's also ARM, **the same arm64 images run unchanged**. Everything below applies, except the OCI-specific steps.

---

## 2. Environments

| Env | Where | Purpose |
|---|---|---|
| `local` | Developer machine, `infra/compose/docker-compose.dev.yml` (**Postgres only**) | api, web and mobile run with hot reload; files go to `./.data/storage` |
| `staging` | **The same OCI VM**, a second compose project (`bookstall-staging`) at `staging.<domain>` with its own database and volume | Test releases with demo data. The Android `preview` build points here. The VM has plenty of RAM for both. |
| `production` | OCI VM, compose project `bookstall` at `<domain>` | Real data |

## 3. Topology

```
Internet ──443/80──▶ Caddy (TLS, HTTP/2+3, zstd/gzip)
                      ├─ /                → static web build (SPA fallback to index.html)
                      ├─ /b/*             → static web (public copy page, SPA route)
                      ├─ /api/*           → api:3000
                      ├─ /rt/*            → api:3000 (WebSocket upgrade)
                      ├─ /app/*           → static: bookstall.apk (Android app download)
                      └─ /.well-known/assetlinks.json → static (Android App Links)
Docker network (internal only):
  api (NestJS) · worker (same image) · db (PostgreSQL) · backup (cron sidecar)
Volumes: pg_data · app_storage (covers, imports) · caddy_data · caddy_config
Outbound: Open Library / Google Books APIs · Backblaze B2 (backups) · Healthchecks.io ping
```

Only ports 22, 80 and 443 are reachable from the internet. PostgreSQL is **never** exposed. Restrict SSH to key-only, and optionally to the admin's IP in the OCI Security List.

## 4. Files to create (`infra/`)

### 4.1 `infra/docker/api.Dockerfile` (multi-stage, arm64)
1. Use a `node:<LTS>-bookworm-slim` base and enable corepack/pnpm.
2. `pnpm fetch` → `pnpm install --offline --frozen-lockfile --filter @bookstall/api...`.
3. Build `packages/shared` and `apps/api`.
4. `pnpm deploy --filter @bookstall/api --prod /out` for a pruned production `node_modules`.
5. Runtime stage: slim image, non-root `node` user, `tini` as PID 1. Copy `/out`, `dist`, migrations and fonts (Noto Sans + Noto Sans Devanagari). Check that `sharp` and `@node-rs/argon2` load on **linux/arm64** with a smoke test in CI.
6. `HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
7. `CMD ["node","dist/main.js"]`. The worker overrides it with `["node","dist/worker.js"]`, and migrate with `["node","dist/db/migrate.js"]`.

### 4.2 `infra/docker/web.Dockerfile`
The build stage runs `pnpm --filter @bookstall/web build` with `VITE_API_URL=/api/v1` and `VITE_RT_URL=/rt`. The final stage is a `caddy:2-alpine` image with `dist/` in `/srv` and the Caddyfile. **Caddy is both the reverse proxy and the static file server.** The APK and `assetlinks.json` are mounted from the host (`/opt/bookstall/public/app`, `/opt/bookstall/public/well-known`), so a new APK doesn't need an image rebuild.

### 4.3 `infra/compose/docker-compose.prod.yml` (outline)
```yaml
name: bookstall
x-api: &api
  image: ghcr.io/<org>/bookstall-api:${APP_VERSION}
  env_file: .env
  volumes: [app_storage:/data/storage]
  restart: unless-stopped
  logging: { driver: local, options: { max-size: "20m", max-file: "5" } }

services:
  caddy:
    image: ghcr.io/<org>/bookstall-web:${APP_VERSION}
    ports: ["80:80", "443:443", "443:443/udp"]
    environment: [DOMAIN=${DOMAIN}, ACME_EMAIL=${ACME_EMAIL}]
    volumes:
      - caddy_data:/data
      - caddy_config:/config
      - /opt/bookstall/public/app:/srv/app:ro
      - /opt/bookstall/public/well-known:/srv/well-known:ro
    depends_on: [api]
    restart: unless-stopped

  migrate:
    <<: *api
    command: ["node", "dist/db/migrate.js"]
    restart: "no"
    depends_on: { db: { condition: service_healthy } }

  api:
    <<: *api
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }

  worker:
    <<: *api
    command: ["node", "dist/worker.js"]
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }

  db:
    image: postgres:<pinned-major>-alpine
    environment:
      POSTGRES_DB: bookstall
      POSTGRES_USER: bookstall
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    secrets: [pg_password]
    command: >
      postgres -c shared_buffers=1GB -c effective_cache_size=3GB
               -c max_connections=50 -c work_mem=16MB
    volumes: [pg_data:/var/lib/postgresql/data]
    shm_size: 256mb
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U bookstall"], interval: 5s, retries: 10 }
    restart: unless-stopped

  backup:
    image: ghcr.io/<org>/bookstall-backup:${APP_VERSION}   # alpine + postgresql-client + restic + curl + crond
    env_file: .env.backup
    volumes: [app_storage:/data/storage:ro]
    depends_on: { db: { condition: service_healthy } }
    restart: unless-stopped

secrets: { pg_password: { file: ./secrets/pg_password } }
volumes: { pg_data: {}, app_storage: {}, caddy_data: {}, caddy_config: {} }
```
- Keep `.env`, `.env.backup` and `secrets/` mode `600`, owned by `deploy`. Never commit them. Commit `.env.example` listing every variable from 02 §2 plus the backup variables (`RESTIC_REPOSITORY=b2:<bucket>:bookstall`, `RESTIC_PASSWORD`, `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`, `HEALTHCHECKS_PING_URL`, `PGHOST=db` …).
- API DB pool size 10, worker pool size 5.

### 4.4 `infra/caddy/Caddyfile` (outline)
```
{
  email {$ACME_EMAIL}
}
{$DOMAIN} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy "camera=(self)"
    Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: https://covers.openlibrary.org https://books.google.com https://*.googleusercontent.com; connect-src 'self' wss://{$DOMAIN}; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  }
  handle /api/*          { reverse_proxy api:3000 }
  handle /rt/*           { reverse_proxy api:3000 }
  handle /.well-known/*  { root * /srv/well-known; uri strip_prefix /.well-known; file_server }
  handle /app/*          {
    root * /srv
    header Content-Type application/vnd.android.package-archive
    file_server
  }
  handle {
    root * /srv
    try_files {path} /index.html
    file_server
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    header /index.html Cache-Control "no-cache"
  }
}
```
`assetlinks.json` contains the Android package name and the **release signing certificate's SHA-256** (from `eas credentials`). The staging project uses the same Caddyfile with `DOMAIN=staging.<domain>`, served by its **own** Caddy on other ports, or more simply, add a second site block to the production Caddy that proxies to the staging services on a shared Docker network. Pick the second option and document it in the runbook.

## 5. First-time setup (must be written up step by step in `docs/RUNBOOK.md`)

1. **OCI account:** sign up (home region Mumbai or Hyderabad), upgrade to PAYG, add a ₹1 budget alert, and enable MFA on the OCI login.
2. **Networking:** create a VCN with the wizard (public subnet). Security List ingress: 22/tcp (ideally restricted to the admin's IP), 80/tcp, 443/tcp, 443/udp.
3. **VM:** create it with shape `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu 24.04 (aarch64), 100 GB boot volume and your SSH public key. Reserve a **public IP** (free) so the IP doesn't change.
4. **Harden:** create a `deploy` user with sudo, disable password SSH and root login, add host firewall rules for 80/443 (see §1.1 point 5), and install `fail2ban` and `unattended-upgrades` (automatic security updates).
5. **Docker:** install Docker Engine and the compose plugin from Docker's apt repo (arm64), then `usermod -aG docker deploy`.
6. **Domain & DNS:** buy the domain (auto-renew ON). Create `A` records for `<domain>` and `staging.<domain>` pointing to the reserved IP.
7. **App:** create `/opt/bookstall/` and copy `docker-compose.prod.yml`, `.env`, `.env.backup` and `secrets/pg_password` (generate secrets with `openssl rand -base64 48`). Create `public/app/` and `public/well-known/`.
8. `docker compose pull && docker compose up -d`. Caddy gets the TLS certificate automatically; check that `https://<domain>/api/v1/health/ready` responds.
9. **Seed once:** `docker compose run --rm api node dist/db/seed.js`. Log in as admin and change the password. Then create a named personal admin account for each trustee, configure the org name, racks/rows and genres, and print the row signs.
10. **Backups:** create a B2 bucket (private) and an application key limited to that bucket, then run `restic init`. Run the first backup manually, **then do a restore test (§7)**.
11. **Monitoring:** add UptimeRobot monitors (§8) and the Healthchecks.io check (expected daily, 1-hour grace period).
12. **Android:** build the release APK (04 §9), put it in `public/app/bookstall.apk` and `assetlinks.json` in `public/well-known/`. Print a "Download the app" QR for volunteers.

## 6. CI/CD (GitHub Actions)

**`ci.yml`** (every push and PR):
- `pnpm install --frozen-lockfile` with the pnpm store cached.
- `pnpm turbo run lint typecheck test` for the affected packages.
- API e2e against a Postgres service container.
- Web build + Playwright (Chromium).
- `drizzle-kit check` (no schema drift).
- `pnpm audit --prod` (warn only) and a `gitleaks` secret scan.

**`deploy.yml`** (tag `v*.*.*` → production; manual dispatch → staging):
1. Build **linux/arm64** images (`api`, `web`, `backup`) with `docker/build-push-action`:
   - Public repo: use GitHub's free **native arm64 runner** (`runs-on: ubuntu-24.04-arm`).
   - Private repo: if native arm runners aren't free on your plan, use `ubuntu-latest` + QEMU (`docker/setup-qemu-action`). It's slower (about 10–20 min) but stays within the free 2,000 minutes per month.
   - Push to GHCR tagged `vX.Y.Z` and the commit `sha`. Use layer caching (`cache-from/to: type=gha`).
2. Deploy over SSH (`appleboy/ssh-action`, using a deploy key that can only run `/opt/bookstall/deploy.sh`). `deploy.sh <version>` then:
   - takes a **pre-deploy DB backup** (`docker compose exec backup /backup.sh pre-deploy`);
   - `APP_VERSION=<version> docker compose pull && docker compose up -d` (the `migrate` service finishes before api/worker start);
   - polls `/api/v1/health/ready` for up to 90 s;
   - if it's not healthy, **rolls back** to the previous `APP_VERSION` (stored in `/opt/bookstall/.last_version`) and exits non-zero.
   - Rollback doesn't undo migrations, so **migrations must be backward-compatible** (expand → migrate → contract).
3. Clean up old images: `docker image prune -af --filter "until=168h"`.

**`mobile.yml`**: see 04 §9 (Android only).

Branching: `main` is always deployable; work happens on feature branches merged by PR with green CI; releases are semver tags. Renovate (free GitHub app) opens dependency update PRs, merged monthly.

## 7. Backups & disaster recovery

| What | How | When | Retention |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` → `restic backup --stdin` to B2 | nightly 02:00 IST + before every deploy | `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune` |
| Files (covers, imports) | `restic backup /data/storage` | nightly | same |
| Secrets (`.env`, restic password, B2 key, OCI login) | Stored in a shared password manager (e.g. Bitwarden free organisation) held by **two** trustees | on change | – |

- `infra/backup/backup.sh` pings Healthchecks.io at `/start`, then on success or `/fail`, so a missed or failed backup sends an alert.
- `infra/backup/restore.sh <snapshot>` restores into a fresh Postgres container plus the storage volume.
- **Monthly restore drill:** on the same VM, restore the latest snapshot into a throwaway container, compare `SELECT count(*) FROM copies` and `SELECT max(sold_at) FROM sales` with production, and log the result in the RUNBOOK.
- Targets: **RPO ≤ 24 h**, **RTO ≤ 2 h** (new VM via §5 steps 3–8, then `restore.sh`).
- At about 30 KB per cover, plus dumps compressed and deduplicated by restic, 10 GB of B2 covers this NGO's scale for years. B2 charges very little beyond that.

## 8. Monitoring & logging

- **UptimeRobot** (free): monitors (1) `https://<domain>/api/v1/health/ready` (keyword `"ok"`), (2) `https://<domain>/` and (3) SSL expiry. Alerts go to email + Telegram.
- **Healthchecks.io:** nightly backup heartbeat.
- **Logs:** JSON (pino), Docker `local` driver with rotation (configured in compose). Read them with `docker compose logs -f api`. Optionally add **Dozzle** (OSS web log viewer) behind Caddy with basic auth.
- **Disk:** a daily cron on the host emails or sends a Telegram alert when disk usage is over 80%.
- **Errors (optional):** set `SENTRY_DSN` to a self-hosted **GlitchTip**, only if the team wants it. It isn't required.

## 9. Security checklist

- [ ] HTTPS only, HSTS, CSP (§4.4); refresh cookie `Secure; HttpOnly; SameSite=Strict`
- [ ] SSH key-only, no root login, fail2ban, automatic security updates; OCI console login uses MFA
- [ ] PostgreSQL not exposed; app DB role isn't a superuser; strong unique secrets; `.env` files mode 600
- [ ] No secrets in images or the repo (gitleaks in CI)
- [ ] Login and public endpoints rate-limited; failed logins audited
- [ ] Stall manager accounts auto-deactivated when their stall closes (`stall.deactivateManagersOnClose`, default on)
- [ ] One named admin account per person, with no shared admin login after setup
- [ ] Customer name and phone are optional and left out of exports by default (DPDP Act 2023 good practice)
- [ ] Outbound cover fetches SSRF-protected (02 §6.2)

## 10. Cost summary

| Item | Cost |
|---|---|
| All software (OSS) | ₹0 |
| OCI Always Free VM + storage + bandwidth | ₹0 |
| Backblaze B2 (≤ 10 GB), UptimeRobot, Healthchecks.io, GitHub | ₹0 |
| Domain | about ₹800–1,200/year (the only recurring cost) |
| Android distribution | ₹0 (APK). Play Store optional: US$25 one-time |
| Fallback host if OCI is unavailable | Hetzner CAX11, about €4–5/month |
| Hardware (one-off) | 2D USB barcode scanner about ₹2,500–4,000; 203 dpi thermal label printer about ₹6,000–12,000; 50 × 25 mm label rolls |

## 11. Go-live checklist (M12 acceptance)

- [ ] OCI account on PAYG with a ₹1 budget alert; VM, reserved IP and firewall configured
- [ ] Production at `https://<domain>`, staging at `https://staging.<domain>`; `/health/ready` green
- [ ] Admin password changed; named admin accounts; org settings, genres, racks/rows configured; row signs printed
- [ ] A test label printed on the thermal printer and scanned with (a) the USB scanner on the web, (b) the Android app, (c) a plain phone camera → public page
- [ ] Nightly backup ran, Healthchecks.io is green, and the **restore drill passed**
- [ ] UptimeRobot alert tested (stop the api container → alert received → start it again)
- [ ] APK downloadable from `/app/bookstall.apk`; App Links verified (scanning a label with the phone camera opens the app)
- [ ] One-page volunteer quick-start PDF: add a book, print a label, check out to a stall, sell, check in
- [ ] `docs/RUNBOOK.md` complete: deploy, rollback, restore, rotate secrets, add a user, reset a password, rebuild the server from scratch, renew or move the domain
