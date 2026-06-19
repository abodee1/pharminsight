
CREATE OR REPLACE FUNCTION public.catchment_breakdown(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_nation text
) RETURNS jsonb
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
      AND z.lat IS NOT NULL AND z.lng IS NOT NULL
      AND z.lat BETWEEN bbox.min_lat AND bbox.max_lat
      AND z.lng BETWEEN bbox.min_lng AND bbox.max_lng
  ),
  inr AS (
    SELECT * FROM cand WHERE dist_m <= p_radius_m
  ),
  dist AS (
    SELECT overall_decile AS decile,
           COUNT(*)::int AS zone_count,
           COALESCE(SUM(population),0)::bigint AS population
    FROM inr
    WHERE overall_decile IS NOT NULL
    GROUP BY overall_decile
  ),
  most AS (
    SELECT zone_name, overall_decile, population
    FROM inr
    WHERE overall_decile IS NOT NULL
    ORDER BY overall_decile ASC, dist_m ASC
    LIMIT 1
  ),
  least AS (
    SELECT zone_name, overall_decile, population
    FROM inr
    WHERE overall_decile IS NOT NULL
    ORDER BY overall_decile DESC, dist_m ASC
    LIMIT 1
  ),
  tot AS (
    SELECT
      COALESCE(SUM(population),0)::bigint AS total_pop,
      COALESCE(SUM(CASE WHEN overall_decile <= 3 THEN population ELSE 0 END),0)::bigint AS pop_most_deprived_30,
      COALESCE(SUM(CASE WHEN overall_decile >= 8 THEN population ELSE 0 END),0)::bigint AS pop_least_deprived_30,
      COUNT(*) FILTER (WHERE overall_decile <= 3)::int AS zones_most_deprived_30,
      AVG(idaci_decile)::numeric AS avg_idaci,
      AVG(idaopi_decile)::numeric AS avg_idaopi
    FROM inr
  )
  SELECT jsonb_build_object(
    'distribution', COALESCE((SELECT jsonb_agg(jsonb_build_object('decile', decile, 'zone_count', zone_count, 'population', population) ORDER BY decile) FROM dist), '[]'::jsonb),
    'most_deprived', (SELECT row_to_json(most) FROM most),
    'least_deprived', (SELECT row_to_json(least) FROM least),
    'totals', (SELECT row_to_json(tot) FROM tot)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.catchment_breakdown(double precision, double precision, integer, text) TO anon, authenticated, service_role;
