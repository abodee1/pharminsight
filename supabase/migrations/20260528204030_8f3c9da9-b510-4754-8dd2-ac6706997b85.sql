ALTER TABLE public.gp_practices
  ADD COLUMN IF NOT EXISTS address_line text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS google_place_id text;

CREATE UNIQUE INDEX IF NOT EXISTS gp_practices_google_place_id_key
  ON public.gp_practices (google_place_id)
  WHERE google_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gp_practices_latlng_idx
  ON public.gp_practices (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Server functions use the service-role client which already bypasses RLS,
-- so no extra grants/policies are needed for the cache writes.

-- RPC: find nearest practices to a point (uses simple bbox + haversine in SQL).
CREATE OR REPLACE FUNCTION public.gp_practices_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer DEFAULT 400,
  p_limit integer DEFAULT 20
) RETURNS TABLE (
  practice_code text,
  practice_name text,
  postcode text,
  address_line text,
  lat double precision,
  lng double precision,
  google_place_id text,
  distance_m double precision
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH bbox AS (
    SELECT
      p_lat - (p_radius_m::float / 111320.0) AS min_lat,
      p_lat + (p_radius_m::float / 111320.0) AS max_lat,
      p_lng - (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS min_lng,
      p_lng + (p_radius_m::float / (111320.0 * cos(radians(p_lat)))) AS max_lng
  )
  SELECT
    gp.practice_code, gp.practice_name, gp.postcode, gp.address_line,
    gp.lat, gp.lng, gp.google_place_id,
    (2 * 6371000 * asin(sqrt(
      power(sin(radians(gp.lat - p_lat) / 2), 2) +
      cos(radians(p_lat)) * cos(radians(gp.lat)) *
      power(sin(radians(gp.lng - p_lng) / 2), 2)
    )))::double precision AS distance_m
  FROM public.gp_practices gp, bbox
  WHERE gp.lat IS NOT NULL AND gp.lng IS NOT NULL
    AND gp.lat BETWEEN bbox.min_lat AND bbox.max_lat
    AND gp.lng BETWEEN bbox.min_lng AND bbox.max_lng
  ORDER BY distance_m ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.gp_practices_near(double precision, double precision, integer, integer) TO anon, authenticated, service_role;