
ALTER TABLE public.ingestion_queue
  ADD COLUMN IF NOT EXISTS header_line text;
