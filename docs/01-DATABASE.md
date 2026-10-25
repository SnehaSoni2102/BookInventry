# 01 — Database Plan (PostgreSQL 16 + Drizzle ORM)

> Read `00-OVERVIEW.md` first. This file is the **canonical schema**. Implement it in Drizzle (`apps/api/src/db/schema/*.ts`), using `casing: 'snake_case'` so TypeScript fields are camelCase and columns are snake_case. Generate migrations with `drizzle-kit generate`, then **diff the generated SQL against the DDL below**: every constraint, partial index and sequence must exist.

## 1. Conventions

- Primary keys: `uuid DEFAULT gen_random_uuid()`.
- Timestamps: `timestamptz`, stored in UTC. The UI shows the time in the configured timezone (default `Asia/Kolkata`).
- Money: `int` in **minor units** (paise), with column names ending in `_minor`. Never use floats or `numeric` in app code.
- Soft delete only where stated (`stalls.deleted_at`). Copies are never deleted after a sale or label print. Use statuses instead.
- `updated_at` is maintained by the application (Drizzle `$onUpdate(() => new Date())`).
- Every multi-row business operation (sale, checkout, check-in, import commit, allocation) runs in **one transaction**.
- Write the business-rule constraints into the DB (CHECK constraints, partial unique indexes) as well as the service code, so a bug in the code can't corrupt inventory.

## 2. Canonical DDL

