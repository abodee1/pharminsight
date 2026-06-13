-- Fix dispensing_data rows where data_source is NULL for England pharmacies.
-- These were ingested before the data_source column was tracked in ingest-england.ts.
-- Scotland (PHS_SCOTLAND) and NI (HSCNI_BSO) rows already have data_source set;
-- Wales (NWSSP_WALES) has no rows yet. Only England rows can be NULL here.
UPDATE public.dispensing_data dd
SET data_source = 'NHSBSA'
FROM public.pharmacies p
WHERE dd.pharmacy_id = p.id
  AND p.country = 'England'
  AND dd.data_source IS NULL;
