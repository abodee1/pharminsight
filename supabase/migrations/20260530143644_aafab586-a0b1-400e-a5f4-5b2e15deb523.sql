CREATE TABLE IF NOT EXISTS public._pharmacy_geo_backfill (
  id uuid PRIMARY KEY,
  lat double precision NOT NULL,
  lng double precision NOT NULL
);
GRANT SELECT, INSERT ON public._pharmacy_geo_backfill TO anon, authenticated, service_role;
ALTER TABLE public._pharmacy_geo_backfill ENABLE ROW LEVEL SECURITY;
CREATE POLICY "_pharmacy_geo_backfill_all" ON public._pharmacy_geo_backfill FOR ALL USING (true) WITH CHECK (true);