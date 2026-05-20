CREATE TABLE IF NOT EXISTS public._pf_services_staging (
  ods_code text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  services jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS _pf_services_staging_lookup
  ON public._pf_services_staging (ods_code, year, month);

CREATE OR REPLACE FUNCTION public._apply_pf_services()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated_count integer;
BEGIN
  UPDATE public.dispensing_data d
    SET pharmacy_first_services = s.services
    FROM public._pf_services_staging s
    JOIN public.pharmacies p ON p.ods_code = s.ods_code
    WHERE d.pharmacy_id = p.id
      AND d.year = s.year
      AND d.month = s.month;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;