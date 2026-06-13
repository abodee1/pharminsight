-- Unified pharmacy search: GIN trigram indices + single comprehensive RPC
-- Replaces the dual (basic PostgREST + fuzzy-on-button) pattern with one fast call.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indices for fast LIKE '%term%' and % (similarity) operators
CREATE INDEX IF NOT EXISTS idx_pharmacies_name_trgm
  ON pharmacies USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pharmacies_tname_trgm
  ON pharmacies USING gin(trading_name gin_trgm_ops)
  WHERE trading_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacies_addr_trgm
  ON pharmacies USING gin(address gin_trgm_ops)
  WHERE address IS NOT NULL;

-- Prefix-match indices (text_pattern_ops = fast LIKE 'prefix%')
CREATE INDEX IF NOT EXISTS idx_pharmacies_postcode_prefix
  ON pharmacies (postcode text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_pharmacies_ods_prefix
  ON pharmacies (ods_code text_pattern_ops);

-- Drop old function first (we're changing the return type)
DROP FUNCTION IF EXISTS public.search_pharmacies(text, int);

CREATE FUNCTION public.search_pharmacies(
  p_query text,
  p_limit  int DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  ods_code     text,
  name         text,
  trading_name text,
  address      text,
  postcode     text,
  country      text,
  region       text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH q AS (
  SELECT
    trim(p_query)                                                  AS term,
    upper(trim(p_query))                                           AS uterm,
    lower(trim(p_query))                                           AS lterm,
    replace(lower(trim(p_query)), ' ', '')                         AS compact
),
scored AS (
  SELECT
    p.id, p.ods_code, p.name, p.trading_name,
    p.address, p.postcode, p.country, p.region,
    GREATEST(
      -- Exact ODS code
      CASE WHEN upper(p.ods_code) = q.uterm                                                          THEN 1.00 ELSE 0.0 END,
      -- ODS code prefix
      CASE WHEN upper(p.ods_code) LIKE q.uterm || '%'                                                THEN 0.82 ELSE 0.0 END,
      -- Postcode exact (strip spaces for comparison)
      CASE WHEN replace(lower(coalesce(p.postcode,'')), ' ', '') = q.compact                         THEN 0.96 ELSE 0.0 END,
      -- Postcode prefix
      CASE WHEN replace(lower(coalesce(p.postcode,'')), ' ', '') LIKE q.compact || '%'               THEN 0.90 ELSE 0.0 END,
      -- Trading name: starts with
      CASE WHEN lower(coalesce(p.trading_name,'')) LIKE q.lterm || '%'                               THEN 0.97 ELSE 0.0 END,
      -- Trading name: contains
      CASE WHEN lower(coalesce(p.trading_name,'')) LIKE '%' || q.lterm || '%'                        THEN 0.88 ELSE 0.0 END,
      -- Name: starts with
      CASE WHEN lower(p.name) LIKE q.lterm || '%'                                                    THEN 0.86 ELSE 0.0 END,
      -- Name: contains
      CASE WHEN lower(p.name) LIKE '%' || q.lterm || '%'                                             THEN 0.74 ELSE 0.0 END,
      -- Address: contains
      CASE WHEN lower(coalesce(p.address,'')) LIKE '%' || q.lterm || '%'                             THEN 0.65 ELSE 0.0 END,
      -- Region/town: contains
      CASE WHEN lower(coalesce(p.region,'')) LIKE '%' || q.lterm || '%'                              THEN 0.52 ELSE 0.0 END,
      -- Trigram fuzzy on trading name (catches typos like "Bots" → Boots)
      (coalesce(similarity(p.trading_name, q.term), 0.0) * 0.92),
      -- Trigram fuzzy on name
      (similarity(p.name, q.term) * 0.80)
    )::real AS score
  FROM pharmacies p, q
  WHERE
    upper(p.ods_code)                                          =    q.uterm
    OR upper(p.ods_code)                                       LIKE q.uterm   || '%'
    OR replace(lower(coalesce(p.postcode,'')), ' ', '')        LIKE q.compact || '%'
    OR lower(p.name)                                           LIKE '%' || q.lterm || '%'
    OR lower(coalesce(p.trading_name,''))                      LIKE '%' || q.lterm || '%'
    OR lower(coalesce(p.address,''))                           LIKE '%' || q.lterm || '%'
    OR lower(coalesce(p.region,''))                            LIKE '%' || q.lterm || '%'
    OR p.name                                                  %    q.term          -- trigram
    OR coalesce(p.trading_name,'')                             %    q.term          -- trigram
)
SELECT id, ods_code, name, trading_name, address, postcode, country, region
FROM   scored
WHERE  score > 0.15
ORDER  BY score DESC, name ASC
LIMIT  p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_pharmacies(text, int) TO anon, authenticated, service_role;
