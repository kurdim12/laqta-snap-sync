insert into public.events (slug, name, status, staff_pin, config)
values (
  'demo',
  'LAQTA Demo Event',
  'dryrun',
  '4242',
  jsonb_build_object(
    'locale', 'both',
    'theme', jsonb_build_object('primary', '#C9A227', 'background', '#0E0E10', 'text', '#FAFAF7', 'logoUrl', ''),
    'fields', jsonb_build_array(
      jsonb_build_object('key','name','type','text','required',true,'label',jsonb_build_object('ar','الاسم','en','Name')),
      jsonb_build_object('key','phone','type','tel','required',true,'label',jsonb_build_object('ar','رقم الهاتف','en','Phone')),
      jsonb_build_object('key','email','type','email','required',false,'label',jsonb_build_object('ar','الإيميل','en','Email'))
    ),
    'consentText', jsonb_build_object('ar','أوافق على استخدام صوري لأغراض الفعالية','en','I agree to my photos being used for this event'),
    'successMessage', jsonb_build_object('ar','تم! صورك رح توصلك هون','en','Done! Your photos will appear here'),
    'gallery', jsonb_build_object('allowDownloadAll', true, 'showVideos', true),
    'limits', jsonb_build_object('maxVideoMB', 50, 'maxPhotoMB', 25)
  )
)
on conflict (slug) do nothing;