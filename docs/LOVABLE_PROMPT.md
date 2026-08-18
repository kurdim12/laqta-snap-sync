# LAQTA — wall consolidation, performance, and guest-booth fixes

Work through the sections **in order**. Sections 1–6 are required. Sections 7–8
are opt-in and each says what it costs. Do not batch them into one giant edit —
make each section its own change so a bad one can be reverted alone.

---

## HARD RULES — read before touching anything

**Already shipped on `main`. Do NOT redo, revert, or "improve" these:**

- `src/lib/vogue.functions.ts` → `getVogueWall` already filters
  `.or("consent.eq.true,published.eq.true")` plus `process_status = 'done'` and
  `status <> 'hidden'`. This is deliberate. Do not change it back to `.eq()`.
- `src/lib/gallery.functions.ts` → `getPublicGalleryBySlug` already has an
  opt-in `config.gallery.publishedOnly` block that filters rows to
  `consent === true || published === true` before signing. Keep it.
- `src/routes/admin.tsx` → `setOnWall` writes **only** `published`. It must
  never write `consent`. `consent` is the guest's legal record and only the
  guest may set it.
- `src/lib/types.ts` → `EventConfig.gallery.publishedOnly?: boolean` exists.

**Do not touch these files at all in sections 1–6:**

- `src/lib/photo-processing.server.ts`
- `src/lib/ai-template.server.ts`
- `src/routes/api/public/process-photo.ts`

**Do not:**
- run `npm install` / add any dependency
- reformat, re-prettier, or reorganise files you are not editing
- rename routes or delete any route file
- change any database schema, RLS policy, or migration
- "clean up" unrelated code you notice along the way

Keep every diff as small as the change requires. There is a live client event in
ten days.

---

## Background you need

The app has **three** pages that all get called "wall", and this has caused
real production confusion:

| URL | Route file | Server fn | Shows a photo when |
|---|---|---|---|
| `/e/{slug}/gallery` | `e.$slug.gallery.tsx` | `getPublicGalleryBySlug` | `status='ready'` AND `approved=true` — **plus** `consent OR published` when `config.gallery.publishedOnly` is set |
| `/wall/{slug}` | `wall.$slug.tsx` | `getWallBySlug` | `status='ready'`, `kind='photo'`, no parent, `approved != false` |
| `/event/{slug}/wall` | `event.$slug.wall.tsx` | `getVogueWall` | `process_status='done'` AND (`consent` OR `published`) AND `status<>'hidden'` |

Two different admin buttons drive two different columns:

- `✓` / `↩` → writes `approved` → governs `/e/{slug}/gallery` and `/wall/{slug}`
- `🖥` / `🖥✕` → writes `published` → governs `/event/{slug}/wall`, and now also
  `/e/{slug}/gallery` for events with `publishedOnly` set

The admin share rail currently labels `/e/{slug}/gallery` as **"Public wall"**
and `/wall/{slug}` as **"Live wall display"**, and never links
`/event/{slug}/wall` at all. That mislabelling is the single biggest source of
confusion. Section 1 fixes it.

---

## SECTION 1 — Make the admin share rail say what each link actually is

**File:** `src/routes/admin.tsx`

Find the quick-share rail (search for `{/* Quick-share rail */}`). It is
currently:

```tsx
<div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
  <CopyLink label="Guest form" url={formUrl} />
  <CopyLink label="Staff console" url={staffUrl} />
  <CopyLink label={ev.config.gallery?.mode === "public" ? "Public wall" : "Gallery (private)"} url={galleryUrl} disabled={ev.config.gallery?.mode !== "public"} />
  <CopyLink label="Live wall display" url={wallUrl} />
  <CopyLink label="Kiosk capture" url={kioskUrl} />
</div>
```

Replace the labels, and add the missing cover-wall link. Near the other url
consts (`formUrl`, `staffUrl`, `galleryUrl`, `wallUrl`, `kioskUrl` — around
line 282) add:

