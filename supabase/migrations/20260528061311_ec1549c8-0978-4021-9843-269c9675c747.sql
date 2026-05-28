
ALTER TABLE public.ingestion_queue
  ADD COLUMN IF NOT EXISTS total_bytes bigint,
  ADD COLUMN IF NOT EXISTS chunk_size bigint,
  ADD COLUMN IF NOT EXISTS total_chunks integer,
  ADD COLUMN IF NOT EXISTS last_completed_chunk integer NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS leftover_bytes text NOT NULL DEFAULT '';

-- Additive upsert for GP prescribing: each chunk adds its partial totals
-- onto any existing row for (practice_code, year, month, country).
CREATE OR REPLACE FUNCTION public.gp_prescribing_add(rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH src AS (
    SELECT
      (x->>'practice_code')::text  AS practice_code,
      (x->>'year')::int            AS year,
      (x->>'month')::int           AS month,
      (x->>'country')::text        AS country,
      COALESCE((x->>'total_items')::bigint, 0)  AS total_items,
      COALESCE((x->>'total_nic')::numeric, 0)   AS total_nic,
      COALESCE((x->>'is_provisional')::boolean, false) AS is_provisional,
      (x->>'data_source')::text    AS data_source
    FROM jsonb_array_elements(rows) AS x
  ),
  ins AS (
    INSERT INTO public.gp_prescribing
      (practice_code, year, month, country, total_items, total_nic, is_provisional, data_source)
    SELECT practice_code, year, month, country, total_items, total_nic, is_provisional, data_source
    FROM src
    ON CONFLICT (practice_code, year, month, country) DO UPDATE
      SET total_items    = public.gp_prescribing.total_items + EXCLUDED.total_items,
          total_nic      = public.gp_prescribing.total_nic   + EXCLUDED.total_nic,
          is_provisional = EXCLUDED.is_provisional,
          data_source    = EXCLUDED.data_source
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gp_prescribing_add(jsonb) TO service_role;
