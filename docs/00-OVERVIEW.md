# NGO Second-Hand Book Inventory — Master Plan (READ FIRST)

> **Audience:** an AI coding agent (or developer) who will build the system end-to-end.
> **Codename:** `bookstall` (rename freely).
> **Plan files (read all before writing code):**
>
> | File | Contents |
> |---|---|
> | `00-OVERVIEW.md` | Scope, decisions, roles & permissions, architecture, repo layout, milestones, feature suggestions |
> | `01-DATABASE.md` | PostgreSQL schema (canonical DDL), constraints, shelf-allocation algorithm, seed data |
> | `02-BACKEND.md` | NestJS API: modules, endpoints, business rules, jobs, realtime, tests |
> | `03-FRONTEND-WEB.md` | React web app: pages, components, hardware/camera scanning, label printing |
> | `04-MOBILE-APP.md` | Expo (React Native) **Android** app with camera barcode scanning |
> | `05-DEPLOYMENT.md` | Production deployment, CI/CD, backups, monitoring, mobile distribution |

---

## 0. Instructions for the AI agent

1. **Read every plan file completely** before scaffolding anything.
2. **§3 Decisions** have all been confirmed by the product owner. Treat them as requirements. Don't re-open them or build the features listed as *out of scope* there.
3. Build in the **milestone order in §8**. Don't start a milestone until the previous one passes its acceptance criteria and `pnpm lint && pnpm typecheck && pnpm test` is green.
4. Use **free and open-source tools only**. Don't add paid SaaS dependencies. Free tiers of external APIs (Open Library, Google Books) are allowed, but the system must keep working when they're unavailable.
5. Use the **latest stable version** of each library at implementation time and pin it in the lockfile. Before upgrading a major version, check its migration notes.
6. Keep a running log in `docs/PROGRESS.md`: milestone, what was done, deviations from the plan and why.
7. **If something is ambiguous or conflicts with this plan, stop and ask the user.** Don't guess on anything that touches money, permissions or data deletion.
8. Never store plaintext passwords and never log secrets or tokens.
9. All money is stored as **integer minor units** (paise). Never use floats for money.

---

## 1. Problem statement

An NGO sells donated second-hand books from a central inventory (shelves) and from temporary **stalls** (book fairs, events, college fests). They need:

- A central database of every **physical copy** of a book. Two copies of the same title can have different condition, original price and selling price.
- Fast data entry: look up book metadata (title, author, genre, summary, cover thumbnail) from open sources by ISBN or title. Fall back to manual entry.
- A **QR code label** for every physical copy. Scanning it shows all details and offers role-appropriate actions: sell, check out to a stall, check in.
- **Automatic shelf placement.** Shelf rows are tagged by genre. Every copy gets a unique row and slot, and books are sorted by genre.
- Inventory search and browse (paginated, searchable, sortable), with selling from the list or the details page.
- **Stalls:** the admin creates or deletes stalls, assigns stall-manager credentials, checks books out to a stall and checks returned books back in to their original slot.
- **Sales:** every sale is recorded. Stall managers see only their own sales. The admin sees all sales with real-time totals per stall.
- **Bulk import** from Excel (admin).
- **Web app** (desktop, with a USB/Bluetooth hardware scanner) and a **mobile app** (camera scanning) with full feature parity.

---

## 2. Glossary (use these names consistently in code)

