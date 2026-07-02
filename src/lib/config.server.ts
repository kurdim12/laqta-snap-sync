import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Canonical origin used for links in outbound email (see delivery.functions).
    appOrigin: process.env.APP_ORIGIN,
    // Video handling decision point. "off" (default) = store the original + a
    // client-generated poster frame (today's behavior). "cloudflare-stream"
    // would transcode via Cloudflare Stream (requires CLOUDFLARE_STREAM_TOKEN);
    // ffmpeg-in-Workers is intentionally NOT attempted.
    mediaPipeline: (process.env.MEDIA_PIPELINE as "off" | "cloudflare-stream") || "off",
  };
}
