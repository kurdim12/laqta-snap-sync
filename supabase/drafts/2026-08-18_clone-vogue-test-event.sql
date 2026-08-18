-- =====================================================================
-- Clone lynkco-900-vogue into a throwaway TEST event.
--
-- Purpose: exercise the whole booth-2 path — capture, generate, publish,
-- wall — without touching the client event's rows or its paid cap.
--
-- Do NOT use Admin's "Clone as dry run" button for this. It copies only
-- name/slug/status/config/staff_pin and drops template_mode,
-- template_prompt, template_model, template_quality,
-- template_aspect_ratio, car_reference_url, location_reference_url,
-- requires_ref_images, template_frame_url and max_generations — so its
-- clone silently generates nothing (processAssetById returns "skipped"
-- when template_prompt is null).
--
-- The clone gets its OWN generation cap (25) so a runaway test cannot
-- spend the client event's budget. Reference images are copied by URL,
-- not by file, so both events point at the same stored images.
--
-- Run section by section. Section 4 deletes everything when you're done.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — Check the source is complete before cloning it.
-- =====================================================================
SELECT slug, status, template_mode,
       template_prompt IS NOT NULL      AS has_prompt,
       template_model,
       template_quality,
       template_aspect_ratio,
       template_frame_url IS NOT NULL   AS has_frame,
       requires_ref_images,
       car_reference_url IS NOT NULL      AS has_car_ref,
       location_reference_url IS NOT NULL AS has_location_ref,
       max_generations, generations_used,
       config->'gallery'->>'mode' AS gallery_mode
FROM public.events
WHERE slug = 'lynkco-900-vogue';
-- EXPECT: template_mode 'ai', has_prompt t, has_car_ref t, has_location_ref t.
-- If requires_ref_images is true and either ref is FALSE, STOP — the clone
-- will fail every generation with "Missing car or location reference image".


-- =====================================================================
-- SECTION 2 — Create the clone.
-- Safe to re-run: it re-syncs the template fields from the source and
-- leaves generations_used alone, so your test progress is not reset.
-- =====================================================================
INSERT INTO public.events (
  name, slug, status, staff_pin, config,
  template_mode, template_prompt, template_quality, template_aspect_ratio,
  template_model, template_frame_url, template_reference_url,
  car_reference_url, location_reference_url, requires_ref_images,
  max_generations, generations_used
)
SELECT
  'LYNK & CO 900 — VOGUE (TEST)',
  'vogue-test',
  'dryrun',                 -- never 'live': keeps it off any public event list
  '112233',                 -- distinct staff PIN so you cannot confuse consoles
  -- same config, but with the new public-wall gate already switched ON,
  -- because that gate is the thing under test.
  jsonb_set(e.config, '{gallery,publishedOnly}', 'true'::jsonb, true),
  e.template_mode, e.template_prompt, e.template_quality, e.template_aspect_ratio,
  e.template_model, e.template_frame_url, e.template_reference_url,
  e.car_reference_url, e.location_reference_url, e.requires_ref_images,
  25,                       -- its own small budget; raise if you need more
  0
FROM public.events e
WHERE e.slug = 'lynkco-900-vogue'
ON CONFLICT (slug) DO UPDATE SET
  name                   = EXCLUDED.name,
  status                 = EXCLUDED.status,
  staff_pin              = EXCLUDED.staff_pin,
  config                 = EXCLUDED.config,
  template_mode          = EXCLUDED.template_mode,
  template_prompt        = EXCLUDED.template_prompt,
  template_quality       = EXCLUDED.template_quality,
  template_aspect_ratio  = EXCLUDED.template_aspect_ratio,
  template_model         = EXCLUDED.template_model,
  template_frame_url     = EXCLUDED.template_frame_url,
  template_reference_url = EXCLUDED.template_reference_url,
  car_reference_url      = EXCLUDED.car_reference_url,
  location_reference_url = EXCLUDED.location_reference_url,
  requires_ref_images    = EXCLUDED.requires_ref_images,
  max_generations        = EXCLUDED.max_generations
RETURNING id, slug, status, max_generations;
-- EXPECT: 1 row, slug 'vogue-test'.


-- =====================================================================
-- SECTION 2.5 — PARKING THE TEST EVENT (read this).
--
-- 'dryrun' is the lowest status the vogue booth actually works at:
-- getVogueEvent reports open only for live/dryrun, and mintVogueUpload /
-- registerVogueCover reject anything else. But listPublicEvents returns
-- live+dryrun and the homepage at "/" renders that list — so while the
-- clone is in dryrun, "LYNK & CO 900 — VOGUE (TEST)" is visible to
-- anyone who opens the site root.
--
-- So: park it in 'draft' whenever you are not actively testing. Direct
-- URLs keep working for admin and the staff PIN; only the guest booth
-- goes to "isn't open yet", which is exactly what you want when idle.
-- =====================================================================

