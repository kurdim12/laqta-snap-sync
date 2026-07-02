import { describe, it, expect } from "vitest";
import { withSecurityHeaders } from "./security-headers";

describe("withSecurityHeaders", () => {
  it("sets the core headers and a prod CSP without unsafe-eval", () => {
    const r = withSecurityHeaders(new Response("x", { status: 200 }), false);
    const csp = r.headers.get("content-security-policy") || "";
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("*.supabase.co");
    expect(csp).toContain("fonts.googleapis.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("keeps camera=(self) for selfie capture but denies mic/geo", () => {
    const pp =
      withSecurityHeaders(new Response("x"), false).headers.get("permissions-policy") || "";
    expect(pp).toContain("camera=(self)");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("relaxes CSP in dev (unsafe-eval + ws for HMR)", () => {
    const csp =
      withSecurityHeaders(new Response("x"), true).headers.get("content-security-policy") || "";
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });

  it("preserves body and status", async () => {
    const r = withSecurityHeaders(new Response("BODY", { status: 201 }), false);
    expect(await r.text()).toBe("BODY");
    expect(r.status).toBe(201);
  });
});
