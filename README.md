# Book Stall Inventory

Inventory, stall checkout and point-of-sale for an NGO book stall: web app (admin / staff / stall manager), Android app, NestJS API, PostgreSQL. All free / open-source; prices are integer paise (INR).

Plans live in [`docs/`](docs/) (start with `00-OVERVIEW.md`); progress and deviations in [`docs/PROGRESS.md`](docs/PROGRESS.md); operations in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Layout
`apps/api` NestJS 12 + Drizzle · `apps/web` Vite/React/Mantine PWA · `apps/mobile` Expo (Android) · `packages/shared` (zod schemas, permissions, money, scan parsing) · `packages/api-client` · `infra/` deployment.

## Local setup
Requires Node 22 (`nvm use`), pnpm, and PostgreSQL ≥ 16 (Docker: `docker compose -f infra/compose/docker-compose.dev.yml up -d`).
```bash
pnpm install
cp .env.example .env            # set JWT_ACCESS_SECRET (>= 32 chars) and SEED_ADMIN_PASSWORD
pnpm --filter @bookstall/api db:migrate
pnpm --filter @bookstall/api db:seed        # genres, settings, racks, first admin
pnpm --filter @bookstall/api dev            # API on :3000   (separate terminal: worker -> tsx src/worker.ts)
pnpm --filter @bookstall/web dev            # web on :5173
pnpm --filter @bookstall/mobile start       # Expo
```
Optional demo data (admin must already have changed the temporary password): `SEED_ADMIN_PASSWORD=... pnpm --filter @bookstall/api db:seed:demo`.

### Admin first run
The seed creates the admin from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` and **forces a password change at first login**. Then: set organisation settings, review genres and racks/rows, create named admin accounts (temporary passwords are shown once), print row signs.

## Environment variables
See [`.env.example`](.env.example) (API) and [`infra/compose/.env.example`](infra/compose/.env.example) (production, incl. backups). Web: `VITE_API_URL` (default `/api/v1`), `VITE_RT_URL` (default same origin). Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_APP_URL`, `ANDROID_PACKAGE`.

## Tests
```bash
pnpm turbo run lint typecheck test build
# API tests use TEST_DATABASE_URL (admin connection to any Postgres) or Testcontainers when Docker is available
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @bookstall/api test
# Web end-to-end (Chromium)
E2E_ADMIN_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @bookstall/web e2e
```
