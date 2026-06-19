-- Add missing drain cron for Scotland GP practice populations (list sizes).
-- The ingest-scotland-gp-listsize hook (source: NHS_SCOT_LISTSIZE) has always existed
-- but no pg_cron job was ever created for it, so its queue was never drained automatically.
-- Quarterly publications are small files; a 15-minute cadence is sufficient.

DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'scotland-listsize-drain' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'scotland-listsize-drain',
  '*/15 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHS_SCOT_LISTSIZE' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-scotland-gp-listsize',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);
