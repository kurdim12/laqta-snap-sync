# LAQTA · لقطة

Bilingual (Arabic/English) event photo & video delivery. An admin creates an
event; guests register at `/e/<slug>` (optionally with a selfie) and get a
private code + QR; they view their photos at `/g/<CODE>`; there's an optional
public wall, a PIN-gated staff upload console, and an admin dashboard.

## Stack

- **Frontend/SSR:** TanStack Start (React 19), Tailwind v4, shadcn/ui
- **Backend:** Supabase (Postgres + RLS, Storage, Auth)
- **Server logic:** TanStack `createServerFn` (service-role work stays server-only)
- **Hosting:** Cloudflare (Nitro), package manager **bun**

## Architecture

- **Guest registration** is offline-first: submissions queue in an IndexedDB
  outbox (`src/lib/outbox.ts`) and sync with backoff when back online.
- **Uploads** never use anon storage writes. Staff/guest uploads get short-lived
  **signed upload URLs** minted by server functions after auth
  (`src/lib/upload.functions.ts`); admins upload directly under an admin RLS
  policy. Bucket-level size/MIME limits are the server-side backstop.
- **Galleries** are signed **server-side** with the service role and rate limited
  (`src/lib/gallery.functions.ts`); the anon client never reads media tables
  directly for private galleries.
- **Delivery** (`src/lib/delivery*`) sends the code email via a provider
  interface (Resend today; SMS/WhatsApp can slot in).

## Environment variables

| Var                                                          | Where           | Purpose                                                    |
| ------------------------------------------------------------ | --------------- | ---------------------------------------------------------- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL`                         | client + server | Supabase project URL                                       |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | client + server | anon key                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | **server only** | service role for server functions                          |
| `APP_ORIGIN`                                                 | server          | canonical origin for links in outbound email (recommended) |
| `RESEND_API_KEY`                                             | server          | Resend key; without it, email is recorded `queued`         |
| `RESEND_FROM`                                                | server          | verified sender, e.g. `LAQTA <noreply@domain>`             |
| `MEDIA_PIPELINE`                                             | server          | `off` (default) or `cloudflare-stream` (deferred)          |

Never expose `SUPABASE_SERVICE_ROLE_KEY` / `RESEND_API_KEY` to the client — they
are only read inside server-function handlers (verified by a bundle scan).

## Local development

```bash
bun install
bun run dev          # http://127.0.0.1:8080

# database (needs Docker + Supabase CLI)
supabase start
supabase db reset    # applies everything in supabase/migrations/

# checks
bunx tsc --noEmit
bun run test         # vitest unit tests
bun run build
bun run format:check
```

## Migrations

- One additive, reversible SQL file per change in `supabase/migrations/`
  (`YYYYMMDDHHMMSS_name.sql`). Never edit an applied migration — add a new one.
- Drafts not yet ready to apply live in `supabase/drafts/`.
- After applying, verify the anon security posture:
  ```bash
  SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local> \
    node scripts/rls-check.mjs --allow-writes
  ```

## Testing

- **Unit** (`bun run test`, Vitest): pure logic — codes, security headers, email
  templates, provider fallback.
- **RLS** (`scripts/rls-check.mjs`): anon-client probes of the security posture;
  run against a local/branch instance (write-probe is guarded off for non-local).
- **E2E** (`e2e/`, Playwright): guest-facing smoke; needs a running app + backend
  (`bun add -D @playwright/test && bunx playwright test`).

CI (`.github/workflows/ci.yml`) runs typecheck, format check, unit tests, and
build on every push.

## Security posture (after Phase 0)

- No anon writes to storage; uploads go through authorized signed URLs.
- Private galleries + downloads signed server-side, rate limited.
- Staff PIN lockout; `get_code_gallery` / `admin_exists` not anon-callable.
- CSP + security headers on every response (`src/lib/security-headers.ts`).
- Consent enforced client-side **and** at the DB (guests INSERT requires consent).

See `PHASE0_NOTES.md`, `PHASE1_NOTES.md`, `PHASE2_NOTES.md` for details and the
`supabase/drafts/` items still pending verification.

## Roadmap status

- **Done (this branch):** security hardening (Phase 0), code delivery (Phase 1),
  consent (3.2), album-rename fix (3.1), HEIC + storage cleanup (Phase 2),
  tests/CI/docs (Phase 4).
- **Drafted / deferred:** bcrypt staff PIN + token (0.3), approved-only media
  read (0.4.1), keyset pagination (3.3), video transcoding (2.2).
- **Gated on infra + keys:** face-match auto-sort (Phase 5, InsightFace worker),
  autonomous pipeline (Phase 6), AI portraits (Phase 7, OpenRouter).
