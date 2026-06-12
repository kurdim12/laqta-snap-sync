CREATE POLICY "staff insert assets into live event"
ON public.assets FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = assets.event_id
      AND e.status IN ('live','dryrun')
  )
);

CREATE POLICY "staff update own-event assets"
ON public.assets FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = assets.event_id
      AND e.status IN ('live','dryrun')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = assets.event_id
      AND e.status IN ('live','dryrun')
  )
);