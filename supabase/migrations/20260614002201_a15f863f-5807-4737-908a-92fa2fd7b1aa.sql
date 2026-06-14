
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS trading_name text;

CREATE OR REPLACE FUNCTION public.search_pharmacies(p_query text, p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid, ods_code text, name text, trading_name text,
  address text, postcode text, country text, region text, score real
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (SELECT lower(trim(p_query)) AS term)
  SELECT p.id, p.ods_code, p.name, p.trading_name, p.address, p.postcode, p.country, p.region,
         GREATEST(
           similarity(lower(p.name), q.term),
           similarity(lower(coalesce(p.trading_name,'')), q.term),
           similarity(lower(coalesce(p.address,'')), q.term) * 0.6,
           similarity(lower(coalesce(p.postcode,'')), q.term) * 0.7
         ) AS score
  FROM public.pharmacies p, q
  WHERE lower(p.name) % q.term
     OR lower(coalesce(p.trading_name,'')) % q.term
     OR lower(coalesce(p.address,'')) % q.term
     OR lower(coalesce(p.postcode,'')) % q.term
  ORDER BY score DESC
  LIMIT p_limit;
$$;
