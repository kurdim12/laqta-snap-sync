# Phase 1 (code delivery) + Phase 3.2 (consent enforcement)

Built after Phase 0. Everything type-checks (`tsc`), builds, and the client
bundle was scanned to confirm **no Resend key / service-role symbols leak**.
**No production data modified; the migration is not applied.**

## Phase 3.2 — consent enforcement

- Registration now **cannot be submitted without consent**: `validate()` in
  `src/routes/e.$slug.tsx` adds an `__consent` error and the checkbox shows it;
  ticking it clears the error.
- **`consent_at`** is stamped at submit time (`new Date().toISOString()`), rides
  through the offline outbox payload (`src/lib/outbox.ts`), and is written on the
  guest insert — so it reflects the real moment of consent even if the row syncs
  much later. Migration `20260702130000_consent_and_delivery.sql` adds the column.

## Phase 1 — Resend code delivery (behind a provider interface)

- **Provider abstraction** (`src/lib/delivery/types.ts`): `DeliveryProvider.send`
  + `DeliveryChannel = email | sms | whatsapp`, so Twilio/WhatsApp slot in later.
- **Resend impl** (`src/lib/delivery/resend.ts`): `fetch` to the Resend API (no
  SDK dep; works on Cloudflare Workers). Reads `RESEND_API_KEY` / `RESEND_FROM`
  at request time. **If the key is unset the send is recorded as `queued`** — the
  whole flow is wired and goes live the moment the key + a verified sender domain
  are configured.
- **Bilingual email** (`src/lib/delivery/templates.ts`, pure + unit-tested):
  AR + EN, prominent code, direct `/g/CODE` link, embedded local QR. Event name
  is HTML-escaped.
- **Server fn** (`src/lib/delivery.functions.ts`) `sendGuestCodeEmail`: rate
  limited (20/min/IP on the platform IP), looks the guest up by code, extracts
  the email from `form_data` via the event's `email` field, composes, sends,
  and **idempotently** records a `deliveries` row (one `sent` email per guest
  unless `force`). The gallery link origin comes from `APP_ORIGIN` (or the
  request), never a client-supplied value.
- **Trigger**: fired best-effort from the outbox after the guest row (and any
  selfie) syncs — offline-safe, non-blocking; the on-screen code/QR is unchanged.
- **Admin** (`src/routes/admin.tsx` `GuestDetail`): per-guest delivery-status
  badge + "Resend code email" button (`force`).

## Verification evidence

- `tsc --noEmit` and `bun run build`: pass.
- Client bundle scan: no `RESEND_API_KEY` / `api.resend.com` / `resendSend` /
  service-role symbols (dynamic import of `resend.ts` tree-shakes correctly).
- Unit tests (pass): `extractEmail` (found / none / invalid / fallback key),
  `codeEmail` (bilingual subject, code, link, embedded QR data URL, HTML-escaped
  name, text part), `resendSend` with no key → `queued`, no throw, no network.

## Adversarial review outcome (2 lenses) + fixes

- **HIGH — anon email-bomb via `force`:** `force` was honored on the unauthed
  server fn, and codes are public (in `/g/CODE` links). **Fixed** by splitting
  the API: `sendGuestCodeEmail` (anon, outbox) is always idempotent — no resend;
  `adminResendGuestCode` verifies the caller's Supabase session is an admin
  (`auth.getUser(token)` + `has_role`) before forcing a resend.
- **MEDIUM — NAT'd venue drops emails:** the throttle now runs only for real
  sends, is raised to 300/min/IP, and records a visible `queued` delivery row
  on overflow instead of silently dropping.
- **MEDIUM — `appOrigin` Host-header fallback:** largely defanged by the fix
  above (no anon resend). Tightened to https-only; `APP_ORIGIN` documented as
  the production requirement.
- **LOW — consent was client-only:** added a **DB-level** guarantee — migration
  `20260702131500_enforce_consent_on_insert.sql` makes the anon guests INSERT
  policy require `consent IS TRUE`, so a stale/replayed insert can't persist a
  non-consented registration.
- **LOW — select-then-insert idempotency race:** documented; a partial unique
  index on `deliveries(guest_id, channel)` is the race-proof follow-up.

## Config needed to go live (runtime env — not required to build/deploy)

- `RESEND_API_KEY` — Resend API key.
- `RESEND_FROM` — verified sender, e.g. `LAQTA <noreply@yourdomain>`.
- `APP_ORIGIN` — canonical site origin for gallery links (recommended; prevents
  link spoofing and works regardless of proxy headers).

## Not verifiable here / follow-ups

- **Live email receipt** can't be verified without `RESEND_API_KEY` + a verified
  domain + outbound network to Resend. The send path, status recording, and
  idempotency are wired and unit-tested; a real send is a 1-line env change.
- Language preference isn't persisted, so the email includes **both** languages
  (AR + EN). Persisting the guest's chosen `lang` is a small follow-up.
- A DB unique index on `deliveries(guest_id, channel)` would make idempotency
  race-proof; omitted here to keep the migration purely additive (handled in the
  server fn instead).
