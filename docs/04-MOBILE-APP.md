# 04 — Mobile App Plan (Expo / React Native)

> Prerequisites: `00-OVERVIEW.md`, `02-BACKEND.md`, `03-FRONTEND-WEB.md` (the mobile app mirrors the web features and reuses `packages/shared` + `packages/api-client`).
> Location: `apps/mobile`. **Android only** (decision D12). Don't add iOS configuration or builds. iPhone users use the web PWA.
> The phone camera is the barcode scanner, so no extra hardware is needed.

---

## 1. Stack

| Concern | Library |
|---|---|
| Framework | Expo (latest SDK), **Expo Router** (file-based navigation), TypeScript strict |
| UI | React Native Paper (Material 3) + `react-native-safe-area-context` |
| Server state | TanStack Query via `packages/api-client` (`platform: 'mobile'`) |
| Forms | react-hook-form + zod (shared schemas) |
| Barcode/QR scanning | `expo-camera` `CameraView` with `barcodeScannerSettings: { barcodeTypes: ['qr','ean13','code128'] }` |
| Secure token storage | `expo-secure-store` (refresh token), access token held in memory |
| Printing / sharing PDFs | `expo-file-system` (download) + `expo-print` (`printAsync({uri})`) + `expo-sharing` |
| File upload (bulk import, cover photo) | `expo-document-picker`, `expo-image-picker` (camera photo of a cover) + `expo-image-manipulator` (resize before upload) |
| Feedback | `expo-haptics`, `expo-audio` (beep) |
| Realtime | `socket.io-client` (works in RN) |
| Deep links | Expo Router + Android App Links for `https://<domain>/b/:code` |
| i18n | `i18next` + `expo-localization` |
| Updates | `expo-updates` (EAS Update, free tier) for over-the-air JS fixes |
| Tests | Jest + React Native Testing Library; optional Maestro flows for e2e |

Monorepo notes: `.npmrc` must contain `node-linker=hoisted`. Recent Expo SDKs configure Metro for monorepos automatically; check the Expo monorepo guide for the SDK in use. Import shared packages as source (TypeScript) and let Metro transpile them.

## 2. Configuration

- `app.config.ts` reads `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_APP_URL` per EAS build profile (`development`, `preview`, `production`).
- Android: `package: org.<ngo>.bookstall`, camera permission text "Used to scan book QR codes and ISBN barcodes", `intentFilters` for `https://<domain>/b/*` with `autoVerify: true`. The server must serve `/.well-known/assetlinks.json` (see 05).
- Allow cleartext HTTP **only** in development builds (LAN API).

## 3. Navigation map (Expo Router)

```
app/
├─ _layout.tsx                 # providers: Paper theme, QueryClient, Auth, Realtime, i18n
├─ (auth)/login.tsx
├─ (auth)/change-password.tsx
├─ (app)/_layout.tsx           # bottom tabs, permission-aware
│  ├─ index.tsx                # Home / dashboard (role-specific)
│  ├─ scan.tsx                 # big Scan tab (center button)
│  ├─ inventory/index.tsx      # search & browse (scoped for manager → "My stall")
│  ├─ inventory/[titleId].tsx  # title details + copy groups
│  ├─ copies/[code].tsx        # copy details + actions (scan target, deep-link target)
│  ├─ add/index.tsx            # add book flow
│  ├─ cart.tsx                 # current sale cart
│  ├─ sales/index.tsx          # sales list + live totals (admin) / my sales (manager)
│  ├─ sales/[id].tsx
│  ├─ stalls/index.tsx, stalls/new.tsx, stalls/[id]/(overview|checkout|checkin|reconcile).tsx
│  ├─ labels.tsx               # print queue
│  ├─ imports/index.tsx, imports/[id].tsx
│  ├─ shelves/index.tsx        # occupancy map (read), row details
│  ├─ users/index.tsx, users/[id].tsx
│  ├─ settings.tsx
│  └─ more.tsx                 # menu for the less-used screens
└─ b/[code].tsx                # deep-link handler → redirects to copies/[code] (or login first)
```

