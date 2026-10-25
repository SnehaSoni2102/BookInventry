# Progress log

## M0 — Monorepo scaffold (done)
- pnpm workspaces + Turborepo, `node-linker=hoisted`, packages `shared`, `config`; apps `api` (NestJS 12), `web` (Vite placeholder).
- `infra/compose/docker-compose.dev.yml` (Postgres only), `.github/workflows/ci.yml`.

## M1 — Database (done)
- Drizzle schema mirrors `01-DATABASE.md` (checked: every CHECK, partial unique index, sequence and trigram index appears in migration 0000). `drizzle-kit check` clean.
- Extensions (`pg_trgm`, `pgcrypto`) are created by `migrate.ts`, since drizzle-kit does not manage them.
- Seed: admin, 27 genres + keywords, default settings, dev-only sample racks (A–C × 5, C05 overflow). Idempotent (tested).
- `seed:demo` is a stub until services exist (M3+).

## M2 — Auth, users, RBAC, audit (done)
- Login/refresh/logout/me/change-password; JWT access (jose, HS256) + rotating opaque refresh tokens with family reuse detection; argon2id; `tv` check through a 30 s cache that is invalidated on local changes.
- Global guards in order: JWT → permission (any-of semantics) → throttler (login 5/min per IP+username, 300/min per user). `RATE_LIMIT_ENABLED=false` in tests except the throttle spec.
- Users CRUD, reset-password (shown once), last-admin protection, audit service + `GET /audit-logs`.
- **Deferred:** `GET /users/:id/credential-slip.pdf` (needs pdfkit/QR; done with labels in M5).

## M3 — Shelves (done)
- Genres, racks, rows (+bulk), shelf map, slot view, unshelved list + place-unshelved, row-signs PDF.
- `ShelfAllocationService` (global advisory lock, genre rows → overflow → unshelved, contiguous runs for quantity > 1). Tested with 20 parallel transactions.
- Row PATCH blocks capacity shrink / genre change / deactivation while it would strand books (`ROW_NOT_EMPTY`).
- Fonts: Noto Sans + Noto Sans Devanagari (OFL, from @fontsource, woff). The Latin subset lacks ₹, so `pdf-text.ts` switches fonts per run.

## M4 — Catalog, titles, copies, covers (done)
- Catalog: local → `external_lookup_cache` (30 d hits / 7 d misses, failures never cached) → Open Library ∥ Google Books, merged per the plan; per-provider 1 req/s gate and 5-failure/60 s circuit breaker; genre + price suggestion. Tested against **real recorded Open Library responses** (`test/fixtures`); the Google fixture is hand-written because Google's anonymous quota was exhausted when I tried to record it.
- `POST /copies` (+ `CopiesService.createWithTitle`, reused by import in M9): title upsert, sequential codes, shelf allocation, audit, all in one transaction, idempotent on `clientRef`.
- Titles (detail with copy groups, PATCH with version, cover upload, relocate), copies (detail, PATCH with version, write-off, move), cover job with SSRF-guarded download, WebP 400/160 px, public `/files/covers/...`.
- Jobs: pg-boss wrapper (`JOBS_MODE=memory` in tests), `worker.ts`, weekly `cache.purge`.
- Genre suggestion uses whole-word keyword matching (so "heart" does not match "art"). On the real Open Library data for the test book, "suspense / mystery / detective" subjects make MYS outscore FIC — as specified; the user confirms the genre.

## M5 — Labels, scan, public page (done)
- Label PDFs (thermal 50×25, 50×30 + Code128, A4 3×8 with start position), QR via bwip-js (`{PUBLIC_APP_URL}/b/{code}`, EC level M), print queue, mark-printed, `qr.svg`.
- `GET /scan/resolve` computes actions server-side (permission × status × scope); managers get limited info + `blocked` for books not at their stall.
- `GET /public/copies/:code`: built from an allow-list, honours `public.fields` / `public.enabled`, 60 req/min/IP; tests assert no location/stall/donor/notes/ids leak.
- Credential slip PDF (deferred from M2): one-time in-memory token returned by create/reset.
- **`POST /labels/pdf`** (ids in the body) added: 500 UUIDs in a GET query string are ~18 KB, over Node's 16 KB header limit, so the plan's "up to 500 labels" cannot work over GET.

