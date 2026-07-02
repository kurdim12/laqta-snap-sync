import { describe, it, expect } from "vitest";
import { extractEmail, codeEmail } from "./templates";

describe("extractEmail", () => {
  const fields = [
    { key: "email", type: "email" },
    { key: "name", type: "text" },
  ];
  it("finds a valid email from the typed field", () => {
    expect(extractEmail(fields, { email: "guest@example.com", name: "X" })).toBe(
      "guest@example.com",
    );
  });
  it("returns null when absent", () => {
    expect(extractEmail(fields, { name: "X" })).toBeNull();
  });
  it("rejects an invalid address", () => {
    expect(extractEmail(fields, { email: "not-an-email" })).toBeNull();
  });
  it("falls back to a conventional 'email' key", () => {
    expect(extractEmail(undefined, { email: "f@b.co" })).toBe("f@b.co");
  });
});

describe("codeEmail", () => {
  it("is bilingual and contains the code, link, embedded QR, and escaped name", async () => {
    const em = await codeEmail({
      eventName: "Sara & Omar",
      code: "ABC234",
      galleryUrl: "https://laqta.app/g/ABC234",
      lang: "ar",
    });
    expect(em.subject).toMatch(/صور/);
    expect(em.subject).toMatch(/photos/i);
    expect(em.html).toContain("ABC234");
    expect(em.html).toContain("https://laqta.app/g/ABC234");
    expect(em.html).toContain("data:image/png;base64,");
    expect(em.html).toContain("Sara &amp; Omar"); // HTML-escaped, no raw &
    expect(em.text).toContain("ABC234");
    expect(em.text).toContain("https://laqta.app/g/ABC234");
  });
});
