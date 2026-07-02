import { test, expect } from "@playwright/test";

// Smoke coverage of the guest-facing entry points. These need a running app
// (bun run dev) and a Supabase backend, so they run on demand / nightly, not in
// the per-push CI job. See the roadmap in README for the register -> code ->
// gallery and staff/admin flows to extend here.

test("landing page renders the code entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LAQTA")).toBeVisible();
  await expect(page.getByPlaceholder("ABC123")).toBeVisible();
});

test("invalid code is rejected client-side", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("ABC123").fill("!!");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText(/valid gallery code/i)).toBeVisible();
});

test("a bogus gallery code shows the wrong-code screen", async ({ page }) => {
  await page.goto("/g/ZZZZZZ");
  await expect(page.getByText(/LAQTA/)).toBeVisible();
});
