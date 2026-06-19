-- 20260619000001 Fix wales-pharmacy-drain cron guard
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

-- 20260619000002 Schedule weekly freshness check
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

-- 20260619000003 Add scotland-listsize-drain
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