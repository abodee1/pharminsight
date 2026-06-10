-- 1. app_role enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role security-definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. freshness check log
CREATE TABLE IF NOT EXISTS public.ingestion_freshness_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  upstream_latest_year int,
  upstream_latest_month int,
  ingested_latest_year int,
  ingested_latest_month int,
  new_data_found boolean NOT NULL DEFAULT false,
  items_queued int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  error text,
  details jsonb
);

CREATE INDEX IF NOT EXISTS idx_freshness_source_time
  ON public.ingestion_freshness_check (source, checked_at DESC);

GRANT SELECT ON public.ingestion_freshness_check TO authenticated;
GRANT ALL ON public.ingestion_freshness_check TO service_role;

ALTER TABLE public.ingestion_freshness_check ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read freshness" ON public.ingestion_freshness_check;
CREATE POLICY "Admins read freshness" ON public.ingestion_freshness_check
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. seed admin role for the known email if present
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(email) = 'abodee.alhasso@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;