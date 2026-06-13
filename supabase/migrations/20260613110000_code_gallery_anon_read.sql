-- Per-code guest galleries (/g/CODE), code downloads, and staff selfie
-- thumbnails relied on service-role server functions. Those throw when no
-- service-role key is present in the runtime env, so the code gallery showed
-- "Double-check your code" and selfies/downloads failed.
--
-- This moves them onto the anon client: a SECURITY DEFINER lookup returns a
-- guest's photos by code, and anon may read (sign) media for any live event.
-- Storage paths are unguessable UUIDs, and a valid code is still required to
-- discover them.

-- 1. Code -> gallery lookup. SECURITY DEFINER because anon cannot read the
--    guests/assets tables directly. Returns only what the gallery needs — no
--    form_data / consent / selfie PII.
CREATE OR REPLACE FUNCTION public.get_code_gallery(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _gid uuid; _eid uuid; _gcode text;
  _event jsonb; _estatus text; _assets jsonb;
BEGIN
  SELECT id, event_id, code INTO _gid, _eid, _gcode
    FROM public.guests WHERE upper(code) = upper(_code) LIMIT 1;
  IF _gid IS NULL THEN RETURN jsonb_build_object('notFound', true); END IF;

  SELECT jsonb_build_object(
           'id', id, 'slug', slug, 'name', name,
           'status', status, 'config', config, 'created_at', created_at
         ), status
    INTO _event, _estatus
    FROM public.events WHERE id = _eid;
  IF _event IS NULL OR _estatus NOT IN ('live','dryrun') THEN
    RETURN jsonb_build_object('notFound', true);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'kind', a.kind, 'variant', a.variant,
            'parent_asset_id', a.parent_asset_id, 'storage_path', a.storage_path,
            'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO _assets
    FROM public.assets a WHERE a.guest_id = _gid AND a.status = 'ready';

  RETURN jsonb_build_object(
    'notFound', false,
    'guest', jsonb_build_object('id', _gid, 'code', _gcode, 'event_id', _eid),
    'event', _event,
    'assets', _assets
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_code_gallery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_code_gallery(text) TO anon, authenticated;

-- 2. Let anon sign/read media for any live/dryrun event. Broadens the earlier
--    public-wall-only policy so per-code galleries and staff selfie thumbnails
--    work without the service-role key. Paths are unguessable UUIDs.
DROP POLICY IF EXISTS "media read for public wall events" ON storage.objects;
DROP POLICY IF EXISTS "media read for live event objects" ON storage.objects;
CREATE POLICY "media read for live event objects"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
);
