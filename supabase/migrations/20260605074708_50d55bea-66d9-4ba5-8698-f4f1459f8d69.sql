
-- 1) companies: drop overly-permissive INSERT/UPDATE policies. Service role bypasses RLS,
--    so removing the policies fully locks down writes from anon/authenticated.
DROP POLICY IF EXISTS companies_auth_write ON public.companies;
DROP POLICY IF EXISTS companies_auth_update ON public.companies;

-- 2) company_match_queue: replace blanket auth writes with ownership-scoped policies.
DROP POLICY IF EXISTS cmq_auth_write ON public.company_match_queue;
DROP POLICY IF EXISTS cmq_auth_update ON public.company_match_queue;

CREATE POLICY cmq_owner_insert ON public.company_match_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    pharmacy_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_pharmacy up
      WHERE up.pharmacy_id = company_match_queue.pharmacy_id
        AND up.user_id = auth.uid()
    )
  );

CREATE POLICY cmq_owner_update ON public.company_match_queue
  FOR UPDATE TO authenticated
  USING (
    pharmacy_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_pharmacy up
      WHERE up.pharmacy_id = company_match_queue.pharmacy_id
        AND up.user_id = auth.uid()
    )
  )
  WITH CHECK (
    pharmacy_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_pharmacy up
      WHERE up.pharmacy_id = company_match_queue.pharmacy_id
        AND up.user_id = auth.uid()
    )
  );

-- 3) ingestion_queue: explicit deny policy so the linter's "RLS enabled, no policy" stops firing.
--    Service role bypasses RLS and continues to manage the queue.
DROP POLICY IF EXISTS ingestion_queue_no_client_access ON public.ingestion_queue;
CREATE POLICY ingestion_queue_no_client_access ON public.ingestion_queue
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
