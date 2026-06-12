
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS selfie_path text;

ALTER TABLE public.guests REPLICA IDENTITY FULL;
ALTER TABLE public.assets REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guests;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.assets;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
