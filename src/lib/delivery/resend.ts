// Resend email provider. Server-only: reads secrets from process.env and is
// dynamic-imported inside server-function handlers so it never reaches the
// client bundle. Uses fetch (native on Cloudflare Workers) — no SDK dependency.
import process from "node:process";
import type { DeliveryMessage, DeliveryResult } from "./types";

// If RESEND_API_KEY is unset the send is recorded as 'queued' with a reason,
// so the flow is fully wired and becomes live the moment the key + a verified
// sender domain (RESEND_FROM) are configured — nothing else changes.
export async function resendSend(msg: DeliveryMessage): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "LAQTA <onboarding@resend.dev>";
  if (!key) {
    return { status: "queued", error: "RESEND_API_KEY not configured" };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { status: "failed", error: `Resend ${resp.status}: ${body.slice(0, 300)}` };
    }
    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerMessageId: data.id };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}