-- 2.5a  PARK — hide it from the homepage between test runs.
-- UPDATE public.events SET status = 'draft'  WHERE slug = 'vogue-test';

-- 2.5b  UNPARK — put it back before a test run.
-- UPDATE public.events SET status = 'dryrun' WHERE slug = 'vogue-test';

-- 2.5c  What the homepage currently exposes.
SELECT slug, name, status
FROM public.events
WHERE status IN ('live', 'dryrun')
ORDER BY slug;
-- EXPECT while testing: lynkco-900-vogue AND vogue-test.
-- Before the client event: run 2.5a so only lynkco-900-vogue is listed.


-- =====================================================================
-- SECTION 3 — Verify the clone matches the source everywhere it matters.
-- =====================================================================

-- 3.1  Side by side. Every column except the ones deliberately changed
--      (name, slug, status, staff_pin, max_generations, publishedOnly)
--      must be identical on both rows.
SELECT slug, status, staff_pin, template_mode,
       md5(coalesce(template_prompt, ''))  AS prompt_hash,
       template_model, template_quality, template_aspect_ratio,
       requires_ref_images,
       car_reference_url IS NOT NULL      AS has_car_ref,
       location_reference_url IS NOT NULL AS has_location_ref,
       template_frame_url IS NOT NULL     AS has_frame,
       max_generations, generations_used,
       config->'gallery'->>'mode'          AS gallery_mode,
       config->'gallery'->>'publishedOnly' AS published_only
FROM public.events
WHERE slug IN ('lynkco-900-vogue', 'vogue-test')
ORDER BY slug;
-- EXPECT: prompt_hash, template_model, template_quality,
--         template_aspect_ratio, requires_ref_images, has_car_ref,
--         has_location_ref, has_frame, gallery_mode all MATCH.
--         vogue-test: published_only 'true', generations_used 0.

-- 3.2  Machine check — anything that should have copied but did not.
SELECT 'template_prompt'    AS column_name WHERE (SELECT template_prompt        FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT template_prompt        FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'template_model'          WHERE (SELECT template_model         FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT template_model         FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'template_quality'        WHERE (SELECT template_quality       FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT template_quality       FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'template_aspect_ratio'   WHERE (SELECT template_aspect_ratio  FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT template_aspect_ratio  FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'car_reference_url'       WHERE (SELECT car_reference_url      FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT car_reference_url      FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'location_reference_url'  WHERE (SELECT location_reference_url FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT location_reference_url FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'template_frame_url'      WHERE (SELECT template_frame_url     FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT template_frame_url     FROM public.events WHERE slug='lynkco-900-vogue')
UNION ALL
SELECT 'requires_ref_images'     WHERE (SELECT requires_ref_images    FROM public.events WHERE slug='vogue-test') IS DISTINCT FROM (SELECT requires_ref_images    FROM public.events WHERE slug='lynkco-900-vogue');
-- EXPECT: ZERO ROWS. Any row names a column that did not clone.

-- 3.3  Live state of the test event while you run through the flow.
SELECT a.created_at, a.process_status, a.consent, a.published, a.approved,
       a.status, a.processed_url IS NOT NULL AS has_file, a.error_message
FROM public.assets a
JOIN public.events e ON e.id = a.event_id
WHERE e.slug = 'vogue-test' AND a.variant = 'original'
ORDER BY a.created_at DESC;
-- A cover reaches BOTH walls once: process_status='done'
--   AND (consent OR published) AND status <> 'hidden'.


-- =====================================================================
-- SECTION 4 — TEARDOWN. Run when the test is finished.
-- Deleting the event cascades its asset ROWS (assets.event_id is
-- ON DELETE CASCADE). It does NOT delete the files in storage — remove
-- the `<event-id>/` folder in the Storage browser if you want those gone.
-- =====================================================================

-- 4.1  Note the folder to clean up in Storage, THEN delete.
-- SELECT id AS storage_folder_to_delete FROM public.events WHERE slug = 'vogue-test';

-- 4.2  Delete the test event and all its rows.
-- DELETE FROM public.events WHERE slug = 'vogue-test';

-- 4.3  Confirm it is gone and the client event is untouched.
-- SELECT slug, status, max_generations, generations_used
-- FROM public.events ORDER BY slug;
