-- =====================================================================
-- LAQTA — wall/consent recovery + re-executed C-phase DB work
-- Target: the LIVE Supabase project (SUPABASE_PROJECT_ID in .env).
-- Paste into the Supabase SQL editor and run SECTION BY SECTION,
-- top to bottom. Every statement is followed by its verification query.
--
-- Written 2026-08-18. Re-executes the MIGRATION_PLAN_V2 C-phase items,
-- which are NOT present in any git ref (see the session report) and so
-- were almost certainly never applied to this database.
--
-- NOTHING HERE IS DESTRUCTIVE. Section 1 flips a status flag on two
-- rows (reversible), sections 2-5 are permission/limit/function work.
-- Read the SECTION 0 output before running anything below it.
-- =====================================================================


-- =====================================================================
-- SECTION 0 — READ-ONLY INVENTORY. Run this first. Do not skip.
-- If any result contradicts what a later section assumes, STOP and
-- adjust that section before running it.
-- =====================================================================

-- 0.1  Events, their generation caps, and current usage.
--      SECTION 3 raises two of these caps. Confirm the slugs match.
SELECT slug,
       name,
       status,
       max_generations,
       generations_used,
       max_generations - generations_used AS remaining,
       requires_ref_images,
       car_reference_url IS NOT NULL      AS has_car_ref,
       location_reference_url IS NOT NULL AS has_location_ref
FROM public.events
ORDER BY created_at DESC;

-- 0.2  Who can currently execute the generation-cap function.
--      Expected BEFORE section 2: a row for PUBLIC (=) — that is the bug.
SELECT p.proname,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a ON true
WHERE n.nspname = 'public'
  AND p.proname IN ('consume_generation', 'refund_generation')
ORDER BY p.proname, grantee;

-- 0.3  The stale rows SECTION 1 will hide. EXPECT EXACTLY 2 ROWS.
--      If you get more or fewer, STOP and hand-pick ids in section 1.
SELECT a.id,
       e.slug          AS event_slug,
       a.created_at,
       a.status,
       a.process_status,
       a.error_message,
       a.published,
       a.consent
FROM public.assets a
JOIN public.events e ON e.id = a.event_id
WHERE a.process_status = 'failed'
  AND a.error_message  = 'Timed out'
  AND a.status <> 'hidden'
ORDER BY a.created_at DESC;


-- =====================================================================
-- SECTION 1 — CLEANUP: hide the two stale "Timed out" rows.
--
-- status='hidden' is honoured by EVERY read path in the app:
--   * getVogueWall            -> .neq("status","hidden")
--   * getPublicWall           -> .eq("status","ready")
--   * getGalleryByCode / getPublicGallery / guest gallery
--                             -> .eq("status","ready")
-- Admin still sees them (admin loads select("*") with no status filter),
-- so this is fully reversible from the dashboard or by section 1.3.
-- =====================================================================

-- 1.1  Apply. The `created_at < '2026-08-16'` guard keeps this from
--      touching any timeout that happens between now and the event.
UPDATE public.assets
   SET status = 'hidden'
 WHERE process_status = 'failed'
   AND error_message  = 'Timed out'
   AND status <> 'hidden'
   AND created_at < timestamptz '2026-08-16 00:00:00+00'
RETURNING id, created_at, status, process_status, error_message;
-- EXPECT: exactly 2 rows returned, each with status = 'hidden'.

-- 1.2  Verify nothing matching is left visible.
SELECT count(*) AS still_visible_timeouts
FROM public.assets
WHERE process_status = 'failed'
  AND error_message  = 'Timed out'
  AND status <> 'hidden'
  AND created_at < timestamptz '2026-08-16 00:00:00+00';
-- EXPECT: 0

-- 1.3  ROLLBACK for section 1 (run ONLY if you want them back):
-- UPDATE public.assets SET status = 'ready'
--  WHERE process_status = 'failed' AND error_message = 'Timed out'
--    AND status = 'hidden' AND created_at < timestamptz '2026-08-16 00:00:00+00';


