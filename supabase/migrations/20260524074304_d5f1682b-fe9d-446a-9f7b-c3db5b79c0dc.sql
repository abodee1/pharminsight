
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  company_number text UNIQUE,
  company_name text,
  company_status text,
  incorporation_date date,
  sic_codes text[],
  registered_address text,
  registered_postcode text,
  last_accounts_date date,
  accounts_type text,
  turnover numeric,
  gross_profit numeric,
  operating_profit numeric,
  net_profit numeric,
  total_payroll numeric,
  avg_employees int,
  net_assets numeric,
  accounts_year int,
  match_confidence text,
  matched_by text,
  is_chain boolean DEFAULT false,
  chain_name text,
  raw_filing jsonb,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_pharmacy ON public.companies(pharmacy_id);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_public_read" ON public.companies FOR SELECT USING (true);
CREATE POLICY "companies_auth_write" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "companies_auth_update" ON public.companies FOR UPDATE TO authenticated USING (true);

CREATE TABLE public.company_match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  candidate_company_number text,
  candidate_company_name text,
  candidate_address text,
  candidate_postcode text,
  match_score int,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cmq_pharmacy ON public.company_match_queue(pharmacy_id);
ALTER TABLE public.company_match_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cmq_public_read" ON public.company_match_queue FOR SELECT USING (true);
CREATE POLICY "cmq_auth_write" ON public.company_match_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cmq_auth_update" ON public.company_match_queue FOR UPDATE TO authenticated USING (true);

CREATE TABLE public.saved_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  notes text,
  is_shortlisted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, pharmacy_id)
);
CREATE INDEX idx_sa_user ON public.saved_analyses(user_id);
ALTER TABLE public.saved_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sa_select_own" ON public.saved_analyses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sa_insert_own" ON public.saved_analyses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sa_update_own" ON public.saved_analyses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "sa_delete_own" ON public.saved_analyses FOR DELETE USING (auth.uid() = user_id);
