
-- Fast aggregates for dashboard: monthly country averages
CREATE OR REPLACE FUNCTION public.country_monthly_aggregates(
  p_country text,
  p_start_year int,
  p_start_month int,
  p_end_year int,
  p_end_month int
)
RETURNS TABLE (
  year int,
  month int,
  pharmacy_count int,
  avg_items numeric,
  avg_pf numeric,
  avg_nms numeric,
  total_items bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.year, d.month,
    COUNT(*)::int AS pharmacy_count,
    AVG(d.items_dispensed)::numeric AS avg_items,
    AVG(d.pharmacy_first_count)::numeric AS avg_pf,
    AVG(d.nms_count)::numeric AS avg_nms,
    SUM(d.items_dispensed)::bigint AS total_items
  FROM dispensing_data d
  JOIN pharmacies p ON p.id = d.pharmacy_id
  WHERE (p_country IS NULL OR p.country = p_country)
    AND (d.year * 12 + d.month) BETWEEN (p_start_year * 12 + p_start_month) AND (p_end_year * 12 + p_end_month)
  GROUP BY d.year, d.month
  ORDER BY d.year, d.month;
$$;

-- Country split at a given period
CREATE OR REPLACE FUNCTION public.country_split_for_period(
  p_year int,
  p_month int
)
RETURNS TABLE (country text, total_items bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.country, 'Unknown') AS country, SUM(d.items_dispensed)::bigint AS total_items
  FROM dispensing_data d
  JOIN pharmacies p ON p.id = d.pharmacy_id
  WHERE d.year = p_year AND d.month = p_month
  GROUP BY COALESCE(p.country, 'Unknown')
  ORDER BY total_items DESC;
$$;

GRANT EXECUTE ON FUNCTION public.country_monthly_aggregates(text, int, int, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.country_split_for_period(int, int) TO anon, authenticated;
