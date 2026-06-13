-- Revert staff PIN hashing back to plaintext so admins can read/print PINs
-- from the dashboard. The PIN stays hidden from the public (the events_public
-- view excludes it, and only authenticated admins can read the events table),
-- and online brute force is still blocked by the rate limiter / lockout in
-- _check_staff_pin.

-- 1. Stop hashing PINs on write.
DROP TRIGGER IF EXISTS events_hash_pin ON public.events;
DROP FUNCTION IF EXISTS public._events_hash_pin();

-- 2. Backfill PINs that the hashing migration nulled out. bcrypt hashes are
--    one-way and can't be recovered, so any event without a plaintext PIN gets
--    a fresh random 6-digit one (admins can change it in the editor).
UPDATE public.events
   SET staff_pin = lpad((floor(random() * 1000000))::int::text, 6, '0')
 WHERE staff_pin IS NULL OR staff_pin = '';

-- 3. Require a PIN again now that every row has one.
ALTER TABLE public.events ALTER COLUMN staff_pin SET NOT NULL;

-- 4. Verify against the plaintext PIN, keeping the existing lockout behaviour
--    (8 failures -> locked for 5 minutes).
CREATE OR REPLACE FUNCTION public._check_staff_pin(_slug text, _pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _ev_id uuid;
  _pin_db text;
  _locked timestamptz;
BEGIN
  SELECT locked_until INTO _locked
    FROM public.staff_pin_attempts WHERE slug = _slug FOR UPDATE;
  IF _locked IS NOT NULL AND _locked > now() THEN
    RETURN NULL;
  END IF;

  SELECT id, staff_pin INTO _ev_id, _pin_db
    FROM public.events
   WHERE slug = _slug AND status IN ('live','dryrun','draft')
   LIMIT 1;

  IF _ev_id IS NULL OR _pin_db IS NULL OR _pin_db <> _pin THEN
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
$function$;

-- 5. Drop the now-unused hash column.
ALTER TABLE public.events DROP COLUMN IF EXISTS staff_pin_hash;
