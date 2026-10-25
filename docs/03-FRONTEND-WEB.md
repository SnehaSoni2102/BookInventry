# 03 — Web Frontend Plan (React + Vite)

> Prerequisites: `00-OVERVIEW.md`, and the API contracts in `02-BACKEND.md`.
> Location: `apps/web`, plus the shared packages `packages/shared` and `packages/api-client` (also used by mobile).
> Target users: admins and volunteers at a desktop or laptop with a **USB/Bluetooth hardware scanner** and a label printer. It also works on tablets and phones (responsive + installable PWA + camera scanning).

---

## 1. Stack

| Concern | Library |
|---|---|
| Build | Vite + React + TypeScript (strict) |
| UI kit | Mantine (core, form-free; `@mantine/notifications`, `@mantine/modals`, `@mantine/dates`, `@mantine/dropzone`, `@mantine/spotlight`) |
| Routing | React Router (data router, lazy routes) |
| Server state | TanStack Query (via `packages/api-client`) |
| Tables | TanStack Table (server-side pagination, sort and filter) |
| Forms | react-hook-form + zod resolver (schemas from `@bookstall/shared`) |
| Camera scanning | `@zxing/browser` (QR, EAN-13, Code128) |
| Realtime | `socket.io-client` |
| i18n | `i18next` + `react-i18next` (English now; keys ready for Hindi) |
| PWA | `vite-plugin-pwa` (installable, caches the app shell; no offline data writes). This is also the **iPhone option**, since there's no iOS app (D12): iPhone users "Add to Home Screen" and scan with the camera modal. |
| Icons | `@tabler/icons-react` |
| Tests | Vitest + React Testing Library + MSW; Playwright for e2e |

## 2. `packages/api-client` (shared by web and mobile)

- `createApiClient({ baseUrl, getAccessToken, onRefresh, platform: 'web'|'mobile' })`: a fetch wrapper that:
  - adds `Authorization: Bearer`;
  - on `401`, calls `/auth/refresh` **once** (single-flight promise) and retries; if that fails → `onLogout()`;
  - parses the error envelope into `ApiError {code, message, details, status}`;
  - validates responses with the shared zod schemas in dev builds only (for speed).
- Typed functions per endpoint: `api.titles.list(params)`, `api.sales.create(body)`, etc.
- TanStack Query hooks + **query-key factory** (`qk.titles.list(params)`, `qk.sales.summary(range)`, …). The realtime handler maps events to these keys (see 02 §6.9).
- `useRealtime(socketUrl, token)`: connects and invalidates keys on events.
- Mutations generate `clientRef = crypto.randomUUID()` **once per user action** and reuse it on retry.

## 3. App shell & navigation

- The layout has a left nav (collapsible; bottom tab bar under 768 px), a top bar with the **global scan box** (always visible), the user menu, and a live connection indicator (realtime socket status).
- The menu adapts to permissions (use `can()` from shared):

| Menu item | ADMIN | INV. STAFF | STALL MGR |
|---|:-:|:-:|:-:|
| Dashboard | ✅ | ✅ | ✅ (stall dashboard) |
| Scan station | ✅ | ✅ | ✅ |
| Add books | ✅ | ✅ | – |
| Inventory | ✅ | ✅ | "My stall" (scoped) |
| Stalls | ✅ | view only (for checkout/check-in) | – |
| Sales | ✅ all + live totals | – | my sales |
| Labels (print queue) | ✅ | ✅ | – |
| Bulk import | ✅ | – | – |
| Shelves & genres | ✅ | view map | – |
| Users | ✅ | – | – |
| Settings, Audit log | ✅ | – | – |

- Route guards: `<RequireAuth>`, `<RequirePermission perm="…">` (otherwise a 403 page). If `mustChangePassword` is set, users are forced to `/change-password`.
- Session: the access token is held **in memory**; the refresh token is an httpOnly cookie, and the app refreshes silently on load. Log out on `session.revoked`.
- Session safety for shared stall laptops: auto-lock after 30 min idle (setting), which returns to the login screen.

## 4. Scanning on the web

### 4.1 Hardware scanner (keyboard wedge) — `useHardwareScanner()`
- USB/BT scanners "type" the payload and press Enter. The hook listens on `window` `keydown` while **no editable element is focused** (or while the focused element is a `data-scan-target` input):
  - Buffer characters. If the gap between keys is under 35 ms and the buffer is at least 6 chars when Enter arrives → treat it as a scan, `preventDefault()`, and dispatch `onScan(buffer)`.
  - Reset the buffer after 100 ms with no keys.