```ts
const coverWallUrl = `${origin}/event/${ev.slug}/wall`;
```

Then:

```tsx
<div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
  <CopyLink label="Guest form" url={formUrl} />
  <CopyLink label="Staff console" url={staffUrl} />
  <CopyLink
    label={ev.config.gallery?.mode === "public" ? "Guest gallery (browse + download)" : "Guest gallery (private)"}
    url={galleryUrl}
    disabled={ev.config.gallery?.mode !== "public"}
  />
  <CopyLink label="Venue screen — photo grid" url={wallUrl} />
  <CopyLink label="Venue screen — AI cover wall" url={coverWallUrl} />
  <CopyLink label="Kiosk capture" url={kioskUrl} />
</div>
```

Nothing else changes. Same URLs, honest names, and the cover wall is reachable
from admin for the first time.

**Also** update the two helper comments so they match reality.

Above `setApproved` (~line 1661) add:

```ts
// Gallery + venue-grid visibility. Writes `approved`, which
// getPublicGalleryBySlug and getWallBySlug filter on.
```

The comment above `setOnWall` is already correct — leave it.

---

## SECTION 2 — Sign storage URLs in one request instead of one per file

**Why:** every signed URL is a separate Cloudflare Worker subrequest.
`getPublicGalleryBySlug` selects up to 500 assets and signs both `storage_path`
and `processed_url` for each — up to 1000 subrequests for a single page load.
Workers cap subrequests per request, so this is both the main cause of slow
loads and a hard failure risk at a busy event. `createSignedUrls` (plural) does
the whole list in one request.

### 2a. `src/lib/gallery.functions.ts` — `signMany`

Replace the body of `signMany` (keep the exported shape identical):

```ts
async function signMany(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // One request for the whole list. The per-file loop this replaces spent one
  // Worker subrequest per file, which is the platform's scarcest budget here.
  const { data } = await supabaseAdmin.storage.from("media").createSignedUrls(paths, 3600);
  for (const row of data || []) {
    if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
}
```

Notes on the API, so you do not get this wrong:
- the result rows are `{ error, path, signedURL, signedUrl }` — use `signedUrl`
  (lowercase `rl`), and `path` can be `null`, so guard both
- `createSignedUrls` takes `(paths, expiresIn, options?)` and its options are
  only `{ download, cacheNonce }` — **there is no `transform` option**

### 2b. ⚠️ Leave `signManyDownload` EXACTLY as it is

It sits directly below `signMany` and looks like the same function, but it
passes a **different `download` filename per file**
(`${filenamePrefix}-${i + 1}.${ext}`). `createSignedUrls` accepts only one
`download` value for the entire batch, so batching it would give every
downloaded photo the same filename. Do not touch it.

### 2c. `src/lib/vogue.functions.ts` — `getVogueWall`

At the end of the handler, replace the per-row signing loop:

```ts
    const items: WallItem[] = [];
    await Promise.all(
      list.map(async (r) => {
        if (!r.processed_url) return;
        const { data: signed } = await supabaseAdmin.storage
          .from("media")
          .createSignedUrl(r.processed_url, 3600, { download: false });
        if (signed?.signedUrl) items.push({ id: r.id, url: signed.signedUrl, createdAt: r.created_at });
      }),
    );
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items };
```

with:

```ts
    const paths = list.map((r) => r.processed_url).filter((p): p is string => !!p);
    const signedByPath: Record<string, string> = {};
    if (paths.length) {
      const { data: signed } = await supabaseAdmin.storage
        .from("media")
        .createSignedUrls(paths, 3600);
      for (const row of signed || []) {
        if (row.path && row.signedUrl && !row.error) signedByPath[row.path] = row.signedUrl;
      }
    }
    const items: WallItem[] = list
      .filter((r) => !!r.processed_url && !!signedByPath[r.processed_url])
      .map((r) => ({ id: r.id, url: signedByPath[r.processed_url as string], createdAt: r.created_at }));
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items };
```

