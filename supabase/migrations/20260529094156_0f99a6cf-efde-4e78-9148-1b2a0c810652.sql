ALTER TABLE public.gp_practices
  ADD COLUMN IF NOT EXISTS google_name text,
  ADD COLUMN IF NOT EXISTS name_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS gp_practices_name_verified_at_idx
  ON public.gp_practices (name_verified_at);