```sql
-- ───────── Extensions, enums, sequences ─────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (built in on PG13+, harmless)

CREATE TYPE user_role         AS ENUM ('ADMIN','INVENTORY_STAFF','STALL_MANAGER');
CREATE TYPE book_condition    AS ENUM ('NEW','LIKE_NEW','VERY_GOOD','GOOD','FAIR','POOR');
CREATE TYPE copy_status       AS ENUM ('IN_STOCK','AT_STALL','SOLD','WRITTEN_OFF');
CREATE TYPE metadata_source   AS ENUM ('OPEN_LIBRARY','GOOGLE_BOOKS','MANUAL','IMPORT');
CREATE TYPE stall_status      AS ENUM ('PLANNED','ACTIVE','CLOSED');
CREATE TYPE movement_outcome  AS ENUM ('OPEN','RETURNED','SOLD','LOST');
CREATE TYPE payment_method    AS ENUM ('CASH','UPI','CARD','OTHER');
CREATE TYPE sale_status       AS ENUM ('COMPLETED','VOIDED');
CREATE TYPE import_status     AS ENUM ('UPLOADED','VALIDATING','READY','COMMITTING','COMPLETED','FAILED');
CREATE TYPE import_row_status AS ENUM ('VALID','WARNING','ERROR','COMMITTED','SKIPPED');
CREATE TYPE writeoff_reason   AS ENUM ('DAMAGED','LOST','DONATED_ONWARD','RECYCLED','OTHER');

CREATE SEQUENCE copy_code_seq START 1;   -- BK0000001 …
CREATE SEQUENCE receipt_seq   START 1;   -- R-000001 …

-- ───────── Users & auth ─────────
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username              text NOT NULL UNIQUE CHECK (username = lower(username) AND username ~ '^[a-z0-9._-]{3,32}$'),
  display_name          text NOT NULL,
  password_hash         text NOT NULL,                 -- argon2id
  role                  user_role NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT true,
  token_version         int NOT NULL DEFAULT 0,        -- bump to invalidate all sessions
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,                           -- rotation family (reuse detection)
  token_hash  text NOT NULL UNIQUE,                    -- sha256 of opaque token
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);

-- ───────── Genres & shelves ─────────
CREATE TABLE genres (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,4}$'),   -- FIC, CHI, SCI …
  color       text NOT NULL DEFAULT '#888888' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int  NOT NULL,                                       -- physical order along shelves
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- keywords used to auto-suggest a genre from Open Library subjects / Google categories
CREATE TABLE genre_keywords (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id  uuid NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  keyword   text NOT NULL CHECK (keyword = lower(keyword)),
  weight    int  NOT NULL DEFAULT 1,
  UNIQUE (genre_id, keyword)
);
CREATE INDEX genre_keywords_keyword_idx ON genre_keywords(keyword);

CREATE TABLE racks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{1,2}$'),   -- A, B, … AA
  name        text,
  sort_order  int  NOT NULL
);

CREATE TABLE shelf_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_id      uuid NOT NULL REFERENCES racks(id),
  row_number   int  NOT NULL CHECK (row_number BETWEEN 1 AND 99),     -- 1 = top
  code         text NOT NULL UNIQUE,                                  -- 'A03'
  capacity     int  NOT NULL CHECK (capacity BETWEEN 1 AND 999),      -- slots (columns)
  genre_id     uuid REFERENCES genres(id),                            -- NULL = unassigned
  is_overflow  boolean NOT NULL DEFAULT false,                        -- used when genre rows are full
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (rack_id, row_number)
);
CREATE INDEX shelf_rows_genre_idx ON shelf_rows(genre_id);

-- ───────── Bibliographic titles ─────────
CREATE TABLE book_titles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isbn13            text UNIQUE CHECK (isbn13 ~ '^97[89][0-9]{10}$'),
  isbn10            text CHECK (isbn10 ~ '^[0-9]{9}[0-9X]$'),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  subtitle          text,
  authors           text[] NOT NULL DEFAULT '{}',
  author_sort       text NOT NULL DEFAULT '',      -- "rowling j k" (first author, surname first, normalized)
  title_sort        text NOT NULL,                 -- normalized, leading "the/a/an" removed
  publisher         text,
  published_year    int CHECK (published_year BETWEEN 1400 AND 2100),
  language          text,                          -- ISO 639-1 ('en','hi',…)
  page_count        int CHECK (page_count > 0),
  edition           text,
  summary           text CHECK (length(summary) <= 4000),
  subjects          text[] NOT NULL DEFAULT '{}',
  genre_id          uuid NOT NULL REFERENCES genres(id),
  cover_key         text,                          -- object-storage key of our WebP thumbnail
  cover_source_url  text,
  source            metadata_source NOT NULL,
  external_ids      jsonb NOT NULL DEFAULT '{}',   -- {"openLibrary":"OL123M","googleBooks":"abc"}
  search_text       text NOT NULL,                 -- normalized "title subtitle authors isbn13 isbn10"
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX book_titles_genre_idx       ON book_titles(genre_id);
CREATE INDEX book_titles_title_sort_idx  ON book_titles(title_sort);
CREATE INDEX book_titles_author_sort_idx ON book_titles(author_sort);
CREATE INDEX book_titles_search_trgm     ON book_titles USING gin (search_text gin_trgm_ops);

-- ───────── Stalls ─────────
CREATE TABLE stalls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  location     text,
  description  text,
  starts_on    date,
  ends_on      date,
  status       stall_status NOT NULL DEFAULT 'PLANNED',
  activated_at timestamptz,
  closed_at    timestamptz,
  deleted_at   timestamptz,                         -- soft delete
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX stalls_name_live_uq ON stalls(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE stall_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stall_id       uuid NOT NULL REFERENCES stalls(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  unassigned_at  timestamptz
);
-- a manager can be on only ONE active stall at a time (decision D5)
CREATE UNIQUE INDEX stall_assignments_one_active_per_user
  ON stall_assignments(user_id) WHERE unassigned_at IS NULL;
CREATE INDEX stall_assignments_stall_idx ON stall_assignments(stall_id);

-- ───────── Physical copies ─────────
CREATE TABLE copies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,4}[0-9]{7}$'),
  title_id              uuid NOT NULL REFERENCES book_titles(id),
  condition             book_condition NOT NULL,
  condition_notes       text,
  original_price_minor  int CHECK (original_price_minor >= 0),          -- MRP; nullable if unknown
  selling_price_minor   int NOT NULL CHECK (selling_price_minor >= 0),  -- always set by a user
  status                copy_status NOT NULL DEFAULT 'IN_STOCK',
  row_id                uuid REFERENCES shelf_rows(id),
  slot_number           int CHECK (slot_number >= 1),
  last_location_code    text,                       -- kept for history after the slot is freed
  current_stall_id      uuid REFERENCES stalls(id),
  writeoff_reason       writeoff_reason,
  donor_name            text,
  acquired_at           timestamptz NOT NULL DEFAULT now(),
  label_printed_at      timestamptz,
  label_needs_print     boolean NOT NULL DEFAULT true,
  notes                 text,
  sold_at               timestamptz,
  created_by_id         uuid NOT NULL REFERENCES users(id),
  version               int NOT NULL DEFAULT 0,     -- optimistic locking for edits
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT copies_slot_pair      CHECK ((row_id IS NULL) = (slot_number IS NULL)),
  CONSTRAINT copies_stall_status   CHECK ((status = 'AT_STALL') = (current_stall_id IS NOT NULL)),
  -- sold / written-off copies must release their shelf slot; at-stall copies KEEP it (reserved)
  CONSTRAINT copies_slot_released  CHECK (status IN ('IN_STOCK','AT_STALL') OR row_id IS NULL),
  CONSTRAINT copies_sold_at        CHECK ((status = 'SOLD') = (sold_at IS NOT NULL)),
  CONSTRAINT copies_writeoff       CHECK ((status = 'WRITTEN_OFF') = (writeoff_reason IS NOT NULL)),
  -- every copy on the shelf (or reserved while at a stall) has a UNIQUE position.
  -- NULLs are distinct in PG, so unshelved/sold copies (row_id NULL) never conflict.
  CONSTRAINT copies_unique_slot UNIQUE (row_id, slot_number)
);
CREATE INDEX copies_title_status_idx    ON copies(title_id, status);
CREATE INDEX copies_stall_status_idx    ON copies(current_stall_id, status);
CREATE INDEX copies_status_price_idx    ON copies(status, selling_price_minor);
CREATE INDEX copies_label_queue_idx     ON copies(label_needs_print) WHERE label_needs_print;
CREATE INDEX copies_unshelved_idx       ON copies(status) WHERE row_id IS NULL AND status = 'IN_STOCK';

-- ───────── Stall movements (checkout / check-in) ─────────
CREATE TABLE stall_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_id            uuid NOT NULL REFERENCES copies(id),
  stall_id           uuid NOT NULL REFERENCES stalls(id),
  batch_id           uuid NOT NULL,                  -- one checkout action → one pick list
  checked_out_at     timestamptz NOT NULL DEFAULT now(),
  checked_out_by_id  uuid NOT NULL REFERENCES users(id),
  checked_in_at      timestamptz,
  checked_in_by_id   uuid REFERENCES users(id),
  outcome            movement_outcome NOT NULL DEFAULT 'OPEN',
  CHECK ((outcome = 'RETURNED') = (checked_in_at IS NOT NULL))
);
CREATE UNIQUE INDEX stall_movements_one_open_per_copy ON stall_movements(copy_id) WHERE outcome = 'OPEN';
CREATE INDEX stall_movements_stall_idx ON stall_movements(stall_id, outcome);
CREATE INDEX stall_movements_batch_idx ON stall_movements(batch_id);

-- ───────── Sales ─────────
CREATE TABLE sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no       text NOT NULL UNIQUE,              -- 'R-000123'
  stall_id         uuid REFERENCES stalls(id),        -- NULL = central sale (shown as "Admin")
  sold_by_id       uuid NOT NULL REFERENCES users(id),
  sold_at          timestamptz NOT NULL DEFAULT now(),
  payment_method   payment_method NOT NULL,
  total_minor      int NOT NULL CHECK (total_minor >= 0),
  status           sale_status NOT NULL DEFAULT 'COMPLETED',
  customer_name    text,
  customer_phone   text,
  notes            text,
  client_ref       uuid UNIQUE,                       -- idempotency key from client (required by API)
  voided_at        timestamptz,
  voided_by_id     uuid REFERENCES users(id),
  void_reason      text,
  CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL))
);
CREATE INDEX sales_stall_time_idx  ON sales(stall_id, sold_at DESC);
CREATE INDEX sales_seller_time_idx ON sales(sold_by_id, sold_at DESC);
CREATE INDEX sales_status_time_idx ON sales(status, sold_at DESC);

CREATE TABLE sale_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  copy_id           uuid NOT NULL REFERENCES copies(id),
  list_price_minor  int NOT NULL CHECK (list_price_minor >= 0),   -- copy.selling_price at sale time
  sold_price_minor  int NOT NULL CHECK (sold_price_minor >= 0),   -- actually charged
  UNIQUE (sale_id, copy_id)
);
CREATE INDEX sale_items_copy_idx ON sale_items(copy_id);

-- ───────── Bulk import ─────────
CREATE TABLE import_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key       text NOT NULL,              -- uploaded xlsx in object storage
  original_name  text NOT NULL,
  status         import_status NOT NULL DEFAULT 'UPLOADED',
  total_rows     int NOT NULL DEFAULT 0,
  valid_rows     int NOT NULL DEFAULT 0,
  warning_rows   int NOT NULL DEFAULT 0,
  error_rows     int NOT NULL DEFAULT 0,
  copies_created int NOT NULL DEFAULT 0,
  error_message  text,
  created_by_id  uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

CREATE TABLE import_rows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number       int NOT NULL,
  raw              jsonb NOT NULL,
  normalized       jsonb,
  messages         jsonb NOT NULL DEFAULT '[]',   -- [{level:'error'|'warning', field, message}]
  status           import_row_status NOT NULL,
  created_copy_ids uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (job_id, row_number)
);

-- ───────── Cross-cutting ─────────
CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id),
  action       text NOT NULL,          -- 'copy.price.update', 'sale.create', 'stall.checkout', …
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  before       jsonb,
  after        jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_time_idx   ON audit_logs(created_at DESC);

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- cache external metadata lookups (saves API quota, makes re-lookups instant)
CREATE TABLE external_lookup_cache (
  provider    text NOT NULL,           -- 'openlibrary' | 'googlebooks'
  lookup_key  text NOT NULL,           -- 'isbn:9780…' or 'q:normalized query'
  payload     jsonb,                   -- NULL = known miss
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, lookup_key)
);
```

