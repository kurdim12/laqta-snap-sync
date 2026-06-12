CREATE POLICY "media public update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');