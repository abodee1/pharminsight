-- Search overhaul: trading names, enhanced fuzzy RPC, recent searches
-- All changes are idempotent (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT)

-- pg_trgm already enabled, but include for safety
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Add trading_name column to pharmacies
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS trading_name text;

-- 2. Chain alias table
CREATE TABLE IF NOT EXISTS pharmacy_trading_names (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_name_pattern text NOT NULL UNIQUE,
  trading_name text NOT NULL,
  chain_group text,
  created_at timestamptz DEFAULT now()
);

-- Public read only — anyone can search
ALTER TABLE pharmacy_trading_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_trading_names" ON pharmacy_trading_names
  FOR SELECT USING (true);

-- 3. Seed chain mappings (upsert so re-runs are safe)
INSERT INTO pharmacy_trading_names (legal_name_pattern, trading_name, chain_group) VALUES
  ('BOOTS UK LIMITED',           'Boots',                'Boots'),
  ('BOOTS',                      'Boots',                'Boots'),
  ('LLOYDS PHARMACY',            'Lloyds Pharmacy',      'Lloyds'),
  ('WELL PHARMACY',              'Well',                 'Well'),
  ('BESTWAY NATIONAL CHEMISTS',  'Well',                 'Well'),
  ('BESTWAY MEDICALS',           'Well',                 'Well'),
  ('L ROWLAND & CO',             'Rowlands Pharmacy',    'Rowlands'),
  ('ROWLANDS PHARMACY',          'Rowlands Pharmacy',    'Rowlands'),
  ('ALPHEGA PHARMACY',           'Alphega Pharmacy',     'Alphega'),
  ('ALLIANCE HEALTHCARE',        'Alphega Pharmacy',     'Alphega'),
  ('COHENS CHEMIST',             'Cohens Chemist',       'Cohens'),
  ('DAY LEWIS',                  'Day Lewis Pharmacy',   'Day Lewis'),
  ('MOSS PHARMACY',              'Moss Pharmacy',        'Moss'),
  ('PEAK PHARMACY',              'Peak Pharmacy',        'Peak'),
  ('NUMARK',                     'Numark Pharmacy',      'Numark'),
  ('WELDRICKS',                  'Weldricks Pharmacy',   'Weldricks'),
  ('JHOOTS PHARMACY',            'Jhoots Pharmacy',      'Jhoots'),
  ('PAYDENS',                    'Paydens Pharmacy',     'Paydens'),
  ('HEALTHCARE AT HOME',         'Healthcare at Home',   'Healthcare at Home'),
  ('PHARMACY2U',                 'Pharmacy2U',           'Pharmacy2U'),
  ('CHEMIST DIRECT',             'Chemist Direct',       'Chemist Direct'),
  ('SUPERDRUG',                  'Superdrug Pharmacy',   'Superdrug'),
  ('ASDA PHARMACY',              'Asda Pharmacy',        'Asda'),
  ('TESCO PHARMACY',             'Tesco Pharmacy',       'Tesco'),
  ('MORRISONS PHARMACY',         'Morrisons Pharmacy',   'Morrisons'),
  ('SAINSBURYS PHARMACY',        'Sainsbury''s Pharmacy','Sainsburys'),
  ('CO-OPERATIVE PHARMACY',      'Co-op Pharmacy',       'Co-op'),
  ('GORDONS CHEMISTS',           'Gordons Chemists',     'Gordons'),
  ('MEDICARE',                   'Medicare Pharmacy',    'Medicare')
ON CONFLICT (legal_name_pattern) DO UPDATE
  SET trading_name = EXCLUDED.trading_name,
      chain_group  = EXCLUDED.chain_group;

-- 4. Backfill trading_name for pharmacies that match a known chain pattern
UPDATE pharmacies p
SET trading_name = (
  SELECT t.trading_name
  FROM pharmacy_trading_names t
  WHERE upper(p.name) LIKE '%' || upper(t.legal_name_pattern) || '%'
  ORDER BY length(t.legal_name_pattern) DESC
  LIMIT 1
)
WHERE p.trading_name IS NULL;

-- 5. GIN index on trading_name for trigram search
CREATE INDEX IF NOT EXISTS idx_pharmacies_trading_name_trgm
  ON pharmacies USING gin (trading_name gin_trgm_ops)
  WHERE trading_name IS NOT NULL;

-- 6. Replace search_pharmacies_fuzzy with enhanced version
--    (DROP first because return type is changing — adds trading_name + chain_group)
DROP FUNCTION IF EXISTS public.search_pharmacies_fuzzy(text, int);

CREATE FUNCTION public.search_pharmacies_fuzzy(
  p_query text,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  ods_code     text,
  name         text,
  trading_name text,
  address      text,
  postcode     text,
  country      text,
  region       text,
  chain_group  text,
  score        real
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH q AS (SELECT trim(p_query) AS term),
  scored AS (
    SELECT
      p.id,
      p.ods_code,
      p.name,
      p.trading_name,
      p.address,
      p.postcode,
      p.country,
      p.region,
      (
        SELECT t.chain_group
        FROM pharmacy_trading_names t
        WHERE upper(p.name) LIKE '%' || upper(t.legal_name_pattern) || '%'
        ORDER BY length(t.legal_name_pattern) DESC
        LIMIT 1
      ) AS chain_group,
      GREATEST(
        -- ODS exact match
        CASE WHEN upper(p.ods_code) = upper(q.term) THEN 1.0 ELSE 0.0 END::real,
        -- Postcode prefix
        CASE WHEN p.postcode ILIKE q.term || '%'    THEN 0.85 ELSE 0.0 END::real,
        -- Trading name similarity (highest name weight)
        COALESCE(similarity(p.trading_name, q.term), 0.0)::real,
        -- Legal name similarity
        similarity(p.name, q.term)::real,
        -- Address (lower weight)
        (similarity(COALESCE(p.address, ''), q.term) * 0.5)::real
      ) AS score
    FROM pharmacies p, q
    WHERE
      upper(p.ods_code) = upper(q.term)
      OR p.postcode ILIKE q.term || '%'
      OR lower(p.name)                          % lower(q.term)
      OR (p.trading_name IS NOT NULL AND lower(p.trading_name) % lower(q.term))
      OR lower(COALESCE(p.address, ''))         % lower(q.term)
  )
  SELECT s.id, s.ods_code, s.name, s.trading_name, s.address, s.postcode,
         s.country, s.region, s.chain_group, s.score
  FROM scored s
  WHERE s.score > 0.1
  ORDER BY s.score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_pharmacies_fuzzy(text, int) TO anon, authenticated, service_role;

-- 7. Recent searches table (per-user, max 10 enforced in application)
CREATE TABLE IF NOT EXISTS recent_searches (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_id uuid REFERENCES pharmacies(id) ON DELETE CASCADE,
  ods_code    text NOT NULL,
  name        text NOT NULL,
  trading_name text,
  address     text,
  postcode    text,
  country     text,
  region      text,
  searched_at timestamptz DEFAULT now(),
  UNIQUE (user_id, ods_code)
);

ALTER TABLE recent_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_recent_searches" ON recent_searches
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recent_searches_user_time
  ON recent_searches (user_id, searched_at DESC);