- The **global scan box** in the top bar is also a normal text input (handy for typing a code or ISBN by hand). Pressing Enter submits it the same way.
- Document a recommended scanner setup in the README: suffix = Enter, keyboard layout = US, and disable "caps lock" mode.

### 4.2 Camera scanning — `<CameraScanModal>`
- `@zxing/browser` `BrowserMultiFormatReader` with formats QR_CODE, EAN_13, CODE_128. Prefers the rear camera (`facingMode: environment`), has a torch toggle when supported, and a continuous mode (see 4.4). It needs HTTPS (or localhost).

### 4.3 Scan handling — `handleScan(raw, context)`
1. `parseScan(raw)` (shared).
2. Copy code → `GET /scan/resolve` → behaviour depends on the **context**:
   - The default (global) context navigates to `/copies/:code`, which shows the action buttons returned by the API.
   - In a **mode** context (scan station, cart, checkout, check-in), the item goes into that mode's list without navigating.
3. ISBN → in the default context, go to `/books/new?isbn=…` (lookup prefilled; shows "Already in inventory: N copies" if it matches). In a sell or checkout context, show the copies of that title so the user can pick one (since ISBN doesn't identify a specific copy).
4. Unknown → toast "Not a recognised code".
5. Feedback: success beep (Web Audio, short) and a green flash; error buzz and a red flash.

### 4.4 Scan station page (`/scan`): the fastest way to work
Tabs (modes), each a continuous scan list with running totals:
- **Lookup:** shows the last scanned copy's full card.
- **Sell (cart):** adds copies to the cart; see §6.6.
- **Check out to stall:** choose a stall first (select box persisted in the URL), then each scan adds a copy to the list; "Confirm checkout (N books)" → pick-list PDF option.
- **Check in:** each scan checks the copy in **immediately** (API call per scan, idempotent). The row shows "Returned from {stall} → put back at **FIC-A03-017**" in large type. Running count per stall.
- **Print labels:** collects copies and prints them in one go.
- (P2) **Stock-take.**

Each item row has a remove (×) button. Duplicate scans within 2 s are ignored; later duplicates show "Already in list". Errors (e.g. a copy not available) are shown inline in red and left out of the batch.

## 5. Shared components

| Component | Purpose |
|---|---|
| `BookCover` | Thumbnail with genre-coloured placeholder initials if there's no cover |
| `ConditionBadge`, `StatusBadge`, `GenreChip` (colour from genre) | Consistent labels |
| `Money` | `formatMoney(minor)` from shared |
| `LocationCode` | Monospace bold `FIC-A03-017` with a tooltip ("Fiction · Rack A · Row 3 · Slot 17") |
| `CopyGroupTable` | Copy groups (condition × price × status/stall) with quantity; expands to show the individual copies (code, location, status). Has row actions: Sell, Check out, Print labels. |
| `CopyCard` | Full copy details + action bar driven by the `actions[]` from `/scan/resolve` or `/copies/:id` |
| `SellDialog` / `CartDrawer` | §6.6 |
| `CheckoutDialog` | Choose a stall + mode (selected copies, or quantity per group) → result list + pick list |
| `CheckinButton` | Confirms "Check in from {stall}?" → shows the return location |
| `LabelPrintDialog` | Template select (thermal / A4) + start position (A4) → opens the PDF in a new tab or iframe and calls `window.print()`; afterwards asks "Did all labels print correctly?" Yes → `mark-printed` |
| `DataTable` | TanStack Table + Mantine, with server pagination, sorting, column visibility and sticky header |
| `ConfirmModal` | Destructive or irreversible actions (void, delete stall, write-off) need a typed or explicit confirmation |
| `EmptyState`, `ErrorState`, `PageSkeleton` | |

## 6. Pages

### 6.1 `/login`, `/change-password`
Username and password; shows "Caps Lock is on"; handles `RATE_LIMITED`. Change password has a strength meter.

### 6.2 `/` Dashboard
- **Admin:** KPI cards (copies in stock, at stalls, unshelved, labels pending, today's revenue), a **live stall totals** strip (same component as Sales §6.9), shelf space alerts, recent sales, active stalls.
- **Inventory staff:** labels pending, unshelved, quick links (Add book, Scan station, Check in).
- **Stall manager:** stall name and status, books at the stall (count and value), my sales today (count and revenue), a big "Scan to sell" button.

### 6.3 `/books/new`: Add books (main data-entry flow)
Step layout on one page (no wizard reloads):
1. **Find the book:** a single input "Scan or type ISBN, or search by title/author". Scanning the book's EAN-13 barcode fills it automatically.
   - ISBN → `GET /catalog/lookup`. Title text → `GET /catalog/search` (shows a result list with covers, to choose one or "None of these, enter manually").
   - If **already in inventory**: a banner "Already in inventory: 4 copies (2 × Good ₹120, 2 × Fair ₹80)". The metadata section becomes read-only (with an "Edit title" link) and the form moves to step 3.
   - If **not found anywhere**: a banner "Not found online, please fill in the details" and the full manual form.
2. **Book details** (prefilled from the lookup and editable): title, subtitle, authors (tag input), publisher, year, language, pages, ISBN, **genre** (select, preselected with the suggestion and showing "Suggested from subjects: fiction, india"), summary (textarea, counter), and a cover preview with options to "Use this cover", "Upload photo" or "Remove".
3. **This copy:** condition (segmented control with tooltips describing each grade), condition notes, original price/MRP, **selling price (required)** with a "Suggested ₹140" chip (click to apply; never auto-filled silently), quantity (1–200), donor, notes.
4. **Submit** (`Ctrl+Enter`) → `POST /copies` → **success panel**: codes created, location(s) in large type ("Place at FIC-A03-017 … 019"), any `NO_SHELF_SPACE` warning, and buttons **Print labels now** (opens `LabelPrintDialog`) · **Add to print queue** · **Add another copy of this book** (keeps the metadata) · **Add a different book** (resets, focuses the find input).

Validation errors are shown inline. Unsaved changes trigger a prompt before leaving.

### 6.4 `/inventory`: Search & browse (central; for managers the same page is `/my-stall`)
- A top **search bar** (debounced 300 ms) with an icon; searches title, author, ISBN and copy code. An exact code or ISBN match jumps directly to the copy or title.
- Filters (collapsible drawer on mobile): genre (multi), condition (multi), price range, status (Available / At stalls / All) and stall (admin/staff). Filters are stored in **URL query params** so links can be shared and the back button works.
- Sort: Title A–Z/Z–A, Author, Price low→high / high→low (min available price), Newest, Quantity.
- **View toggle:**
  - *Titles view* (default): cards or rows with cover, title, author, genre chip, available qty, price range, condition badges.
  - *Copies view*: one row per physical copy (code, title, condition, price, location, status/stall), with **multi-select checkboxes** → bulk actions: **Check out to stall**, **Add to cart (sell)**, **Print labels**.
- Pagination: page size 25/50/100, with the total count.
- Clicking a title opens `/inventory/titles/:id`.
- The manager variant (`/my-stall`) uses the same component with `scope="stall"`: no stall or status filters, header "Books at {Stall name}: N books, ₹X value", and only the actions Sell and Print label.

### 6.5 `/inventory/titles/:id`: Title details
- Header: cover, title, subtitle, authors, genre chip, ISBN, publisher/year/pages/language, summary (expandable), source badge (Open Library / Google / Manual).
- **Copy groups table** (`CopyGroupTable`): e.g.

| Condition | Selling price | MRP | Status | Qty | Actions |
|---|---|---|---|---|---|
| Good | ₹120 | ₹399 | In stock | 2 | Sell · Check out · Labels |
| Fair | ₹80 | ₹399 | At *Diwali Mela* | 1 | Check in |

  Expanding a row shows each copy: code, location, status, created date; clicking a copy opens the copy page.
- **Sell from a group:** opens `SellDialog`, which preselects the first available copy in the group (lowest location) and shows **"Confirm the sticker code on the book: BK0000123"** with a field to scan or type the code to confirm or change it. This keeps the system accurate about which physical copy left the shelf.
- **Check out from a group:** choose a stall + quantity → checkout (by group) → pick list.
- Admin/staff: Edit title, Add copy, Relocate (if the genre changed). Audit history tab (admin).

### 6.6 `/copies/:code`: Copy details (the scan target)
- `CopyCard`: cover, title, author, **condition**, **selling price**, **original price**, genre, summary, **location code (big)**, status, and, if at a stall, a banner **"Checked out to {Stall} since {date} by {user}"**; if sold, "Sold on {date}, receipt R-000123 (link)".
- Action bar (from API `actions[]`): **Sell**, **Check out to stall**, **Check in** (shows the return location after success), Edit, Print label, Write off.
- Movement history and price history (from the audit log).

### 6.6a Selling: `SellDialog` and `CartDrawer`
- Selling one copy: a dialog with the copy summary, price (read-only for everyone except the admin, who can override it with an "Override price" toggle; D7), payment method (Cash/UPI/Card/Other, large buttons), optional customer name/phone → **Confirm sale** → a success screen with the receipt number and **Print receipt / Share** (Web Share API) / **New sale**.
- **Cart:** "Add to cart" from anywhere (scan station, copy page, copies view). A cart drawer with a badge in the top bar lists items with remove buttons, the total and the payment method → one `POST /sales`. The cart is kept in `sessionStorage` per user, and the server revalidates it on submit. If the server returns `COPY_NOT_AVAILABLE` for some codes, highlight them and let the user remove them and retry.
- Admin selling a copy that's at a stall: a confirmation "This book is at {Stall}. Record the sale as Admin @ {Stall}?"

### 6.7 `/stalls` (admin; staff read-only)
- List: name, dates, status, managers, books out, sold, revenue (live), with actions: Activate, Edit, Close, Delete.
- **Create stall** modal: name, location, dates, description, manager: (a) choose an existing manager, or (b) create a new one (username + display name). On success, show the credentials **once** with **Print credential slip** and **Copy** buttons. "Reset password" is available later on the stall and user pages.
- Delete: blocked with an explanation and a link to reconcile if books are still out.

### 6.8 `/stalls/:id`: Stall details
Tabs:
- **Overview:** status, managers (assign/unassign/reset password), live totals (books out, sold, revenue by payment method).
- **Inventory at stall:** the scoped inventory component.
- **Checkout:** scan or select copies, or "Add by quantity" (title search → group → qty) → confirm → pick list PDF. History of checkout batches, with a reprint link for each pick list.
- **Check in:** a dedicated scan list (same as the scan station check-in mode, with the stall preselected).
- **Sales:** this stall's sales.
- **Reconcile & close:** sent / sold / returned / still out (list) → scan the remaining returns → "Close stall" with the choice for the remaining books (mark as lost / keep open) → downloadable report PDF/XLSX.

### 6.9 `/sales`
- **Admin:** a **live consolidated totals** panel at the top: one card per active stall + **"Admin (central)"** + **Grand total**, showing revenue, books sold and a payment-method split. It updates in real time via `sale.created`, with a subtle highlight animation on the card that changed. Date range presets: Today / This stall period / Custom.
- The table below lists receipt no., time, **Sold at** (`soldAtLabel`: stall name, "Admin", or "Admin @ Stall"), seller, items, total, payment, and status. Filters: stall (including "Admin/central"), seller, date, payment method, status; search by receipt, copy code or title. Export XLSX.
- Sale details drawer: items, receipt PDF, and (admin) **Void sale**, which requires a reason and then shows the return locations and labels to print.
- **Stall manager:** the same page showing only their own sales, with their own totals (today / this stall).

### 6.10 `/labels`: Print queue
A list of copies needing labels (new or price changed), filterable by "created by me", import job and date. Select all → print → confirm → mark printed.

### 6.11 `/imports` (admin)
- **Download template** button; dropzone for the upload; job list with status.
- `/imports/:id`: a progress bar (realtime `import.updated` or polling every 2 s), then a **preview table** with row status filters (Valid / Warning / Error). Clicking a row edits its fields inline (revalidates that row) or skips it. A **Commit** button is disabled while errors remain (unless "skip error rows" is ticked) → progress → result: copies created, **Print all labels** (sorted by location) and **Download result file**.

### 6.12 `/shelves` (admin; staff view map only)
- **Occupancy map:** racks as columns, rows as bars coloured by genre with a fill %. Clicking a row shows its slots (a grid of numbered cells: filled / reserved-at-stall / empty).
- Manage racks and rows (add rack, bulk add rows, set capacity, assign genre, overflow flag).
- **Print row signs.**
- **Unshelved copies** list with a "Try placing now" button.
- `/genres`: list, colour picker, sort order (drag to reorder), keywords editor.

### 6.13 `/users` (admin)
List, create, edit role, deactivate, reset password (shows the password once + slip), and view a user's active stall.

### 6.14 `/settings`, `/audit`
Settings sections: Organisation (name, logo), Pricing (condition %, rounding), Sales (managers see whole stall), Stalls (deactivate managers on close), Labels (default template, show MRP on label), Public page (fields), Session (auto-lock minutes). The audit log is a filterable table with a JSON diff viewer.

### 6.15 `/b/:code`: Public or logged-in copy page (the QR target URL)
- **Not logged in:** a light public page (no app chrome): NGO logo/name, cover, title, author, genre, condition, price (MRP shown struck through next to our price), summary, availability. Also "Are you a volunteer? Log in". It must load fast (lazy-load everything else; no auth calls).
- **Logged in:** redirect to `/copies/:code` with full details and actions.
- The mobile app intercepts the same URL through app links (see 04).

## 7. UX & quality requirements

- **Keyboard first** on desktop: `/` focuses search, `Ctrl+K` opens the Spotlight command palette (go to page, find book), `Ctrl+Enter` submits forms, `Esc` closes dialogs.
- Touch targets ≥ 44 px; layouts work from 360 px wide.
- Accessibility: semantic HTML, labelled inputs, focus rings, colour is never the only signal (genre chips also show the code), WCAG AA contrast.
- Every list has loading, empty and error states. Mutations show optimistic feedback only where safe (not for sales).
- Errors are human-readable and mapped from `ApiError.code` (e.g. `COPY_NOT_AVAILABLE` → "This book was already sold or isn't available").
- Money is always formatted via shared `formatMoney`, and dates use the `org.timezone` setting.
- Performance: route-level code splitting; initial JS < 250 KB gzipped (excluding the camera scanner chunk, which is lazy-loaded).

## 8. Folder structure

```
apps/web/src/
├─ main.tsx, App.tsx, router.tsx
├─ app/ (providers: QueryClient, Mantine theme, i18n, auth, realtime, scanner)
├─ features/
│  ├─ auth/  dashboard/  catalog/ (add-book)  inventory/  copies/  scan/  cart/
│  ├─ stalls/  sales/  labels/  imports/  shelves/  genres/  users/  settings/  audit/  public/
│  └─ (each: pages/, components/, hooks/)
├─ components/ (shared UI listed in §5)
├─ lib/ (scanner hook, audio feedback, print helpers, format)
└─ locales/en/*.json
```

## 9. Tests

- Unit and component: scanner hook timing logic, `handleScan` routing per context, CartDrawer totals, permission-driven menu, form validation.
- **Playwright e2e** (against the API with the demo seed, external lookups mocked):
  1. Admin logs in → adds a book by ISBN → submits → label PDF opens → item appears in inventory search.
  2. Book not found → manual entry → created.
  3. Inventory search by author, sort by price, pagination.
  4. Admin creates a stall + manager → checks out 3 copies by quantity → pick list.
  5. Manager logs in → sees only the stall's books → sells 2 (cart) → admin's sales page totals update **without a reload** (realtime).
  6. Admin checks in the remaining copy via the scan station (simulated keyboard-wedge input) → sees the original location.
  7. Admin bulk import happy path.
  8. Public `/b/:code` hides internal fields.

## 10. Web milestone checklist (M10)

- [ ] Shell, auth, guards, theme, i18n, api-client, realtime provider
- [ ] Hardware scanner hook + global scan box + camera modal
- [ ] Add books flow (lookup, manual, quantity, success panel, label print)
- [ ] Inventory (titles/copies views, filters, sort, pagination, bulk actions) + My stall variant
- [ ] Title details, copy details, sell dialog, cart
- [ ] Scan station (lookup, sell, checkout, check-in, labels)
- [ ] Stalls list/details (create with manager credentials, checkout, check-in, reconcile, close)
- [ ] Sales (live totals, filters, details, void, export)
- [ ] Labels queue, Imports, Shelves/Genres, Users, Settings, Audit
- [ ] Public `/b/:code`
- [ ] PWA manifest + icons; Playwright suite green