> pg-boss creates its own `pgboss` schema at startup, so it needs no manual migration.

## 3. Status model & invariants

```
           create                  checkout                 sale (at stall)
 (new) ───────────▶ IN_STOCK ───────────────▶ AT_STALL ─────────────────▶ SOLD
                     ▲   │  ◀─────────────── │                             ▲
                     │   │      check-in      │ mark lost (reconcile)       │
                     │   │                    ▼                             │
                     │   │               WRITTEN_OFF (LOST)                 │
                     │   └──── central sale (admin) ────────────────────────┘
                     │   └──── write-off (damaged/donated/recycled) ──▶ WRITTEN_OFF
                     └──── sale VOID (admin) → back to IN_STOCK (new slot allocated if old one taken)
```

| Invariant | Enforced by |
|---|---|
| Each shelved or reserved copy has a unique (row, slot) | `copies_unique_slot` unique constraint + allocation lock |
| `AT_STALL` ⇔ `current_stall_id` set | `copies_stall_status` CHECK |
| A copy at a stall **keeps its slot**, so it returns to the same place | Checkout never clears `row_id/slot_number`; `copies_slot_released` only forces release for SOLD/WRITTEN_OFF |
| A copy has at most one open movement | `stall_movements_one_open_per_copy` |
| A copy can't be sold twice | Conditional `UPDATE … WHERE status IN (…)` inside the sale transaction; `sale_items` unique per sale; service test for concurrency |
| A manager is on at most one active stall | `stall_assignments_one_active_per_user` |
| Sales and copies are never hard-deleted | No DELETE endpoints; voids and write-offs only |

