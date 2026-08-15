ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS car_reference_url text,
  ADD COLUMN IF NOT EXISTS location_reference_url text,
  ADD COLUMN IF NOT EXISTS requires_ref_images boolean NOT NULL DEFAULT false;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS assets_event_published_idx ON public.assets(event_id, published, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_session_idx ON public.assets(session_id);

INSERT INTO public.events (name, slug, status, staff_pin, config, template_mode, template_prompt, template_quality, template_aspect_ratio, template_model, max_generations, requires_ref_images)
VALUES (
  'LYNK & CO 900 — VOGUE EXPERIENCE',
  'lynkco-900-vogue',
  'live',
  '900900',
  '{"locale":"both","registration":"open","theme":{"primary":"#C9A227","background":"#0B0B0C","text":"#F5F1E8","logoUrl":""},"fields":[],"consentText":{"ar":"أوافق على عرض صورتي على شاشة الفعالية","en":"I agree to display my photo on the event wall"},"successMessage":{"ar":"جاهزة!","en":"Ready!"},"gallery":{"allowDownloadAll":true,"showVideos":false,"mode":"public","requireApproval":false},"selfie":"required","limits":{"maxVideoMB":50,"maxPhotoMB":25}}'::jsonb,
  'ai',
  $prompt$Create a luxury VOGUE-style magazine cover portrait.

IMAGE 1 is the guest — keep their face, identity, expression, skin tone and hair EXACTLY as photographed.
IMAGE 2 is the LYNK & CO 900 car — reproduce the car's exact shape, proportions, grille, lighting signature and colour.
IMAGE 3 is the location — use it as the environment and lighting reference.

Compose an editorial fashion-magazine cover: the guest standing confidently in the foreground, elegantly styled in refined evening wear (black, champagne and ivory palette), the LYNK & CO 900 positioned behind them in the location from IMAGE 3. Cinematic dusk lighting, shallow depth of field, high-end fashion photography, glossy magazine finish, vertical 2:3 framing with clean headroom at the top for cover typography.

Do not add any text, logos, watermarks or captions. Do not alter the guest's facial features.$prompt$,
  'high',
  '2:3',
  'google/gemini-3.1-flash-image',
  300,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  template_mode = EXCLUDED.template_mode,
  template_prompt = EXCLUDED.template_prompt,
  template_quality = EXCLUDED.template_quality,
  template_aspect_ratio = EXCLUDED.template_aspect_ratio,
  template_model = EXCLUDED.template_model,
  requires_ref_images = true;