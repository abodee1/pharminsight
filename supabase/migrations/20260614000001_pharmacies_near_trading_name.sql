-- Add trading_name to pharmacies_near RPC return so UI can apply proper display names
CREATE OR REPLACE FUNCTION public.pharmacies_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer DEFAULT 1600,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  id uuid,
  ods_code text,
  name text,
  trading_name text,
  address text,
  postcode text,
  country text,
  region text,
  lat double precision,
  lng double precision,
  distance_m double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH bbox AS (
    SELECT
      p_lat - (p_radius_m::float / 111320.0) AS min_lat,
      p_lat + (p_radius_m::float / 111320.0) AS max_lat,
      p_lng - (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS min_lng,
      p_lng + (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS max_lng
  )
  SELECT
    p.id, p.ods_code, p.name, p.trading_name, p.address, p.postcode, p.country, p.region,
    p.lat, p.lng,
    (2 * 6371000 * asin(sqrt(
      power(sin(radians(p.lat - p_lat) / 2), 2) +
      cos(radians(p_lat)) * cos(radians(p.lat)) *
      power(sin(radians(p.lng - p_lng) / 2), 2)
    )))::double precision AS distance_m
  FROM public.pharmacies p, bbox
  WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
    AND p.lat BETWEEN bbox.min_lat AND bbox.max_lat
    AND p.lng BETWEEN bbox.min_lng AND bbox.max_lng
  ORDER BY distance_m ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.pharmacies_near(double precision, double precision, integer, integer) TO anon, authenticated, service_role;
