CREATE TABLE IF NOT EXISTS public._scot_metrics_staging (
  ods_code text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  mcr_registrations integer NOT NULL DEFAULT 0,
  mcr_items integer NOT NULL DEFAULT 0,
  supervised_methadone_doses integer NOT NULL DEFAULT 0,
  smoking_cessation_payment numeric NOT NULL DEFAULT 0
);
ALTER TABLE public._scot_metrics_staging ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._apply_scot_metrics()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  WITH upd AS (
    UPDATE public.dispensing_data dd
    SET mcr_registrations = s.mcr_registrations,
        mcr_items = s.mcr_items,
        supervised_methadone_doses = s.supervised_methadone_doses,
        smoking_cessation_payment = s.smoking_cessation_payment
    FROM public._scot_metrics_staging s
    JOIN public.pharmacies p ON p.ods_code = s.ods_code
    WHERE dd.pharmacy_id = p.id
      AND dd.year = s.year
      AND dd.month = s.month
    RETURNING 1
  )
  SELECT count(*) INTO updated FROM upd;
  RETURN updated;
END;
$$;