import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";

// In-memory rate limiter (per-worker). Good-enough basic abuse protection.
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

function ipKey(): string {
  try {
    // Use the platform-trusted remote address (e.g. Cloudflare's
    // cf-connecting-ip), NOT the client-spoofable X-Forwarded-For.
    return getRequestIP() || "anon";
  } catch {
    return "anon";
  }
}

interface AssetLite {
  id: string;
  event_id: string;
  guest_id: string | null;
  parent_asset_id: string | null;
  kind: "photo" | "video";
  variant: "original" | "web" | "thumb" | "poster";
  storage_path: string;
  content_type: string;
  bytes: number;
  status: string;
  meta: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  created_at: string;
  processed_url?: string | null;
  process_status?: string | null;
  error_message?: string | null;
  processing_started_at?: string | null;
  consent?: boolean;
  published?: boolean;
}


interface EventLite {
  id: string;
  slug: string;
  name: string;
  status: string;
  // JSONB — typed loose so TanStack's serializable check accepts it
  config: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  created_at: string;
  template_mode?: string | null;
  template_frame_url?: string | null;
}


async function signMany(paths: string[]): Promise<Record<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await supabaseAdmin.storage.from("media").createSignedUrl(p, 3600, {
        download: false,
      });
      if (data?.signedUrl) out[p] = data.signedUrl;
    }),
  );
  return out;
}

async function signManyDownload(paths: string[], filenamePrefix: string): Promise<Record<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p, i) => {
      const ext = p.split(".").pop() || "jpg";
      const { data } = await supabaseAdmin.storage.from("media").createSignedUrl(p, 3600, {
        download: `${filenamePrefix}-${i + 1}.${ext}`,
      });
      if (data?.signedUrl) out[p] = data.signedUrl;
    }),
  );
  return out;
}

function buildEnriched(rows: AssetLite[], urls: Record<string, string>) {
  const originals = rows.filter((r) => r.variant === "original");
  const webs = rows.filter((r) => r.variant === "web");
  // A video's thumbnail is its `poster` variant, not `thumb`. Mirror the
  // client-side enrich: include poster, and leave a posterless video's thumbUrl
  // undefined so the UI falls back to a <video> frame instead of an <img> of
  // the mp4 (which renders as a broken image).
  const thumbs = rows.filter((r) => r.variant === "thumb" || r.variant === "poster");
  const display = originals.length
    ? originals
    : webs.length
      ? webs
      : rows.filter((r) => r.variant !== "thumb" && r.variant !== "poster");
  return display.map((r) => {
    const isVideo = r.kind === "video";
    const web = webs.find((w) => w.parent_asset_id === r.id) || r;
    const thumb = thumbs.find((t) => t.parent_asset_id === r.id);
    const thumbAsset = thumb || (isVideo ? undefined : web);
    // When the event applies an AI template, the styled render replaces the
    // original everywhere the guest sees it.
    const processed = r.processed_url ? urls[r.processed_url] : undefined;
    return {
      ...r,
      url: processed || urls[web.storage_path],
      thumbUrl: processed || (thumbAsset ? urls[thumbAsset.storage_path] : undefined),
    };
  });
}

// ---------------- guest gallery by code ----------------
export const getGalleryByCode = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => ({
    // strip anything outside the code alphabet — ilike treats % and _ as wildcards
    code: String(d?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32),
  }))
  .handler(async ({ data }) => {
    if (!rateLimit(`gbc:${ipKey()}`, 30, 60_000)) {
      throw new Error("Too many requests");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: g } = await supabaseAdmin
      .from("guests")
      .select("id, event_id, code")
      .ilike("code", data.code)
      .maybeSingle();
    if (!g) return { notFound: true as const };

    const { sweepStaleProcessing } = await import("@/lib/photo-processing.server");
    await sweepStaleProcessing(g.event_id);

    const { data: e } = await supabaseAdmin
      .from("events")
      .select("id, slug, name, status, config, created_at, template_mode, template_frame_url")
      .eq("id", g.event_id)
      .maybeSingle();
    if (!e || (e.status !== "live" && e.status !== "dryrun")) {
      return { notFound: true as const };
    }

    const { data: aRows } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("guest_id", g.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false });

    const rows = (aRows || []) as AssetLite[];
    const paths = Array.from(
      new Set(rows.flatMap((r) => [r.storage_path, ...(r.processed_url ? [r.processed_url] : [])])),
    );
    const urls = await signMany(paths);

    return {
      notFound: false as const,
      guest: g as { id: string; event_id: string; code: string },
      event: e as EventLite,
      assets: buildEnriched(rows, urls),
    };
  });

// ---------------- public event gallery by slug ----------------
export const getPublicGalleryBySlug = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string }) => ({
    slug: String(d?.slug || "").slice(0, 128),
  }))
  .handler(async ({ data }) => {
    if (!rateLimit(`pgs:${ipKey()}`, 60, 60_000)) {
      throw new Error("Too many requests");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: e } = await supabaseAdmin
      .from("events")
      .select("id, slug, name, status, config, created_at, template_mode, template_frame_url")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!e || (e.status !== "live" && e.status !== "dryrun")) {
      return { notFound: true as const };
    }
    const cfg = (e.config || {}) as { gallery?: { mode?: string; publishedOnly?: boolean } };
    if (cfg.gallery?.mode !== "public") return { notFound: true as const };

    const { sweepStaleProcessing } = await import("@/lib/photo-processing.server");
    await sweepStaleProcessing(e.id);

    const { data: aRows } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("event_id", e.id)
      .eq("status", "ready")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(500);

    let rows = (aRows || []) as AssetLite[];
    // Opt-in per event via config.gallery.publishedOnly. When on, this public
    // wall mirrors the venue wall: a photo appears only once the guest
    // consented or an admin pressed "Show on wall". Variants (web/thumb) ride
    // along with their parent so thumbnails still resolve. Off by default, so
    // every other event's gallery keeps showing everything approved.
    if (cfg.gallery?.publishedOnly) {
      const onWall = new Set(
        rows.filter((r) => r.consent === true || r.published === true).map((r) => r.id),
      );
      rows = rows.filter(
        (r) => onWall.has(r.id) || (!!r.parent_asset_id && onWall.has(r.parent_asset_id)),
      );
    }
    const paths = Array.from(
      new Set(rows.flatMap((r) => [r.storage_path, ...(r.processed_url ? [r.processed_url] : [])])),
    );
    const urls = await signMany(paths);

    return {
      notFound: false as const,
      event: e as EventLite,
      assets: buildEnriched(rows, urls),
    };
  });

