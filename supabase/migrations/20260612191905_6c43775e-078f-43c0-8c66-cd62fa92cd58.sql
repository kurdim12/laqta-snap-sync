
-- 1) Hide staff_pin from public reads of events
DROP POLICY IF EXISTS "public read live events" ON public.events;

CREATE OR REPLACE VIEW public.events_public AS
SELECT id, slug, name, status, config, created_at
FROM public.events
WHERE status IN ('live','dryrun','draft','archived');
ALTER VIEW public.events_public SET (security_invoker = off);
GRANT SELECT ON public.events_public TO anon, authenticated;

-- 2) Remove blanket guest read; expose via security-definer RPCs
DROP POLICY IF EXISTS "anyone read guests by code" ON public.guests;

CREATE OR REPLACE FUNCTION public.get_guest_by_code(_code text)
RETURNS SETOF public.guests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.guests WHERE upper(code) = upper(_code) LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_guest_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_by_code(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_list_guests(_slug text, _pin text)
RETURNS SETOF public.guests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT g.*
  FROM public.guests g
  JOIN public.events e ON e.id = g.event_id
  WHERE e.slug = _slug
    AND e.staff_pin = _pin
    AND e.status IN ('live','dryrun','draft')
  ORDER BY g.created_at DESC
  LIMIT 1000;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_list_guests(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_list_guests(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_guest_selfie(_id uuid, _code text, _path text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE rows int;
BEGIN
  UPDATE public.guests SET selfie_path = _path
   WHERE id = _id AND upper(code) = upper(_code);
  GET DIAGNOSTICS rows = ROW_COUNT;
  RETURN rows > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_guest_selfie(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_guest_selfie(uuid, text, text) TO anon, authenticated;

-- 3) Tighten asset UPDATE — admins only (existing admin policy already covers ALL)
DROP POLICY IF EXISTS "staff update own-event assets" ON public.assets;

-- 4) Storage: replace blanket policies with event-scoped ones for the media bucket
DROP POLICY IF EXISTS "media public read" ON storage.objects;
DROP POLICY IF EXISTS "media public update" ON storage.objects;

CREATE POLICY "media read for active event objects"
ON storage.objects FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND (storage.foldername(name))[1] = e.id::text
  )
);

CREATE POLICY "media update for active event objects"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND (storage.foldername(name))[1] = e.id::text
  )
)
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND (storage.foldername(name))[1] = e.id::text
  )
);
