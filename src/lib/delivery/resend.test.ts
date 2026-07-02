import { describe, it, expect, beforeEach } from "vitest";
import { resendSend } from "./resend";

describe("resendSend", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  it("records 'queued' (no throw, no network) when no API key is configured", async () => {
    const r = await resendSend({
      channel: "email",
      to: "g@e.co",
      subject: "s",
      html: "<b>h</b>",
      text: "t",
    });
    expect(r.status).toBe("queued");
    expect(r.error).toContain("RESEND_API_KEY");
  });
});
