-- ============================================================================
-- DRAFT — Phase 0.3. NOT in migrations/ on purpose: it rewrites the LIVE staff
-- auth path and needs a new env secret (STAFF_TOKEN_SECRET) + local Supabase
-- verification before it is promoted into supabase/migrations/ and applied.
-- Move this file into migrations/ (with a fresh timestamp) once verified.
-- ============================================================================
--
-- Goal: (1) stop storing staff PINs in plaintext, (2) make the brute-force
-- lockout per-IP+slug instead of global-per-slug (which lets anyone lock out
-- real staff), (3) hand out a short-lived session token on success so the
-- client never persists the raw PIN.
--
-- The bcrypt hashing + verification lives in SQL (pgcrypto). The signed session
-- token is minted by the server function (Node/HMAC with STAFF_TOKEN_SECRET) —
-- see the TS sketch in PHASE0_NOTES.md — because SQL has no app secret.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add a hash column and backfill from the existing plaintext PINs.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS staff_pin_hash text;
UPDATE public.events
   SET staff_pin_hash = crypt(staff_pin, gen_salt('bf', 10))
 WHERE staff_pin_hash IS NULL AND staff_pin IS NOT NULL AND staff_pin <> '';

-- 2. Per-IP+slug lockout. Widen the attempts key so failures from one IP never
--    lock a different visitor (or real staff) out.
ALTER TABLE public.staff_pin_attempts ADD COLUMN IF NOT EXISTS ip text NOT NULL DEFAULT 'unknown';
-- Recreate PK on (slug, ip). (Do this carefully against real data.)
--   ALTER TABLE public.staff_pin_attempts DROP CONSTRAINT staff_pin_attempts_pkey;
--   ALTER TABLE public.staff_pin_attempts ADD PRIMARY KEY (slug, ip);

-- 3. Verify against the hash, keyed by IP. Returns the event id on success.
CREATE OR REPLACE FUNCTION public._check_staff_pin_v2(_slug text, _pin text, _ip text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _ev_id uuid; _hash text; _locked timestamptz;
BEGIN
  SELECT locked_until INTO _locked
    FROM public.staff_pin_attempts WHERE slug = _slug AND ip = _ip FOR UPDATE;
  IF _locked IS NOT NULL AND _locked > now() THEN RETURN NULL; END IF;

  SELECT id, staff_pin_hash INTO _ev_id, _hash
    FROM public.events WHERE slug = _slug AND status IN ('live','dryrun','draft') LIMIT 1;

  IF _ev_id IS NULL OR _hash IS NULL OR crypt(_pin, _hash) <> _hash THEN
    INSERT INTO public.staff_pin_attempts (slug, ip, failed_count, last_failed_at)
      VALUES (_slug, _ip, 1, now())
      ON CONFLICT (slug, ip) DO UPDATE
        SET failed_count = public.staff_pin_attempts.failed_count + 1,
            last_failed_at = now(),
            locked_until = CASE WHEN public.staff_pin_attempts.failed_count + 1 >= 8
                                THEN now() + interval '5 minutes' ELSE NULL END;
    RETURN NULL;
  END IF;

  DELETE FROM public.staff_pin_attempts WHERE slug = _slug AND ip = _ip;
  RETURN _ev_id;
END;
$fn$;

-- 4. After the app is switched to token auth and PINs are shown only once at
--    creation, drop the plaintext column:
--    ALTER TABLE public.events DROP COLUMN staff_pin;

COMMIT;
