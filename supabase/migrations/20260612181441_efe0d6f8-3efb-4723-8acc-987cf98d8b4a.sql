
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','staff','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- First signup becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.events TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
-- Public can see live/dryrun events (we'll project safe columns at query level)
CREATE POLICY "public read live events" ON public.events FOR SELECT
  TO anon, authenticated USING (status IN ('live','dryrun'));
CREATE POLICY "admins read all events" ON public.events FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write events" ON public.events FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Guests
CREATE TABLE public.guests (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'primary',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.guests TO anon, authenticated;
GRANT UPDATE, DELETE ON public.guests TO authenticated;
GRANT ALL ON public.guests TO service_role;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read guests by code" ON public.guests FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anyone insert guest into live event" ON public.guests FOR INSERT
  TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.status IN ('live','dryrun')));
CREATE POLICY "admins write guests" ON public.guests FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX guests_event_created ON public.guests(event_id, created_at DESC);

-- Assets
CREATE TABLE public.assets (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  parent_asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  kind text NOT NULL,
  variant text NOT NULL DEFAULT 'original',
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  bytes bigint DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assets TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read ready assets" ON public.assets FOR SELECT
  TO anon, authenticated USING (status = 'ready');
CREATE POLICY "admins all assets" ON public.assets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX assets_event_guest ON public.assets(event_id, guest_id);
CREATE INDEX assets_parent ON public.assets(parent_asset_id);

-- Deliveries
CREATE TABLE public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'gallery',
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage deliveries" ON public.deliveries FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Verify staff PIN: returns event id when correct
CREATE OR REPLACE FUNCTION public.verify_staff_pin(_slug text, _pin text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.events WHERE slug = _slug AND staff_pin = _pin AND status IN ('live','dryrun','draft') LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text,text) TO anon, authenticated;
