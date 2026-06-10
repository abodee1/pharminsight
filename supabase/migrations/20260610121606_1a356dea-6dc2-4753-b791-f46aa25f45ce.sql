
-- 1. Track retry attempts on each queue item
ALTER TABLE public.ingestion_queue
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- 2. Replace the monthly England GP cron with a continuous drainer.
--    Runs every 2 minutes and only fires when there is work pending/processing.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'england-gp-monthly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'england-gp-drain';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'england-gp-drain',
  '*/2 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHSBSA_GP' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-england-gp',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);
