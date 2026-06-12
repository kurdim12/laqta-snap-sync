
-- 1. Remove public read on assets (server fn with service role returns signed URLs instead)
DROP POLICY IF EXISTS "public read ready assets" ON public.assets;

-- 2. Remove public read on media storage (server fn issues signed URLs instead)
DROP POLICY IF EXISTS "media read for active event objects" ON storage.objects;

-- 3. Allow admins to read media bucket (admin panel previews still need to work)
CREATE POLICY "media admins read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'));

-- 4. Drop unsafe guest lookup that returned form_data/consent/selfie_path
DROP FUNCTION IF EXISTS public.get_guest_by_code(text);
