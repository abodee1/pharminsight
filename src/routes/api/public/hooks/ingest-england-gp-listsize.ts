// England — practice directory (epraccur.zip) + Patients Registered at a GP Practice (quarterly CSV).
import { authorizeHookRequest } from "@/lib/hook-auth.server";
import { createFileRoute } from "@tanstack/react-router";
import { unzipSync, strFromU8 } from "fflate";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHSBSA_LISTSIZE";
// Primary directory source: NHS Spine ORD API (open JSON, no auth, not behind WAF).
// PrimaryRoleId RO177 = "Prescribing Cost Centre" (English GP practices).
const SPINE_ORD_URL = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations";
// Legacy primary (CloudFront WAF blocks non-browser clients in 2026).
const EPRACCUR_URL = "https://files.digital.nhs.uk/assets/ods/current/epraccur.zip";
const PATIENT_INDEX_URL = "https://digital.nhs.uk/data-and-information/publications/statistical/patients-registered-at-a-gp-practice";

type PracticeRow = { practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string };

async function fetchSpineOrd(): Promise<PracticeRow[]> {
  const out: PracticeRow[] = [];
  const limit = 1000;
  let offset = 0;
  for (let page = 0; page < 60; page++) {
    const url = `${SPINE_ORD_URL}?PrimaryRoleId=RO177&Status=Active&Limit=${limit}&Offset=${offset}`;
    const res = await fetch(url, { redirect: "follow", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Spine ORD ${res.status} at offset ${offset}`);
    const j = (await res.json()) as { Organisations?: Array<{ OrgId: string; Name: string; PostCode?: string; Status: string }> };
    const orgs = j.Organisations ?? [];
    if (!orgs.length) break;
    for (const o of orgs) {
      if (!o.OrgId) continue;
      out.push({
        practice_code: o.OrgId,
        practice_name: o.Name?.trim() || o.OrgId,
        country: "England",
        postcode: o.PostCode?.trim() || null,
        status_code: "A",
      });
    }
    if (orgs.length < limit) break;
    offset += limit;
  }
  return out;
}

async function fetchEpraccurLegacy(): Promise<PracticeRow[] | null> {
  try {
    const res = await fetch(EPRACCUR_URL, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/zip,application/octet-stream,*/*",
      },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name.toLowerCase().endsWith(".csv") });
    const name = Object.keys(files)[0];
    if (!name) return null;
    const text = strFromU8(files[name]);
    const out: PracticeRow[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const cells = line.split(",");
      const code = (cells[0] ?? "").trim();
      const status = (cells[12] ?? "").trim();
      if (!code || status !== "A") continue;
      out.push({
        practice_code: code,
        practice_name: (cells[1] ?? "").trim().replace(/^"|"$/g, ""),
        country: "England",
        postcode: (cells[9] ?? "").trim() || null,
        status_code: status,
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function ingestPracticeDirectory() {
  let rows: PracticeRow[];
  try {
    rows = await fetchSpineOrd();
  } catch (e) {
    console.warn("[ingest-england-gp-listsize] Spine ORD failed, trying epraccur:", e instanceof Error ? e.message : e);
    rows = (await fetchEpraccurLegacy()) ?? [];
  }
  if (!rows.length) throw new Error("No practice rows from Spine ORD or epraccur");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_practices")
      .upsert(rows.slice(i, i + 500), { onConflict: "practice_code" });
    if (error) throw error;
  }
  return rows.length;
}


const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PharmInsightBot/1.0; +https://pharminsight.lovable.app)",
  "Accept": "text/html,application/xhtml+xml",
};
const NHS_BASE = "https://digital.nhs.uk";

// Discover ALL historically available "all patients by practice" CSV files from the
// NHS Digital publication index — both current and archived monthly releases.
async function discoverAllPatientCsvs(): Promise<Array<{ url: string; year: number | null; month: number | null }>> {
  const seen = new Set<string>();
  const out: Array<{ url: string; year: number | null; month: number | null }> = [];

  function addCsvLink(href: string): void {
    const url = href.startsWith("http") ? href : new URL(href, NHS_BASE).toString();
    if (seen.has(url)) return;
    seen.add(url);
    const dm = url.match(/(20\d{2})[-_](\d{2})/);
    out.push({ url, year: dm ? +dm[1] : null, month: dm ? +dm[2] : null });
  }

  function parseCsvLinks(html: string): void {
    for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)) {
      const href = m[1];
      // Only ingest the canonical aggregate practice-level extract.
      // gp-reg-pat-prac-all.csv (or -v2) contains TOTAL_ALL per practice.
      // Skip demographic breakdowns (sing-age-male/female/regions), maps, quintiles, LSOA.
      if (/gp-reg-pat-prac-all(?:[-_]v\d+)?\.csv$/i.test(href)) {
        addCsvLink(href);
      }
    }
  }

  // Fetch main publication index
  const mainRes = await fetch(PATIENT_INDEX_URL, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!mainRes.ok) throw new Error(`patient index ${mainRes.status}`);
  const mainHtml = await mainRes.text();
  parseCsvLinks(mainHtml);

  // Collect links to individual monthly publication archive pages
  const subPages: string[] = [];
  const archivePath = "/data-and-information/publications/statistical/patients-registered-at-a-gp-practice/";
  for (const m of mainHtml.matchAll(/href="([^"#?]+)"/gi)) {
    const href = m[1];
    if (!href.includes(archivePath)) continue;
    const url = href.startsWith("http") ? href : new URL(href, NHS_BASE).toString();
    if (url === PATIENT_INDEX_URL || url === PATIENT_INDEX_URL + "/") continue;
    if (!subPages.includes(url)) subPages.push(url);
  }

  // Fetch archive pages in parallel batches of 5, up to 72 months (6 years of backfill)
  const BATCH = 5;
  const MAX_PAGES = 72;
  for (let i = 0; i < Math.min(subPages.length, MAX_PAGES); i += BATCH) {
    await Promise.all(
      subPages.slice(i, i + BATCH).map(async (url) => {
        try {
          const r = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
          if (r.ok) parseCsvLinks(await r.text());
        } catch {
          // ignore individual page failures silently
        }
      }),
    );
  }

  return out;
}

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const queue: Array<{ source: string; dataset: string; resource_url: string; year: number | null; month: number | null }> = [];

  // Practice directory — keyed by quarter so it re-ingests once per quarter
  const today = new Date();
  const epraccurKey = `${EPRACCUR_URL}#${today.getUTCFullYear()}Q${Math.floor(today.getUTCMonth() / 3) + 1}`;
  if (!skip.has(epraccurKey)) {
    queue.push({ source: SOURCE, dataset: "epraccur", resource_url: epraccurKey, year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 });
  }

  // All historically available patient registration CSVs
  try {
    const allCsvs = await discoverAllPatientCsvs();
    for (const csv of allCsvs) {
      if (!skip.has(csv.url)) {
        queue.push({ source: SOURCE, dataset: "patients-registered", resource_url: csv.url, year: csv.year, month: csv.month });
      }
    }
  } catch (e) {
    console.warn("[ingest-england-gp-listsize] patient discovery failed:", e instanceof Error ? e.message : e);
  }

  return enqueue(queue);
}

async function processPatientsCsv(item: { id: string; resource_url: string; year: number | null; month: number | null }) {
  let codeIdx = -1, totIdx = -1, dateIdx = -1;
  const rows: Array<{ practice_code: string; list_size_date: string; registered_patients: number; country: string; data_source: string }> = [];
  const fallbackDate = (() => {
    const y = item.year ?? new Date().getUTCFullYear();
    const m = item.month ?? 1;
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  })();
  let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      codeIdx = h.find("PRACTICE_CODE", "ORG_CODE", "CODE");
      totIdx = h.find("TOTAL_ALL", "NUMBER_OF_PATIENTS", "TOTAL_PATIENTS", "PATIENTS");
      dateIdx = h.find("EXTRACT_DATE", "EXTRACT_DT", "PUBLICATION");
      return;
    }
    if (codeIdx < 0 || totIdx < 0) return;
    const code = (cells[codeIdx] ?? "").trim();
    if (!code) return;
    const patients = +(cells[totIdx] ?? "0").replace(/,/g, "") || 0;
    if (!patients) return;
    let date = fallbackDate;
    if (dateIdx >= 0) {
      const s = (cells[dateIdx] ?? "").trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) date = s.slice(0, 10);
      else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
        const [d, m, y] = s.split("/"); date = `${y}-${m}-${d}`;
      }
    }
    rows.push({
      practice_code: code, list_size_date: date,
      registered_patients: patients, country: "England", data_source: SOURCE,
    });
  });
  if (codeIdx < 0) throw new Error("No PRACTICE_CODE column");
  if (rowNo <= 1) throw new Error("Empty CSV");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_list_sizes")
      .upsert(rows.slice(i, i + 500), { onConflict: "practice_code,list_size_date" });
    if (error) throw error;
  }
  return rows.length;
}

async function processOne() {
  const item = await takeNextPending(SOURCE);
  if (!item) return null;
  await markProcessing(item.id);
  try {
    const rows = item.dataset === "epraccur"
      ? await ingestPracticeDirectory()
      : await processPatientsCsv(item);
    await markSuccess({ ...item, source: SOURCE, rows });
    return { url: item.resource_url, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-england-gp-listsize] ${item.resource_url}`, msg);
    await markFailed({ ...item, source: SOURCE, error: msg });
    return { url: item.resource_url, error: msg };
  }
}

export const Route = createFileRoute("/api/public/hooks/ingest-england-gp-listsize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
        try {
          const queued = await discover();
          const result = await processOne();
          return Response.json({ ok: true, queued, processed: result ? 1 : 0, result });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});