## 4. Shelf allocation algorithm (`ShelfAllocationService`)

**Goal:** give each new copy a unique (row, slot), grouped by genre, with rows tagged by genre and ordered by `genres.sort_order`, then `racks.sort_order`, then `row_number`.

```
allocate(tx, genreId, count = 1, preferContiguous = true) → [{rowId, slot, locationCode}]
  1. SELECT pg_advisory_xact_lock(hashtext('shelf-alloc'))        -- one global lock;
     -- allocation is fast, and a global lock avoids deadlocks when overflow rows are shared
  2. candidateRows = active rows WHERE genre_id = genreId
                     ORDER BY rack.sort_order, row_number
  3. For each row: free slots = generate_series(1, capacity) EXCEPT occupied slot_numbers
       (occupied = copies with row_id = row AND row_id IS NOT NULL, any status IN_STOCK/AT_STALL)
     If preferContiguous and count > 1: try to find a run of `count` consecutive free slots in one row first.
     Otherwise take the lowest free slots in row order.
  4. If not enough: continue with active rows WHERE is_overflow = true (same ordering).
  5. If still not enough: allocate what is available; the remaining copies are created
     with row_id = NULL (status IN_STOCK, "Unshelved"). Return a warning NO_SHELF_SPACE
     listing the genre. Emit realtime event `shelf.space.low`.
  6. locationCode = `${genre.code}-${rack.code}${pad2(row_number)}-${pad3(slot)}`
     (for overflow rows use the copy's genre code too, so the label still shows the genre)
```