// ---------------- download URLs (Content-Disposition: attachment) ----------------
export const getDownloadUrlsByCode = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; prefix?: string }) => ({
    // strip anything outside the code alphabet — ilike treats % and _ as wildcards
    code: String(d?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32),
    prefix: String(d?.prefix || "laqta").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    if (!rateLimit(`dbc:${ipKey()}`, 10, 60_000)) {
      throw new Error("Too many requests");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: g } = await supabaseAdmin
      .from("guests")
      .select("id")
      .ilike("code", data.code)
      .maybeSingle();
    if (!g) return { urls: [] as string[] };

    const { data: aRows } = await supabaseAdmin
      .from("assets")
      .select("storage_path, variant, parent_asset_id, id")
      .eq("guest_id", g.id)
      .eq("status", "ready");
    const rows = (aRows || []) as { storage_path: string; variant: string; parent_asset_id: string | null; id: string }[];
    const originals = rows.filter((r) => r.variant === "original");
    const webs = rows.filter((r) => r.variant === "web");
    const display = originals.length ? originals : webs;
    const paths = display.map((r) => r.storage_path);
    const urlMap = await signManyDownload(paths, data.prefix);
    return { urls: paths.map((p) => urlMap[p]).filter(Boolean) };
  });

// ---------------- staff selfie URL (PIN gated) ----------------
export const getStaffSelfieUrls = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; pin: string; paths: string[] }) => ({
    slug: String(d?.slug || ""),
    pin: String(d?.pin || ""),
    paths: Array.isArray(d?.paths) ? d.paths.slice(0, 200).map((p) => String(p)) : [],
  }))
  .handler(async ({ data }) => {
    if (!rateLimit(`ssel:${ipKey()}`, 60, 60_000)) {
      throw new Error("Too many requests");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: evId } = await supabaseAdmin.rpc("verify_staff_pin", {
      _slug: data.slug,
      _pin: data.pin,
    });
    if (!evId) throw new Error("Unauthorized");
    const prefix = `${evId}/`;
    const safe = data.paths.filter((p) => p.startsWith(prefix));
    const urls = await signMany(safe);
    return { urls };
  });

// ---------------- public event lookups ----------------
// The `events_public` view is security_invoker, and `events` has no anon SELECT
// policy, so the anon client reads nothing from it. Public screens (guest form,
// staff console, landing list, public wall) go through these service-role
// server functions instead, which return only non-sensitive columns.
export const getPublicEventBySlug = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string }) => ({ slug: String(d?.slug || "").slice(0, 128) }))
  .handler(async ({ data }): Promise<{ event: EventLite | null }> => {
    if (!rateLimit(`pev:${ipKey()}`, 120, 60_000)) throw new Error("Too many requests");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: e } = await supabaseAdmin
      .from("events")
      .select("id, slug, name, status, config, created_at, template_mode, template_frame_url")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!e || (e.status !== "live" && e.status !== "dryrun")) return { event: null };
    return { event: e as EventLite };
  });

export const listPublicEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ events: { slug: string; name: string; status: string }[] }> => {
    if (!rateLimit(`plist:${ipKey()}`, 120, 60_000)) throw new Error("Too many requests");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("events")
      .select("slug, name, status")
      .in("status", ["live", "dryrun"])
      .order("created_at", { ascending: false });
    return { events: (data || []) as { slug: string; name: string; status: string }[] };
  },
);

// ---------------- venue wall display ----------------
export const getWallBySlug = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string }) => ({ slug: String(d?.slug || "").slice(0, 128) }))
  .handler(async ({ data }): Promise<{
    event: { name: string; config: Record<string, any>; template_mode: string | null } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    photos: { id: string; url: string; created_at: string }[];
  }> => {
    if (!rateLimit(`wall:${ipKey()}`, 240, 60_000)) throw new Error("Too many requests");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("id, name, status, config, template_mode")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!ev || (ev.status !== "live" && ev.status !== "dryrun")) return { event: null, photos: [] };

    const { data: rows } = await supabaseAdmin
      .from("assets")
      .select("id, storage_path, processed_url, process_status, created_at, kind, variant, approved, status")
      .eq("event_id", ev.id)
      .eq("kind", "photo")
      .eq("status", "ready")
      .is("parent_asset_id", null)
      .order("created_at", { ascending: false })
      .limit(90);

    const usable = (rows || []).filter(
      (r) => r.approved !== false && (r.processed_url || r.process_status === "done" || r.process_status === "failed"),
    );
    const paths = usable.map((r) => r.processed_url || r.storage_path);
    const urls = await signMany(paths);
    const photos = usable
      .map((r) => ({ id: r.id, url: urls[r.processed_url || r.storage_path], created_at: r.created_at }))
      .filter((p) => !!p.url);
    return {
      event: { name: ev.name, config: (ev.config || {}) as Record<string, unknown>, template_mode: ev.template_mode ?? null },
      photos,
    };
  });
