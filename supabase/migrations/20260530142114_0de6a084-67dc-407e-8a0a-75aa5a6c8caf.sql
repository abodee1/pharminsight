CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS pharmacies_name_trgm_idx ON public.pharmacies USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pharmacies_address_trgm_idx ON public.pharmacies USING gin (address gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_pharmacies_fuzzy(p_query text, p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid, ods_code text, name text, address text,
  postcode text, country text, region text, score real
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH q AS (SELECT lower(trim(p_query)) AS term)
  SELECT p.id, p.ods_code, p.name, p.address, p.postcode, p.country, p.region,
         GREATEST(
           similarity(lower(p.name), q.term),
           similarity(lower(coalesce(p.address,'')), q.term) * 0.6,
           similarity(lower(coalesce(p.postcode,'')), q.term) * 0.7
         ) AS score
  FROM public.pharmacies p, q
  WHERE lower(p.name) % q.term
     OR lower(coalesce(p.address,'')) % q.term
     OR lower(coalesce(p.postcode,'')) % q.term
  ORDER BY score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_pharmacies_fuzzy(text, int) TO anon, authenticated, service_role;