Bottom tabs per role:
- **Admin / Staff:** Home · Inventory · **Scan** · Add · More (Stalls, Sales, Labels, Imports, Shelves, Users, Settings)
- **Stall manager:** Home · My stall · **Scan** · Cart · Sales

## 4. Scanner (core of the mobile UX)

`<Scanner mode onScan />` component built on `CameraView`:
- Full-screen camera with a viewfinder overlay, torch toggle, zoom slider, and a manual code entry button (for damaged labels).
- Permission flow: explain → request → if denied, show a settings deep link.
- **Debounce:** ignore the same value within 2 s, and pause briefly (300 ms) after each accepted scan.
- Feedback: haptic `success` + beep on accept; haptic `error` + red flash on reject.
- Uses `parseScan()` from shared and the same `handleScan(raw, context)` logic as the web (move it into `packages/api-client/scan-handler.ts` so both apps share it).

**Scan tab modes** (segmented control at the top, mirroring the web scan station):

| Mode | Behaviour |
|---|---|
| **Lookup** (default) | Scan → bottom sheet with the copy summary + action buttons from `actions[]` (Sell / Add to cart / Check out / Check in / Print label) → tap to open the full copy screen. An ISBN scan → "View copies" or "Add new copy". |
| **Sell** | Continuous: every scan adds to the cart, and a sticky footer shows "N books · ₹X → Checkout". |
| **Check out** | Choose a stall first (sheet), then continuous scanning adds to a list → "Confirm checkout". The result screen offers to share or print the pick list. |
| **Check in** | Continuous: each scan checks in immediately. The full-screen result says **"Put back at FIC-A03-017"** (large, high contrast) plus "from {Stall}", and a running count. |
| **Add book** | Scan the book's **ISBN barcode** → opens the Add flow with the lookup done. |
| **Labels** | Collect codes → print or share the label PDF. |

Managers only see the Lookup and Sell modes. Copies not at their stall show "This book isn't at your stall".

## 5. Screens (functional parity with web; layouts adapted for mobile)

- **Login / change password:** same rules as the web. "Remember username" option.
- **Home:** role-specific cards like the web dashboard. Manager: stall name, books at the stall, today's sales, and a big **Scan to sell** button.
- **Inventory:** search bar with debounce, a filter sheet (genre, condition, price, status/stall for admin), a sort menu, an infinite-scroll list (`useInfiniteQuery` over the paginated API), and a titles/copies toggle. In the copies view, long-press starts multi-select → actions: Check out, Add to cart, Print labels.
- **Title details:** cover, metadata, summary (expandable), copy-group list with quantity and actions (Sell: confirm the copy by scanning its sticker, or pick from the list; Check out by quantity).
- **Copy details:** all fields required by the brief (name, author, condition, selling price, original price, genre, summary, **row/slot location**, status, current stall banner, sale info) + action bar.
- **Add book:** step 1 scan ISBN / type ISBN / search title → step 2 details (prefilled; genre suggestion; cover from online or **take a photo**) → step 3 copy fields (condition, MRP, selling price with suggestion chip, quantity, donor, notes) → submit → success sheet with the location(s), **Print labels** (download PDF → `Print.printAsync`) or **Share PDF**, and "Add another".
- **Cart / sell:** items, total, payment method buttons, optional customer → confirm → receipt screen (Share receipt PDF or text via the share sheet, e.g. to WhatsApp).
- **Sales:** admin gets live totals cards (per stall + Admin + grand total) via realtime, plus the list and filters. Manager sees only their own sales and totals. Details screen; void (admin) with a reason.
- **Stalls (admin):** list, create (with manager credentials shown once + share slip), edit, activate, assign/reset manager, checkout (scan or by quantity), check-in, reconcile and close, delete.
- **Labels queue, Bulk import** (pick an .xlsx file → upload → progress → preview list with error rows → commit → print labels), **Shelves** (map in read mode; row details), **Users**, **Settings** (a subset, read-only for complex sections, with a link to the web for shelf configuration if needed).