This wall polls every 8 seconds, so it was re-issuing one subrequest per cover
every 8 seconds forever. Now it issues one.

---

## SECTION 3 — Stop the admin buttons failing silently

**File:** `src/routes/admin.tsx`

`setApproved` and `setOnWall` both ignore the Supabase result. If RLS, a
network blip, or a permissions problem rejects the write, the button appears to
work, `load()` re-renders the old state, and the operator has no idea. This
already cost a debugging session.

Add error surfacing to both. `toast` is **already imported** in `admin.tsx`
(line 14, `import { toast } from "sonner"`) and already used further down the
file, and `<Toaster />` is already mounted in `src/routes/__root.tsx`. Do not
add an import and do not mount another Toaster — just call `toast.error`.

```ts
  async function setApproved(a: EnrichedAsset, approved: boolean) {
    const { error } = await supabase.from("assets").update({ approved }).eq("event_id", event.id).or(`id.eq.${a.id},parent_asset_id.eq.${a.id}`);
    if (error) { toast.error(`Could not update: ${error.message}`); return; }
    load();
  }

  async function setOnWall(a: EnrichedAsset, published: boolean) {
    const { error } = await supabase.from("assets").update({ published } as never).eq("id", a.id);
    if (error) { toast.error(`Could not update the wall: ${error.message}`); return; }
    load();
  }
```

Do not change what either function writes — only add the error check.

---

## SECTION 4 — Actually enforce the generation cap in the guest booth

**File:** `src/routes/event.$slug.index.tsx`

`getVogueEvent` already returns `capReached`, and `VogueEventInfo` already
declares it, but the UI never reads it. When the event's paid budget is spent,
a guest still gets the full "Create my cover" flow and only fails after posing
and uploading, with a raw "Generation cap reached" error.

Find the main gate (around line 194):

```tsx
{event && event !== "loading" && event.open && event.ready && (
```

Immediately **above** it, add a cap notice that matches the styling of the two
notices already there (`!event.open` and `!event.ready`):

```tsx
{event && event !== "loading" && event.open && event.ready && event.capReached && (
  <p className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5 text-center text-sm">
    We’ve created every cover for tonight. Thank you for coming by.
    <span className="mt-1 block font-arabic" dir="rtl">اكتمل عدد الأغلفة لهذه الليلة. شكراً لزيارتك</span>
  </p>
)}
```

and change the gate itself to exclude the capped state:

```tsx
{event && event !== "loading" && event.open && event.ready && !event.capReached && (
```

Bilingual copy is required — every other guest-facing string in this file has
an Arabic line with `dir="rtl"` and `className="font-arabic"`.

---

## SECTION 5 — Fix the guest's "Send to wall" button lying

**File:** `src/routes/event.$slug.index.tsx`

The consent checkbox defaults to **checked**, and its label promises "Show my
cover on the event wall". `registerVogueCover` writes that value to `consent`,
and the wall now shows anything with `consent = true`. So a guest who leaves
the box ticked is already on the wall — but the result screen initialises
`onWall` to `false` and shows them a **"Send to wall"** button for something
already sent.

In `submit()`, around line 131, change:

```ts
      setOnWall(false);
```

to:

```ts
      // The wall shows consent OR published, so a guest who left the consent
      // box ticked is already on it — the button must open in the "on" state.
      setOnWall(consent);
```

One line. The toggle itself already works correctly in both directions:
`publishVogueCover` writes `{ published: publish, consent: publish }`, so
switching it off genuinely removes the guest from the wall.

---

## SECTION 6 — Stop leaking raw provider errors to anonymous guests

**File:** `src/lib/vogue.functions.ts`

`getVogueCover` returns `error: row.error_message` straight to any anonymous
session holder. `error_message` deliberately stores the AI provider's response
verbatim and untruncated — model names, request shapes, policy-refusal text,
Zod validation dumps. That belongs in the admin Diagnostics panel, not on a
guest's phone.

