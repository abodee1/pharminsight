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
    if (error) throw new Error(error.message || JSON.stringify(error));
  }
  return rows.length;
}


const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PharmInsightBot/1.0; +https://pharminsight.lovable.app)",
  "Accept": "text/html,application/xhtml+xml",
};
const NHS_BASE = "https://digital.nhs.uk";

// NHS Digital sits behind Cloudflare and 403s Worker IPs. Returns extracted
// links (preferred — survives Firecrawl's HTML post-processing) plus raw HTML
// (best-effort, used for period detection from index headings).
async function fetchPageSmart(url: string): Promise<{ html: string; links: string[] } | null> {
  // Direct fetch first
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (r.ok) {
      const html = await r.text();
      const links: string[] = [];
      for (const m of html.matchAll(/href="([^"#?]+)"/gi)) links.push(m[1]);
      return { html, links };
    }
  } catch {
    // fall through
  }
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) return null;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${fcKey}` },
      body: JSON.stringify({ url, formats: ["html", "links"], onlyMainContent: false }),
    });
    if (!r.ok) return null;
    const j = await r.json() as { data?: { html?: string; rawHtml?: string; links?: string[] } };
    return {
      html: j.data?.html ?? j.data?.rawHtml ?? "",
      links: j.data?.links ?? [],
    };
  } catch {
    return null;
  }
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Try to derive (year, month) from a publication page URL like
// ".../patients-registered-at-a-gp-practice/may-2024" or ".../may-2024-data".
function periodFromPubUrl(url: string): { year: number | null; month: number | null } {
  const lower = url.toLowerCase();
  const m = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)[-_ ]?(20\d{2})\b/);
  if (m) return { year: +m[2], month: MONTHS[m[1]] };
  const m2 = lower.match(/(20\d{2})[-_](0[1-9]|1[0-2])\b/);
  if (m2) return { year: +m2[1], month: +m2[2] };
  return { year: null, month: null };
}

// Discover ALL historically available "all patients by practice" CSV files from the
// NHS Digital publication index — both current and archived monthly releases.
async function discoverAllPatientCsvs(): Promise<Array<{ url: string; year: number | null; month: number | null }>> {
  const seen = new Map<string, { year: number | null; month: number | null }>();

  function addCsvLink(href: string, period: { year: number | null; month: number | null }): void {
    const url = href.startsWith("http") ? href : new URL(href, NHS_BASE).toString();
    const prev = seen.get(url);
    // Prefer entries that have a year/month over null ones.
    if (!prev || (prev.year == null && period.year != null)) seen.set(url, period);
  }

  function parseCsvLinks(html: string, period: { year: number | null; month: number | null }): void {
    for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)) {
      const href = m[1];
      // Canonical aggregate practice-level extract — TOTAL_ALL per practice.
      // Accept the modern "all" file and the older "map" file (also totals).
      // Skip demographic breakdowns and LSOA splits.
      if (/gp-reg-pat-prac-(?:all|map)(?:[-_]v\d+)?\.csv$/i.test(href)) {
        addCsvLink(href, period);
      }
    }
  }

  // Fetch main publication index
  const mainHtml = await fetchHtmlSmart(PATIENT_INDEX_URL);
  if (!mainHtml) throw new Error(`patient index unreachable (direct + firecrawl)`);
  // Main index represents the latest publication — try to read the period from the index itself.
  const indexPeriod = (() => {
    const m = mainHtml.match(/patients[- ]registered[- ]at[- ]a[- ]gp[- ]practice[, ]+([A-Za-z]+)[ -](20\d{2})/i);
    if (m) {
      const mn = m[1].toLowerCase();
      return { year: +m[2], month: MONTHS[mn] ?? null };
    }
    return { year: null, month: null };
  })();
  parseCsvLinks(mainHtml, indexPeriod);

  // Collect links to individual monthly publication archive pages
  const subPages = new Set<string>();
  const archivePath = "/data-and-information/publications/statistical/patients-registered-at-a-gp-practice/";
  for (const m of mainHtml.matchAll(/href="([^"#?]+)"/gi)) {
    const href = m[1];
    if (!href.includes(archivePath)) continue;
    const url = href.startsWith("http") ? href : new URL(href, NHS_BASE).toString();
    if (url === PATIENT_INDEX_URL || url === PATIENT_INDEX_URL + "/") continue;
    subPages.add(url);
  }

  // Fetch archive pages in parallel batches of 5, up to 96 months (8 years of backfill).
  const subPageList = Array.from(subPages);
  const BATCH = 5;
  const MAX_PAGES = 96;
  for (let i = 0; i < Math.min(subPageList.length, MAX_PAGES); i += BATCH) {
    await Promise.all(
      subPageList.slice(i, i + BATCH).map(async (url) => {
        try {
          const html = await fetchHtmlSmart(url);
          if (!html) return;
          parseCsvLinks(html, periodFromPubUrl(url));
        } catch {
          // ignore individual page failures silently
        }
      }),
    );
  }

  return Array.from(seen.entries()).map(([url, p]) => ({ url, ...p }));
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
    if (error) throw new Error(error.message || JSON.stringify(error));
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
