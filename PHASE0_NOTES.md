# Phase 0 — Critical Security Hardening

Status of each Phase 0 item, how it was verified, and what remains. **No
production data was modified. No migrations were applied** — the SQL under
`supabase/migrations/` is ready to apply through your normal pipeline _after_
local verification; the SQL under `supabase/drafts/` is not yet ready.

## Environment note (why some items are "drafted, not applied")

This coding environment has **no Docker and no Supabase CLI**, so `supabase
start` / `supabase db reset` could not be run here. DB-side behavior (RLS,
revokes, bcrypt) therefore could **not be runtime-verified** in this session.
Everything below type-checks (`tsc`), builds (`bun run build`), and the
client/edge pieces were unit-verified. The SQL is designed to be verified by you
with the harness in a few minutes.

## Shipped & verified here

| Item                   | What                                                                                                                                                                                                                                                           | Verification                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0.4.2 Local QR         | `src/lib/qr.ts` + `src/components/QrCode.tsx`; replaced all 3 `api.qrserver.com` `<img>` uses (admin, guest success, QR sheet). Private `/g/CODE` links no longer leave the app.                                                                               | Unit test: `qrDataUrl()` returns a local `data:image/png` URL with no `http`. |
| 0.4.3 Security headers | `src/lib/security-headers.ts` applied in `src/server.ts` to every response: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (keeps `camera=(self)` for selfie capture). Dev-tolerant (ws/`unsafe-eval` only in dev). | Unit test asserts header values + prod/dev branches + body/status preserved.  |

## Implemented, type-checked, tree-shake-verified — apply + verify DB before deploy

| Item                        | Migration / code                                                                                                                                                                                                                                                                                         | Notes                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Drop anon storage write | `supabase/migrations/20260702120000_lock_storage_writes.sql` + `src/lib/upload.functions.ts` (`mintStaffUploadUrls`, `mintGuestSelfieUrl`) + rewired staff upload (`staff.$slug.tsx`) and guest selfie (`outbox.ts`) to **signed upload URLs**; bucket `file_size_limit` (200MB) + `allowed_mime_types`. | Admin uploads keep working via a new `media admins insert` policy. Confirmed the client bundle contains **no** service-role symbols/keys. |
| 0.2 Revoke anon RPCs        | `supabase/migrations/20260702120500_revoke_anon_rpcs.sql` + `checkAdminExists` server fn + `/g/CODE` rewired to `getGalleryByCode` / `getDownloadUrlsByCode` (rate-limited, service-role signing).                                                                                                       | `get_code_gallery` and `admin_exists` no longer anon-callable.                                                                            |

## How to verify (5 min, local)

```bash
supabase start
supabase db reset                     # applies all migrations incl. 20260702*
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<local anon key> \
node scripts/rls-check.mjs --allow-writes
```

Expected after applying: **all checks PASS**, including "anon storage upload
denied". Baseline (pre-migration, run read-only against any instance) shows the
two revoke checks FAILing and the write-probe skipped — this is what the
migrations close.

## Deferred — delivered as reviewed drafts + plan (do NOT apply blind)

- **0.3 Bcrypt PINs + per-IP lockout + session token** — `supabase/drafts/0.3_staff_pin_bcrypt_token.sql`. Deferred because it rewrites the **live** staff-login path and needs a new secret. Server-side token (mint on successful `_check_staff_pin_v2`, store in `sessionStorage` instead of the raw PIN):
  ```ts
  // requires env STAFF_TOKEN_SECRET (HMAC key), never shipped to client
  // token = base64url({slug,evId,exp}) + "." + HMAC_SHA256(payload, secret)
  // verifyStaffToken() gates mintStaffUploadUrls/staff_create_asset instead of _pin
  ```
  Admin UI should show the PIN **once** on create/regenerate rather than reading it back.
- **0.4.1 Approved-only media read** — `supabase/drafts/0.4.1_approved_only_media_read.sql`. Apply only after the public wall is moved to `getPublicGalleryBySlug` and staff selfies to `getStaffSelfieUrls` (`<SelfieAvatar signedUrl=…>`), else staff selfie thumbnails break.
- **Registration abuse control (0.2.4)** — add a honeypot field + move the guest insert behind a rate-limited server fn. Deferred to avoid destabilizing the **offline outbox** without runtime testing. Cloudflare Turnstile needs site/secret keys (not available here).

## Adversarial review outcome (4 parallel lenses)

The storage-lockdown lens came back clean. Findings fixed in this branch:

- **Video poster regression (fix):** `buildEnriched` (gallery.functions.ts) now
  includes the `poster` variant and leaves a posterless video's `thumbUrl`
  undefined, so `/g/CODE` video tiles fall back to a `<video>` frame instead of
  a broken `<img>` of the mp4.
- **`ilike` wildcard bypass (fix):** `mintGuestSelfieUrl` sanitizes the guest
  code (`[^A-Z0-9]` stripped) before the lookup — a `%` can no longer match an
  arbitrary code for a known guest id.
- **Spoofable rate-limit key (fix):** both server-fn `ipKey()`s now use the
  platform remote address (Cloudflare `cf-connecting-ip`) instead of the
  client-controllable `X-Forwarded-For`.
- **Staff MIME mismatch (fix):** the staff picker rejects types outside the
  server/bucket allowlist up front instead of failing after 5 retries.

Known, accepted limitations (documented, not blocking):

- **Client-reported size/MIME is advisory** for signed-URL uploads — the real
  server-side bound is the bucket `file_size_limit` (200 MB) + `allowed_mime_types`.
  A tighter per-object selfie cap would need post-upload verification or a
  dedicated selfie bucket (follow-up).
- **In-memory rate limits are per-instance.** A shared KV/DB limiter is the
  production-grade version (follow-up).

## Follow-up phases

Phases 1–4 (code delivery, media pipeline, correctness fixes, tests/CI) are
untouched. Recommended order once Phase 0 is verified & applied: 0.3 → 0.4.1 →
registration abuse → Phase 1.
