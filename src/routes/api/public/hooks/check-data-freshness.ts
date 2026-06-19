// Weekly data-freshness checker.
//
// For every active CKAN-published pipeline:
//   1. Ask the publisher's CKAN package_show for the latest YYYYMM resource
//   2. Compare to the latest period we have successfully ingested (ingestion_log)
//   3. If upstream is newer → POST to the matching /api/public/hooks/<hook> to
//      enqueue the missing period(s)
//   4. Record one row in public.ingestion_freshness_check per source
//
// Called by pg_cron every Monday morning + manual trigger from the admin UI.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

type CkanSource = {
  source: string;       // ingestion_log.source
  label: string;
  ckanBase: string;
  dataset: string;
  hook: string;         // /api/public/hooks/<hook>
};

const CKAN_SOURCES: CkanSource[] = [
  {
    source: "NHSBSA",
    label: "England — pharmacy dispensing",
    ckanBase: "https://opendata.nhsbsa.net/api/3/action",
    dataset: "pharmacy-and-appliance-contractor-dispensing-data",
    hook: "ingest-england",
  },
  {
    source: "NHSBSA_GP",
    label: "England — GP prescribing (EPD)",
    ckanBase: "https://opendata.nhsbsa.net/api/3/action",
    dataset: "english-prescribing-data-epd",
    hook: "ingest-england-gp",
  },
  {
    source: "PHS_SCOTLAND",
    label: "Scotland — community pharmacy",
    ckanBase: "https://www.opendata.nhs.scot/api/3/action",
    dataset: "prescriptions-in-the-community",
    hook: "ingest-scotland",
  },
  {
    source: "NHS_SCOT_GP",
    label: "Scotland — GP prescribing",
    ckanBase: "https://www.opendata.nhs.scot/api/3/action",
    dataset: "prescriptions-in-the-community",
    hook: "ingest-scotland-gp",
  },
  {
    // NI BSO dispensing data published via OpenDataNI on data.gov.uk CKAN
    source: "HSCNI_BSO",
    label: "Northern Ireland — pharmacy dispensing (BSO)",
    ckanBase: "https://ckan.publishing.service.gov.uk/api/3/action",
    dataset: "dispensing-by-contractor",
    hook: "ingest-ni",
  },
];

type CkanResource = { id: string; name: string; url: string };

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseYearMonth(s: string): { y: number; m: number } | null {
  // 1. YYYYMM numeric (e.g. in URL: pitc202409 or in name: 202604)
  const m1 = s.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (m1) return { y: +m1[1], m: +m1[2] };
  // 2. Word month + year (e.g. "April 2026" — used in NI BSO resource names)
  const m2 = s.match(/\b([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (m2) {
    const key = m2[1].toLowerCase();
    const month = MONTH_NAMES[key] ?? Object.entries(MONTH_NAMES).find(([k]) => k.startsWith(key))?.[1];
    if (month) return { y: +m2[2], m: month };
  }
  return null;
}

// Fetch with a hard 8-second timeout so slow CKAN portals don't stall the handler
async function fetchWithTimeout(url: string, opts?: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function upstreamLatest(src: CkanSource): Promise<{ y: number; m: number } | null> {
  const res = await fetchWithTimeout(`${src.ckanBase}/package_show?id=${encodeURIComponent(src.dataset)}`);
  if (!res.ok) throw new Error(`CKAN ${res.status}`);
  const j: any = await res.json();
  const resources: CkanResource[] = j?.result?.resources ?? [];
  let best: { y: number; m: number } | null = null;
  for (const r of resources) {
    const ym = parseYearMonth(`${r.url} ${r.name}`);
    if (!ym) continue;
    if (!best || ym.y * 12 + ym.m > best.y * 12 + best.m) best = ym;
  }
  return best;
}

async function ingestedLatest(source: string): Promise<{ y: number; m: number } | null> {
  const { data } = await supabaseAdmin
    .from("ingestion_log")
    .select("year,month")
    .eq("source", source)
    .eq("status", "success")
    .not("year", "is", null)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0];
  if (!row?.year || !row?.month) return null;
  return { y: row.year as number, m: row.month as number };
}

export const Route = createFileRoute("/api/public/hooks/check-data-freshness")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.message }), {
            status: auth.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const u = new URL(request.url);
          const origin = `${u.protocol}//${u.host}`;
          const hookSecret = process.env.INGEST_HOOK_SECRET ?? "";

          const results: any[] = [];

          // Check all sources in parallel to avoid serial CKAN timeout accumulation
          await Promise.all(CKAN_SOURCES.map(async (src) => {
            const startedAt = new Date();
            let upstream: { y: number; m: number } | null = null;
            let ingested: { y: number; m: number } | null = null;
            let queued = 0;
            let triggered = false;
            let status = "ok";
            let error: string | null = null;

            try {
              [upstream, ingested] = await Promise.all([
                upstreamLatest(src),
                ingestedLatest(src.source),
              ]);

              const upstreamScore = upstream ? upstream.y * 12 + upstream.m : 0;
              const ingestedScore = ingested ? ingested.y * 12 + ingested.m : 0;
              const newDataFound = upstreamScore > ingestedScore;

              if (newDataFound) {
                try {
                  const r = await fetchWithTimeout(
                    `${origin}/api/public/hooks/${src.hook}`,
                    {
                      method: "POST",
                      headers: hookSecret ? { "x-hook-secret": hookSecret } : {},
                    },
                    15000,
                  );
                  triggered = r.ok;
                  if (!r.ok) {
                    status = "trigger_failed";
                    error = `Trigger HTTP ${r.status}`;
                  } else {
                    const j: any = await r.json().catch(() => ({}));
                    queued = Number(j?.queued ?? 0) || 0;
                  }
                } catch (trigErr: any) {
                  status = "trigger_failed";
                  error = String(trigErr?.message ?? trigErr).slice(0, 200);
                }
              }

              await supabaseAdmin.from("ingestion_freshness_check").insert({
                source: src.source,
                checked_at: startedAt.toISOString(),
                upstream_latest_year: upstream?.y ?? null,
                upstream_latest_month: upstream?.m ?? null,
                ingested_latest_year: ingested?.y ?? null,
                ingested_latest_month: ingested?.m ?? null,
                new_data_found: newDataFound,
                items_queued: queued,
                status,
                error,
                details: { triggered, hook: src.hook },
              });

              results.push({
                source: src.source,
                upstream,
                ingested,
                new_data_found: newDataFound,
                triggered,
                queued,
                status,
              });
            } catch (e: any) {
              error = String(e?.message ?? e).slice(0, 500);
              await supabaseAdmin.from("ingestion_freshness_check").insert({
                source: src.source,
                checked_at: startedAt.toISOString(),
                upstream_latest_year: upstream?.y ?? null,
                upstream_latest_month: upstream?.m ?? null,
                ingested_latest_year: ingested?.y ?? null,
                ingested_latest_month: ingested?.m ?? null,
                new_data_found: false,
                items_queued: 0,
                status: "failed",
                error,
                details: { hook: src.hook },
              }).then(() => {}, () => {});
              results.push({ source: src.source, status: "failed", error });
            }
          }));

          return Response.json({ ok: true, checked: results.length, results });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
