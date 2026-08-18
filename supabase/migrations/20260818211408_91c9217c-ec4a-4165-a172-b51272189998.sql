UPDATE public.events SET
  template_reference_url = NULL,
  car_reference_url = NULL,
  location_reference_url = NULL,
  requires_ref_images = false,
  template_model = 'google/gemini-3.1-flash-image',
  template_aspect_ratio = '2:3',
  template_quality = 'medium',
  template_mode = 'ai'
WHERE slug = 'vogue-test';