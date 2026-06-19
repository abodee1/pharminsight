-- Fix wales-pharmacy-drain cron: remove the OR NOT EXISTS guard that caused the cron to fire
-- every 10 minutes even when nothing was queued.
--
-- Old behaviour: fires if pending/processing items exist OR no NWSSP_WALES rows in ingestion_queue.
-- The second arm meant it fired perpetually because CKAN discovery never queued anything.
--
-- New behaviour: fires only when pending/processing items exist (same idle-guard as all other drains).
-- ingest-wales.ts now logs a single error entry to ingestion_log on first call to surface the
-- broken data source in the admin UI.

DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'wales-pharmacy-drain' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'wales-pharmacy-drain',
  '*/10 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NWSSP_WALES' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-wales',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);