| Term | Meaning |
|---|---|
| **Title** (`book_titles`) | Bibliographic record: ISBN, title, authors, genre, summary, cover. One per edition/ISBN. |
| **Copy** (`copies`) | One physical book. Has a unique **copy code** (e.g. `BK0000123`), condition, original price (MRP), selling price, status, shelf slot and current stall. **The QR code identifies a copy.** |
| **Copy group** | Copies of the same title with the same condition and selling price, shown as "quantity N" in the UI. |
| **Rack / Row / Slot** | Physical location. A rack (A, B, …) has rows (1 = top). A row has numbered slots (columns). Each row is tagged with one genre. |
| **Location code** | Human-readable position: `{GENRE}-{RACK}{ROW}-{SLOT}`, e.g. `FIC-A03-17` = Fiction, rack A, row 3, slot 17. |
| **Stall** | A temporary point of sale. Status: `PLANNED` → `ACTIVE` → `CLOSED`. |
| **Movement** | One copy checked out to a stall, plus its eventual outcome (returned / sold / lost). |
| **Sale** | A transaction (receipt) with one or more sale items (copies). `stall_id = NULL` means a central sale made by the admin. |
| **Central** | The main inventory/warehouse. A sale made there is shown as **"Admin"** in sales lists. |

---

## 3. Decisions & open questions

All decisions below are **confirmed**.

