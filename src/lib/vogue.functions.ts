// Public, session-scoped server functions for the LYNK & CO 900 VOGUE
// experience (`/event/:slug`). Anonymous guests: a random opaque `sessionId`
// generated in the browser is the only credential, and it only ever grants
// access to rows that carry the same id.

import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

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
    return getRequestIP() || "anon";
  } catch {
    return "anon";
  }
}

/** Total covers a single guest session may generate (1 + 2 retries). */
export const MAX_SESSION_ATTEMPTS = 3;

const sessionId = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const slugSchema = z.string().min(1).max(128);

interface EventLite {
  id: string;
  slug: string;
  name: string;
  status: string;
  car_reference_url: string | null;
  location_reference_url: string | null;
  requires_ref_images: boolean | null;
  max_generations: number | null;
  generations_used: number | null;
}

async function loadEvent(slug: string): Promise<EventLite | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("events")
    .select("id, slug, name, status, car_reference_url, location_reference_url, requires_ref_images, max_generations, generations_used")
    .eq("slug", slug)
    .maybeSingle();
  return (data as unknown as EventLite) || null;
}

export interface VogueEventInfo {
  id: string;
  slug: string;
  name: string;
  open: boolean;
  /** references uploaded — generation is blocked until true */
  ready: boolean;
  capReached: boolean;
}

export const getVogueEvent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ slug: slugSchema }))
  .handler(async ({ data }): Promise<VogueEventInfo | null> => {
    const ev = await loadEvent(data.slug);
    if (!ev) return null;
    const needsRefs = !!ev.requires_ref_images;
    return {
      id: ev.id,
      slug: ev.slug,
      name: ev.name,
      open: ev.status === "live" || ev.status === "dryrun",
      ready: !needsRefs || (!!ev.car_reference_url && !!ev.location_reference_url),
      capReached: (ev.max_generations ?? 0) > 0 && (ev.generations_used ?? 0) >= (ev.max_generations ?? 0),
    };
  });

export const mintVogueUpload = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      slug: slugSchema,
      sessionId,
      contentType: z.string().min(1).max(128),
      bytes: z.number().int().positive().max(20 * 1024 * 1024),
    }),
  )
  .handler(async ({ data }): Promise<{ eventId: string; path: string; token: string; signedUrl: string }> => {
    if (!rateLimit(`vogue-mint:${ipKey()}`, 40, 60_000)) throw new Error("Too many requests");
    if (!/^image\/(jpeg|png|webp)$/.test(data.contentType)) throw new Error("disallowed type");
    const ev = await loadEvent(data.slug);
    if (!ev || (ev.status !== "live" && ev.status !== "dryrun")) throw new Error("Event not available");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("session_id", data.sessionId);
    if ((count ?? 0) >= MAX_SESSION_ATTEMPTS) throw new Error("Attempt limit reached");

    const nonce = crypto.randomUUID();
    const path = `${ev.id}/originals/${data.sessionId}-${nonce}.jpg`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("media")
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !signed) throw new Error("could not mint upload");
    return { eventId: ev.id, path: signed.path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const registerVogueCover = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      slug: slugSchema,
      sessionId,
      storagePath: z.string().min(1).max(512),
      bytes: z.number().int().positive().max(20 * 1024 * 1024),
      consent: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<{ assetId: string; attemptsUsed: number; attemptsLeft: number }> => {
    if (!rateLimit(`vogue-register:${ipKey()}`, 30, 60_000)) throw new Error("Too many requests");
    const ev = await loadEvent(data.slug);
    if (!ev || (ev.status !== "live" && ev.status !== "dryrun")) throw new Error("Event not available");
    if (!data.storagePath.startsWith(`${ev.id}/originals/${data.sessionId}-`)) {
      throw new Error("path outside session scope");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("session_id", data.sessionId);
    const used = count ?? 0;
    if (used >= MAX_SESSION_ATTEMPTS) throw new Error("Attempt limit reached");

    const { data: row, error } = await supabaseAdmin
      .from("assets")
      .insert({
        event_id: ev.id,
        guest_id: null,
        parent_asset_id: null,
        kind: "photo",
        variant: "original",
        storage_path: data.storagePath,
        content_type: "image/jpeg",
        bytes: data.bytes,
        status: "ready",
        approved: true,
        process_status: "pending",
        session_id: data.sessionId,
        consent: data.consent,
        published: false,
        meta: { source: "vogue" },
      } as never)
      .select("id")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "could not register the photo");
    return { assetId: (row as { id: string }).id, attemptsUsed: used + 1, attemptsLeft: MAX_SESSION_ATTEMPTS - used - 1 };
  });

export interface VogueCoverStatus {
  status: "pending" | "processing" | "done" | "failed";
  url: string | null;
  error: string | null;
}

export const getVogueCover = createServerFn({ method: "POST" })
  .inputValidator(z.object({ assetId: z.string().uuid(), sessionId }))
  .handler(async ({ data }): Promise<VogueCoverStatus> => {
    if (!rateLimit(`vogue-status:${ipKey()}`, 300, 60_000)) throw new Error("Too many requests");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: a } = await supabaseAdmin
      .from("assets")
      .select("id, session_id, process_status, processed_url, error_message")
      .eq("id", data.assetId)
      .maybeSingle();
    const row = a as unknown as
      | { session_id: string | null; process_status: string | null; processed_url: string | null; error_message: string | null }
      | null;
    if (!row || row.session_id !== data.sessionId) throw new Error("Not found");

    let url: string | null = null;
    if (row.processed_url) {
      const { data: signed } = await supabaseAdmin.storage
        .from("media")
        .createSignedUrl(row.processed_url, 3600, { download: false });
      url = signed?.signedUrl || null;
    }
    return {
      status: (row.process_status as VogueCoverStatus["status"]) || "pending",
      url,
      error: row.error_message,
    };
  });

/** Guest opts their finished cover onto the venue wall. */
export const publishVogueCover = createServerFn({ method: "POST" })
  .inputValidator(z.object({ assetId: z.string().uuid(), sessionId, publish: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!rateLimit(`vogue-publish:${ipKey()}`, 60, 60_000)) throw new Error("Too many requests");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: a } = await supabaseAdmin
      .from("assets")
      .select("id, session_id, process_status")
      .eq("id", data.assetId)
      .maybeSingle();
    const row = a as unknown as { session_id: string | null; process_status: string | null } | null;
    if (!row || row.session_id !== data.sessionId) throw new Error("Not found");
    if (data.publish && row.process_status !== "done") throw new Error("Cover is not ready yet");
    await supabaseAdmin
      .from("assets")
      .update({ published: data.publish, consent: data.publish } as never)
      .eq("id", data.assetId);
    return { ok: true };
  });

export interface WallItem {
  id: string;
  url: string;
  createdAt: string;
}

export const getVogueWall = createServerFn({ method: "POST" })
  .inputValidator(z.object({ slug: slugSchema, limit: z.number().int().min(1).max(120).default(60) }))
  .handler(async ({ data }): Promise<{ items: WallItem[] }> => {
    if (!rateLimit(`vogue-wall:${ipKey()}`, 300, 60_000)) throw new Error("Too many requests");
    const ev = await loadEvent(data.slug);
    if (!ev) return { items: [] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("assets")
      .select("id, processed_url, created_at, published, consent, process_status, status")
      .eq("event_id", ev.id)
      .eq("published", true)
      .eq("consent", true)
      .eq("process_status", "done")
      .neq("status", "hidden")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    const list = (rows || []) as unknown as {
      id: string;
      processed_url: string | null;
      created_at: string;
    }[];
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
  });
