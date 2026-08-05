ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_generations integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS generations_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS generation_model text;

CREATE TABLE IF NOT EXISTS public.template_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  user_id uuid,
  model text,
  cost numeric,
  ms integer,
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.template_test_runs TO authenticated;
GRANT ALL ON public.template_test_runs TO service_role;
ALTER TABLE public.template_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read test runs" ON public.template_test_runs;
CREATE POLICY "admins read test runs" ON public.template_test_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Atomic cap consumption: increments only when under the cap.
CREATE OR REPLACE FUNCTION public.consume_generation(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ok boolean;
BEGIN
  UPDATE public.events
     SET generations_used = generations_used + 1
   WHERE id = _event_id
     AND generations_used < max_generations
  RETURNING true INTO _ok;
  RETURN coalesce(_ok, false);
END;
$$;