Useful SQL for step 3:

```sql
SELECT r.id AS row_id, s.slot
FROM shelf_rows r
JOIN racks k ON k.id = r.rack_id
CROSS JOIN LATERAL generate_series(1, r.capacity) AS s(slot)
WHERE r.is_active AND r.genre_id = $1
  AND NOT EXISTS (SELECT 1 FROM copies c WHERE c.row_id = r.id AND c.slot_number = s.slot)
ORDER BY k.sort_order, r.row_number, s.slot
LIMIT $2;
```

**Other rules**
- **Check-in:** the copy still holds its slot (reserved), so it goes back to the same place. If the slot is somehow missing (e.g. data repair), allocate a new one and **tell the user the new location**.
- **Genre change on a title:** offer "Move N copies to new genre rows". This allocates new slots and prints a move list plus labels to reprint. Never move copies automatically without confirming.
- **Shrinking capacity, or reassigning a row's genre:** blocked while the row holds copies in slots above the new capacity or of another genre. The UI offers a move plan.
- **Sorting (decision D4):** books are sorted by **genre only**: genres follow `sort_order` along the shelves, and each row holds one genre. Inside a genre, a copy simply takes the first free slot. **Don't build** any reorganize or alphabetical re-sort feature.

## 5. Search design

- `book_titles.search_text = normalize(title + ' ' + subtitle + ' ' + authors.join(' ') + ' ' + isbn13 + ' ' + isbn10)` using `packages/shared/normalize.ts`: lowercase, strip diacritics (NFKD), collapse whitespace, remove punctuation.
- Query (`q` normalized the same way):
  - If `parseScan(q)` gives a copy code → exact match on `copies.code`.
  - If it gives an ISBN → exact match on `isbn13`.
  - Otherwise `search_text ILIKE '%' || q || '%' OR similarity(search_text, q) > 0.25`, ordered by `similarity DESC` when `q` is present.
- The title list aggregates copies with the scope applied (central or stall):
  `available_count`, `min_price_minor`, `max_price_minor`, `conditions[]`.
- Sorting: `title_sort`, `author_sort`, `min_price_minor`, `created_at` (newest), `available_count`.
- Pagination: `page`, `pageSize` (≤ 100), and a `total` returned with each page.

## 6. Seed data (`pnpm db:seed`, idempotent)

