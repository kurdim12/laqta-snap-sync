import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Admin-only storage maintenance: delete objects under an event's folder that
// are not referenced by any asset row or guest selfie. Also cleans up anything
// left over from before anon storage writes were locked down (Phase 0.1).

async function assertAdmin(accessToken: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: u } = await supabaseAdmin.auth.getUser(accessToken);
  if (!u?.user) return false;
  const { data } = await supabaseAdmin.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  return data === true;
}

// Recursively collect every object path under `prefix` (bounded depth).
async function listAll(
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 4) return [];
  const { data } = await admin.storage.from("media").list(prefix, { limit: 1000 });
  const out: string[] = [];
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    // Storage returns folders with a null id.
    if ((item as { id: string | null }).id === null) {
      out.push(...(await listAll(admin, path, depth + 1)));
    } else {
      out.push(path);
    }
  }
  return out;
}

export interface SweepResult {
  scanned: number;
  orphans: number;
  deleted: number;
  sample: string[];
}

export const adminSweepEventOrphans = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      eventId: z.string().uuid(),
      accessToken: z.string().min(1),
      dryRun: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<SweepResult> => {
    if (!(await assertAdmin(data.accessToken))) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: assets }, { data: guests }] = await Promise.all([
      supabaseAdmin.from("assets").select("storage_path").eq("event_id", data.eventId),
      supabaseAdmin.from("guests").select("selfie_path").eq("event_id", data.eventId),
    ]);
    const referenced = new Set<string>();
    (assets || []).forEach((a) => a.storage_path && referenced.add(a.storage_path));
    (guests || []).forEach((g) => g.selfie_path && referenced.add(g.selfie_path));

    const all = await listAll(supabaseAdmin, data.eventId);
    const orphans = all.filter((p) => !referenced.has(p));

    if (!data.dryRun && orphans.length) {
      for (let i = 0; i < orphans.length; i += 100) {
        await supabaseAdmin.storage.from("media").remove(orphans.slice(i, i + 100));
      }
    }
    return {
      scanned: all.length,
      orphans: orphans.length,
      deleted: data.dryRun ? 0 : orphans.length,
      sample: orphans.slice(0, 10),
    };
  });
