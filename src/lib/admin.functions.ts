import { createServerFn } from "@tanstack/react-start";

// First-run admin setup helper. The admin_exists RPC is no longer anon-callable
// (see migration 20260702120500_revoke_anon_rpcs); the sign-in screen asks this
// server function instead, which runs with the service role. Returns only a
// boolean — whether any admin account exists yet — so it never leaks data.
export const checkAdminExists = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ exists: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("admin_exists");
    return { exists: Boolean(data) };
  },
);
