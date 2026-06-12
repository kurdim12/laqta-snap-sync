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
    return getRequestIP({ xForwardedFor: true }) || "anon";
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
}


interface EventLite {
  id: string;
  slug: string;
  name: string;
  status: string;
  // JSONB — typed loose so TanStack's serializable check accepts it
  config: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  created_at: string;
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
  const thumbs = rows.filter((r) => r.variant === "thumb");
  const display = originals.length ? originals : webs.length ? webs : rows;
  return display.map((r) => {
    const web = webs.find((w) => w.parent_asset_id === r.id) || r;
    const thumb = thumbs.find((t) => t.parent_asset_id === r.id) || web;
    return {
      ...r,
      url: urls[web.storage_path],
      thumbUrl: urls[thumb.storage_path],
    };
  });
}

// ---------------- guest gallery by code ----------------
export const getGalleryByCode = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => ({
    code: String(d?.code || "").toUpperCase().slice(0, 32),
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

    const { data: e } = await supabaseAdmin
      .from("events")
      .select("id, slug, name, status, config, created_at")
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
    const paths = Array.from(new Set(rows.map((r) => r.storage_path)));
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
      .select("id, slug, name, status, config, created_at")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!e || (e.status !== "live" && e.status !== "dryrun")) {
      return { notFound: true as const };
    }
    const cfg = (e.config || {}) as { gallery?: { mode?: string } };
    if (cfg.gallery?.mode !== "public") return { notFound: true as const };

    const { data: aRows } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("event_id", e.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = (aRows || []) as AssetLite[];
    const paths = Array.from(new Set(rows.map((r) => r.storage_path)));
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
    code: String(d?.code || "").toUpperCase().slice(0, 32),
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
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("slug", data.slug)
      .eq("staff_pin", data.pin)
      .maybeSingle();
    if (!ev) throw new Error("Unauthorized");
    const prefix = `${ev.id}/`;
    const safe = data.paths.filter((p) => p.startsWith(prefix));
    const urls = await signMany(safe);
    return { urls };
  });
