DROP POLICY IF EXISTS cmq_public_read ON public.company_match_queue;

CREATE POLICY "cmq_admin_read"
ON public.company_match_queue
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

REVOKE SELECT ON public.company_match_queue FROM anon;
GRANT SELECT ON public.company_match_queue TO authenticated;
GRANT ALL ON public.company_match_queue TO service_role;