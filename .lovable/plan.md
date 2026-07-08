# LAQTA — System Improvement Roadmap

Below is a prioritized set of upgrades across design and functionality. Pick any subset (or all) to implement in follow-up turns. Nothing here is speculative — each item points at a real file / gap in the current codebase.

## 1. Design & Brand Polish

**Landing page (`/`)**
- Replace the single ambient gradient with a layered hero: animated gold grain, subtle parallax "لقطة" wordmark behind LAQTA, framer-motion staggered fade-in.
- Add a 3-tile "how it works" strip (Register → Snap → Instant gallery) in AR/EN.
- Featured event card (large hero cover pulled from first approved asset) for the most recent live event.
- Real footer with social + contact, replacing the tiny caption.

**Typography**
- Current stack (Inter + Cairo) is generic. Pair a distinctive display face (e.g. Fraunces / Instrument Serif for LAQTA wordmark) + keep Cairo for Arabic + Inter for UI. Add font weights we're actually using; drop the rest.

**Gallery UX (`/e/:slug/gallery`, `/g/:code`)**
- Masonry (CSS columns) instead of uniform grid so portraits/landscapes both breathe.
- Skeleton shimmer while signed URLs resolve (currently blank tiles).
- Lightbox: swipe gestures on mobile, keyboard arrows, share-sheet button, "download this one" per asset, prev/next preload.
- Album chips as sticky pill filter bar with counts.
- Empty state illustration + AR/EN copy instead of plain text.

**Admin console (`/admin`)**
- Left-rail nav (Events / Guests / Assets / Settings) instead of stacked sections.
- Event card grid with cover thumbnail, status pill, live guest count, "open QR sheet" quick action.
- Approval queue as a dedicated review view: keyboard shortcuts (A = approve, R = reject, ← → navigate), before/after side-by-side when a "web" variant exists.
- Bulk selection + bulk approve/reject/delete.
- Toast system (sonner) for all mutations; currently silent.

**Design tokens (`src/styles.css`)**
- Add `--gradient-primary`, `--gradient-hero`, `--shadow-elegant`, `--shadow-glow` tokens and use them via `bg-gradient-*` utilities so components stop hardcoding inline radial-gradients.
- Add semantic status colors (pending / approved / hidden) as tokens.

## 2. Functionality — Guest & Public Experience

- **Selfie face-match delivery** (already partially there via `selfie_path`): actually run embeddings so a guest sees only photos they're in, not the whole event. Use Lovable AI Gateway for embeddings + a simple cosine match server fn.
- **Share links per photo**: signed, time-boxed public URL with OG preview (currently only the whole gallery is shareable).
- **Download-all as ZIP** (config already exposes `allowDownloadAll` but no zipping endpoint). Stream from a server route in `/api/public/` with signed access.
- **PWA / add-to-home-screen**: manifest, service worker for offline gallery browsing after first load, "install app" prompt on `/g/CODE`.
- **Realtime updates**: subscribe to `assets` channel on gallery pages so new approved photos appear without refresh.
- **QR sheet print layout**: A4 + A5 print stylesheet with cut marks; currently sized for screen only.

## 3. Functionality — Staff & Admin

- **Staff PIN → bcrypt + session token** (draft SQL already sitting in `supabase/drafts/0.3_staff_pin_bcrypt_token.sql`). Ship it. Show PIN once on creation, stop reading it back in the admin UI.
- **Approved-only public reads** (`supabase/drafts/0.4.1_approved_only_media_read.sql`). Ship it once staff selfie thumbnails use `getStaffSelfieUrls`.
- **Curation workflow (built for Ey) upgrades**:
  - Side-by-side "raw vs edited" replace flow: admin uploads edited version → links to original as parent → toggle which one is public.
  - Watermark toggle per event (admin uploads clean; public gets watermarked web variant).
  - Scheduled publish (approve now, go public at time X).
- **Guest-to-photo tagging**: admin can drag guests onto photos so `/g/CODE` shows the right ones even without face-match.
- **Analytics per event**: views, unique visitors, downloads, top photos. Simple table + sparkline.
- **Multi-admin roles**: add `editor` and `viewer` to `app_role`; scope RLS accordingly so photographers can approve without full admin.

## 4. Media Pipeline

- Move client-side `resizeImage` to a server route that also produces AVIF + WebP + a low-quality blurhash for skeletons.
- Auto-generate video posters server-side (currently posterless videos fall back to `<video>` frame).
- EXIF strip on upload (privacy).
- Duplicate detection via perceptual hash so re-uploads of the same shot merge instead of stacking.

## 5. Reliability, Security & Ops

- **Shared rate limiter**: current in-memory `buckets` map in `src/lib/upload.functions.ts` is per-instance. Move to a Supabase table + `has_role`-gated cleanup, or Cloudflare KV.
- **Turnstile** on guest registration + gallery-code entry (honeypot alone is weak).
- **Audit log table**: who approved/deleted what, when, from which IP.
- **Error surface**: replace bare `console.error` with a small `reportError` helper that writes to an `errors` table for admin visibility.
- **E2E test suite** (Playwright): register → upload → approve → view flow, run in CI on every PR.
- **SEO on public event pages**: unique `head()` per event with cover image; currently every route reuses generic titles.

## 6. i18n & Accessibility

- Full RTL audit — several admin panels use `text-start` but flexbox order is still LTR; fix mirroring for Arabic.
- Add a language switcher visible on every route (currently only in some places).
- `prefers-reduced-motion` support for the framer animations we'll add.
- Alt text on every rendered asset (use `meta.caption` if present, else event name + index).
- Focus rings + skip-to-content link on all routes.

## 7. Suggested execution order

```text
Phase A (1 turn each)     Phase B (2–3 turns)         Phase C (bigger)
- Design tokens + polish  - Approval queue redesign   - Face-match delivery
- Landing hero            - Realtime gallery updates  - ZIP download route
- Gallery masonry+shimmer - Bcrypt PINs (0.3)         - PWA + service worker
- Toasts everywhere       - Approved-only reads (0.4) - Analytics dashboard
- Print QR sheet          - Turnstile + audit log     - Multi-admin roles
```

## Ask before I build

Which phase(s) do you want first? If you say "everything in Phase A", I'll ship those 5 in one pass. If you'd rather I pick, my recommendation is: **Phase A + approval-queue redesign** — biggest visible upgrade for you on Ey day without touching auth/DB risk surface.
