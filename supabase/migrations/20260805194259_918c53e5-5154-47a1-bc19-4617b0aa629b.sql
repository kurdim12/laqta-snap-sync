DROP VIEW IF EXISTS public.events_public;

CREATE VIEW public.events_public
WITH (security_invoker = on) AS
SELECT
  e.id,
  e.slug,
  e.name,
  e.status,
  e.config,
  e.created_at,
  e.template_mode,
  e.template_frame_url
FROM public.events e;

GRANT SELECT ON public.events_public TO anon, authenticated;