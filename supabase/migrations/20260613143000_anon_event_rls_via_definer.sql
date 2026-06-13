-- Real anonymous users (guests scanning a QR, non-admin staff, public-wall
-- visitors) were locked out of everything. Reason: the "public read live
-- events" policy was dropped, so the anon role can't read the events TABLE
-- (only the events_public VIEW). Yet the anon-facing RLS policies gate access
-- with `EXISTS (SELECT 1 FROM public.events ...)`, which — evaluated as anon —
-- returns no rows and denies the action. Admins were unaffected (they can read
-- events), which is why it looked like it worked.
--
-- Fix: check event state through SECURITY DEFINER helpers that bypass RLS
-- (same pattern as has_role). The helpers return only a boolean — no event
-- columns (and never staff_pin) are exposed.

CREATE OR REPLACE FUNCTION public.event_is_live(_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _id AND e.status IN ('live','dryrun')
  );
$$;

CREATE OR REPLACE FUNCTION public.event_is_public_wall(_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _id AND e.status IN ('live','dryrun')
      AND (e.config -> 'gallery' ->> 'mode') = 'public'
  );
$$;

CREATE OR REPLACE FUNCTION public.event_folder_is_live(_folder text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun') AND e.id::text = _folder
  );
$$;

REVOKE EXECUTE ON FUNCTION public.event_is_live(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_is_public_wall(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_folder_is_live(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_is_live(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_is_public_wall(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_folder_is_live(text) TO anon, authenticated;

-- Public wall: anon can read approved, ready photos of live public-wall events.
DROP POLICY IF EXISTS "public read approved public-wall assets" ON public.assets;
CREATE POLICY "public read approved public-wall assets"
ON public.assets FOR SELECT TO anon, authenticated
USING (status = 'ready' AND approved IS TRUE AND public.event_is_public_wall(event_id));

-- Registration: anon can insert a guest into a live event.
DROP POLICY IF EXISTS "anyone insert guest into live event" ON public.guests;
CREATE POLICY "anyone insert guest into live event"
ON public.guests FOR INSERT TO anon, authenticated
WITH CHECK (public.event_is_live(event_id));

-- Storage read: anon can sign/read media for any live event.
DROP POLICY IF EXISTS "media read for live event objects" ON storage.objects;
CREATE POLICY "media read for live event objects"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'media' AND public.event_folder_is_live((storage.foldername(name))[1]));

-- Storage insert: anon (staff/guest) can upload into a live event's folder.
DROP POLICY IF EXISTS "media scoped insert" ON storage.objects;
CREATE POLICY "media scoped insert"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'media' AND public.event_folder_is_live((storage.foldername(name))[1]));

-- Storage update: anon upload upserts.
DROP POLICY IF EXISTS "media scoped update" ON storage.objects;
CREATE POLICY "media scoped update"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id = 'media' AND public.event_folder_is_live((storage.foldername(name))[1]))
WITH CHECK (bucket_id = 'media' AND public.event_folder_is_live((storage.foldername(name))[1]));
