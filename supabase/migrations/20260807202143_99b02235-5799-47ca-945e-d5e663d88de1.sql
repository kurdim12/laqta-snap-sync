DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%template_mode%' LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.events DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.events
  ADD CONSTRAINT events_template_mode_check
  CHECK (template_mode IN ('none','frame','ai','backdrop'));