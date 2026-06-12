
-- 1) Recreate events_public with security_invoker so it respects caller's RLS
ALTER VIEW public.events_public SET (security_invoker = on);

-- 2) Fix broken storage policies that referenced events.name instead of object name
DROP POLICY IF EXISTS "media scoped insert" ON storage.objects;
DROP POLICY IF EXISTS "media update for active event objects" ON storage.objects;

CREATE POLICY "media scoped insert"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status = ANY (ARRAY['live','dryrun'])
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
);

CREATE POLICY "media scoped update"
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status = ANY (ARRAY['live','dryrun'])
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
)
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.status = ANY (ARRAY['live','dryrun'])
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
);
