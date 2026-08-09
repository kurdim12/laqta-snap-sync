ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS shirt_variant text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS display_order integer;
CREATE INDEX IF NOT EXISTS assets_display_order_idx ON public.assets (event_id, display_order);