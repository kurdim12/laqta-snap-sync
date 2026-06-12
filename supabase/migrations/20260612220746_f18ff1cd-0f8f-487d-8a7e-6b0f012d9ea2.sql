
CREATE OR REPLACE FUNCTION public._events_hash_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
BEGIN
  IF NEW.staff_pin IS NOT NULL AND NEW.staff_pin <> ''
     AND (TG_OP = 'INSERT' OR NEW.staff_pin IS DISTINCT FROM OLD.staff_pin) THEN
    IF length(NEW.staff_pin) < 6 THEN
      RAISE EXCEPTION 'Staff PIN must be at least 6 characters';
    END IF;
    NEW.staff_pin_hash := extensions.crypt(NEW.staff_pin, extensions.gen_salt('bf'));
    NEW.staff_pin := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._check_staff_pin(_slug text, _pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
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

  IF _ev_id IS NULL OR _hash IS NULL OR extensions.crypt(_pin, _hash) <> _hash THEN
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
