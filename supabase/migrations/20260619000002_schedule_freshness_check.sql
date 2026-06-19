-- Schedule the weekly data-freshness check.
-- The hook (check-data-freshness.ts) compares each pipeline's latest CKAN resource against
-- the most recently ingested period in ingestion_log, and triggers the relevant ingest hook
-- if upstream has newer data.
--
-- Runs every Monday at 06:00 UTC (before UK business day starts).

DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'weekly-freshness-check' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'weekly-freshness-check',
  '0 6 * * 1',
  $cron$
  SELECT net.http_post(
    url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/check-data-freshness',
    headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
    body   := '{}'::jsonb,
    timeout_milliseconds := 55000
  )::text;
  $cron$
);
