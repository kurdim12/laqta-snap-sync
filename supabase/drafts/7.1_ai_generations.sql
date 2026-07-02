-- ============================================================================
-- DRAFT — Phase 7.1 (AI portrait experience). NOT in migrations/ until wired.
-- Service-role only; per-event toggle default OFF.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  model text NOT NULL,
  cost_usd numeric(10,4),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','quarantined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_generations_event ON public.ai_generations(event_id);
CREATE INDEX IF NOT EXISTS ai_generations_guest ON public.ai_generations(guest_id);

-- Per-event AI config (default OFF) + per-guest cap + budget.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ai_portraits_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_style_prompt text,
  ADD COLUMN IF NOT EXISTS ai_per_guest_cap int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS ai_budget_generations int;

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_generations FROM anon, authenticated;
GRANT ALL ON public.ai_generations TO service_role;

COMMIT;