Keep the database column exactly as it is. Sanitise only at this boundary.
Add above `getVogueCover`:

```ts
/** Map an internal failure to something a guest can act on. The raw provider
 *  message stays in the DB for the admin Diagnostics panel. */
function guestFacingError(raw: string | null): string | null {
  if (!raw) return null;
  if (/cap reached/i.test(raw)) return "We've created every cover for tonight.";
  if (/reference image/i.test(raw)) return "This station isn't set up yet — please ask a host.";
  if (/timed out|timeout|aborted/i.test(raw)) return "That took too long. Please try again.";
  return "We couldn't create your cover. Please try again.";
}
```

and in the returned object change `error: row.error_message` to:

```ts
      error: guestFacingError(row.error_message),
```

Do not change `photo-processing.server.ts`, which writes the raw value, and do
not change the admin Diagnostics panel, which reads it.

---

## SECTION 7 — OPTIONAL: image payload size (needs a decision, read first)

Every grid tile currently loads the **full-size** AI cover. There is no
thumbnail for AI-processed photos: `buildEnriched` sets
`thumbUrl = processed`, and `event.$slug.wall.tsx` renders `it.url` directly.
`processAssetById` writes exactly one file, `processed/{id}.jpg`.

**Do not try to generate thumbnails on the server.** This app builds for
Cloudflare Workers (nitro, cloudflare target) and `resizeImage` in
`src/lib/media.ts` is canvas-based and browser-only. There is no `sharp` and no
canvas in a Worker, so a server-side resize needs a new Worker-compatible image
dependency — out of scope before the event.

The two viable options, both needing a human decision:

- **Supabase image transformations.** `createSignedUrl` (singular) accepts
  `{ transform: { width, height, resize } }`. This is a **paid Supabase
  feature** — confirm the project's plan first. It also cannot be combined
  with the batching in Section 2, because `createSignedUrls` has no
  `transform` option, so it trades subrequests back for smaller images.
- **Smaller output at generation time.** `ai-template.server.ts` sends
  `output_compression: 85`. Dropping to `70` cuts bytes roughly a third with
  little visible loss on a wall. This is a one-value change but that file is
  frozen — a human must approve it and re-verify booth 1 afterwards.

**Do not implement either without explicit instruction.** Report which you
recommend and stop.

---

## SECTION 8 — OPTIONAL, FROZEN FILE: refund a generation when the AI fails

`processAssetById` consumes a paid generation slot **before** the provider
call and never returns it on failure, so every timeout or refusal permanently
burns budget.

This requires the `refund_generation(uuid)` RPC to exist in the database
first — it is defined in `supabase/drafts/2026-08-18_wall-consent-recovery.sql`
section 5 and may not have been applied yet. **Verify it exists before writing
any code that calls it.**

The change touches `src/lib/photo-processing.server.ts`, which is frozen. Only
do this if a human explicitly approves. The edit is one line in the `catch`
block, after the row is marked failed:

```ts
    await supabaseAdmin.rpc("refund_generation", { _event_id: asset.event_id });
```

If you do this, say clearly in your summary that a frozen file changed, so
booth 1 (staff capture → upload → process → gallery) gets re-tested.

---

## VERIFICATION — run before you report done

1. TypeScript compiles with no new errors.
2. You changed **only**: `src/routes/admin.tsx`,
   `src/lib/gallery.functions.ts`, `src/lib/vogue.functions.ts`,
   `src/routes/event.$slug.index.tsx`. If any other file appears in the diff,
   explain why.
3. `signManyDownload` is byte-for-byte unchanged.
4. `getVogueWall` still filters on `consent OR published`, `process_status`
   `'done'`, and `status <> 'hidden'`.
5. `setOnWall` still writes `published` and **never** `consent`.
6. The `publishedOnly` block in `getPublicGalleryBySlug` is still there.
7. No new dependency, no schema change, no migration.

Then report, per section: what you changed, what you skipped, and anything you
found that contradicts this brief.
