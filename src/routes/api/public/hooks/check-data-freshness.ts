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
];

type CkanResource = { id: string; name: string; url: string };

function parseYearMonth(s: string): { y: number; m: number } | null {
  const m = s.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (!m) return null;
  return { y: +m[1], m: +m[2] };
}

async function upstreamLatest(src: CkanSource): Promise<{ y: number; m: number } | null> {
  const res = await fetch(`${src.ckanBase}/package_show?id=${encodeURIComponent(src.dataset)}`);
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

async function originUrl(request: Request): Promise<string> {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
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

        const origin = await originUrl(request);
        const hookSecret = process.env.INGEST_HOOK_SECRET ?? "";

        const results: any[] = [];

        for (const src of CKAN_SOURCES) {
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
              // Fire-and-forget trigger of the corresponding ingest hook.
              // The hook itself is idempotent (skips already-successful resources).
              const r = await fetch(`${origin}/api/public/hooks/${src.hook}`, {
                method: "POST",
                headers: hookSecret ? { "x-hook-secret": hookSecret } : {},
              });
              triggered = r.ok;
              if (!r.ok) {
                status = "trigger_failed";
                error = `Trigger HTTP ${r.status}`;
              } else {
                const j: any = await r.json().catch(() => ({}));
                queued = Number(j?.queued ?? 0) || 0;
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
            });
            results.push({ source: src.source, status: "failed", error });
          }
        }

        return new Response(JSON.stringify({ ok: true, checked: results.length, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
