-- Make the public photo wall work for true anonymous visitors (the audience
-- scanning a printed QR) WITHOUT relying on the service-role key.
--
-- Background: the public gallery used a service-role server function to read
-- events/assets and sign URLs. When the service-role key isn't present in the
-- runtime environment, that function throws and the page shows
-- "This event is not available". On top of that, `events_public` had been
-- switched to security_invoker=on, which made the view return zero rows for
-- the anon role (the underlying events table has no anon SELECT policy), so
-- anonymous visitors couldn't resolve the event at all.
--
-- This migration moves the public wall onto the anon client + RLS. It only
-- ever exposes PUBLIC-wall events and their APPROVED photos. Private,
-- per-code galleries are untouched and remain private.

-- 1. Let anon read public event metadata again via the safe view.
--    The view selects only id/slug/name/status/config/created_at — staff_pin
--    is never exposed. security_invoker=off lets the view bypass the
--    (admin-only) RLS on the underlying events table and return its safe
--    columns to anon, which is exactly what a public view is for.
ALTER VIEW public.events_public SET (security_invoker = off);

-- 2. Let anyone read APPROVED, ready photos of live/dryrun public-wall events.
--    Narrower than the old blanket "public read ready assets" policy: it
--    requires approved = true AND the event to be a public wall.
DROP POLICY IF EXISTS "public read approved public-wall assets" ON public.assets;
CREATE POLICY "public read approved public-wall assets"
ON public.assets FOR SELECT
TO anon, authenticated
USING (
  status = 'ready'
  AND approved IS TRUE
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = assets.event_id
      AND e.status IN ('live','dryrun')
      AND (e.config -> 'gallery' ->> 'mode') = 'public'
  )
);

-- 3. Let anyone read the media objects of live/dryrun public-wall events so
--    the gallery can sign/display them via the anon client. Scoped to
--    public-wall event folders only — private events stay locked down.
DROP POLICY IF EXISTS "media read for public wall events" ON storage.objects;
CREATE POLICY "media read for public wall events"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND (e.config -> 'gallery' ->> 'mode') = 'public'
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
);
