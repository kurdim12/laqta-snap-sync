// Delivery provider abstraction. Email ships first (Resend); SMS/WhatsApp
// (Twilio, WhatsApp Business) can implement the same interface later without
// touching callers.
export type DeliveryChannel = "email" | "sms" | "whatsapp";

export interface DeliveryMessage {
  channel: DeliveryChannel;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface DeliveryResult {
  status: "sent" | "failed" | "queued";
  providerMessageId?: string;
  error?: string;
}

export interface DeliveryProvider {
  send(msg: DeliveryMessage): Promise<DeliveryResult>;
}
