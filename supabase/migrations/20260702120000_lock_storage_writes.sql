-- Phase 0.1 — remove anonymous write access to the media bucket.
--
-- The previous "media scoped insert" / "media scoped update" policies granted
-- the anon role INSERT/UPDATE on storage.objects for any live event's folder.
-- Because approved object paths are anon-readable for public-wall events, this
-- allowed overwrite / defacement and storage cost-abuse by anyone holding the
-- publishable key — not merely appends.
--
-- Staff and guest uploads now go through short-lived SIGNED UPLOAD URLs minted
-- by server functions (mintStaffUploadUrls / mintGuestSelfieUrl) only after the
-- caller is authorized (staff PIN / guest code) and the path, MIME and size are
-- validated. Signed-URL uploads bypass RLS via a one-time token, so no anon
-- write policy is required. Admins keep direct writes via has_role('admin').
--
-- Reversible: to roll back, recreate the two dropped policies from migration
-- 20260613143000 and (optionally) clear the bucket limits set below.

BEGIN;

-- 1. Drop the anonymous write policies (the vulnerability).
DROP POLICY IF EXISTS "media scoped insert" ON storage.objects;
DROP POLICY IF EXISTS "media scoped update" ON storage.objects;

-- 2. Admins already have UPDATE / DELETE / SELECT policies on the media bucket
--    but not INSERT (they previously rode the blanket policy above). Add the
--    missing INSERT so the admin dashboard's direct uploads keep working.
DROP POLICY IF EXISTS "media admins insert" ON storage.objects;
CREATE POLICY "media admins insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'));

-- 3. Enforce size + MIME at the bucket level. This is a hard server-side
--    backstop that applies to signed-URL uploads too, independent of any
--    client-reported values.
UPDATE storage.buckets
   SET file_size_limit = 209715200, -- 200 MB ceiling
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/heic','image/heif',
         'video/mp4','video/quicktime'
       ]
 WHERE id = 'media';

COMMIT;
