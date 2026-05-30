UPDATE public.pharmacies p
SET lat = s.lat, lng = s.lng
FROM public._pharmacy_geo_backfill s
WHERE p.id = s.id AND p.lat IS NULL;

DROP TABLE public._pharmacy_geo_backfill;