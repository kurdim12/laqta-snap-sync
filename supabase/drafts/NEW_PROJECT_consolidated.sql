-- =====================================================================
-- LAQTA — consolidated schema for a BRAND-NEW Supabase project.
--
-- Assembled from the 28 files in supabase/migrations/ resolved to FINAL
-- STATE (not concatenated — superseded objects are simply absent), plus
-- the Phase C lockdown, the refund RPC + CHECK, and the caps.
--
-- Run PART A in one go on the empty project. Then create your admin
-- account. Then PART B. Then create the events, then PART C.
--
-- Every part ends with verification queries. Do not skip them.
-- =====================================================================


-- #####################################################################
-- PART A — SCHEMA + SECURITY.  Run on the empty project, top to bottom.
-- #####################################################################

-- ---------- A0. Extensions -------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- A1. Roles -------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin','staff','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL    ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- First signup becomes admin. This trigger is a LOADED GUN: while it
-- exists, the next person to sign up on an admin-less DB becomes admin.
-- PART B drops it immediately after you claim the account.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- A2. events ------------------------------------------------
-- Final shape. staff_pin is PLAINTEXT and NOT NULL: migration
-- 20260613083500 deliberately reverted bcrypt hashing so admins can read
-- and print PINs. The hash column and its trigger are intentionally
-- ABSENT — see the PART B verification.
CREATE TABLE public.events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,
  name                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft',
  config                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_pin               text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  template_mode           text NOT NULL DEFAULT 'none',
  template_prompt         text,
  template_reference_url  text,
  template_frame_url      text,
  template_quality        text NOT NULL DEFAULT 'medium',
  template_aspect_ratio   text NOT NULL DEFAULT '1024x1024',
  template_model          text,
  car_reference_url       text,
  location_reference_url  text,
  requires_ref_images     boolean NOT NULL DEFAULT false,
  max_generations         integer NOT NULL DEFAULT 150,
  generations_used        integer NOT NULL DEFAULT 0,
  CONSTRAINT events_template_mode_check
    CHECK (template_mode IN ('none','frame','ai','backdrop')),
  CONSTRAINT events_generations_used_nonneg
    CHECK (generations_used >= 0)
);
GRANT SELECT                 ON public.events TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL                    ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- NOTE: there is deliberately NO anon SELECT policy on events. The
-- "public read live events" policy was dropped in 20260612191905 so
-- staff_pin can never leak. Public screens go through service-role
-- server functions (see gallery.functions.ts).
CREATE POLICY "admins read all events" ON public.events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write events" ON public.events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------- A3. guests ------------------------------------------------
CREATE TABLE public.guests (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  form_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent     boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'primary',
  selfie_path text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.guests TO anon, authenticated;
GRANT UPDATE, DELETE ON public.guests TO authenticated;
GRANT ALL            ON public.guests TO service_role;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
CREATE INDEX guests_event_created ON public.guests(event_id, created_at DESC);
ALTER TABLE public.guests REPLICA IDENTITY FULL;

-- ---------- A4. assets ------------------------------------------------
CREATE TABLE public.assets (
  id                     uuid PRIMARY KEY,
  event_id               uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_id               uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  parent_asset_id        uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  kind                   text NOT NULL,
  variant                text NOT NULL DEFAULT 'original',
  storage_path           text NOT NULL UNIQUE,
  content_type           text NOT NULL,
  bytes                  bigint DEFAULT 0,
  status                 text NOT NULL DEFAULT 'pending',
  approved               boolean NOT NULL DEFAULT true,
  meta                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_url           text,
  processed_url          text,
  process_status         text NOT NULL DEFAULT 'done',
  error_message          text,
  generation_cost        numeric,
  generation_model       text,
  processing_started_at  timestamptz,
  processing_finished_at timestamptz,
  shirt_variant          text,
  display_order          integer,
  published              boolean NOT NULL DEFAULT false,
  consent                boolean NOT NULL DEFAULT false,
  session_id             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_process_status_check
    CHECK (process_status IN ('pending','processing','done','failed'))
);
GRANT SELECT                 ON public.assets TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL                    ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets REPLICA IDENTITY FULL;

CREATE INDEX assets_event_guest          ON public.assets(event_id, guest_id);
CREATE INDEX assets_parent               ON public.assets(parent_asset_id);
CREATE INDEX assets_event_approved_idx   ON public.assets(event_id, approved, status);
CREATE INDEX assets_process_status_idx   ON public.assets(process_status)
  WHERE process_status IN ('pending','processing');
CREATE INDEX assets_display_order_idx    ON public.assets(event_id, display_order);
CREATE INDEX assets_event_published_idx  ON public.assets(event_id, published, created_at DESC);
CREATE INDEX assets_session_idx          ON public.assets(session_id);

-- ---------- A5. deliveries / staff_pin_attempts / template_test_runs --
CREATE TABLE public.deliveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  channel    text NOT NULL DEFAULT 'gallery',
  status     text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage deliveries" ON public.deliveries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Server-only: no policies, reachable solely via SECURITY DEFINER fns.
CREATE TABLE public.staff_pin_attempts (
  slug           text PRIMARY KEY,
  failed_count   int NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_failed_at timestamptz
);
GRANT ALL ON public.staff_pin_attempts TO service_role;
ALTER TABLE public.staff_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.template_test_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid REFERENCES public.events(id) ON DELETE SET NULL,
  user_id    uuid,
  model      text,
  cost       numeric,
  ms         integer,
  ok         boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.template_test_runs TO authenticated;
GRANT ALL    ON public.template_test_runs TO service_role;
ALTER TABLE public.template_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read test runs" ON public.template_test_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- A6. events_public view ------------------------------------
-- Final version (20260805194259): security_invoker = ON. Combined with
-- the absent anon SELECT policy on events, the anon role reads ZERO rows
-- from this view. That is intended and the app already accounts for it —
-- see the comment at gallery.functions.ts:291. staff_pin is not selected.
CREATE VIEW public.events_public
WITH (security_invoker = on) AS
SELECT e.id, e.slug, e.name, e.status, e.config, e.created_at,
       e.template_mode, e.template_frame_url
FROM public.events e;
GRANT SELECT ON public.events_public TO anon, authenticated;

-- ---------- A7. Event-state helpers (bypass RLS, return only booleans) -
CREATE OR REPLACE FUNCTION public.event_is_live(_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = _id AND e.status IN ('live','dryrun'));
$$;
CREATE OR REPLACE FUNCTION public.event_is_public_wall(_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _id AND e.status IN ('live','dryrun')
      AND (e.config -> 'gallery' ->> 'mode') = 'public');
$$;
CREATE OR REPLACE FUNCTION public.event_folder_is_live(_folder text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.status IN ('live','dryrun') AND e.id::text = _folder);
$$;
REVOKE EXECUTE ON FUNCTION public.event_is_live(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_is_public_wall(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_folder_is_live(text)   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.event_is_live(uuid)          TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.event_is_public_wall(uuid)   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.event_folder_is_live(text)   TO anon, authenticated;

-- ---------- A8. Table RLS policies that use those helpers -------------
CREATE POLICY "public read approved public-wall assets" ON public.assets
  FOR SELECT TO anon, authenticated
  USING (status = 'ready' AND approved IS TRUE AND public.event_is_public_wall(event_id));
CREATE POLICY "admins all assets" ON public.assets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "anyone insert guest into live event" ON public.guests
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.event_is_live(event_id));
CREATE POLICY "admins write guests" ON public.guests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------- A9. Staff PIN: plaintext verifier + lockout ----------------
CREATE OR REPLACE FUNCTION public._check_staff_pin(_slug text, _pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _ev_id uuid; _pin_db text; _locked timestamptz;
BEGIN
  SELECT locked_until INTO _locked FROM public.staff_pin_attempts WHERE slug = _slug FOR UPDATE;
  IF _locked IS NOT NULL AND _locked > now() THEN RETURN NULL; END IF;

  SELECT id, staff_pin INTO _ev_id, _pin_db
    FROM public.events WHERE slug = _slug AND status IN ('live','dryrun','draft') LIMIT 1;

  IF _ev_id IS NULL OR _pin_db IS NULL OR _pin_db <> _pin THEN
    INSERT INTO public.staff_pin_attempts (slug, failed_count, last_failed_at)
      VALUES (_slug, 1, now())
      ON CONFLICT (slug) DO UPDATE
        SET failed_count   = public.staff_pin_attempts.failed_count + 1,
            last_failed_at = now(),
            locked_until   = CASE WHEN public.staff_pin_attempts.failed_count + 1 >= 8
                                  THEN now() + interval '5 minutes' ELSE NULL END;
    RETURN NULL;
  END IF;

  DELETE FROM public.staff_pin_attempts WHERE slug = _slug;
  RETURN _ev_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(_slug text, _pin text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public._check_staff_pin(_slug, _pin) $$;
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_staff_pin(text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_list_guests(_slug text, _pin text)
RETURNS SETOF public.guests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ev_id uuid;
BEGIN
  _ev_id := public._check_staff_pin(_slug, _pin);
  IF _ev_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT g.* FROM public.guests g
    WHERE g.event_id = _ev_id ORDER BY g.created_at DESC LIMIT 1000;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_list_guests(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.staff_list_guests(text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_guest_selfie(_id uuid, _code text, _path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rows int;
BEGIN
  UPDATE public.guests SET selfie_path = _path WHERE id = _id AND upper(code) = upper(_code);
  GET DIAGNOSTICS rows = ROW_COUNT;
  RETURN rows > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_guest_selfie(uuid,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_guest_selfie(uuid,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_create_asset(
  _slug text, _pin text, _id uuid, _guest_id uuid, _parent_asset_id uuid,
  _kind text, _variant text, _storage_path text, _content_type text, _bytes bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _ev_id uuid; _require boolean; _approved boolean;
BEGIN
  _ev_id := public._check_staff_pin(_slug, _pin);
  IF _ev_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _storage_path NOT LIKE _ev_id::text || '/%' THEN
    RAISE EXCEPTION 'Storage path outside event scope';
  END IF;
  IF _kind    NOT IN ('photo','video')                       THEN RAISE EXCEPTION 'Invalid kind';    END IF;
  IF _variant NOT IN ('original','web','thumb','poster')      THEN RAISE EXCEPTION 'Invalid variant'; END IF;

  SELECT COALESCE((config->'gallery'->>'requireApproval')::boolean, false)
    INTO _require FROM public.events WHERE id = _ev_id;
  _approved := NOT _require;

  INSERT INTO public.assets (id, event_id, guest_id, parent_asset_id, kind, variant,
                             storage_path, content_type, bytes, status, approved)
    VALUES (_id, _ev_id, _guest_id, _parent_asset_id, _kind, _variant,
            _storage_path, _content_type, _bytes, 'ready', _approved)
    ON CONFLICT (id) DO UPDATE
      SET guest_id = EXCLUDED.guest_id, parent_asset_id = EXCLUDED.parent_asset_id,
          variant = EXCLUDED.variant, storage_path = EXCLUDED.storage_path,
          content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, status = 'ready'
    WHERE public.assets.event_id = _ev_id;
  RETURN _id;
END;
$function$;
-- DEVIATION (flagged): the original migration left this at PostgreSQL's
-- default EXECUTE-to-PUBLIC. Made explicit here. anon still has it —
-- staff.$slug.tsx calls it with the anon client — so behaviour is
-- unchanged for every caller that exists.
REVOKE EXECUTE ON FUNCTION public.staff_create_asset(text,text,uuid,uuid,uuid,text,text,text,text,bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.staff_create_asset(text,text,uuid,uuid,uuid,text,text,text,text,bigint) TO anon, authenticated;

-- ---------- A10. admin_exists + get_code_gallery (both locked down) ----
CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') $$;
REVOKE EXECUTE ON FUNCTION public.admin_exists() FROM PUBLIC, anon;

-- Retained so the rls-check harness has something to prove is revoked.
-- No caller remains: /g/CODE goes through the rate-limited server fn.
CREATE OR REPLACE FUNCTION public.get_code_gallery(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE _gid uuid; _eid uuid; _gcode text; _event jsonb; _estatus text; _assets jsonb;
BEGIN
  SELECT id, event_id, code INTO _gid, _eid, _gcode
    FROM public.guests WHERE upper(code) = upper(_code) LIMIT 1;
  IF _gid IS NULL THEN RETURN jsonb_build_object('notFound', true); END IF;
  SELECT jsonb_build_object('id',id,'slug',slug,'name',name,'status',status,
                            'config',config,'created_at',created_at), status
    INTO _event, _estatus FROM public.events WHERE id = _eid;
  IF _event IS NULL OR _estatus NOT IN ('live','dryrun') THEN
    RETURN jsonb_build_object('notFound', true);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'variant',a.variant,
           'parent_asset_id',a.parent_asset_id,'storage_path',a.storage_path,
           'created_at',a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO _assets FROM public.assets a WHERE a.guest_id = _gid AND a.status = 'ready';
  RETURN jsonb_build_object('notFound', false,
    'guest', jsonb_build_object('id',_gid,'code',_gcode,'event_id',_eid),
    'event', _event, 'assets', _assets);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_code_gallery(text) FROM PUBLIC, anon, authenticated;

-- ---------- A11. Generation cap: consume + refund ---------------------
CREATE OR REPLACE FUNCTION public.consume_generation(_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ok boolean;
BEGIN
  UPDATE public.events SET generations_used = generations_used + 1
   WHERE id = _event_id AND generations_used < max_generations
  RETURNING true INTO _ok;
  RETURN coalesce(_ok, false);
END;
$$;
-- PHASE C LOCKDOWN. Without this REVOKE the function is EXECUTE-to-PUBLIC
-- by default and anyone holding the publishable key can drain the paid
-- generation budget in a loop. Only the service role ever calls it.
REVOKE EXECUTE ON FUNCTION public.consume_generation(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_generation(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_generation(_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ok boolean;
BEGIN
  UPDATE public.events SET generations_used = generations_used - 1
   WHERE id = _event_id AND generations_used > 0
  RETURNING true INTO _ok;
  RETURN coalesce(_ok, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refund_generation(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_generation(uuid) TO service_role;
-- NOTE: nothing calls refund_generation yet. Its only correct call site is
-- the catch block of photo-processing.server.ts, which is frozen.

-- ---------- A12. Storage: bucket + policies ---------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media','media', false, 209715200,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif',
              'video/mp4','video/quicktime'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Admin: full control.
CREATE POLICY "media admins read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "media admins insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "media admins update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "media admins delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));

-- Anon: READ ONLY, and only inside a live event's folder. There is
-- deliberately NO anon INSERT/UPDATE — 20260702120000 removed it. Staff
-- and guest uploads use short-lived signed upload URLs minted server-side,
-- which bypass RLS via a one-time token.
CREATE POLICY "media read for live event objects" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'media' AND public.event_folder_is_live((storage.foldername(name))[1]));


-- =====================================================================
-- PART A VERIFICATION — every query must return what the comment says.
-- =====================================================================

-- A-V1. All 7 tables present.
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;
-- EXPECT: assets, deliveries, events, guests, staff_pin_attempts,
--         template_test_runs, user_roles   (7 rows)

-- A-V2. RLS enabled on every one of them.
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname;
-- EXPECT: relrowsecurity = true for all 7.

-- A-V3. events has every column the app reads.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_schema='public' AND table_name='events'
ORDER BY column_name;
-- EXPECT 19 columns incl. max_generations, generations_used,
--        car_reference_url, location_reference_url, requires_ref_images,
--        template_model.  staff_pin_hash MUST NOT appear.

-- A-V4. assets has every column the app writes.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='assets' ORDER BY column_name;
-- EXPECT 26 columns incl. published, consent, session_id, generation_model,
--        shirt_variant, display_order, process_status, processed_url.

-- A-V5. Anon must NOT be able to execute the locked-down functions.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('consume_generation','refund_generation','get_code_gallery',
                    'admin_exists','handle_new_user','verify_staff_pin',
                    'staff_list_guests','staff_create_asset','set_guest_selfie')
ORDER BY p.proname;
-- EXPECT anon_exec:
--   consume_generation f | refund_generation f | get_code_gallery f
--   admin_exists f | handle_new_user f
--   verify_staff_pin t | staff_list_guests t | staff_create_asset t
--   set_guest_selfie t            <- these four MUST be t or booth 1 dies.

-- A-V6. The PIN-hashing trigger must NOT exist (plaintext PINs by design).
SELECT count(*) AS events_hash_pin_present FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='events' AND t.tgname='events_hash_pin';
-- EXPECT: 0
SELECT count(*) AS hash_fn_present FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='_events_hash_pin';
-- EXPECT: 0

-- A-V7. The bucket exists, is PRIVATE, and enforces size + MIME.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='media';
-- EXPECT: public=false, file_size_limit=209715200, 7 mime types.

-- A-V8. No anon write policy on storage.
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;
-- EXPECT 5 policies. The ONLY one including {anon} is
-- "media read for live event objects" and its cmd is SELECT.

-- A-V9. Constraints present.
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.events'::regclass,'public.assets'::regclass)
  AND contype='c' ORDER BY conname;
-- EXPECT: assets_process_status_check, events_generations_used_nonneg,
--         events_template_mode_check.

-- A-V10. Zero rows anywhere. This is a fresh project.
SELECT (SELECT count(*) FROM public.events)     AS events,
       (SELECT count(*) FROM public.guests)     AS guests,
       (SELECT count(*) FROM public.assets)     AS assets,
       (SELECT count(*) FROM public.user_roles) AS roles;
-- EXPECT: 0, 0, 0, 0


-- #####################################################################
-- PART B — LOCKDOWN.  Run IMMEDIATELY after you create your admin
-- account in the app. Not tomorrow. The window between PART A and this
-- is the window where a stranger's signup becomes your admin.
-- #####################################################################

-- B-V1. Confirm YOUR account is the admin, and the only one.
SELECT u.email, ur.role, ur.created_at
FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
ORDER BY ur.created_at;
-- EXPECT: exactly ONE row, role=admin, YOUR email.
-- If you see any other email: STOP. Delete that user in
-- Authentication -> Users, delete its user_roles row, and start again.

-- B1. Disarm the first-signup-becomes-admin trigger.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- B-V2. Trigger is gone.
SELECT count(*) AS on_auth_user_created_present FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='auth' AND c.relname='users' AND t.tgname='on_auth_user_created';
-- EXPECT: 0.  From now on new signups get NO role. Grant admin by hand:
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = 'someone@example.com';

-- B-V3. Still exactly one admin.
SELECT count(*) AS admin_count FROM public.user_roles WHERE role='admin';
-- EXPECT: 1


-- #####################################################################
-- PART C — AFTER the two events exist in admin.
-- #####################################################################

-- C-V0. See what you actually created before changing it.
SELECT slug, name, status, template_mode, template_quality,
       template_aspect_ratio, template_model,
       template_prompt IS NOT NULL AS has_prompt,
       requires_ref_images, max_generations, generations_used,
       config->'gallery'->>'mode' AS gallery_mode,
       config->'gallery'->>'publishedOnly' AS published_only
FROM public.events ORDER BY created_at;

-- C1. Caps. EDIT THE SLUGS to match what C-V0 printed.
UPDATE public.events SET max_generations = 700 WHERE slug = 'lynkco-900-vogue'
RETURNING slug, max_generations, generations_used;
UPDATE public.events SET max_generations = 500 WHERE slug = 'REPLACE-WITH-SHIRT-EVENT-SLUG'
RETURNING slug, max_generations, generations_used;
-- EXPECT 1 row each. 0 rows means the slug is wrong — check C-V0.

-- C2. Public-wall gate for the vogue event (the Block-2 feature).
--     Turn this on ONLY once some covers are published, or the wall is blank.
UPDATE public.events
   SET config = jsonb_set(config, '{gallery,publishedOnly}', 'true'::jsonb, true)
 WHERE slug = 'lynkco-900-vogue'
RETURNING slug, config->'gallery' AS gallery_config;
-- KILL SWITCH (no redeploy needed):
-- UPDATE public.events SET config = config #- '{gallery,publishedOnly}'
--  WHERE slug = 'lynkco-900-vogue';

-- C3. THE LOVABLE MIGRATION (20260818211408), folded in verbatim.
--     ⚠️ ON A FRESH DATABASE THIS IS A NO-OP: it targets slug='vogue-test',
--     a row that only exists if you also create the throwaway test event.
--     Run it ONLY if you create 'vogue-test'. See the flags in the runbook.
UPDATE public.events SET
  template_reference_url = NULL,
  car_reference_url      = NULL,
  location_reference_url = NULL,
  requires_ref_images    = false,
  template_model         = 'google/gemini-3.1-flash-image',
  template_aspect_ratio  = '2:3',
  template_quality       = 'medium',
  template_mode          = 'ai'
WHERE slug = 'vogue-test';
-- EXPECT: 0 rows on a fresh DB with no test event. That is correct.

-- C-V1. Final state.
SELECT slug, status, template_mode, template_quality, template_aspect_ratio,
       requires_ref_images, max_generations, generations_used,
       max_generations - generations_used AS remaining,
       config->'gallery'->>'mode' AS gallery_mode,
       config->'gallery'->>'publishedOnly' AS published_only,
       staff_pin
FROM public.events ORDER BY slug;
-- EXPECT: vogue 700, shirt event 500, both generations_used = 0,
--         staff_pin readable and NOT 900900.
