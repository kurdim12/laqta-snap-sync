
-- Lock down SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text, text) TO anon, authenticated;

-- Storage policies for media bucket
CREATE POLICY "media public read" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'media');
CREATE POLICY "media public insert" ON storage.objects FOR INSERT
  TO anon, authenticated WITH CHECK (bucket_id = 'media');
CREATE POLICY "media admins update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "media admins delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'media' AND public.has_role(auth.uid(),'admin'));
