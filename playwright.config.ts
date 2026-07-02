import { defineConfig, devices } from "@playwright/test";

// Smoke e2e scaffold. To run:
//   bun add -D @playwright/test
//   bun run dev            # in another shell (needs Supabase env)
//   bunx playwright test
// In the preconfigured sandbox, Chromium is at /opt/pw-browsers/chromium — set
// launchOptions.executablePath there if a pinned browser isn't downloaded.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8080",
    ...devices["Desktop Chrome"],
  },
});
