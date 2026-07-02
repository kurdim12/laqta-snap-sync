-- ============================================================================
-- DRAFT — Phase 6.1 (autonomous pipeline job queue). NOT in migrations/ until
-- the worker exists. Service-role only.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('moderate','match_faces','enroll_face','notify')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  -- Idempotency key per (asset, type) so re-enqueues don't duplicate work.
  idem_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_jobs_claim
  ON public.pipeline_jobs(status, run_after) WHERE status = 'queued';

-- Per-event pipeline mode + moderation state on assets.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS pipeline_mode text NOT NULL DEFAULT 'manual'
    CHECK (pipeline_mode IN ('manual','assisted','autonomous'));
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS moderation text NOT NULL DEFAULT 'pending'
    CHECK (moderation IN ('pending','clean','quarantined'));

ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_jobs FROM anon, authenticated;
GRANT ALL ON public.pipeline_jobs TO service_role;

-- The worker claims jobs with:
--   SELECT ... FROM pipeline_jobs
--    WHERE status='queued' AND run_after <= now()
--    ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT N;

COMMIT;
