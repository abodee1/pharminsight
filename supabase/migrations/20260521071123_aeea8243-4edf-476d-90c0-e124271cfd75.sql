
CREATE OR REPLACE FUNCTION public.country_monthly_aggregates(
  p_country text, p_start_year int, p_start_month int, p_end_year int, p_end_month int
) RETURNS TABLE (year int, month int, pharmacy_count int, avg_items numeric, avg_pf numeric, avg_nms numeric, total_items bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT d.year, d.month, COUNT(*)::int, AVG(d.items_dispensed)::numeric, AVG(d.pharmacy_first_count)::numeric, AVG(d.nms_count)::numeric, SUM(d.items_dispensed)::bigint
  FROM dispensing_data d JOIN pharmacies p ON p.id = d.pharmacy_id
  WHERE (p_country IS NULL OR p.country = p_country)
    AND (d.year * 12 + d.month) BETWEEN (p_start_year * 12 + p_start_month) AND (p_end_year * 12 + p_end_month)
  GROUP BY d.year, d.month ORDER BY d.year, d.month;
$$;

CREATE OR REPLACE FUNCTION public.country_split_for_period(p_year int, p_month int)
RETURNS TABLE (country text, total_items bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(p.country, 'Unknown'), SUM(d.items_dispensed)::bigint
  FROM dispensing_data d JOIN pharmacies p ON p.id = d.pharmacy_id
  WHERE d.year = p_year AND d.month = p_month
  GROUP BY COALESCE(p.country, 'Unknown') ORDER BY 2 DESC;
$$;
