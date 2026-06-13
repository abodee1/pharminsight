DROP POLICY IF EXISTS ingestion_log_public_read ON public.ingestion_log;
DROP POLICY IF EXISTS schema_alerts_public_read ON public.schema_alerts;

CREATE POLICY ingestion_log_admin_read ON public.ingestion_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY schema_alerts_admin_read ON public.schema_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE SELECT ON public.ingestion_log FROM anon;
REVOKE SELECT ON public.schema_alerts FROM anon;