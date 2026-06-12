
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1a. Rate-limit / lockout table (server-only)
CREATE TABLE IF NOT EXISTS public.staff_pin_attempts (
  slug text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_failed_at timestamptz
);
GRANT ALL ON public.staff_pin_attempts TO service_role;
ALTER TABLE public.staff_pin_attempts ENABLE ROW LEVEL SECURITY;
-- no policies: only reachable via SECURITY DEFINER functions below

-- 1b. Add hash column, migrate existing plaintext, then null plaintext
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS staff_pin_hash text;
UPDATE public.events
   SET staff_pin_hash = crypt(staff_pin, gen_salt('bf'))
 WHERE staff_pin_hash IS NULL AND staff_pin IS NOT NULL AND staff_pin <> '';
ALTER TABLE public.events ALTER COLUMN staff_pin DROP NOT NULL;
UPDATE public.events SET staff_pin = NULL WHERE staff_pin_hash IS NOT NULL;

-- 1c. Trigger that hashes any new plaintext PIN and clears the plaintext column
CREATE OR REPLACE FUNCTION public._events_hash_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.staff_pin IS NOT NULL AND NEW.staff_pin <> ''
     AND (TG_OP = 'INSERT' OR NEW.staff_pin IS DISTINCT FROM OLD.staff_pin) THEN
    IF length(NEW.staff_pin) < 6 THEN
      RAISE EXCEPTION 'Staff PIN must be at least 6 characters';
    END IF;
    NEW.staff_pin_hash := crypt(NEW.staff_pin, gen_salt('bf'));
    NEW.staff_pin := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS events_hash_pin ON public.events;
CREATE TRIGGER events_hash_pin
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public._events_hash_pin();

-- 1d. Verifier with bcrypt + rate limit
CREATE OR REPLACE FUNCTION public._check_staff_pin(_slug text, _pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ev_id uuid;
  _hash text;
  _failed int;
  _locked timestamptz;
BEGIN
  SELECT failed_count, locked_until INTO _failed, _locked
    FROM public.staff_pin_attempts WHERE slug = _slug FOR UPDATE;
  IF _locked IS NOT NULL AND _locked > now() THEN
    RETURN NULL;
  END IF;

  SELECT id, staff_pin_hash INTO _ev_id, _hash
    FROM public.events
   WHERE slug = _slug AND status IN ('live','dryrun','draft')
   LIMIT 1;

  IF _ev_id IS NULL OR _hash IS NULL OR crypt(_pin, _hash) <> _hash THEN
    INSERT INTO public.staff_pin_attempts (slug, failed_count, last_failed_at)
      VALUES (_slug, 1, now())
      ON CONFLICT (slug) DO UPDATE
        SET failed_count = public.staff_pin_attempts.failed_count + 1,
            last_failed_at = now(),
            locked_until = CASE
              WHEN public.staff_pin_attempts.failed_count + 1 >= 8
              THEN now() + interval '5 minutes'
              ELSE NULL
            END;
    RETURN NULL;
  END IF;

  DELETE FROM public.staff_pin_attempts WHERE slug = _slug;
  RETURN _ev_id;
END;
$$;

-- 1e. Replace public PIN-checking RPCs to use the hashed verifier
CREATE OR REPLACE FUNCTION public.verify_staff_pin(_slug text, _pin text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public._check_staff_pin(_slug, _pin) $$;

CREATE OR REPLACE FUNCTION public.staff_list_guests(_slug text, _pin text)
RETURNS SETOF public.guests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ev_id uuid;
BEGIN
  _ev_id := public._check_staff_pin(_slug, _pin);
  IF _ev_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT g.* FROM public.guests g
     WHERE g.event_id = _ev_id
     ORDER BY g.created_at DESC
     LIMIT 1000;
END;
$$;

-- 2. Replace the blanket assets-insert policy with a SECURITY DEFINER RPC
DROP POLICY IF EXISTS "staff insert assets into live event" ON public.assets;

CREATE OR REPLACE FUNCTION public.staff_create_asset(
  _slug text,
  _pin text,
  _id uuid,
  _guest_id uuid,
  _parent_asset_id uuid,
  _kind text,
  _variant text,
  _storage_path text,
  _content_type text,
  _bytes bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ev_id uuid;
BEGIN
  _ev_id := public._check_staff_pin(_slug, _pin);
  IF _ev_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _storage_path NOT LIKE _ev_id::text || '/%' THEN
    RAISE EXCEPTION 'Storage path outside event scope';
  END IF;
  IF _kind NOT IN ('photo','video') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
  IF _variant NOT IN ('original','web','thumb','poster') THEN RAISE EXCEPTION 'Invalid variant'; END IF;

  INSERT INTO public.assets (id, event_id, guest_id, parent_asset_id, kind, variant, storage_path, content_type, bytes, status)
    VALUES (_id, _ev_id, _guest_id, _parent_asset_id, _kind, _variant, _storage_path, _content_type, _bytes, 'ready')
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
$$;

-- 3. Scope storage inserts to active-event folders
DROP POLICY IF EXISTS "media public insert" ON storage.objects;
CREATE POLICY "media scoped insert"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status IN ('live','dryrun')
      AND (storage.foldername(name))[1] = e.id::text
  )
);

-- 4. admin_exists for login-screen gating
CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') $$;
