CREATE OR REPLACE FUNCTION public._apply_pf_counts(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated int;
BEGIN
  WITH src AS (
    SELECT (e->>'ods')::text AS ods,
           (e->>'y')::int    AS y,
           (e->>'m')::int    AS m,
           (e->>'c')::int    AS c
    FROM jsonb_array_elements(payload) e
  )
  UPDATE public.dispensing_data dd
     SET pharmacy_first_count = src.c
    FROM src
    JOIN public.pharmacies p ON p.ods_code = src.ods
   WHERE dd.pharmacy_id = p.id
     AND dd.year = src.y
     AND dd.month = src.m
     AND dd.pharmacy_first_count IS DISTINCT FROM src.c;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;