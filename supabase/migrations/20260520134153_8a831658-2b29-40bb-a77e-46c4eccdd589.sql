CREATE TABLE IF NOT EXISTS public.schema_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  dataset text,
  resource_url text,
  missing_field text NOT NULL,
  tried_variants text[] NOT NULL DEFAULT '{}'::text[],
  available_headers text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schema_alerts_public_read" ON public.schema_alerts FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_schema_alerts_created_at ON public.schema_alerts (created_at DESC);