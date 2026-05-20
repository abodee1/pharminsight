-- Health boards lookup
CREATE TABLE IF NOT EXISTS public.health_boards (
  code text PRIMARY KEY,
  name text NOT NULL,
  country text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.health_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_boards_public_read" ON public.health_boards
  FOR SELECT USING (true);

INSERT INTO public.health_boards (code, name, country) VALUES
  ('S08000015', 'Ayrshire and Arran', 'Scotland'),
  ('S08000016', 'Borders', 'Scotland'),
  ('S08000017', 'Dumfries and Galloway', 'Scotland'),
  ('S08000029', 'Fife', 'Scotland'),
  ('S08000019', 'Forth Valley', 'Scotland'),
  ('S08000020', 'Grampian', 'Scotland'),
  ('S08000031', 'Greater Glasgow and Clyde', 'Scotland'),
  ('S08000022', 'Highland', 'Scotland'),
  ('S08000032', 'Lanarkshire', 'Scotland'),
  ('S08000024', 'Lothian', 'Scotland'),
  ('S08000025', 'Orkney', 'Scotland'),
  ('S08000026', 'Shetland', 'Scotland'),
  ('S08000030', 'Tayside', 'Scotland'),
  ('S08000028', 'Western Isles', 'Scotland')
ON CONFLICT (code) DO NOTHING;

-- Ingestion queue
CREATE TABLE IF NOT EXISTS public.ingestion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  dataset text NOT NULL,
  resource_url text NOT NULL,
  year integer,
  month integer,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (source, dataset, resource_url)
);

ALTER TABLE public.ingestion_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ingestion_queue_status_idx ON public.ingestion_queue (status);

-- Ingestion log
CREATE TABLE IF NOT EXISTS public.ingestion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  dataset text NOT NULL,
  resource_url text NOT NULL,
  year integer,
  month integer,
  status text NOT NULL,
  rows_ingested integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingestion_log_public_read" ON public.ingestion_log
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS ingestion_log_source_year_month_idx
  ON public.ingestion_log (source, year, month);

-- New columns on dispensing_data
ALTER TABLE public.dispensing_data
  ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gross_cost numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_source text;

-- Unique constraint for upsert (drop existing duplicates first if any — keep latest)
DELETE FROM public.dispensing_data d
USING public.dispensing_data d2
WHERE d.pharmacy_id = d2.pharmacy_id
  AND d.year = d2.year
  AND d.month = d2.month
  AND d.created_at < d2.created_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispensing_data_pharmacy_year_month_key'
  ) THEN
    ALTER TABLE public.dispensing_data
      ADD CONSTRAINT dispensing_data_pharmacy_year_month_key
      UNIQUE (pharmacy_id, year, month);
  END IF;
END $$;

-- Unique constraint for pharmacies upsert by ods_code
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pharmacies_ods_code_key'
  ) THEN
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_ods_code_key UNIQUE (ods_code);
  END IF;
END $$;