## M6 — Inventory search (done)
- `GET /titles` and `GET /copies`: scope (managers pinned to their stall), `status` available/atStalls/all/sold/writtenOff, filters (genre, condition, price in paise, stall, unshelved, labelPending), sorts, pagination, exact-match short-circuit for copy codes/ISBNs, fuzzy search (all words, or trigram similarity > 0.25). Punctuation-only queries match nothing.
- Bugs found by tests: drizzle builders mutate in place (the count query inherited `LIMIT`), and an invalid `ORDER BY` for the location sort.

## M7 — Stalls (done)
- CRUD, activate, managers (one active stall each unless `moveFromOtherStall`), checkout by copies or by group (shelf order, all-or-nothing per group, race-safe), pick-list PDF, check-in (restores the same slot; allocates a new one and says so if the reserved slot is gone), soft delete (blocked by open checkouts), reconciliation, close (LOST / KEEP_OPEN; deactivates managers per setting), PDF/XLSX reports.
- `GET /stalls/mine` returns `{ stall }` (Nest drops a bare `null` body).

## M8 — Sales and realtime (done)
- `POST /sales`: row locks, idempotent on `clientRef` (also when requests race; another user's clientRef → 409), manager scoping, D7 (only admin may change price; override audited), D8 (admin at a stall needs `confirmAtStallCopies`; label "Admin @ stall"), D6 (managers see own sales; setting widens to their stall).
- Void: restores the original slot if free, else allocates and flags the label; optional `returnToStall`.
- Summary (stall/day/paymentMethod/genre) with the Admin (central) row and grand total; receipts (80 mm thermal / A6); Excel export without customer contact details.
- Socket.IO at **`/rt/socket.io`** (so Caddy's `/rt/*` rule covers it): handshake auth, rooms `user:`, `role:admin`, `stall:`. Sale events go to admins and the seller (and the stall room only if `managerSeesWholeStall`), so co-managers do not see each other's totals. `session.revoked` disconnects the user. `shelf.space.low` + nightly capacity job.
- HTTP guards skip non-HTTP contexts (WebSocket auth happens in the handshake).

## M9 — Excel bulk import (done)
- Template (dropdowns for condition and genre, Genres sheet, Instructions), upload (≤ 10 MB, ≤ 5,000 rows), background validation (distinct ISBNs looked up 4 at a time through the catalogue, so cache + rate limits apply), per-row preview with errors/warnings, inline fix (`PATCH`) and skip, commit in chunks of 100 rows (one transaction per chunk, savepoint per row), resumable after a crash, result `.xlsx`, labels by `importJobId`.
- Verified: crash between chunks then retry → exactly 250 titles, none duplicated; a poisoned row becomes an ERROR row without losing its chunk; **1,000 rows with mocked lookups: validate 1.0 s, whole import 5.1 s** (target < 60 s).
- Smoke-tested the compiled build (`node dist/…`) with a real pg-boss worker: a cover URL was fetched and served by the worker.
- Zod 4 gotcha: `z.record(z.enum([...]))` is exhaustive; use `z.partialRecord`.

## M10 — Web app (done)
- All pages in the plan: auth, dashboard, scan station (lookup / sell / checkout / check-in / labels), add book, inventory, copy page, stalls, sales, labels, bulk import, shelves, genres, users, settings, audit, public QR page. Realtime bridge invalidates queries from Socket.IO events.
- Keyboard-wedge scanning works without focus (`WedgeDetector`: ≤ 35 ms between keys, Enter within 70 ms); camera scanning via `CameraScanModal`; repeat reads within 2 s are ignored.
- **Deviation:** a small server-paged `DataTable` instead of TanStack Table 9 (v9 is a rewrite with a different API; the lists are server-sorted so the extra layer bought nothing).
- Bug found by the e2e suite: a hook (`useFormat`) called conditionally in JSX crashed the scan page (React #310). Fixed.
- Tests: 21 unit tests (wedge, nav, cart, datatable) and 9 serial Playwright flows (`apps/web/e2e`, API on :3100 with a fresh DB and mock catalogue providers, `vite preview` on :4173). Run: `E2E_ADMIN_URL=<admin postgres url> pnpm --filter @bookstall/web exec playwright test`.

## M11 — Android app (done in code; device checks pending)
- Expo SDK 58 / RN 0.88 / Expo Router. Role-based tabs, scan modes (lookup / sell / checkout / check-in / add / labels), cart, sales, stalls, inventory, imports, shelves, users, settings, deep link `/b/:code`, app lock, SecureStore refresh token, no offline selling (D12).
- `pnpm typecheck` and jest (3 suites / 7 tests) pass; `expo export --platform android` bundles (Hermes bytecode ≈ 4.8 MB).
- **Not verifiable here:** APK build (EAS/Gradle), camera scanning and Bluetooth printing on a real Android device.

## M12 — Deployment artefacts (written, not run on a server)
- `infra/docker/{api,web,backup}.Dockerfile`, `infra/compose/docker-compose.prod.yml` (+ `.env.example`, `.env.backup.example`), `infra/caddy/Caddyfile`, `infra/backup/{backup,restore}.sh` + crontab, `infra/scripts/deploy.sh` (backup → pull → up → health check → auto-rollback), `.github/workflows/{ci,deploy,mobile}.yml` (ci now also runs the Playwright suite), `apps/mobile/eas.json`, `docs/RUNBOOK.md`, `README.md`.
- **Not verifiable here:** Docker was not running locally, so the images were never built and the compose file never started; there is no OCI VM, domain or B2 bucket. The go-live checklist (`05-DEPLOYMENT.md` §11) is therefore **open**. Expect small fixes on first real build (e.g. `pnpm deploy --legacy` flags, Caddy staging block).
- `db:seed:demo` now creates 50 titles / ~150 copies through the API (stalls and sales are left to the app).

## Deviations / notes
- **Node 22** (not 20): pg-boss 12 requires ≥ 22.12. `.nvmrc`, `engines` and CI updated.
- **Pool deadlock lesson:** inside a transaction always use the `tx` (type `Q`), never the pool — 10 concurrent creates each holding a connection while asking for a second one exhausted the pool. `SettingsService` now takes an optional executor.
- **Schema additions (migration 0001):** `book_titles.version` (plan wants optimistic locking on titles but the DDL lacked the column) and `idempotency_keys` (plan wants `clientRef` idempotency on `POST /copies`, `/checkout`, `/checkin`; sales use `sales.client_ref`).
- Location-code prefix follows the **physical row's genre** (overflow rows use the book's genre), so it stays correct if a title's genre is edited before relocation.
- Relocate also moves the reserved slot of copies that are out at a stall (plan said "in-stock"), so they return to the right genre row.
- S3 storage driver not implemented (local disk is what production uses, D14).

- **Nest 12 is ESM-only**, so `apps/api` is `"type": "module"` (NodeNext, `.js` import suffixes). Constructor injection uses explicit `@Inject()` tokens so it works under tsx/esbuild, which cannot emit decorator metadata. Vitest uses SWC.
- **TypeScript 7** has no compiler API, so `tsup --dts` fails; `packages/shared` builds JS with tsup and `.d.ts` with `tsc --emitDeclarationOnly`.
- pnpm 12 needs build scripts approved (`allowBuilds` in `pnpm-workspace.yaml`).
- Tests use `TEST_DATABASE_URL` (admin connection to any Postgres) if set, otherwise a Testcontainers Postgres. The dev machine had no running Docker, so M1 tests were run against a local Postgres 17 (`TEST_DATABASE_URL=postgres://postgres@localhost:5433/postgres`).
