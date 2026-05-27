
CREATE TABLE public.gp_practices (
  practice_code text PRIMARY KEY,
  practice_name text,
  country text,
  health_board text,
  postcode text,
  status_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gp_practices TO anon, authenticated;
GRANT ALL ON public.gp_practices TO service_role;
ALTER TABLE public.gp_practices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp_practices_public_read" ON public.gp_practices FOR SELECT USING (true);

CREATE TABLE public.gp_prescribing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_code text NOT NULL,
  year int NOT NULL,
  month int NOT NULL,
  country text NOT NULL,
  total_items bigint NOT NULL DEFAULT 0,
  total_nic numeric NOT NULL DEFAULT 0,
  is_provisional boolean NOT NULL DEFAULT false,
  data_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_code, year, month, country)
);
CREATE INDEX gp_prescribing_period_idx ON public.gp_prescribing (country, year, month);
GRANT SELECT ON public.gp_prescribing TO anon, authenticated;
GRANT ALL ON public.gp_prescribing TO service_role;
ALTER TABLE public.gp_prescribing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp_prescribing_public_read" ON public.gp_prescribing FOR SELECT USING (true);

CREATE TABLE public.gp_dispensing_by_pharmacy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_ods_code text NOT NULL,
  pharmacy_name text,
  health_board text,
  year int NOT NULL,
  month int NOT NULL,
  items_dispensed bigint NOT NULL DEFAULT 0,
  gross_cost numeric NOT NULL DEFAULT 0,
  data_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_ods_code, year, month)
);
CREATE INDEX gp_disp_pharm_period_idx ON public.gp_dispensing_by_pharmacy (year, month);
GRANT SELECT ON public.gp_dispensing_by_pharmacy TO anon, authenticated;
GRANT ALL ON public.gp_dispensing_by_pharmacy TO service_role;
ALTER TABLE public.gp_dispensing_by_pharmacy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp_disp_pharm_public_read" ON public.gp_dispensing_by_pharmacy FOR SELECT USING (true);

CREATE TABLE public.gp_pharmacy_linkage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_code text NOT NULL,
  pharmacy_ods_code text NOT NULL,
  year int NOT NULL,
  month int NOT NULL,
  items_dispensed bigint NOT NULL DEFAULT 0,
  is_provisional boolean NOT NULL DEFAULT false,
  data_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_code, pharmacy_ods_code, year, month)
);
CREATE INDEX gp_link_practice_idx ON public.gp_pharmacy_linkage (practice_code);
CREATE INDEX gp_link_pharmacy_idx ON public.gp_pharmacy_linkage (pharmacy_ods_code);
CREATE INDEX gp_link_period_idx ON public.gp_pharmacy_linkage (year, month);
GRANT SELECT ON public.gp_pharmacy_linkage TO anon, authenticated;
GRANT ALL ON public.gp_pharmacy_linkage TO service_role;
ALTER TABLE public.gp_pharmacy_linkage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp_link_public_read" ON public.gp_pharmacy_linkage FOR SELECT USING (true);

CREATE TABLE public.gp_list_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_code text NOT NULL,
  list_size_date date NOT NULL,
  registered_patients int NOT NULL DEFAULT 0,
  country text NOT NULL,
  data_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_code, list_size_date)
);
CREATE INDEX gp_list_country_date_idx ON public.gp_list_sizes (country, list_size_date);
GRANT SELECT ON public.gp_list_sizes TO anon, authenticated;
GRANT ALL ON public.gp_list_sizes TO service_role;
ALTER TABLE public.gp_list_sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp_list_public_read" ON public.gp_list_sizes FOR SELECT USING (true);
