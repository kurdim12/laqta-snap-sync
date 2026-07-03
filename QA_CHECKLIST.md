# QA Checklist — branch `claude/project-evaluation-rk20rc`

Each item: **what changed → how to test → expected**. Items are grouped by what
setup they need, so you can start with the zero-setup ones.

> Nothing here has been applied to production. Migrations are files in
> `supabase/migrations/`; you apply them yourself (Tier B below).

---

## Setup

```bash
git fetch origin && git checkout claude/project-evaluation-rk20rc
bun install
bun run dev            # http://127.0.0.1:8080  (or 8080 per your setup)
```

---

## Tier A — testable now, no DB/keys needed

### A1. Automated suite (fastest confidence)

```bash
bunx tsc --noEmit      # 0 errors
bun run test           # 14 unit tests pass
bun run lint           # 0 errors (warnings ok)
bun run format:check   # clean
bun run build          # succeeds
```

### A2. Local QR (no more third-party leak)

- **Changed:** QR was fetched from `api.qrserver.com` (leaked private `/g/CODE`
  links). Now generated locally (`src/components/QrCode.tsx`).
- **Test:** open the registration success screen, the admin QR dialog, and the
  QR print sheet. Open browser DevTools → Network.
- **Expect:** QR renders; **no** request to `api.qrserver.com` (the `<img>` is a
  `data:image/png…` URL).

### A3. Security headers

- **Changed:** every response now carries CSP + hardening headers
  (`src/lib/security-headers.ts`, wired in `src/server.ts`).
- **Test:** `curl -sS -D - -o /dev/null http://127.0.0.1:8080/ | grep -i security`
  (or DevTools → Network → any document → Response Headers).
- **Expect:** `Content-Security-Policy`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and
  `Permissions-Policy: camera=(self)…`. The app must still look/work normally
  (fonts load, selfie camera works — `camera=(self)` allows it).

### A4. Consent is required to register

- **Changed:** the guest form now blocks submit until the consent box is ticked,
  and stamps `consent_at` (`src/routes/e.$slug.tsx`).
- **Test:** go to `/e/demo`, fill the form, leave consent **unchecked**, submit.
  Then tick it and submit.
- **Expect:** unchecked → inline error, no submission. Checked → submits normally.

### A5. HEIC photos (iPhone)

- **Changed:** HEIC/HEIF is converted to JPEG before the resize step
  (`src/lib/media.ts`), so iPhone photos get thumbnails instead of failing.
- **Test:** as staff (`/staff/<slug>`) or admin, upload a real `.heic` file.
- **Expect:** it uploads and shows a thumbnail (previously HEIC produced no
  web/thumb variant). Unsupported types (e.g. `.gif`) now get a clear "unsupported
  type" alert instead of silently retrying 5×.

---

## Tier B — needs the migrations applied (local Supabase or a branch)

Apply first:

```bash
supabase start
supabase db reset          # applies everything in supabase/migrations/
```

Then run the security harness (proves the RLS changes):

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
  node scripts/rls-check.mjs --allow-writes
```

- **Expect:** **all checks PASS**, including "anon storage upload denied".
  (Against production _today_, the two revoke checks FAIL — that's the before
  state the migrations fix.)

Individual behaviors to spot-check (need `SUPABASE_SERVICE_ROLE_KEY` set for the
app so server functions run):

### B1. Anon can't write storage anymore

- **Test:** with the local anon key, try `supabase.storage.from('media').upload(...)`.
- **Expect:** permission denied. Staff/guest uploads still work (they go through
  server-minted signed URLs). Admin uploads still work (admin policy).

### B2. Gallery loading is server-signed + rate limited

- **Test:** open `/g/<a real code>`; the photos load. Hammer `get_code_gallery`
  directly with the anon key.
- **Expect:** gallery works; direct anon `get_code_gallery` / `admin_exists`
  calls are **rejected** (revoked); repeated wrong codes from one IP get throttled.

### B3. Consent enforced at the DB

- **Test:** try to insert a guest row with `consent=false` via the anon REST API.
- **Expect:** rejected by RLS (`consent IS TRUE` required).

### B4. Storage orphan sweep

- **Test:** admin → open an event's Photos → "Sweep orphans". (Optionally seed a
  stray file under the event folder first.)
- **Expect:** dry-run reports orphan count; confirm deletes them; linked
  photos/selfies are untouched.

### B5. Album rename keeps other metadata

- **Test:** put photos in an album, add other `meta` (if any), rename the album.
- **Expect:** album name changes; other `meta` keys survive (this was the bug).

---

## Tier C — needs external keys

### C1. Email delivery (Resend)

- **Setup:** set `RESEND_API_KEY`, `RESEND_FROM` (verified sender), `APP_ORIGIN`.
- **Test:** register with an email field filled → check the inbox. In admin →
  guest detail, use "Resend code email".
- **Expect:** bilingual email with the code, a working `/g/CODE` link, and a QR;
  a `deliveries` row shows `sent`. **Without** the key, it records `queued` and
  nothing breaks. Registering **without** an email behaves exactly as before.
- **Security to verify:** the anon path can't force a resend (no email-bomb);
  only the admin "resend" (session-verified) can re-send.

### C2. Face-match / AI portraits (Phases 5–7)

- **Not testable yet** — scaffolding only (`supabase/drafts/`, `src/lib/face`,
  `src/lib/ai`, `services/face-worker`). Needs the InsightFace worker, pgvector,
  and `OPENROUTER_API_KEY`. See `PHASE5-7_NOTES.md`.

---

## Commit-by-commit (for diff review)

| Commit    | Scope                                                                      |
| --------- | -------------------------------------------------------------------------- |
| `a4999ee` | Phase 0 — lock anon storage writes, local QR, headers                      |
| `aeb1b2f` | Phase 0 review fixes (video posters, code sanitize, IP source, staff MIME) |
| `4524cf4` | Phase 1 delivery + Phase 3.2 consent                                       |
| `c25885a` | Phase 1/3.2 review fixes (admin-only resend, consent RLS, throttle)        |
| `99d60fd` | Phase 2 media + 3.1 album-rename bug                                       |
| `b3a22f9` | Phase 4 — tests, CI, README, e2e scaffold                                  |
| `42c69a7` | Phases 5–7 scaffolding                                                     |
| `7d9e087` | Prettier format pass (isolated)                                            |

## Known limitations verified in QA

- Live email receipt, signed-upload runtime, and RLS enforcement can't be tested
  without the service-role key + applied migrations (env-gated, not defects).
- Keyset pagination (3.3), bcrypt PIN (0.3), approved-only read (0.4.1), and video
  transcoding (2.2) are deferred — see the phase notes.
