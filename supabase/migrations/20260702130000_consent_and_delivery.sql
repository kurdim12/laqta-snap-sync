-- Phase 3.2 (consent) + Phase 1 (delivery) — additive, reversible.
--
-- 3.2: record WHEN the guest consented. Set at form-submit time so it reflects
-- the real moment of consent even though the offline outbox may insert the row
-- much later.
--
-- Phase 1: enrich `deliveries` so an email/SMS/WhatsApp send can be recorded and
-- de-duplicated (channel + status already exist). No unique constraint is added
-- here to keep the migration purely additive; idempotency is handled in the
-- server function (one 'sent' row per guest+channel).

BEGIN;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
