# Phase 2 (media) + Phase 3.1 (album rename bug)

Buildable pieces done + verified (`tsc`, `bun run build`, client bundle has no
service-role symbols). No production data modified.

## Phase 3.1 — album rename bug (fixed)
`renameAlbum` replaced the whole `meta` jsonb (dropping other keys). Now it
read-merges: fetch affected rows and rewrite only `meta.album`. (`admin.tsx`)

## Phase 2.1 — HEIC (done)
`src/lib/media.ts` `toDecodable()` converts HEIC/HEIF → JPEG via `heic2any`
(browser-only, dynamic import) before the canvas resize, so iPhone photos now
produce web/thumb variants instead of throwing. Wired into `resizeImage`, which
every upload path (staff, admin, guest selfie) uses.

## Phase 2.3 — storage cleanup (done)
- Deleting a guest now removes their selfie object (`admin.tsx deleteGuest`).
  (Deleting an asset already removed its variants + files.)
- New admin **orphan sweep** (`src/lib/storage.functions.ts adminSweepEventOrphans`,
  admin-session-verified): recursively lists an event's storage folder, deletes
  objects not referenced by any asset row or guest selfie. Also cleans anything
  left from before Phase 0.1 locked anon writes. Wired as a "Sweep orphans"
  button in the admin Photos panel (dry-run probe → confirm → delete).

## Phase 2.2 — video pipeline (flag + decision point)
`config.server.ts` exposes `mediaPipeline` (`MEDIA_PIPELINE` env): `"off"`
(default) keeps today's behavior — store original + client poster frame. The
`"cloudflare-stream"` path (transcode + adaptive playback) is the documented
decision point; it needs `CLOUDFLARE_STREAM_TOKEN` and a small integration, so
it's **deferred** (not wired) — ffmpeg-in-Workers is intentionally not attempted.
