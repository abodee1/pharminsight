
CREATE TABLE public.deprivation_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_code text NOT NULL,
  zone_name text,
  nation text NOT NULL CHECK (nation IN ('england','scotland')),
  overall_decile smallint,
  overall_rank integer,
  overall_score numeric,
  income_decile smallint,
  employment_decile smallint,
  health_decile smallint,
  education_decile smallint,
  crime_decile smallint,
  housing_decile smallint,
  access_decile smallint,
  idaci_decile smallint,
  idaopi_decile smallint,
  population integer,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nation, zone_code)
);

CREATE INDEX deprivation_zones_latlng_idx ON public.deprivation_zones (lat, lng);
CREATE INDEX deprivation_zones_nation_idx ON public.deprivation_zones (nation);

GRANT SELECT ON public.deprivation_zones TO anon, authenticated;
GRANT ALL ON public.deprivation_zones TO service_role;

ALTER TABLE public.deprivation_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read deprivation zones"
  ON public.deprivation_zones FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.deprivation_in_radius(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_nation text
)
RETURNS TABLE(
  zone_count integer,
  avg_overall numeric,
  avg_income numeric,
  avg_employment numeric,
  avg_health numeric,
  avg_education numeric,
  avg_crime numeric,
  avg_housing numeric,
  avg_access numeric,
  avg_idaci numeric,
  avg_idaopi numeric,
  total_population bigint
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
  )
  SELECT
    COUNT(*)::int AS zone_count,
    AVG(overall_decile)::numeric AS avg_overall,
    AVG(income_decile)::numeric AS avg_income,
    AVG(employment_decile)::numeric AS avg_employment,
    AVG(health_decile)::numeric AS avg_health,
    AVG(education_decile)::numeric AS avg_education,
    AVG(crime_decile)::numeric AS avg_crime,
    AVG(housing_decile)::numeric AS avg_housing,
    AVG(access_decile)::numeric AS avg_access,
    AVG(idaci_decile)::numeric AS avg_idaci,
    AVG(idaopi_decile)::numeric AS avg_idaopi,
    COALESCE(SUM(population),0)::bigint AS total_population
  FROM inr;
$$;

GRANT EXECUTE ON FUNCTION public.deprivation_in_radius(double precision, double precision, integer, text) TO anon, authenticated, service_role;
