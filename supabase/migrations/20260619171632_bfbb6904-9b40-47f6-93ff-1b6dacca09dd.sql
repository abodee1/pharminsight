
CREATE OR REPLACE FUNCTION public.catchment_zones_by_decile(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_nation text,
  p_decile integer
) RETURNS TABLE(zone_code text, zone_name text, overall_decile smallint, population integer, dist_m double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH bbox AS (
    SELECT
      p_lat - (p_radius_m::float / 111320.0) AS min_lat,
      p_lat + (p_radius_m::float / 111320.0) AS max_lat,
      p_lng - (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS min_lng,
      p_lng + (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS max_lng
  ),
  cand AS (
    SELECT z.*,
      (2 * 6371000 * asin(sqrt(
        power(sin(radians(z.lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(z.lat)) *
        power(sin(radians(z.lng - p_lng) / 2), 2)
      ))) AS dist_m
    FROM public.deprivation_zones z, bbox
    WHERE z.nation = p_nation
      AND z.overall_decile = p_decile
      AND z.lat IS NOT NULL AND z.lng IS NOT NULL
      AND z.lat BETWEEN bbox.min_lat AND bbox.max_lat
      AND z.lng BETWEEN bbox.min_lng AND bbox.max_lng
  )
  SELECT zone_code, zone_name, overall_decile, population, dist_m
  FROM cand
  WHERE dist_m <= p_radius_m
  ORDER BY dist_m ASC
  LIMIT 50;
$function$;

GRANT EXECUTE ON FUNCTION public.catchment_zones_by_decile(double precision, double precision, integer, text, integer) TO anon, authenticated, service_role;
