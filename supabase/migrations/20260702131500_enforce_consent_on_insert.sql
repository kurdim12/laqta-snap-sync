-- Phase 3.2 — enforce consent at the DATABASE, not just the client.
--
-- The client form now blocks submit without consent, but the anon guests INSERT
-- policy accepted consent=false (e.g. a stale outbox entry queued by a previous
-- app version, or a direct REST POST). Require consent on the self-registration
-- insert path so a persisted registration can never have consent = false.
--
-- Admins are unaffected: they write guests through the separate
-- "admins write guests" (FOR ALL) policy.
--
-- Reversible: recreate the policy without the `AND consent IS TRUE` clause.

DROP POLICY IF EXISTS "anyone insert guest into live event" ON public.guests;
CREATE POLICY "anyone insert guest into live event"
ON public.guests FOR INSERT
TO anon, authenticated
WITH CHECK (public.event_is_live(event_id) AND consent IS TRUE);
