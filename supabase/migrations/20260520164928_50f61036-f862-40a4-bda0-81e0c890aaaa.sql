ALTER TABLE public._pf_services_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION public._apply_pf_services() FROM PUBLIC, anon, authenticated;