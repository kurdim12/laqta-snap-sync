update public.events set config = config
  || jsonb_build_object(
    'backdrop', jsonb_build_object(
      'palette', jsonb_build_array(
        jsonb_build_object('from','#6D28D9','to','#2563EB'),
        jsonb_build_object('from','#06B6D4','to','#34D399'),
        jsonb_build_object('from','#4F46E5','to','#7C3AED'),
        jsonb_build_object('from','#F43F5E','to','#EC4899'),
        jsonb_build_object('from','#22D3EE','to','#3B82F6'),
        jsonb_build_object('from','#A855F7','to','#1E1B4B')
      ),
      'halftone', true,
      'halftoneOpacity', 16,
      'aspect', '4:5'
    ),
    'wall', jsonb_build_object(
      'columns', 3,
      'intervalSec', 8,
      'tiles', jsonb_build_array(
        jsonb_build_object('text','CHANGING MOBILITY FOREVER','background','#0A0A0A','color','#22C55E'),
        jsonb_build_object('text','LYNK&CO','background','#14B8A6','color','#FFFFFF'),
        jsonb_build_object('text','PERSONAL OPEN CO','background','#0A0A0A','color','#F43F5E'),
        jsonb_build_object('text','LYNK&CO','background','#7C3AED','color','#FFFFFF'),
        jsonb_build_object('text','WHY NOT','background','#22D3EE','color','#1D4ED8'),
        jsonb_build_object('text','LYNK&CO','background','#F43F5E','color','#FFFFFF')
      )
    )
  )
where slug = 'test';