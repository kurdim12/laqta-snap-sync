ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS template_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS template_prompt text,
  ADD COLUMN IF NOT EXISTS template_reference_url text,
  ADD COLUMN IF NOT EXISTS template_frame_url text,
  ADD COLUMN IF NOT EXISTS template_quality text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS template_aspect_ratio text NOT NULL DEFAULT '1024x1024';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_template_mode_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_template_mode_check CHECK (template_mode IN ('none','frame','ai'));

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS original_url text,
  ADD COLUMN IF NOT EXISTS processed_url text,
  ADD COLUMN IF NOT EXISTS process_status text NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS generation_cost numeric,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_finished_at timestamptz;

ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_process_status_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_process_status_check CHECK (process_status IN ('pending','processing','done','failed'));

CREATE INDEX IF NOT EXISTS assets_process_status_idx ON public.assets (process_status) WHERE process_status IN ('pending','processing');