## 6. Auth & session on mobile

- Login sends `client: 'mobile'` and stores the refresh token in `SecureStore` (`keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- App start: read the refresh token → `/auth/refresh` → navigate to the app or to login.
- Optional **app lock** after N minutes in the background (reuses the device PIN/biometric via `expo-local-authentication`). Recommended on shared stall phones.
- Logout clears SecureStore and the query cache and disconnects the socket.
- When the app returns to the foreground: reconnect the socket and refetch active queries (TanStack `focusManager` + `AppState`).

## 7. Network resilience (offline selling is out of scope, D13)

- Detect connectivity (`@react-native-community/netinfo`) and show an offline banner. Disable mutations while offline with the message "No internet; the sale can't be recorded right now."
- Retry mutations with the **same `clientRef`** (idempotent API), so a timeout never double-sells.
- Don't build a local sales queue or a local database.

## 8. Printing from mobile

- Labels and receipts are PDFs from the API. Download to the cache dir with the auth header (`FileSystem.downloadAsync(url, path, {headers})`), then `Print.printAsync({ uri })` (Android print service) or `Sharing.shareAsync(path)`.
- Bluetooth thermal label printers usually come with an Android print-service plugin, so the same PDF path works. Direct Bluetooth ESC/POS/TSPL printing isn't part of this build.

## 9. Build & distribution

- **EAS Build** (free tier has a limited monthly build quota) or a local build (`npx expo run:android --variant release`) to avoid the quota.
  - `development`: a dev client for testing on devices.
  - `preview` / `production`: an **APK** for direct install by volunteers. This is the **recommended free distribution**: host the APK at `https://<domain>/app/bookstall.apk` and share a QR code to it. Volunteers allow "install unknown apps" once.
  - Optional later: an **AAB** for Google Play (one-time US$25 developer fee) if the NGO wants store updates.
- **EAS Update** for JS-only fixes, with channels `preview` and `production`. Bump `runtimeVersion` (policy `appVersion`) whenever native dependencies change.
- Versioning: `version` matches the web/API release tag; `android.versionCode` is auto-incremented by EAS (`autoIncrement: true`).
- CI: `.github/workflows/mobile.yml` runs lint, typecheck and tests on every PR, and `eas build --profile preview --platform android --non-interactive` on tags `mobile-v*` (needs an `EXPO_TOKEN` secret).

## 10. Tests

- Unit and component: Scanner debounce, `handleScan` routing per mode, cart totals, permission-based tabs, form validation.
- **Maestro** flows (optional, free CLI), run on an emulator against the staging API:
  1. Login as a manager → scan (inject a deep link `https://<domain>/b/BK0000001`) → sell → receipt.
  2. Admin: add a book via ISBN entry → success → share labels.
  3. Admin: check-in mode shows the return location.
- Manual device test checklist (record results in `docs/PROGRESS.md`): QR scan in low light with the torch, EAN-13 scan from a curved book back, a scan via the phone's native camera opening the app via App Links, printing to an Android print service, and rotation/small-screen layouts (360 × 640).

## 11. Mobile milestone checklist (M11)

- [ ] Expo app in the monorepo; shared packages resolve; dev build runs on Android
- [ ] Auth (SecureStore), role-aware tabs, change password, app lock
- [ ] Scanner component + Scan tab modes (lookup, sell, checkout, check-in, add, labels)
- [ ] Inventory search/browse + title/copy details + actions
- [ ] Add book flow (ISBN scan, lookup, cover photo, quantity) + label print/share
- [ ] Cart & sale + receipt share
- [ ] Sales (live totals for admin, own sales for manager), void
- [ ] Stalls (admin) incl. checkout/check-in/reconcile; labels queue; imports; shelves view; users; settings
- [ ] Deep links (`/b/:code`) verified with App Links
- [ ] Preview APK built and installed on a test device; manual checklist passed