| # | Topic | Decision | Affects |
|---|---|---|---|
| D1 | Currency / locale | INR (₹), `en-IN` number formatting, UI in English with i18n scaffolding so Hindi can be added later | M1 |
| D2 | Roles | Three roles: `ADMIN`, `INVENTORY_STAFF` (volunteers who add, shelve and check books in and out, but can't manage users or stalls or see sales) and `STALL_MANAGER` | M2 |
| D3 | Stall manager passwords "accessible by admin" | Passwords are **hashed (argon2id), never stored readable**. The admin can **reset** a password at any time and sees the new password **once**, with a printable credential slip. | M2 |
| D4 | Shelf placement | **Genre → row, then the first free slot** in that genre's rows. Every copy gets a unique position, and existing books are never shifted. **Out of scope:** any shelf reorganize or alphabetical re-sort tool. | M3 |
| D5 | Stall manager ↔ stall | One manager account can be on **one active stall at a time**. Accounts can be reused across stalls over time. A stall can have several managers. | M7 |
| D6 | What a stall manager sees in sales | Only sales **they personally made**. Setting `sales.managerSeesWholeStall` (default `false`) lets them see the whole stall's sales instead. | M8 |
| D7 | Discounts at the point of sale | **Stall managers can't change the price.** They always sell at the copy's selling price. Only the admin may override a price at sale time; the override is audited. | M8 |
| D8 | Admin selling a copy that is at a stall | Allowed, with a confirmation. The sale is recorded with that stall's id and **seller = Admin**. Admin sales from central have `stall_id = NULL` and show **"Admin"**. | M8 |
| D9 | Who checks books in and out | `ADMIN` and `INVENTORY_STAFF`. Stall managers can't check in or out (returns are handled at central). | M7 |
| D10 | Public QR scan (customer scans with a normal phone camera, not logged in) | Shows a **public page**: cover, title, author, genre, condition, selling price, MRP, summary, available/sold. Hidden: shelf position, stall, internal notes, donor. | M5 |
| D11 | Label size / printer | Default template **50 × 25 mm thermal label** (QR + code + short title + price + location). Second template: **A4 sticker sheet, 3 × 8 = 24 labels**. Hardware: a 2D (imager) USB scanner that reads QR and 1D codes, plus any thermal label printer that works with the OS print dialog. | M5 |
| D12 | Mobile platforms | **Android only.** **Out of scope:** an iOS build. iPhone users use the installable web app (PWA), which also scans with the camera. | M11 |
| D13 | Offline selling | **Out of scope.** Stalls need internet (mobile data is enough). The API still uses idempotency keys so retries on flaky networks never double-sell. | – |
| D14 | Hosting | **Oracle Cloud Always Free** ARM VM (₹0) running Docker Compose: Caddy + API + worker + PostgreSQL. Files are stored on the VM disk. Off-site backups go to Backblaze B2's free tier. A domain costs about ₹800/yr. Full details and the fallback host are in `05-DEPLOYMENT.md`. | M12 |
| D15 | Expected scale | Up to about 100k copies, 20 concurrent stalls, 50 users. The design handles 10× that without changes. | – |
| D16 | Copy code format | `{PREFIX}{7 digits}` with prefix `BK` (setting `copy.codePrefix`), e.g. `BK0000123`. The QR encodes `https://<domain>/b/BK0000123`. | M4 |
| D17 | Payment methods | Recorded per sale: `CASH`, `UPI`, `CARD`, `OTHER`. No payment gateway integration. | M8 |

---

## 4. Roles & permissions

Use **permission-based RBAC**. Roles map to permissions in `packages/shared/src/permissions.ts`; guards check permissions, never role names. Stall managers are additionally **row-scoped** to their active stall.

| Permission | ADMIN | INVENTORY_STAFF | STALL_MANAGER |
|---|:-:|:-:|:-:|
| `inventory.read` (all central + stall stock) | ✅ | ✅ | – |
| `inventory.read.stall` (only own active stall stock) | ✅ | – | ✅ (scoped) |
| `title.write` (create/edit title metadata) | ✅ | ✅ | – |
| `copy.create` | ✅ | ✅ | – |
| `copy.update` (condition, notes, location) | ✅ | ✅ | – |
| `copy.price.update` | ✅ | ✅ | – |
| `copy.writeoff` (damaged/lost) | ✅ | – | – |
| `label.print` | ✅ | ✅ | ✅ (reprint only, own stall copies) |
| `stall.manage` (create/edit/delete/close, assign managers) | ✅ | – | – |
| `stall.checkout` / `stall.checkin` | ✅ | ✅ | – |
| `sale.create.central` | ✅ | – | – |
| `sale.create.stall` (only copies at own active stall) | ✅ | – | ✅ (scoped) |
| `sale.read.all` + real-time stall totals | ✅ | – | – |
| `sale.read.own` | ✅ | – | ✅ |
| `sale.void` | ✅ | – | – |
| `import.manage` (Excel bulk create) | ✅ | – | – |
| `shelf.manage`, `genre.manage` | ✅ | – | – |
| `user.manage` | ✅ | – | – |
| `settings.manage`, `audit.read`, `report.read` | ✅ | – | – |

The UI hides any action the user lacks permission for. **The API enforces every rule independently** and never trusts the client.

---

## 5. Technology stack (all free & open source)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | Shared types and validation between API, web and mobile |
| Monorepo | **pnpm workspaces + Turborepo** | Fast and simple; Expo supports it |
| Backend | **Node.js LTS + NestJS** (Express adapter) | Structured modules, guards for RBAC, WebSockets built in |
| Validation | **Zod** schemas in `packages/shared`, used by the API (custom `ZodValidationPipe`) and by forms (`react-hook-form` + `@hookform/resolvers/zod`) | One source of truth |
| Database | **PostgreSQL 16+** with `pg_trgm` | Reliable, free, fuzzy search built in |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Supports partial unique indexes, CHECK constraints and sequences natively, all of which this design needs |
| Background jobs | **pg-boss** (job queue stored in Postgres) | No Redis needed |
| Realtime | **Socket.IO** via `@nestjs/websockets` | Live sales totals and inventory updates |
| Auth | JWT access token (15 min) + rotating refresh token; **argon2id** (`@node-rs/argon2`) | Secure, no external identity provider |
| QR / barcode generation | **bwip-js** (QR, Code128) | Pure JS, server-side PNG/SVG |
| Label / report PDFs | **pdfkit** | Pure JS |
| Excel | **exceljs** (MIT) | Reads uploads, writes templates and reports |
| Images | **sharp** | Resizes covers to WebP thumbnails |
| File storage | `StorageService` with a **local-disk driver** (a Docker volume on the VM; used in prod). An optional S3 driver (`@aws-sdk/client-s3`) works with any S3-compatible bucket if storage is ever moved off the VM. | Covers and import files. Total size stays small (≈1–2 GB for 50k covers). Don't use MinIO: its community edition no longer ships maintained images. |
| Book metadata | **Open Library API** (primary), **Google Books API** (secondary, free key optional) | Free |
| Web frontend | **React + Vite + TypeScript**, **Mantine** UI, **TanStack Query**, **TanStack Table**, **React Router**, `@zxing/browser` (camera scan), `vite-plugin-pwa` | Mature, free |
| Mobile | **Expo (React Native)** + **Expo Router**, `expo-camera` (barcode scanning built in), `expo-secure-store`, `expo-print`, `expo-document-picker`, **React Native Paper** | Android app sharing the TypeScript packages, free builds |
| Testing | **Vitest** (unit), **Supertest + Testcontainers** (API e2e against real Postgres), **Playwright** (web e2e), **Jest + RNTL** (mobile), optional **Maestro** (mobile e2e) | Free |
| Reverse proxy / TLS | **Caddy** (automatic HTTPS via Let's Encrypt) | Zero-config TLS |
| CI/CD | **GitHub Actions** + GHCR | Free for public repos and generous for private ones |
| Monitoring | Structured logs with **pino**; external uptime checks with **UptimeRobot** (free tier); backup heartbeat with **Healthchecks.io** (open source, free tier) | Monitoring runs outside the VM, so an outage of the VM itself still triggers an alert |
| Backups | `pg_dump` + **restic** to **Backblaze B2** (10 GB free) | Off-site (a different provider from the host), encrypted |
| Hosting | **Oracle Cloud Always Free** Ampere ARM VM + Docker Compose | ₹0. Details and the fallback host are in `05-DEPLOYMENT.md`. |

---

## 6. Architecture

```
            ┌──────────────────────┐        ┌───────────────────────┐
 USB/BT     │  Web app (React SPA, │        │  Mobile app (Expo)    │
 scanner ──▶│  PWA) — desktop/tab  │        │  camera QR/ISBN scan  │
            └──────────┬───────────┘        └───────────┬───────────┘
                       │ HTTPS (REST JSON) + WebSocket   │
                       ▼                                 ▼
               ┌───────────────────────── Caddy (TLS, static web, /api proxy) ─┐
               │                                                               │
               │   ┌────────────── NestJS API ──────────────┐   ┌──────────┐    │
               │   │ auth · users · catalog · titles · copies│   │  Worker  │    │
               │   │ shelves · labels · scan · stalls · sales│◀─▶│ (pg-boss)│    │
               │   │ imports · reports · realtime(Socket.IO) │   │ covers,  │    │
               │   └──────────────┬──────────────────────────┘   │ imports  │    │
               │                  │                              └────┬─────┘    │
               │          ┌───────▼────────┐        ┌──────────────────┐        │
               │          │ PostgreSQL 16  │        │ File storage     │◀─┘      │
               │          └────────────────┘        │ (disk volume)    │        │
               │                                    └──────────────────┘        │
               └──────────── Oracle Cloud Always Free ARM VM ─────────────────┘
                                  │ nightly encrypted backup → Backblaze B2
                                  │ outbound HTTPS
                     Open Library API · Google Books API · covers.openlibrary.org
```

- The API keeps no state of its own apart from Postgres and the file storage volume. The worker is the same Docker image started with a different command.
- Every client talks REST. The WebSocket channel only pushes events; clients refetch data with TanStack Query cache invalidation.

---

## 7. Repository layout

```
bookstall/
├─ apps/
│  ├─ api/                 # NestJS (see 02-BACKEND.md)
│  ├─ web/                 # React + Vite (see 03-FRONTEND-WEB.md)
│  └─ mobile/              # Expo (see 04-MOBILE-APP.md)
├─ packages/
│  ├─ shared/              # zod schemas, enums, permissions, scan parser, money/ISBN utils
│  ├─ api-client/          # typed fetch client + TanStack Query hooks (used by web & mobile)
│  └─ config/              # shared tsconfig, eslint, prettier
├─ infra/
│  ├─ docker/              # api.Dockerfile, web.Dockerfile, backup.Dockerfile
│  ├─ compose/             # docker-compose.dev.yml (Postgres only), docker-compose.prod.yml
│  ├─ caddy/Caddyfile
│  ├─ backup/              # backup.sh, restore.sh, crontab (restic → Backblaze B2)
│  └─ scripts/             # deploy.sh (with health check + auto-rollback)
├─ docs/                   # these plan files + PROGRESS.md + ADRs
├─ .github/workflows/      # ci.yml, deploy.yml, mobile.yml
├─ .npmrc                  # node-linker=hoisted   (required for Expo in pnpm monorepo)
├─ pnpm-workspace.yaml
└─ turbo.json
```

**`packages/shared` must contain** (and both clients must use it):
- `enums.ts`: `Role`, `BookCondition`, `CopyStatus`, `StallStatus`, `PaymentMethod`, `SaleStatus`, `MovementOutcome`.
- `permissions.ts`: the permission list, `ROLE_PERMISSIONS`, and `can(user, permission)`.
- `schemas/*.ts`: zod request/response schemas for every endpoint.
- `scan.ts`: `parseScan(raw: string): {kind:'copy', code} | {kind:'isbn', isbn13} | {kind:'unknown', raw}` (see 02-BACKEND §6.6).
- `isbn.ts`: ISBN-10/13 validation, ISBN-10→13 conversion, checksum.
- `money.ts`: `formatMoney(minor, currency, locale)`, `parseMoneyToMinor("150.50")`.
- `location.ts`: `formatLocation(genreCode, rackCode, rowNumber, slot)`.
- `normalize.ts`: `searchText()`, `titleSort()`, `authorSort()`. The API uses these when writing, so search and sort behave the same everywhere.

---

## 8. Milestones (execution order)

Each milestone ends with: tests green, `docs/PROGRESS.md` updated, one git commit (or PR).

| # | Milestone | Main plan file | Acceptance highlights |
|---|---|---|---|
| **M0** | Monorepo scaffold, tooling, `docker-compose.dev.yml` (Postgres), CI lint/typecheck/test | 00, 05 | `pnpm dev` starts api + web; CI green |
| **M1** | DB schema, migrations, seed (admin user, genres, sample racks/rows, settings) | 01 | `pnpm db:migrate && pnpm db:seed` works on an empty DB; constraint tests pass |
| **M2** | Auth, users, RBAC guards, audit log | 02 §4–5 | Login/refresh/logout; admin can create a stall manager and reset their password; permission tests |
| **M3** | Genres, racks/rows, **shelf allocation service** (unique slot per copy), occupancy map, row signs | 01 §4, 02 §6.3 | Parallel-creation test produces no duplicate slots; overflow behaviour tested |
| **M4** | Catalog lookup (local → Open Library → Google Books → manual), titles, copies (with quantity), cover thumbnails | 02 §6.1–6.2 | ISBN lookup returns a merged result; works with external APIs mocked offline |
| **M5** | QR/label PDFs, label print queue, scan resolve, public copy page endpoint | 02 §6.5–6.6 | Label PDF renders on both templates; `parseScan` unit tests |
| **M6** | Inventory search/list (title & copy views), details, sort, filter, pagination, stall-scoped variant | 02 §6.4 | Search by title/author/ISBN/code, fuzzy; sort by price/name/newest |
| **M7** | Stalls CRUD, manager assignment, checkout (by copies or by quantity → pick list), check-in, reconciliation/close | 02 §6.7 | Check-in restores original slot; manager scoping tests |
| **M8** | Sales (cart, multi-item), void, summaries per stall, **realtime** events | 02 §6.8–6.9 | Concurrent sell of the same copy → exactly one success; idempotent `clientRef` |
| **M9** | Excel bulk import (template, validate, preview, commit, error report, batch labels) | 02 §6.10 | 1,000-row file imports in under 60 s with external lookups mocked |
| **M10** | **Web app**, all pages | 03 | Playwright e2e for: add book → print label → checkout → sell at stall → check in |
| **M11** | **Android app**, all features | 04 | Scan flows on a real Android device; APK built |
| **M12** | Production deployment on Oracle Cloud Free, backups, monitoring, runbook | 05 | HTTPS live, nightly backup restored in a test, uptime alerting |

> The web app (M10) can be built **in parallel** with M6–M9 once M5's API contracts are stable. Mobile (M11) starts after M10 because it reuses `packages/api-client`.

**Definition of done (whole project):** every requirement in §1 is demonstrable on web and mobile; the e2e suites pass; production is deployed with a tested backup restore; the README explains local setup, environment variables and the admin first-run steps.

---

## 9. Feature suggestions (improvements beyond the brief)

Items tagged **[MVP]** are cheap and already included in the milestone plans. **[P2]** = phase 2, recommended. **[P3]** = later.

### Included in MVP
1. **[MVP] Scan the book's own ISBN barcode** (the EAN-13 on the back cover) when adding a book. The metadata lookup runs instantly, so typing is rarely needed.
2. **[MVP] Price suggestion:** suggested price = original price × condition percentage (configurable, e.g. Good = 35%), rounded to ₹10. The user always confirms or overrides it, so the selling price stays the user's decision.
3. **[MVP] Multi-book cart sale** with a receipt number and payment method. Covers customers buying 5 books at once. Receipts can be shared on WhatsApp or printed.
4. **[MVP] Checkout by quantity + pick list:** "Send 10 copies of *X* (Good, ₹100) to Stall 3". The system picks the copies and prints a pick list sorted by shelf location so volunteers can collect them quickly.
5. **[MVP] Stall reconciliation & close wizard:** at the end of a stall, scan the returned books. Anything not returned and not sold is flagged as missing. Produces a stall report (sent / sold / returned / missing / revenue by payment method).
6. **[MVP] Label print queue:** new copies, and copies whose price changed, are queued for (re)printing in batches.
7. **[MVP] Public QR page:** a customer at a stall scans a sticker with their own phone and sees the summary and price. No app needed.
8. **[MVP] Audit log** of every price change, sale, void, checkout, check-in and user change. Important for NGO accountability.
9. **[MVP] Shelf occupancy map + printable genre row signs** (colour-coded per genre) for the physical shelves.
10. **[MVP] Unshelved and space alerts** when a genre's rows are almost full or a book couldn't be placed.

### Phase 2 (recommended, not part of this build)
11. **[P2] Stock-take mode:** scan every book on a row. The system reports missing, misplaced (belongs to another slot) and unexpected copies.
12. **[P2] Aging inventory & markdown suggestions:** books unsold for more than N days, with suggested price drops (applied by the admin) or "donate onward" lists.
13. **[P2] Analytics dashboard:** sell-through rate per stall, revenue by genre, best-selling titles and authors, average days to sell, books per donor.
14. **[P2] Donor / donation-batch tracking** with thank-you reports ("your 40 books raised ₹3,200").
15. **[P2] UPI QR on screen** (static VPA QR built from settings) so customers can pay instantly at the stall.
16. **[P2] Hindi (and other regional language) UI** using the i18n scaffolding added in MVP.
17. **[P2] 2FA (TOTP) for admin accounts.**

### Later
18. **[P3] Public online catalogue + reservations** ("hold this book; collect at the stall on Sunday").
19. **[P3] Stall expenses** (rent, transport) to report net proceeds per stall.
20. **[P3] Wishlist / notify-me** for customers looking for specific titles.
21. **[P3] Accounting export** (Tally-compatible CSV) for the NGO's books of accounts.

### Explicitly out of scope (owner decisions)
- Shelf reorganize or alphabetical re-sorting (D4)
- Stall-manager discounts (D7)
- iOS app (D12)
- Offline selling (D13)
