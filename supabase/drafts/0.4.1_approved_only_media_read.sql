-- ============================================================================
-- DRAFT — Phase 0.4.1. NOT in migrations/ on purpose: applying this BEFORE the
-- staff console's selfie thumbnails are re-routed through a server function
-- would break them (staff currently signs selfie objects with the anon client).
-- Promote into migrations/ only after the selfie rewire below is in place and
-- verified locally.
-- ============================================================================
--
-- Today anon may sign/read ANY object in a live event's folder ("media read for
-- live event objects"), including originals of not-yet-approved photos. After
-- the galleries were moved to server-side signing (Phase 0.2 for /g/CODE; do
-- the same for the public wall), the anon role only needs to read APPROVED
-- public-wall objects — everything else is signed server-side with the service
-- role.
--
-- Prerequisite client changes (see PHASE0_NOTES.md):
--   * public wall  -> load via getPublicGalleryBySlug (server-signed)
--   * staff selfies -> sign via getStaffSelfieUrls (PIN-gated server fn); pass
--                      the resulting URL into <SelfieAvatar signedUrl=... />

BEGIN;

DROP POLICY IF EXISTS "media read for live event objects" ON storage.objects;

-- Anon may read a media object only if it is an APPROVED, ready asset of a
-- live/dryrun public-wall event. `name` is the object path == assets.storage_path.
CREATE POLICY "media read approved public-wall objects"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.storage_path = storage.objects.name
      AND a.status = 'ready'
      AND a.approved IS TRUE
      AND public.event_is_public_wall(a.event_id)
  )
);

COMMIT;
