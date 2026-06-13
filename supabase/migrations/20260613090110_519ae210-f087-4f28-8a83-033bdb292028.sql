-- 1. Add approval flag to assets (existing rows stay visible)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS assets_event_approved_idx ON public.assets (event_id, approved, status);

-- 2. Update staff_create_asset so uploads to events requiring approval land unapproved
CREATE OR REPLACE FUNCTION public.staff_create_asset(
  _slug text, _pin text, _id uuid, _guest_id uuid, _parent_asset_id uuid,
  _kind text, _variant text, _storage_path text, _content_type text, _bytes bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _ev_id uuid;
  _require boolean;
  _approved boolean;
BEGIN
  _ev_id := public._check_staff_pin(_slug, _pin);
  IF _ev_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _storage_path NOT LIKE _ev_id::text || '/%' THEN
    RAISE EXCEPTION 'Storage path outside event scope';
  END IF;
  IF _kind NOT IN ('photo','video') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
  IF _variant NOT IN ('original','web','thumb','poster') THEN RAISE EXCEPTION 'Invalid variant'; END IF;

  SELECT COALESCE((config->'gallery'->>'requireApproval')::boolean, false)
    INTO _require FROM public.events WHERE id = _ev_id;
  _approved := NOT _require;

  INSERT INTO public.assets (id, event_id, guest_id, parent_asset_id, kind, variant, storage_path, content_type, bytes, status, approved)
    VALUES (_id, _ev_id, _guest_id, _parent_asset_id, _kind, _variant, _storage_path, _content_type, _bytes, 'ready', _approved)
    ON CONFLICT (id) DO UPDATE
      SET guest_id = EXCLUDED.guest_id,
          parent_asset_id = EXCLUDED.parent_asset_id,
          variant = EXCLUDED.variant,
          storage_path = EXCLUDED.storage_path,
          content_type = EXCLUDED.content_type,
          bytes = EXCLUDED.bytes,
          status = 'ready'
    WHERE public.assets.event_id = _ev_id;
  RETURN _id;
END;
$function$;

-- 3. Seed the EY event (idempotent) with: no registration, staff PIN-gated, public gallery, approval required
INSERT INTO public.events (slug, name, status, staff_pin, config)
VALUES (
  'ey', 'Ey', 'live',
  -- temporary plain PIN; trigger hashes & nulls it. Admin can rotate from UI.
  encode(gen_random_bytes(4), 'hex'),
  jsonb_build_object(
    'locale','both',
    'registration','none',
    'theme', jsonb_build_object('primary','#FFE600','background','#0E0E10','text','#FAFAF7','logoUrl',''),
    'fields','[]'::jsonb,
    'consentText', jsonb_build_object('ar','','en',''),
    'successMessage', jsonb_build_object('ar','شكراً','en','Thanks'),
    'gallery', jsonb_build_object('allowDownloadAll', true, 'showVideos', true, 'mode','public','requireApproval', true),
    'selfie','off',
    'limits', jsonb_build_object('maxVideoMB',200,'maxPhotoMB',50)
  )
)
ON CONFLICT (slug) DO NOTHING;
