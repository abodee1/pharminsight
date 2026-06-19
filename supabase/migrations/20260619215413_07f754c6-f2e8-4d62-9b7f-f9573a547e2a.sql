
-- Lock down companies: signed-in users only
DROP POLICY IF EXISTS companies_public_read ON public.companies;
REVOKE SELECT ON public.companies FROM anon;
GRANT SELECT ON public.companies TO authenticated;
CREATE POLICY companies_authenticated_read ON public.companies
  FOR SELECT TO authenticated USING (true);

-- Lock down dispensing_data: signed-in users only
DROP POLICY IF EXISTS dispensing_public_read ON public.dispensing_data;
REVOKE SELECT ON public.dispensing_data FROM anon;
GRANT SELECT ON public.dispensing_data TO authenticated;
CREATE POLICY dispensing_authenticated_read ON public.dispensing_data
  FOR SELECT TO authenticated USING (true);
