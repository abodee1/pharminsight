-- Restore trading_name column and search_pharmacies_fuzzy after search-overhaul revert.
-- All statements are idempotent — safe to run even if the objects already exist.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Ensure trading_name column exists on pharmacies
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS trading_name text;

-- 2. Chain alias table
CREATE TABLE IF NOT EXISTS pharmacy_trading_names (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_name_pattern  text NOT NULL UNIQUE,
  trading_name        text NOT NULL,
  chain_group         text,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE pharmacy_trading_names ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pharmacy_trading_names'
      AND policyname = 'public_read_trading_names'
  ) THEN
    CREATE POLICY "public_read_trading_names" ON pharmacy_trading_names
      FOR SELECT USING (true);
  END IF;
END $$;

-- 3. Seed / refresh chain aliases (upsert so re-runs are safe)
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
  ('DAY LEWIS',                  'Day Lewis',            'Day Lewis'),
  ('MOSS PHARMACY',              'Moss Pharmacy',        'Moss'),
  ('PEAK PHARMACY',              'Peak Pharmacy',        'Peak'),
  ('JHOOTS PHARMACY',            'Jhoots Pharmacy',      'Jhoots'),
  ('MEDICINECHEST',              'MedicineChest',        'MedicineChest'),
  ('PHARMACY2U',                 'Pharmacy2U',           'Pharmacy2U'),
  ('WELL',                       'Well',                 'Well'),
  ('ROWLANDS',                   'Rowlands Pharmacy',    'Rowlands'),
  ('SUPERDRUG',                  'Superdrug',            'Superdrug'),
  ('ASDA PHARMACY',              'Asda Pharmacy',        'Asda'),
  ('SAINSBURYS PHARMACY',        'Sainsbury''s Pharmacy','Sainsburys'),
  ('TESCO PHARMACY',             'Tesco Pharmacy',       'Tesco'),
  ('MORRISONS PHARMACY',         'Morrisons Pharmacy',   'Morrisons'),
  ('HEALTH & BEAUTY',            'Boots',                'Boots')
ON CONFLICT (legal_name_pattern) DO UPDATE
  SET trading_name = EXCLUDED.trading_name,
      chain_group  = EXCLUDED.chain_group;

-- 4. Back-fill trading_name on pharmacies from alias table
UPDATE pharmacies p
SET trading_name = (
  SELECT t.trading_name
  FROM pharmacy_trading_names t
  WHERE upper(p.name) LIKE '%' || upper(t.legal_name_pattern) || '%'
  ORDER BY length(t.legal_name_pattern) DESC
  LIMIT 1
)
WHERE trading_name IS NULL;

-- 5. (Re)create search_pharmacies_fuzzy with trading_name + chain_group in return type
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
        CASE WHEN upper(p.ods_code) = upper(q.term) THEN 1.0 ELSE 0.0 END::real,
        CASE WHEN p.postcode ILIKE q.term || '%'    THEN 0.85 ELSE 0.0 END::real,
        COALESCE(similarity(p.trading_name, q.term), 0.0)::real,
        similarity(p.name, q.term)::real,
        (similarity(COALESCE(p.address, ''), q.term) * 0.5)::real
      ) AS score
    FROM pharmacies p, q
    WHERE
      upper(p.ods_code) = upper(q.term)
      OR p.postcode ILIKE q.term || '%'
      OR lower(p.name)                         % lower(q.term)
      OR (p.trading_name IS NOT NULL AND lower(p.trading_name) % lower(q.term))
      OR lower(COALESCE(p.address, ''))        % lower(q.term)
  )
  SELECT s.id, s.ods_code, s.name, s.trading_name, s.address, s.postcode,
         s.country, s.region, s.chain_group, s.score
  FROM scored s
  WHERE s.score > 0.1
  ORDER BY s.score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_pharmacies_fuzzy(text, int) TO anon, authenticated, service_role;
