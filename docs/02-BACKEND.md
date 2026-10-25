# 02 — Backend Plan (NestJS API + Worker)

> Prerequisites: `00-OVERVIEW.md` (roles, decisions, glossary) and `01-DATABASE.md` (schema, allocation algorithm).
> Location: `apps/api`. One Docker image, two entrypoints: `node dist/main.js` (HTTP + WebSocket) and `node dist/worker.js` (pg-boss jobs).

---

## 1. Project structure

```
apps/api/
├─ src/
│  ├─ main.ts                 # HTTP bootstrap (helmet, CORS, pino, global pipes/filters, /api prefix)
│  ├─ worker.ts               # pg-boss worker bootstrap (no HTTP)
│  ├─ app.module.ts
│  ├─ config/                 # env schema (zod) + typed ConfigService
│  ├─ db/
│  │  ├─ schema/*.ts          # Drizzle tables (mirror 01-DATABASE.md exactly)
│  │  ├─ migrations/          # drizzle-kit output (committed)
│  │  ├─ migrate.ts           # runs migrations (used on deploy)
│  │  ├─ seed.ts, seed-demo.ts
│  │  └─ db.module.ts         # provides `DB` (drizzle instance on pg Pool) + `withTx()` helper
│  ├─ common/
│  │  ├─ zod-validation.pipe.ts
│  │  ├─ http-exception.filter.ts   # uniform error envelope
│  │  ├─ decorators/ (CurrentUser, RequirePermission, Public)
│  │  ├─ guards/ (JwtAuthGuard, PermissionGuard)
│  │  ├─ scope.ts             # resolves stall scope for STALL_MANAGER
│  │  └─ pagination.ts
│  └─ modules/
│     ├─ auth/  users/  audit/  settings/  storage/  jobs/  realtime/  health/
│     ├─ genres/  shelves/
│     ├─ catalog/            # external metadata lookup (Open Library, Google Books)
│     ├─ titles/  copies/  labels/  scan/  public/
│     ├─ stalls/             # stalls, assignments, movements (checkout/check-in), reconciliation
│     ├─ sales/
│     ├─ imports/
│     └─ reports/
└─ test/
   ├─ e2e/*.e2e-spec.ts       # Supertest + Testcontainers Postgres
   └─ fixtures/               # recorded Open Library / Google Books JSON responses
```

**Rules for every module:** controller (HTTP only) → service (business logic, transactions) → repository functions (Drizzle queries). Validate every input with zod schemas imported from `@bookstall/shared`. Return DTOs that match the shared response schemas, and never return `password_hash` or internal columns.

---

