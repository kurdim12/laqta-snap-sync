#!/usr/bin/env node
// Phase 0 RLS / anon-surface verification harness.
//
// Runs the ANON (publishable) client against a Supabase instance and asserts
// the hardened posture. Intended to be run against a LOCAL or BRANCH instance
// after the Phase 0 migrations are applied:
//
//   supabase start
//   supabase db reset            # applies all migrations incl. 20260702*
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<local anon key> \
//   node scripts/rls-check.mjs
//
// Safety: the write-probe (attempting an anon storage upload) is DESTRUCTIVE on
// an instance where the old policy still applies. It is skipped unless the URL
// is local, or --allow-writes is passed explicitly. Never point --allow-writes
// at production.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ALLOW_WRITES =
  process.argv.includes("--allow-writes") ||
  /localhost|127\.0\.0\.1/.test(URL || "");

if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY (or PUBLISHABLE_KEY).");
  process.exit(2);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function main() {
  console.log(`Target: ${URL}  (writes ${ALLOW_WRITES ? "ENABLED" : "skipped"})\n`);

  // 1. Base tables must be closed to anon.
  {
    const { data, error } = await sb.from("events").select("id").limit(1);
    ok("anon cannot read events base table", (data ?? []).length === 0 || !!error);
  }
  {
    const { data, error } = await sb.from("guests").select("id").limit(1);
    ok("anon cannot read guests base table", (data ?? []).length === 0 || !!error);
  }

  // 2. Public view still readable.
  {
    const { data, error } = await sb.from("events_public").select("id").limit(1);
    ok("anon can read events_public view", !error);
  }

  // 3. Assets: any row visible to anon must be approved.
  {
    const { data } = await sb.from("assets").select("id,approved").limit(200);
    const bad = (data ?? []).filter((r) => r.approved !== true).length;
    ok("anon sees only approved assets", bad === 0, `${bad} unapproved visible`);
  }

  // 4. Revoked RPCs must reject anon.
  {
    const { error } = await sb.rpc("get_code_gallery", { _code: "ZZZZZZ" });
    ok("anon cannot call get_code_gallery", !!error, error?.message || "no error");
  }
  {
    const { error } = await sb.rpc("admin_exists");
    ok("anon cannot call admin_exists", !!error, error?.message || "no error");
  }

  // 5. Storage write must be denied to anon (destructive; gated).
  if (ALLOW_WRITES) {
    // Use a fabricated live-event-looking folder; the point is the policy denies
    // the write regardless of folder now.
    const path = `rls-check/${Date.now()}.txt`;
    const { error } = await sb.storage
      .from("media")
      .upload(path, new Blob(["x"]), { upsert: true, contentType: "text/plain" });
    ok("anon storage upload denied", !!error, error?.message || "UPLOAD SUCCEEDED (hole open!)");
    if (!error) await sb.storage.from("media").remove([path]).catch(() => {});
  } else {
    console.log("SKIP  anon storage upload denied — pass --allow-writes on a LOCAL instance");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
