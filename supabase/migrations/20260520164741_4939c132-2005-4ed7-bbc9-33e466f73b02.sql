ALTER TABLE public.dispensing_data
  ADD COLUMN IF NOT EXISTS pharmacy_first_services jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS dispensing_pf_services_gin
  ON public.dispensing_data USING GIN (pharmacy_first_services);