1. **Admin user** from env `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`, with `must_change_password = true`.
2. **Genres** (code, colour, sort order) and starter keywords:

| Code | Name | Example keywords |
|---|---|---|
| FIC | Fiction (General & Literary) | fiction, novel, literary |
| CLS | Classics | classic, classics |
| MYS | Mystery & Thriller | mystery, detective, thriller, crime, suspense |
| ROM | Romance | romance, love stories |
| SFF | Sci-Fi & Fantasy | science fiction, fantasy, dystopia, magic |
| HOR | Horror | horror, ghost |
| YA  | Young Adult | young adult, teen |
| CHI | Children | juvenile, children, picture books |
| CMC | Comics & Graphic Novels | comics, graphic novels, manga |
| BIO | Biography & Memoir | biography, autobiography, memoir |
| HIS | History | history, historical |
| POL | Politics & Society | politics, sociology, social science |
| PHI | Philosophy | philosophy |
| REL | Religion & Spirituality | religion, spirituality, hinduism, buddhism |
| SLF | Self-Help & Personal Growth | self-help, motivation, success, psychology |
| BUS | Business & Economics | business, economics, management, finance |
| SCI | Science & Nature | science, physics, biology, nature |
| TEC | Technology & Computing | computers, programming, technology |
| ACA | Academic & Textbooks | textbooks, study guides, education |
| EXM | Competitive Exams | examinations, upsc, jee, neet, gate |
| HIN | Hindi & Regional Literature | hindi, marathi, bengali, tamil (also matched via language ≠ 'en') |
| POE | Poetry & Drama | poetry, drama, plays |
| CKG | Cooking & Lifestyle | cooking, recipes, health, fitness |
| TRV | Travel | travel, guidebooks |
| ART | Art & Photography | art, photography, design |
| REF | Reference & Dictionaries | dictionaries, encyclopedias, reference |
| OTH | Other | (fallback) |

3. **Sample racks/rows** (dev only, `NODE_ENV !== 'production'`): racks A–C, 5 rows each, capacity 40, rows assigned to genres in sort order, plus one overflow row `C05`.
4. **Settings** defaults:

```json
{
  "org.name": "Your NGO",
  "org.currency": "INR",
  "org.locale": "en-IN",
  "org.timezone": "Asia/Kolkata",
  "copy.codePrefix": "BK",
  "label.defaultTemplate": "THERMAL_50x25",
  "pricing.conditionPercent": {"NEW":60,"LIKE_NEW":50,"VERY_GOOD":40,"GOOD":35,"FAIR":25,"POOR":15},
  "pricing.roundToMinor": 1000,
  "sales.managerSeesWholeStall": false,
  "public.enabled": true,
  "public.fields": ["cover","title","authors","genre","condition","sellingPrice","originalPrice","summary","availability"],
  "stall.deactivateManagersOnClose": true,
  "session.autoLockMinutes": 30,
  "shelf.lowSpaceThresholdPercent": 90
}
```

5. **Dev-only demo data** (`pnpm db:seed:demo`): about 50 titles and 200 copies, 2 stalls, 1 manager per stall, about 30 sales. This is used by the e2e tests.

## 7. Database tests (M1 acceptance)

Run with Testcontainers Postgres:
- Inserting two copies into the same (row, slot) fails.
- An `AT_STALL` copy without `current_stall_id` fails, and vice versa.
- A `SOLD` copy with `row_id` set fails.
- A second open movement for the same copy fails.
- A second active assignment for the same user fails.
- Running the seed twice creates no duplicates.
- `drizzle-kit check` reports no drift.

## 8. Operations

- Back up with `pg_dump -Fc` nightly (see `05-DEPLOYMENT.md`).
- Migrations run automatically on deploy (`node dist/db/migrate.js`) **before** the new API version starts. Migrations must be backward-compatible with the previous app version (expand → migrate → contract).
- Retention: keep `audit_logs` forever (they're small). Purge `external_lookup_cache` rows older than 90 days with a weekly job.
