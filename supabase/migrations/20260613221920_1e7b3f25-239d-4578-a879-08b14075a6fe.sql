-- Remove non-aggregate England GP list-size queue entries (demographic breakdowns, maps)
-- that the ingestor cannot parse, and reset stuck items so they retry cleanly.
DELETE FROM public.ingestion_queue
WHERE source = 'NHSBSA_LISTSIZE'
  AND resource_url NOT ILIKE '%gp-reg-pat-prac-all%';

UPDATE public.ingestion_queue
SET status = 'pending', error = NULL, started_at = NULL, attempts = 0,
    last_completed_chunk = -1, leftover_bytes = '', header_line = NULL
WHERE status IN ('processing', 'failed');