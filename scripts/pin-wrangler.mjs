// Post-build: pin the Cloudflare Worker's identity.
//
// Nitro's cloudflare preset writes .output/server/wrangler.json fresh on every
// build and defaults `compatibility_date` to THE DAY YOU BUILT. That means the
// Worker runtime's semantics can shift under you between two deploys of
// identical source — the exact thing a pinned date exists to prevent. It also
// auto-derives `name` from the git remote, so renaming the repo or the owner
// would silently deploy to a different Worker (and a different URL).
//
// @lovable.dev/vite-tanstack-config exposes only { preset, output, cloudflare }
// from nitro, so there is no build-time knob for either value. Rewriting the
// generated file afterwards is the supported seam.
//
// Change COMPATIBILITY_DATE only deliberately: bump it, redeploy, and re-run
// the smoke tests. Never set it to a date you have not built and tested against.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Verified green against this runtime date. */
const COMPATIBILITY_DATE = "2026-08-19";
/** Fixed Worker name -> fixed *.workers.dev hostname. */
const WORKER_NAME = "laqta-snap-sync";

const CANDIDATES = [
  ".output/server/wrangler.json",
  "dist/server/wrangler.json",
];

const found = CANDIDATES.map((p) => path.resolve(process.cwd(), p)).find((p) => existsSync(p));
if (!found) {
  console.error(
    `[pin-wrangler] FAILED: no wrangler.json at any of:\n  ${CANDIDATES.join("\n  ")}\n` +
      `The cloudflare preset did not run. Do not deploy this build.`,
  );
  process.exit(1);
}

const config = JSON.parse(await readFile(found, "utf8"));
const before = { name: config.name, compatibility_date: config.compatibility_date };

config.compatibility_date = COMPATIBILITY_DATE;
config.name = WORKER_NAME;

await writeFile(found, JSON.stringify(config, null, 2) + "\n");

console.log(`[pin-wrangler] ${path.relative(process.cwd(), found)}`);
console.log(`[pin-wrangler]   name:               ${before.name} -> ${config.name}`);
console.log(`[pin-wrangler]   compatibility_date: ${before.compatibility_date} -> ${config.compatibility_date}`);
console.log(`[pin-wrangler]   compatibility_flags: ${JSON.stringify(config.compatibility_flags ?? [])}`);