-- =====================================================================
-- SECTION 2 — LOCK DOWN consume_generation.
--
-- WHY: the function was created (migration 20260805195736) with no
-- GRANT/REVOKE block. PostgreSQL grants EXECUTE to PUBLIC by default on
-- a new function, so ANY holder of the publishable anon key can call
--     rpc('consume_generation', { _event_id: <uuid> })
-- in a loop and burn the entire paid generation budget before the event
-- starts. The app only ever calls it server-side with the service role
-- (photo-processing.server.ts), so revoking anon/authenticated is safe.
--
-- DO NOT revoke verify_staff_pin, staff_list_guests or staff_create_asset
-- — the staff booth calls those from the anon client and would break.
-- =====================================================================

-- 2.1  Apply.
REVOKE EXECUTE ON FUNCTION public.consume_generation(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_generation(uuid) TO service_role;

-- 2.2  Verify: only service_role may execute it now.
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
WHERE n.nspname = 'public' AND p.proname = 'consume_generation';
-- EXPECT: service_role (EXECUTE), plus the owner (postgres/supabase_admin).
--         NO row for PUBLIC, anon or authenticated.

-- 2.3  Verify the staff-booth RPCs are STILL anon-callable (booth 1).
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('verify_staff_pin', 'staff_list_guests', 'staff_create_asset')
ORDER BY p.proname;
-- EXPECT: anon_can_execute = true for all three. If any is false, STOP —
--         the staff booth cannot log in or upload.


-- =====================================================================
-- SECTION 3 — RAISE THE GENERATION CAPS to 700 / 500.
--
-- ASSUMPTION FLAGGED: the plan said "700/500" without naming which event
-- gets which. This assigns 700 to the client event (lynkco-900-vogue,
-- currently 300) and 500 to 'ey' (currently at the 150 default).
-- If that is backwards, swap the two numbers before running 3.1.
-- Cross-check against the SECTION 0.1 output first.
-- =====================================================================

-- 3.1  Apply.
UPDATE public.events SET max_generations = 700 WHERE slug = 'lynkco-900-vogue'
RETURNING slug, max_generations, generations_used;

UPDATE public.events SET max_generations = 500 WHERE slug = 'ey'
RETURNING slug, max_generations, generations_used;
-- EXPECT: 1 row from each. 0 rows means the slug does not exist — check 0.1.

-- 3.2  Verify.
SELECT slug, max_generations, generations_used,
       max_generations - generations_used AS remaining
FROM public.events
WHERE slug IN ('lynkco-900-vogue', 'ey')
ORDER BY slug;
-- EXPECT: lynkco-900-vogue = 700, ey = 500, remaining > 0 for both.


-- =====================================================================
-- SECTION 4 — TRIGGER VERIFICATION (read-only unless 4.2 fails).
--
-- WHY THIS MATTERS: migration 20260612215913 added an `events_hash_pin`
-- BEFORE-trigger that bcrypt-hashed staff_pin on write. Migration
-- 20260613083500 dropped it so PINs are stored plaintext and readable in
-- the dashboard. If the drop never reached this database, the staff PIN
-- is silently re-hashed on every admin save and verify_staff_pin fails —
-- i.e. BOOTH 1 CANNOT LOG IN. Verify before the event, not during it.
-- =====================================================================

-- 4.1  List every trigger on public tables.
SELECT c.relname  AS table_name,
       t.tgname   AS trigger_name,
       p.proname  AS function_name,
       t.tgenabled
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p      ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal AND n.nspname = 'public'
ORDER BY c.relname, t.tgname;
-- EXPECT: NO trigger named 'events_hash_pin'.

-- 4.2  Direct assertion on the PIN trigger.
SELECT count(*) AS events_hash_pin_present
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'events' AND t.tgname = 'events_hash_pin';
-- EXPECT: 0. IF IT RETURNS 1, run the remediation on the next line,
-- then RE-TEST the staff PIN login at /staff/<slug> before continuing:
-- DROP TRIGGER IF EXISTS events_hash_pin ON public.events;

-- 4.3  The auth trigger that must STILL exist (admin signup -> profile row).
SELECT count(*) AS on_auth_user_created_present
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'on_auth_user_created';
-- EXPECT: 1

-- 4.4  Confirm plaintext PINs really are readable (the booth-1 precondition).
SELECT slug, staff_pin,
       (staff_pin ~ '^[0-9]{4,8}$') AS looks_plaintext
FROM public.events
ORDER BY created_at DESC;
-- EXPECT: looks_plaintext = true. A '$2a$...' bcrypt string means 4.2's
--         trigger already re-hashed it — reset the PIN in Admin after
--         dropping the trigger.


-- =====================================================================
-- SECTION 5 — REFUND RPC + CHECK CONSTRAINT.
--
-- WHY: processAssetById consumes a cap slot BEFORE the paid provider
-- call and never gives it back when the call fails. Every provider
-- timeout, policy refusal or upload error permanently burns one paid
-- generation. This creates the refund path.
--
-- ⚠️  READ THIS: creating the function is NOT the whole fix. Nothing in
-- the app calls refund_generation yet — the only correct call site is
-- the catch block of src/lib/photo-processing.server.ts, which is a
-- FROZEN file this session did not touch. Until that call is wired in,
-- section 5 only makes the refund POSSIBLE (and safe to call by hand).
-- The exact 3-line patch is in the session report.
-- =====================================================================

-- 5.1  The refund function. Mirrors consume_generation, floored at 0.
CREATE OR REPLACE FUNCTION public.refund_generation(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ok boolean;
BEGIN
  UPDATE public.events
     SET generations_used = generations_used - 1
   WHERE id = _event_id
     AND generations_used > 0
  RETURNING true INTO _ok;
  RETURN coalesce(_ok, false);
END;
$$;

-- 5.2  Lock it down immediately — a new function is EXECUTE-to-PUBLIC by
--      default, and an anon-callable refund is a cap-bypass in reverse.
REVOKE EXECUTE ON FUNCTION public.refund_generation(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_generation(uuid) TO service_role;

-- 5.3  Verify the function exists and only service_role can call it.
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
WHERE n.nspname = 'public' AND p.proname = 'refund_generation';
-- EXPECT: service_role (EXECUTE) + owner only. No PUBLIC/anon/authenticated.

-- 5.4  Floor guard: generations_used can never go negative, no matter who
--      calls what. Idempotent — safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_generations_used_nonneg'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_generations_used_nonneg CHECK (generations_used >= 0);
  END IF;
END $$;

-- 5.5  Verify the constraint is present and validated.
SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
FROM pg_constraint
WHERE conrelid = 'public.events'::regclass AND contype = 'c'
ORDER BY conname;
-- EXPECT: a row for events_generations_used_nonneg, convalidated = true.

-- 5.6  DELIBERATELY OMITTED: CHECK (generations_used <= max_generations).
--      It reads well but it is a footgun 10 days out — it makes lowering
--      an event's cap below its current usage fail outright, and blocks
--      any manual correction of generations_used. consume_generation
--      already enforces the ceiling atomically at the only write site.
--      Add it later, off-season, if you still want it.

-- 5.7  Smoke test the refund path by hand (safe, self-reverting).
--      Run all three statements together and read the three results.
-- SELECT generations_used AS before_value FROM public.events WHERE slug = 'lynkco-900-vogue';
-- SELECT public.refund_generation(id) AS refunded FROM public.events WHERE slug = 'lynkco-900-vogue';
-- SELECT generations_used AS after_value  FROM public.events WHERE slug = 'lynkco-900-vogue';
-- EXPECT: refunded = true and after_value = before_value - 1 (or refunded
--         = false and unchanged, if usage was already 0). Undo with:
-- UPDATE public.events SET generations_used = generations_used + 1 WHERE slug = 'lynkco-900-vogue';


-- =====================================================================
-- FINAL STATE CHECK — run after every section above.
-- =====================================================================
SELECT e.slug,
       e.max_generations,
       e.generations_used,
       e.max_generations - e.generations_used AS remaining,
       count(a.id) FILTER (WHERE a.process_status = 'done')                          AS done_assets,
       count(a.id) FILTER (WHERE a.process_status = 'failed')                        AS failed_assets,
       count(a.id) FILTER (WHERE a.status = 'hidden')                                AS hidden_assets,
       count(a.id) FILTER (WHERE (a.consent OR a.published)
                             AND a.process_status = 'done'
                             AND a.status <> 'hidden')                               AS wall_visible
FROM public.events e
LEFT JOIN public.assets a ON a.event_id = e.id
GROUP BY e.slug, e.max_generations, e.generations_used
ORDER BY e.slug;
-- `wall_visible` is exactly what getVogueWall now returns per event after
-- the Step 1 code change. For lynkco-900-vogue it should be > 0 once you
-- have admin-published at least one done cover.
