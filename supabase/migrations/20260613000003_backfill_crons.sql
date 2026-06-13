-- Step 2 backfill crons — drain the historical queue for each pipeline.
-- All crons use the same idle-guard pattern as england-gp-drain:
-- only fires net.http_post when pending/processing items actually exist.
-- Once queues are empty the crons become no-ops until new data arrives.

DO $$
DECLARE jid bigint;
BEGIN
  -- Remove any pre-existing versions so we can redefine cleanly.
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN (
    'scotland-gp-linkage-drain',
    'england-listsize-drain',
    'england-pharmacy-drain',
    'scotland-pharmacy-drain',
    'wales-pharmacy-drain',
    'scotland-gp-drain',
    'ni-pharmacy-drain'
  ) LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

-- ── Scotland GP↔pharmacy linkage (quarterly, ~38 files to backfill)
-- Each file is ~200k rows; allow 5-minute cadence.
SELECT cron.schedule(
  'scotland-gp-linkage-drain',
  '*/5 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHS_SCOT_LINKAGE' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-scotland-gp-linkage',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);

-- ── England GP practice list sizes (monthly, ~145 files to backfill)
-- Files are small (~17k rows); 2-minute cadence drains in ~5 hours.
SELECT cron.schedule(
  'england-listsize-drain',
  '*/2 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHSBSA_LISTSIZE' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-england-gp-listsize',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);

-- ── England pharmacy dispensing / NHSBSA (monthly, up to 36 extra files 2011–2014)
-- NHSBSA files are ~50 MB each; 10-minute cadence is conservative.
SELECT cron.schedule(
  'england-pharmacy-drain',
  '*/10 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHSBSA' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-england',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);

-- ── Scotland pharmacy dispensing / PHS (monthly, backfill 2013–2018 monthly gaps)
-- Files are small; 5-minute cadence.
SELECT cron.schedule(
  'scotland-pharmacy-drain',
  '*/5 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'PHS_SCOTLAND' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-scotland',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);

-- ── Wales pharmacy dispensing / NWSSP (new pipeline — all historical files)
-- Start conservatively at 10-minute cadence; CKAN discovery runs on first trigger.
SELECT cron.schedule(
  'wales-pharmacy-drain',
  '*/10 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NWSSP_WALES' AND status IN ('pending','processing')
    ) OR NOT EXISTS (
      -- Also fire if nothing has ever been queued (first discovery run)
      SELECT 1 FROM public.ingestion_queue WHERE source = 'NWSSP_WALES'
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

-- ── Scotland GP prescribing (backfill 2013–2015, ~33 extra months)
-- Files are small monthly CSVs; 3-minute cadence.
SELECT cron.schedule(
  'scotland-gp-drain',
  '*/3 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'NHS_SCOT_GP' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-scotland-gp',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);

-- ── NI pharmacy dispensing (fill the single 2019-07 gap + keep current)
-- BSO files are small; 15-minute cadence is enough once the gap is filled.
SELECT cron.schedule(
  'ni-pharmacy-drain',
  '*/15 * * * *',
  $cron$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ingestion_queue
      WHERE source = 'HSCNI_BSO' AND status IN ('pending','processing')
    )
    THEN net.http_post(
      url    := 'https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app/api/public/hooks/ingest-ni',
      headers:= '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyd3BnemFxeWttc2ZjdXB1Ym94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjk4MzcsImV4cCI6MjA5NDg0NTgzN30.9RZXx6Ovfw2A4bfs6iOZE7wRZCx-fjQ2GKOWjtFj9UQ"}'::jsonb,
      body   := '{}'::jsonb,
      timeout_milliseconds := 110000
    )::text
    ELSE 'idle'
  END;
  $cron$
);