## 2. Configuration (env, validated with zod at startup — refuse to boot if invalid)

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://bookstall:***@db:5432/bookstall` | |
| `JWT_ACCESS_SECRET` | 64 random bytes (base64) | |
| `JWT_ACCESS_TTL` | `15m` | |
| `REFRESH_TTL_DAYS` | `30` | |
| `PUBLIC_APP_URL` | `https://books.example.org` | Used inside the QR (`/b/{code}`) |
| `CORS_ORIGINS` | `https://books.example.org` | Comma-separated |
| `STORAGE_DRIVER` | `local` (default, used in production too) \| `s3` | `local` stores files on a Docker volume |
| `LOCAL_STORAGE_DIR` | `/data/storage` (prod), `./.data/storage` (dev) | Mounted volume, included in backups |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_FORCE_PATH_STYLE` | (optional) | Only if `STORAGE_DRIVER=s3` |
| `GOOGLE_BOOKS_API_KEY` | (optional) | Works without a key at lower quota |
| `OPENLIBRARY_USER_AGENT` | `bookstall/1.0 (contact@ngo.org)` | Open Library asks clients to identify themselves |
| `EXTERNAL_LOOKUP_TIMEOUT_MS` | `5000` | |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | | Only read by the seed |
| `LOG_LEVEL` | `info` | |
| `SENTRY_DSN` | (optional, GlitchTip) | |

---

## 3. Cross-cutting conventions

- **Base path** `/api/v1`. JSON only, except file downloads (PDF, XLSX, PNG).
- **Error envelope:** `{ "error": { "code": "COPY_NOT_AVAILABLE", "message": "…", "details": {…} } }`, with an HTTP status code that matches the error. Error codes are a `const` enum in `packages/shared/src/errors.ts`:
  `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, VERSION_CONFLICT, COPY_NOT_AVAILABLE, COPY_NOT_AT_YOUR_STALL, STALL_NOT_ACTIVE, STALL_HAS_OPEN_CHECKOUTS, NO_SHELF_SPACE, ROW_NOT_EMPTY, DISCOUNT_NOT_ALLOWED, IMPORT_NOT_READY, EXTERNAL_LOOKUP_FAILED, PASSWORD_CHANGE_REQUIRED, RATE_LIMITED`.
- **Pagination:** query `page` (1-based), `pageSize` (default 25, max 100). Response `{ items, page, pageSize, total }`.
- **Optimistic locking:** `PATCH` on copies and titles requires `version` (or `If-Match`). A mismatch returns `409 VERSION_CONFLICT`.
- **Idempotency:** `POST /sales`, `POST /stalls/:id/checkout` and `POST /checkin` accept `clientRef` (uuid). Repeating the request returns the original result, not a duplicate. This protects against double-sells when a request is retried on a flaky mobile network at a stall.
- **Audit:** `AuditService.record(tx, {actorId, action, entityType, entityId, before, after})` is called **inside the same transaction** as each mutation listed in §8.
- **Logging:** `nestjs-pino`, with a request id on every log line. Redact `authorization`, `password`, `token` and `cookie`.
- **Security:** `helmet`, strict CORS, `@nestjs/throttler` (login: 5/min per IP+username; global: 300/min per user), request body limit 1 MB (uploads 10 MB), `trust proxy` for Caddy.
- **OpenAPI:** generate `/api/docs` (Swagger UI) from the zod schemas (e.g. `@anatine/zod-openapi` or `zod-to-openapi`). It's disabled in production unless `ENABLE_DOCS=true`.

---

## 4. Auth (`modules/auth`)

| Endpoint | Body / Notes |
|---|---|
| `POST /auth/login` | `{username, password, client: 'web'\|'mobile'}` → `{accessToken, user, mustChangePassword}`. Web: refresh token set as `httpOnly; Secure; SameSite=Strict` cookie on path `/api/v1/auth`. Mobile: refresh token returned in the body (stored in SecureStore). |
| `POST /auth/refresh` | Rotates the refresh token. If an already-used token from the same `family_id` is presented again, **revoke the whole family** (theft detection). |
| `POST /auth/logout` | Revokes the current refresh token. |
| `GET /auth/me` | User, role, permissions[], active stall (for managers), settings needed by the client (currency, locale, code prefix, public base URL). |
| `POST /auth/change-password` | `{currentPassword, newPassword}`; min 8 chars, checked against a small common-password list. Clears `must_change_password` and bumps `token_version`. |

- The access JWT contains `{sub, role, tv: tokenVersion}`. The guard rejects it when `tv` doesn't match the DB value (cached for 30 s), so disabling a user or resetting a password takes effect quickly.
- If `must_change_password` is true, every endpoint except `me`, `change-password` and `logout` returns `403 PASSWORD_CHANGE_REQUIRED`.
- Hash with argon2id (`@node-rs/argon2`, memoryCost 19456 KiB, timeCost 2).

## 5. Users (`modules/users`), admin only (`user.manage`)

| Endpoint | Notes |
|---|---|
| `GET /users?role=&q=&active=` | Paginated |
| `POST /users` | `{username, displayName, role, password?}`. If `password` is omitted, generate a readable 10-char password (no ambiguous characters). Response includes `initialPassword` **once**. |
| `PATCH /users/:id` | displayName, role, isActive (deactivating bumps `token_version`) |
| `POST /users/:id/reset-password` | Returns a new `temporaryPassword` once and sets `must_change_password=true`. Audited. (Decision D3) |
| `GET /users/:id/credential-slip.pdf` | Printable slip with username, temporary password (only right after a reset, passed via a one-time token), app URL and a QR code for the app URL. |

The admin can't deactivate or demote themselves if they're the last active admin.

---

## 6. Domain modules

### 6.1 Catalog lookup (`modules/catalog`)

`GET /catalog/lookup?isbn=9780143127550` and `GET /catalog/search?q=god of small things&author=roy`

**Resolution chain** (stop at the first hit, but always run step 1):
1. **Local DB:** `book_titles` by ISBN, or title/author search. Response `{ inInventory: true, title, copyGroups[] }`. The UI then offers **"Add another copy"** with the metadata prefilled and read-only (editable via "Edit title").
2. **Cache:** `external_lookup_cache` (30-day TTL for hits, 7-day TTL for misses).
3. **Open Library** (use `OPENLIBRARY_USER_AGENT`):
   - `GET https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data` → title, subtitle, authors[].name, publishers[].name, publish_date, number_of_pages, subjects[].name, cover.{small,medium,large}, identifiers.
   - For the summary: `GET https://openlibrary.org/isbn/{isbn}.json` → `works[0].key` → `GET https://openlibrary.org{workKey}.json` → `description` (a string or `{value}`).
   - Search: `GET https://openlibrary.org/search.json?q=…&fields=key,title,author_name,first_publish_year,isbn,cover_i,subject,language&limit=10`.
   - Cover: `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false` (404 when there's no cover) or `/b/id/{cover_i}-L.jpg`.
4. **Google Books:** `GET https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}&key=…` (or `intitle:…+inauthor:…`) → volumeInfo.title, authors, publisher, publishedDate, description, pageCount, categories, language, imageLinks.thumbnail (switch to `https`, remove `&edge=curl`).
5. **Not found** → `{ found: false }`. The UI shows the empty manual form (any ISBN the user typed is kept).

**Merge strategy** (when both providers answer, call them **in parallel** with a timeout): prefer Open Library for title/authors/publisher/year, prefer Google Books for `description` and `categories`. Take the first cover that's available. Strip HTML from descriptions and trim the summary to 1,500 chars at a sentence boundary.

**Genre suggestion:** score each genre by summing `genre_keywords.weight` for keywords found in subjects/categories (lowercased, substring match). If the language isn't English and an `HIN` (regional) genre exists, add +2 to it. Return `suggestedGenreId` plus the top 3 alternatives. **The user always confirms the genre.**

**Price suggestion:** `GET /catalog/price-suggestion?originalPriceMinor=49900&condition=GOOD` → `round(original × percent[condition] / 100, to pricing.roundToMinor)`. This is advisory only; the user must enter or confirm the selling price.

**Resilience:** each provider has a 5 s timeout, a circuit breaker (open for 60 s after 5 consecutive failures) and a 1-request/second rate limit per provider. Lookup failures **never** block manual entry.

Response schema (`CatalogLookupResult` in shared):
```ts
{ inInventory: boolean; titleId?: string; copyGroups?: CopyGroup[];
  found: boolean; source?: 'OPEN_LIBRARY'|'GOOGLE_BOOKS'|'LOCAL';
  metadata?: { isbn13, isbn10, title, subtitle, authors[], publisher, publishedYear, language,
               pageCount, summary, subjects[], coverUrl, externalIds };
  suggestedGenreId?: string; alternativeGenreIds?: string[] }
```

### 6.2 Titles & copies (`modules/titles`, `modules/copies`)

**Create (the main data-entry flow), one call:**
`POST /copies` (`copy.create`)
```ts
{
  titleId?: string,                     // existing title, OR:
  title?: { isbn13?, isbn10?, title, subtitle?, authors[], publisher?, publishedYear?, language?,
            pageCount?, summary?, subjects?, genreId, coverUrl?, source, externalIds? },
  copy: { condition, conditionNotes?, originalPriceMinor?, sellingPriceMinor, donorName?, notes? },
  quantity: 1..200,                     // N identical copies (same condition & price)
  clientRef: uuid
}
→ { title, copies: [{ id, code, locationCode|null, ... }], warnings: ['NO_SHELF_SPACE'?], labelPdfUrl }
```
Transaction:
1. Upsert the title. If `isbn13` already exists, reuse that title and ignore the incoming metadata (return a warning).
2. Compute `search_text`, `title_sort` and `author_sort` with the shared normalizers.
3. For each copy: `code = prefix + lpad(nextval('copy_code_seq'), 7, '0')`.
4. `ShelfAllocationService.allocate(tx, genreId, quantity)`.
5. Insert copies with `label_needs_print=true`, and write the audit entry.
6. After commit: enqueue the `cover.fetch` job if `coverUrl` is set and the title has no `cover_key`, then emit `copy.created`.

The response includes `labelPdfUrl` (`/labels/pdf?copyIds=…`), so the UI can print immediately after the form is submitted.

**Other endpoints**

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /titles` | `inventory.read` / `inventory.read.stall` | Search list (see 6.4) |
| `GET /titles/:id` | same | Title + `copyGroups[]` (grouped by condition + selling price + status/stall, with quantity, copy codes and locations) |
| `PATCH /titles/:id` | `title.write` | Metadata. A genre change returns `requiresRelocation: n` and doesn't move copies (see 01 §4). |
| `POST /titles/:id/cover` | `title.write` | Multipart image upload (e.g. a photo taken on mobile) → sharp → WebP 400 px wide plus a 160 px thumbnail |
| `POST /titles/:id/relocate` | `copy.update` | Move in-stock copies to the current genre's rows; returns a move list plus labels to reprint |
| `GET /copies` | `inventory.read(.stall)` | Copy-level list (filters: status, condition, stallId, genreId, price range, unshelved, labelPending) |
| `GET /copies/:id`, `GET /copies/by-code/:code` | `inventory.read(.stall)` | Full details incl. title, location, current stall + open movement, sale info if sold, movement history |
| `PATCH /copies/:id` | `copy.update` (price fields need `copy.price.update`) | A price change sets `label_needs_print=true` and is audited |
| `POST /copies/:id/write-off` | `copy.writeoff` | `{reason, notes}`; frees the slot and closes an open movement as LOST if one exists |
| `POST /copies/:id/move` | `copy.update` | Manual move to a specific free `{rowId, slot}`, or "auto" |

**Cover job (`cover.fetch`)** downloads the image (max 5 MB, image/* only, 10 s timeout, follows max 3 redirects, **blocks private-IP targets** to prevent SSRF), converts it with sharp to WebP 400 px plus a 160 px thumbnail, and stores `covers/{titleId}/{400|160}.webp`. It then sets `cover_key` and emits `title.updated`. Covers are served via `GET /files/covers/:titleId/:size.webp` (public, `Cache-Control: max-age=86400`), or a presigned or public bucket URL.

### 6.3 Genres & shelves (`modules/genres`, `modules/shelves`) — `genre.manage` / `shelf.manage`

| Endpoint | Notes |
|---|---|
| `GET/POST/PATCH /genres`, `PUT /genres/:id/keywords` | A genre can't be deleted while titles use it; deactivate it instead |
| `GET/POST/PATCH /racks` | |
| `GET/POST/PATCH /rows`, `POST /racks/:id/rows/bulk` | Bulk-create rows `{count, capacity, genreId?}`. A PATCH changing capacity or genre is validated as described in 01 §4 (`ROW_NOT_EMPTY`). |
| `GET /shelves/map` | All racks → rows → `{capacity, used, reservedAtStall, genre, percentFull}` for the occupancy map |
| `GET /shelves/rows/:id/slots` | Slot-by-slot contents (code, title, status) |
| `GET /shelves/unshelved` | IN_STOCK copies with no slot |
| `POST /shelves/place-unshelved` | Retry allocation for unshelved copies (after new rows are added) |
| `GET /shelves/row-signs.pdf?rowIds=` | A4 printable row signs: genre name, colour band, row code, slot range |

`ShelfAllocationService` implements 01 §4 exactly. Required tests:
- 20 concurrent `POST /copies` for the same genre produce 20 distinct slots.
- A full genre goes to overflow, then to unshelved with a warning.
- `quantity=5` gets contiguous slots when available.
- Check-in returns the copy to its original slot.

### 6.4 Inventory search (`GET /titles`, `GET /copies`)

Query params: `q`, `genreId[]`, `condition[]`, `minPrice`, `maxPrice`, `status` (default `available`, meaning IN_STOCK for central or AT_STALL at the user's stall for a manager), `stallId` (admin only), `sort` (`title|author|price|newest|quantity`), `order` (`asc|desc`), `page`, `pageSize`.

**Scope resolution (`common/scope.ts`):**
- `ADMIN` / `INVENTORY_STAFF`: can see everything and filter by `status` and `stallId` freely. "Available" means IN_STOCK; `status=all` includes AT_STALL with the stall name.
- `STALL_MANAGER`: always forced to `current_stall_id = myActiveStallId AND status = 'AT_STALL'`. Any `stallId`/`status` params are ignored. With no active stall they get an empty list plus the flag `noActiveStall: true`.

Title list item:
`{ id, title, authors, genre:{id,name,code,color}, coverThumbUrl, availableCount, minPriceMinor, maxPriceMinor, conditions[], isbn13 }`

A request with `q` equal to a copy code or ISBN short-circuits (see 01 §5). The response then includes `exactMatch: {type:'copy', code}` so the client can jump straight to that copy.

### 6.5 Labels (`modules/labels`) — `label.print`

| Endpoint | Notes |
|---|---|
| `GET /labels/pdf?copyIds=a,b,c&template=THERMAL_50x25\|A4_24&startPosition=1` | Max 500 copies per call. `startPosition` lets users reuse a partly used A4 sheet. |
| `GET /labels/queue` | Copies with `label_needs_print=true` (filters: createdBy=me, importJobId) |
| `POST /labels/mark-printed` | `{copyIds}` → sets `label_printed_at`, clears the flag. The client calls this after the user confirms the print succeeded. |
| `GET /copies/:id/qr.svg` | QR only (for on-screen display or sharing) |

**Label content (THERMAL 50 × 25 mm, 203 dpi safe):**
```
┌───────────────────────────────────────────┐
│ ┌───────┐  BK0000123                      │
│ │  QR   │  The God of Small Things        │  ← title, max 2 lines, ellipsis
│ │ 20mm  │  Arundhati Roy                  │  ← first author, 1 line
│ └───────┘  GOOD   ₹150  (MRP ₹399)        │
│            FIC-A03-017            [NGO]   │  ← location code bold
└───────────────────────────────────────────┘
```
- QR payload: `${PUBLIC_APP_URL}/b/${code}`, error correction `M`, quiet zone 2 modules. Generate with `bwip-js` (`bcid: 'qrcode'`), embedded in pdfkit as PNG at 300 dpi.
- An optional Code128 of `code` (template `THERMAL_50x30_1D`) for sites that only have 1D scanners.
- The A4_24 template uses a 3 × 8 grid of 70 × 37 mm labels with the same content, scaled.
- Bundle the font (**Noto Sans** + **Noto Sans Devanagari**, both OFL) so Hindi titles render.

### 6.6 Scan resolution (`modules/scan`) and the public page (`modules/public`)

`packages/shared/src/scan.ts` → `parseScan(raw)`:
1. `trim()`, strip control chars, then check in this order:
2. URL whose path matches `/b/([A-Z]{2,4}\d{7})$` (any host, so labels survive a domain change) → `{kind:'copy', code}`.
3. `^[A-Za-z]{2,4}\d{7}$` → `{kind:'copy', code: upper}`.
4. 13 digits starting 978/979 with a valid checksum → `{kind:'isbn', isbn13}`. 10 chars with a valid ISBN-10 checksum → converted to 13. Also accept EAN-13 with a "+5 digit" add-on by stripping the add-on.
5. Otherwise `{kind:'unknown', raw}`.

`GET /scan/resolve?value=…` (authenticated) returns one of:
- `{kind:'copy', copy: CopyDetail, actions: Action[]}`, where `actions` are computed server-side from permission × status × scope:
  - `SELL` (IN_STOCK & `sale.create.central`; or AT_STALL at my stall & `sale.create.stall`; admin + AT_STALL → `SELL` with `requiresConfirm: 'COPY_AT_STALL'`)
  - `CHECKOUT` (IN_STOCK & `stall.checkout`)
  - `CHECKIN` (AT_STALL & `stall.checkin`), with `stall:{id,name}` and the `locationCode` to return it to
  - `EDIT`, `PRINT_LABEL`, `WRITE_OFF`
- `{kind:'isbn', isbn13, titleId?, copyGroups?, lookup?: CatalogLookupResult}`: the client offers "Add copy" or "View copies".
- `{kind:'unknown'}`, or `404` if a copy code isn't found.
- For a manager scanning a copy that **isn't at their stall**: return limited info plus `{blocked:'COPY_NOT_AT_YOUR_STALL'}`. No sell action is offered.

`GET /public/copies/:code` (**no auth**, rate-limited to 60/min per IP): only the fields allowed in `public.fields`. It returns `availability: 'AVAILABLE'|'SOLD'|'UNAVAILABLE'` and never includes location, stall, donor, notes or internal ids.

### 6.7 Stalls, assignments, checkout / check-in (`modules/stalls`)

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /stalls?status=` | `stall.manage` (managers: `GET /stalls/mine`) | Includes counts: atStall, sold, revenue |
| `POST /stalls` | `stall.manage` | `{name, location, startsOn, endsOn, description, manager?: {existingUserId} \| {username, displayName}}`. Creating a manager returns `initialPassword` once. |
| `PATCH /stalls/:id` | `stall.manage` | Can't edit a CLOSED stall except its notes |
| `POST /stalls/:id/activate` | `stall.manage` | PLANNED → ACTIVE |
| `POST /stalls/:id/managers` / `DELETE /stalls/:id/managers/:userId` | `stall.manage` | Assign or unassign. Assigning fails if the user is active elsewhere, unless `{moveFromOtherStall:true}`. |
| `DELETE /stalls/:id` | `stall.manage` | **Soft delete.** Fails with `STALL_HAS_OPEN_CHECKOUTS` if any movement is OPEN. A stall with sales can be deleted (hidden from lists) but stays in reports as "(deleted) name". Unassigns its managers. |
| `POST /stalls/:id/checkout` | `stall.checkout` | Body (A) `{copyIds[], clientRef}` or (B) `{groups:[{titleId, condition, sellingPriceMinor, quantity}], clientRef}`. The stall must be PLANNED or ACTIVE. (B) picks IN_STOCK copies ordered by location code. Response: `{batchId, checkedOut:[{code, locationCode, title}], failed:[{copyId/code, reason}]}`. Use partial success for (A), all-or-nothing per group for (B). |
| `GET /stalls/:id/pick-list.pdf?batchId=` | `stall.checkout` | Sorted by location code, with checkbox column, title, code, price. Totals: count and value. |
| `POST /checkin` | `stall.checkin` | `{copyIds[] \| codes[], clientRef}` → for each: must be AT_STALL; close the OPEN movement (`RETURNED`), set status IN_STOCK and `current_stall_id=NULL`. Returns `[{code, title, fromStall, returnToLocation}]`. If the slot is somehow gone, allocate a new one and flag `relocated:true`. |
| `GET /stalls/:id/inventory` | `stall.manage` or the stall's manager | Same as `/titles` scoped to the stall |
| `GET /stalls/:id/movements?outcome=` | `stall.manage` | History |
| `GET /stalls/:id/reconciliation` | `stall.manage` | `{sent, sold, returned, lost, stillOut:[…], revenueMinor, byPaymentMethod}` |
| `POST /stalls/:id/close` | `stall.manage` | `{markRemainingAs: 'LOST' \| 'KEEP_OPEN'}`. LOST sets movements to LOST and copies to WRITTEN_OFF(LOST), freeing their slots. Stall → CLOSED, assignments ended. Returns the reconciliation. `GET /stalls/:id/report.pdf` and `.xlsx` are available afterwards. |

Every checkout and check-in emits realtime `inventory.changed {copyIds, stallId}` and an audit entry per batch (not per copy, to keep the log readable; copy ids go in `after`).

### 6.8 Sales (`modules/sales`)

`POST /sales` (`sale.create.central` or `sale.create.stall`)
```ts
{ items: [{ copyId, soldPriceMinor? }], paymentMethod, customerName?, customerPhone?, notes?,
  clientRef: uuid, confirmAtStallCopies?: boolean }
```
Transaction (`SERIALIZABLE` is not required; use row locks):
1. If `clientRef` already exists → return that sale (idempotent).
2. `SELECT … FROM copies WHERE id = ANY($ids) FOR UPDATE`.
3. Validate each copy:
   - **Stall manager:** status AT_STALL and `current_stall_id = myActiveStallId`, and the stall is ACTIVE. Otherwise `COPY_NOT_AT_YOUR_STALL` or `STALL_NOT_ACTIVE`.
   - **Admin:** status IN_STOCK (central), or AT_STALL with `confirmAtStallCopies=true` (decision D8). All items in one sale must share the same origin (all central, or all from one stall). Otherwise return `VALIDATION_FAILED`.
   - Anything else returns `COPY_NOT_AVAILABLE` with the offending codes in `details`.
4. Price (decision D7): `soldPriceMinor` defaults to `selling_price_minor`. **Only an ADMIN** may send a different `soldPriceMinor` (any value ≥ 0, audited as `sale.price.override`). For any other role, a `soldPriceMinor` that differs from the list price returns `DISCOUNT_NOT_ALLOWED`. Stall managers always sell at the listed price.
5. Insert the sale: `receipt_no = 'R-' || lpad(nextval('receipt_seq'), 6, '0')`. `stall_id` = the stall for stall-origin sales, NULL for central sales. `sold_by_id = me`.
6. Insert sale_items. Update copies → `SOLD`, `sold_at=now()`, `last_location_code = current location`, `row_id=NULL`, `slot_number=NULL`, `current_stall_id=NULL`.
7. Close any OPEN movement as `SOLD`.
8. Audit, commit, then emit realtime `sale.created` with the summary payload.

Display rule for "Sold at / By" (computed in the response, `soldAtLabel`):
- `stall_id IS NULL` → **"Admin"**.
- Stall set and seller is ADMIN → `"Admin @ {stall.name}"`.
- Otherwise → `stall.name` (plus the seller's display name in the details).

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /sales` | `sale.read.all` (filters: stallId, `central=true`, sellerId, from, to, paymentMethod, status, q=receipt/code/title) or `sale.read.own` (forced `sold_by_id = me`, or the whole stall if `sales.managerSeesWholeStall`) | Paginated, newest first. Each row: receipt, time, soldAtLabel, seller, item count, total, payment method, status. |
| `GET /sales/:id` | same scoping | Items with title, code, condition, list vs sold price |
| `GET /sales/:id/receipt.pdf` | same | 80 mm receipt layout (thermal) plus a share-friendly A6 version |
| `POST /sales/:id/void` | `sale.void` | `{reason}` (required). Sale → VOIDED. Each copy goes back to IN_STOCK at central (re-allocate a slot, since the old one may be taken) and the response includes the new locations and labels to print. If the sale came from a still-ACTIVE stall, add `{returnToStall:true}` to put copies back AT_STALL with a new OPEN movement instead. Audited. |
| `GET /sales/summary?from&to&groupBy=stall\|day\|paymentMethod\|genre` | `sale.read.all` (managers get their own scope) | **Consolidated totals:** one row per stall plus a "Admin (central)" row and a grand total: `{key, label, salesCount, itemsCount, revenueMinor, byPaymentMethod:{CASH,UPI,…}}`. Excludes VOIDED. |
| `GET /sales/export.xlsx?…` | `sale.read.all` | Same filters, for accounting |

### 6.9 Realtime (`modules/realtime`, Socket.IO namespace `/rt`)

- Handshake: `auth: { token: accessToken }`. The server verifies the JWT and joins rooms:
  `user:{id}`; `role:admin` (admins); `stall:{stallId}` (managers on their active stall; admins can join any via `subscribe:stall`).
- Events (server → client). The payloads are small, and clients **invalidate TanStack Query keys** and refetch:

| Event | Rooms | Payload | Client invalidates |
|---|---|---|---|
| `sale.created` / `sale.voided` | `role:admin`, `stall:{id}` | `{saleId, stallId, totalMinor, itemsCount, soldAt}` | `['sales']`, `['sales','summary']`, `['titles']`, `['copies']` |
| `inventory.changed` | `role:admin`, `stall:{id}` | `{copyIds, stallId?}` | `['titles']`, `['copies']`, `['stalls', id]` |
| `stall.updated` | `role:admin`, `stall:{id}` | `{stallId, status}` | `['stalls']`, `['auth','me']` |
| `title.updated` | all authenticated | `{titleId}` | `['titles', id]` |
| `shelf.space.low` | `role:admin` | `{genreId, percentFull}` | toast |
| `import.updated` | `user:{id}` | `{jobId, status, processedRows, totalRows}` | `['imports', id]` |
| `session.revoked` | `user:{id}` | `{}` | force logout |

- Events are emitted **after the transaction commits** (use a small `afterCommit` queue on the tx helper).
- Runs as a single instance. If the API is ever scaled horizontally, add `@socket.io/postgres-adapter` (no Redis needed).

### 6.10 Bulk import (`modules/imports`) — `import.manage`

**Template** `GET /imports/template.xlsx` (generated with exceljs, with a data-validation dropdown for condition and genre, a "Genres" reference sheet and an "Instructions" sheet):

| Column | Required | Notes |
|---|---|---|
| `isbn` | either isbn or title | ISBN-10 or ISBN-13, hyphens allowed |
| `title` | if no isbn | |
| `authors` | no | Separated by `;` |
| `genre` | no* | Genre name or code. *Required if the lookup can't suggest one. |
| `condition` | **yes** | NEW, LIKE_NEW, VERY_GOOD, GOOD, FAIR, POOR (case-insensitive; also accepts "like new", "very good") |
| `original_price` | no | Rupees, e.g. `399` or `399.00` |
| `selling_price` | **yes** | Rupees |
| `quantity` | no (default 1) | 1–200 |
| `publisher`, `published_year`, `language`, `summary`, `cover_url`, `donor`, `notes` | no | |

**Flow**
1. `POST /imports` (multipart xlsx, ≤ 10 MB, ≤ 5,000 data rows) → stores the file → creates `import_jobs` (UPLOADED) → enqueues `import.validate` → `202 {jobId}`.
2. Worker `import.validate`: parse the rows → normalize → validate with the shared zod schema → for rows with an ISBN and missing metadata, look up local then external (parallelism 4, honouring provider rate limits) → resolve the genre (explicit > suggestion > `ERROR` if none) → detect in-file duplicates (same ISBN + condition + price in several rows, giving a `WARNING`: "duplicate row; each row still creates its own copies, check that this isn't double-counted") → write `import_rows` → job READY, counts updated → emit `import.updated` to `user:{id}`.
3. `GET /imports/:id` (status plus counts) and `GET /imports/:id/rows?status=` (preview with per-row messages). The UI shows the preview table.
4. Optional fix-ups: `PATCH /imports/:id/rows/:rowId` (edit normalized fields and revalidate that row) and `POST /imports/:id/rows/:rowId/skip`.
5. `POST /imports/:id/commit` → requires READY and 0 ERROR rows (or `{skipErrors:true}`) → enqueue `import.commit`.
6. Worker `import.commit`: processes rows in chunks of 100. **Each chunk is its own transaction** (so a failure doesn't lose everything; the job can resume from the first uncommitted row). It reuses the same `CopiesService.createWithTitle` used by `POST /copies` (allocation, codes, audit, source=`IMPORT`), then marks rows COMMITTED with `created_copy_ids` and enqueues cover jobs.
7. Done → COMPLETED. Outputs: `GET /imports/:id/result.xlsx` (the original rows plus created codes and locations, or error messages), and labels via `GET /labels/pdf?importJobId=…` (sorted by location so stickers go on quickly while shelving).

### 6.11 Reports & dashboard (`modules/reports`) — `report.read`

- `GET /dashboard`: totals (titles, copies in stock, at stalls, unshelved, labels pending), today's sales by stall, active stalls, shelf space alerts, last 10 sales.
- `GET /reports/inventory.xlsx`: full stock export.
- `GET /reports/stalls/:id.pdf|.xlsx`: stall reconciliation report.
- (P2) sell-through by genre, aging stock.

### 6.12 Settings & audit

- `GET /settings` (any authenticated user gets the client-safe subset); `PATCH /settings` (`settings.manage`). The values are validated by a zod schema per key.
- `GET /audit-logs?entityType&entityId&actorId&action&from&to` (`audit.read`).

### 6.13 Health

- `GET /health/live` (process up) and `GET /health/ready` (DB reachable, migrations applied, storage reachable). Used by Docker healthchecks, the deploy script and UptimeRobot.

---

## 7. Background jobs (pg-boss, `worker.ts`)

| Job | Trigger | Retry |
|---|---|---|
| `cover.fetch` | title created/updated with `coverUrl` | 3× exponential backoff; give up silently (a missing cover is fine) |
| `import.validate` | `POST /imports` | 1 retry; on failure job → FAILED with message |
| `import.commit` | `POST /imports/:id/commit` | resumable; 3 retries |
| `cache.purge` | weekly cron | – |
| `shelf.capacity.check` | nightly cron + after allocation | emits `shelf.space.low` |
| `backup.verify` (optional) | weekly | see deployment |

The worker shares the services through a Nest `ApplicationContext` (`NestFactory.createApplicationContext(WorkerModule)`), with no HTTP.

---

## 8. Audited actions (minimum)

`auth.login.failed` (after 3 consecutive failures), `user.create`, `user.update`, `user.password.reset`, `title.create`, `title.update`, `copy.create`, `copy.update`, `copy.price.update`, `copy.writeoff`, `copy.move`, `stall.create`, `stall.update`, `stall.activate`, `stall.close`, `stall.delete`, `stall.manager.assign`, `stall.manager.unassign`, `stall.checkout`, `stall.checkin`, `sale.create`, `sale.price.override`, `sale.void`, `import.commit`, `shelf.row.update`, `settings.update`.

---

## 9. Testing plan (required for each milestone)

**Unit (Vitest):** `parseScan`, ISBN utils, money utils, normalizers, genre scorer, price suggestion, label layout text truncation, Open Library and Google Books response mappers (using recorded fixtures), merge strategy, permission matrix (`can()` for every role × permission).

**E2E (Supertest + Testcontainers Postgres, local storage driver, external HTTP mocked with `nock` or `msw`):**
1. Auth: login, refresh rotation, reuse detection revokes the family, must-change-password gate, disabled user rejected within 30 s.
2. Create copy from an ISBN (mocked OL hit) → title + 3 copies + 3 distinct slots + codes sequential + label PDF returns `application/pdf`.
3. Create a copy where both providers miss → manual metadata is accepted.
4. Same ISBN again → reuses the title; copies with a different condition and price appear as separate copy groups.
5. **Concurrency:** 20 parallel creates → unique slots. 10 parallel `POST /sales` for the same copy → exactly 1 `201`, 9 `409 COPY_NOT_AVAILABLE`.
6. Checkout by quantity → pick list order. Check-in → the same `row_id/slot` as before checkout.
7. A manager can't list, scan-sell or check out copies outside their stall. A manager only sees their own sales.
8. Admin central sale shows `soldAtLabel = "Admin"`. Summary includes the Admin row and per-stall rows, and the totals match.
9. Void → copy back in stock with a location. VOIDED is excluded from the summary.
10. Stall delete is blocked with open checkouts; close with `LOST` writes off the remaining copies.
11. Import: valid file → preview → commit → copies created; a file with errors can't be committed without `skipErrors`; resume after a simulated crash mid-commit.
12. Idempotency: the same `clientRef` twice → one sale.
12a. A stall manager sending `soldPriceMinor` ≠ list price → `DISCOUNT_NOT_ALLOWED`; an admin override succeeds and is audited.
13. Public endpoint never leaks location, stall or donor.
14. Realtime: a socket client in `role:admin` receives `sale.created` after a manager sells.

Coverage target: services ≥ 80% lines. CI fails below 70%.

---

## 10. Backend milestone checklist (maps to 00-OVERVIEW §8)

- [ ] M0 Nest app boots, `/health/live`, pino, config validation, Dockerfile builds
- [ ] M1 Drizzle schema = DDL, migrations, seed, DB constraint tests
- [ ] M2 auth, users, guards, audit, throttling
- [ ] M3 genres, racks/rows, allocation service + concurrency test, shelf map, row signs PDF
- [ ] M4 catalog providers + cache + merge + genre & price suggestion; titles/copies create & edit; cover job
- [ ] M5 labels PDF (2–3 templates), label queue, `parseScan`, `/scan/resolve`, public endpoint
- [ ] M6 search & listing with scopes, sorting, filters, pagination
- [ ] M7 stalls, assignments, checkout (A/B), pick list, check-in, reconciliation, close, soft delete
- [ ] M8 sales (cart), void, receipts, summary, export, realtime gateway + events
- [ ] M9 imports end-to-end + result xlsx + labels by import
- [ ] Dashboard, settings, audit endpoints
