
-- Cache table for landing dashboard
CREATE TABLE IF NOT EXISTS public.landing_cache (
  id int PRIMARY KEY DEFAULT 1,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landing_cache_singleton CHECK (id = 1)
);

GRANT SELECT ON public.landing_cache TO anon, authenticated;
GRANT ALL ON public.landing_cache TO service_role;
ALTER TABLE public.landing_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landing_cache_read ON public.landing_cache;
CREATE POLICY landing_cache_read ON public.landing_cache FOR SELECT USING (true);

-- Refresh function (security definer, longer timeout)
CREATE OR REPLACE FUNCTION public.refresh_landing_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := public.public_landing_data_compute();
  INSERT INTO public.landing_cache(id, payload, updated_at)
  VALUES (1, payload, now())
  ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
END $$;

-- Rename existing heavy function -> compute
CREATE OR REPLACE FUNCTION public.public_landing_data_compute()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
declare
  ly int; lm int;
  latest_d date;
  result jsonb;
begin
  select year, month into ly, lm
  from public.dispensing_data
  group by year, month
  having count(*) > 5000
  order by year desc, month desc
  limit 1;

  if ly is null then
    return jsonb_build_object('period', null);
  end if;

  latest_d := make_date(ly, lm, 1);

  result := jsonb_build_object(
    'period', jsonb_build_object('year', ly, 'month', lm),
    'totals_now', (
      select jsonb_build_object(
        'items', coalesce(sum(items_dispensed),0)::bigint,
        'pf',    coalesce(sum(pharmacy_first_count),0)::bigint,
        'nms',   coalesce(sum(nms_count),0)::bigint,
        'eps',   coalesce(sum(eps_items),0)::bigint,
        'pharmacies', count(distinct pharmacy_id)
      )
      from public.dispensing_data
      where year = ly and month = lm
    ),
    'top_items', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select p.ods_code as ods, p.name, p.region, p.country, d.items_dispensed as value
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and d.items_dispensed > 0
        order by d.items_dispensed desc limit 10
      ) t
    ),
    'top_pf', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select p.ods_code as ods, p.name, p.region, p.country, d.pharmacy_first_count as value
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and d.pharmacy_first_count > 0
        order by d.pharmacy_first_count desc limit 10
      ) t
    ),
    'top_nms', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select p.ods_code as ods, p.name, p.region, p.country, d.nms_count as value
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and d.nms_count > 0
        order by d.nms_count desc limit 10
      ) t
    ),
    'top_eps', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select p.ods_code as ods, p.name, p.region, p.country, d.eps_items as value
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and d.eps_items > 0
        order by d.eps_items desc limit 10
      ) t
    ),
    'totals_trend', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.year, t.month), '[]'::jsonb) from (
        select year, month,
          sum(items_dispensed)::bigint as items,
          sum(eps_items)::bigint as eps,
          sum(pharmacy_first_count)::bigint as pf,
          sum(nms_count)::bigint as nms
        from public.dispensing_data
        where make_date(year, month, 1) >= (latest_d - interval '23 months')
          and make_date(year, month, 1) <= latest_d
        group by year, month
      ) t
    ),
    'top_regions', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.value desc), '[]'::jsonb) from (
        select p.region, p.country,
          sum(d.items_dispensed)::bigint as value,
          count(distinct d.pharmacy_id)::int as pharmacies
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and p.region is not null
        group by p.region, p.country
        order by value desc limit 12
      ) t
    ),
    'by_country', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.value desc), '[]'::jsonb) from (
        select p.country,
          sum(d.items_dispensed)::bigint as value,
          sum(d.pharmacy_first_count)::bigint as pf,
          sum(d.nms_count)::bigint as nms,
          count(distinct d.pharmacy_id)::int as pharmacies
        from public.dispensing_data d join public.pharmacies p on p.id = d.pharmacy_id
        where d.year = ly and d.month = lm and p.country is not null
        group by p.country
      ) t
    )
  );
  return result;
end $$;

-- Replace public_landing_data to read from cache (instant); auto-refresh if missing
CREATE OR REPLACE FUNCTION public.public_landing_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p jsonb;
BEGIN
  SELECT payload INTO p FROM public.landing_cache WHERE id = 1;
  RETURN COALESCE(p, jsonb_build_object('period', null));
END $$;

GRANT EXECUTE ON FUNCTION public.public_landing_data() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_landing_cache() TO service_role;

-- Initial populate
SELECT public.refresh_landing_cache();
