
CREATE OR REPLACE FUNCTION public.deprivation_set_centroids(
  p_nation text,
  p_codes text[],
  p_lats double precision[],
  p_lngs double precision[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  IF array_length(p_codes, 1) IS DISTINCT FROM array_length(p_lats, 1)
    OR array_length(p_codes, 1) IS DISTINCT FROM array_length(p_lngs, 1) THEN
    RAISE EXCEPTION 'codes/lats/lngs length mismatch';
  END IF;
  WITH src AS (
    SELECT unnest(p_codes) AS code,
           unnest(p_lats) AS lat,
           unnest(p_lngs) AS lng
  ),
  upd AS (
    UPDATE public.deprivation_zones z
       SET lat = src.lat, lng = src.lng, updated_at = now()
      FROM src
     WHERE z.nation = p_nation
       AND z.zone_code = src.code
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION public.deprivation_set_centroids(text, text[], double precision[], double precision[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deprivation_set_centroids(text, text[], double precision[], double precision[]) TO service_role;
