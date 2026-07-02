-- ============================================================================
-- DRAFT — Phase 5.2 (face-match schema). NOT in migrations/: the feature has no
-- runnable code yet (needs the InsightFace worker + calibration). Promote once
-- Phase 5 is being implemented. Provider decision: insightface (pgvector).
-- ============================================================================
--
-- Face embeddings are BIOMETRIC data: service-role only, zero anon/authenticated
-- RLS access, deleted on consent revocation / guest deletion / event purge.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Guest opt-in (separate from the general consent checkbox).
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS face_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_consent_at timestamptz;

-- Per-event face settings (default OFF; thresholds calibrated during impl).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS face_sort_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_assign_threshold real,
  ADD COLUMN IF NOT EXISTS review_threshold real;

-- ArcFace-class 512-d embeddings. Exactly one of guest_id (enrollment) or
-- asset_id (a face found in a photo) is set.
CREATE TABLE IF NOT EXISTS public.face_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  bbox jsonb,
  quality real,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT face_one_owner CHECK ((guest_id IS NULL) <> (asset_id IS NULL))
);
CREATE INDEX IF NOT EXISTS face_embeddings_hnsw
  ON public.face_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS face_embeddings_event ON public.face_embeddings(event_id);

-- One group photo -> many guest galleries.
CREATE TABLE IF NOT EXISTS public.asset_guests (
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('face_auto','face_review','manual')),
  similarity real,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, guest_id)
);

-- Lock everything down: service role only. No anon/authenticated policies.
ALTER TABLE public.face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.face_embeddings FROM anon, authenticated;
REVOKE ALL ON public.asset_guests FROM anon, authenticated;
GRANT ALL ON public.face_embeddings TO service_role;
GRANT ALL ON public.asset_guests TO service_role;

COMMIT;
