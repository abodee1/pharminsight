// England — practice directory (epraccur.zip) + Patients Registered at a GP Practice (quarterly CSV).
import { createFileRoute } from "@tanstack/react-router";
import { unzipSync, strFromU8 } from "fflate";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHSBSA_LISTSIZE";
const EPRACCUR_URL = "https://files.digital.nhs.uk/assets/ods/current/epraccur.zip";
const PATIENT_INDEX_URL = "https://digital.nhs.uk/data-and-information/publications/statistical/patients-registered-at-a-gp-practice";
// Fallback: OpenPrescribing's mirror of active English GP practices (no auth, CORS-open).
const OPENPRESCRIBING_URL = "https://openprescribing.net/api/1.0/org_code/?org_type=practice&format=csv";

async function fetchEpraccur(): Promise<Array<{ practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string }> | null> {
  try {
    const res = await fetch(EPRACCUR_URL, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/zip,application/octet-stream,*/*",
      },
    });
    if (!res.ok) {
      console.warn(`[ingest-england-gp-listsize] epraccur ${res.status}; falling back to OpenPrescribing`);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name.toLowerCase().endsWith(".csv") });
    const name = Object.keys(files)[0];
    if (!name) return null;
    const text = strFromU8(files[name]);
    const lines = text.split(/\r?\n/);
    const out: Array<{ practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string }> = [];
    for (const line of lines) {
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
  } catch (e) {
    console.warn("[ingest-england-gp-listsize] epraccur fetch error:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchOpenPrescribing(): Promise<Array<{ practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string }>> {
  const res = await fetch(OPENPRESCRIBING_URL, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PharmInsightBot/1.0; +https://pharminsight.lovable.app)",
      "Accept": "text/csv,*/*",
    },
  });
  if (!res.ok) throw new Error(`openprescribing ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const codeIdx = header.findIndex((h) => h === "code" || h === "practice_code");
  const nameIdx = header.findIndex((h) => h === "name" || h === "practice_name");
  const out: Array<{ practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const code = (cells[codeIdx] ?? "").trim();
    if (!code) continue;
    out.push({
      practice_code: code,
      practice_name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code,
      country: "England",
      postcode: null,
      status_code: "A",
    });
  }
  return out;
}

async function ingestPracticeDirectory() {
  const rows = (await fetchEpraccur()) ?? (await fetchOpenPrescribing());
  if (!rows.length) throw new Error("No practice rows from epraccur or OpenPrescribing");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_practices")
      .upsert(rows.slice(i, i + 500), { onConflict: "practice_code" });
    if (error) throw error;
  }
  return rows.length;
}


// Discover the latest "All patients by practice" CSV URL from the NHS Digital publications index.
async function findLatestPatientCsv(): Promise<{ url: string; year: number | null; month: number | null } | null> {
  const res = await fetch(PATIENT_INDEX_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PharmInsightBot/1.0; +https://pharminsight.lovable.app)",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`patient index ${res.status}`);
  const html = await res.text();
  const csvLinks = Array.from(html.matchAll(/href="([^"]+\.csv)"/gi)).map((m) => m[1]);
  const target = csvLinks.find((u) => /gp-reg-pat|all[-_ ]?patients?[-_ ]?by[-_ ]?practice/i.test(u))
    ?? csvLinks[0];
  if (!target) return null;
  const url = target.startsWith("http") ? target : new URL(target, "https://digital.nhs.uk").toString();
  const m = url.match(/(20\d{2})[-_](\d{2})/);
  const year = m ? +m[1] : null;
  const month = m ? +m[2] : null;
  return { url, year, month };
}

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const queue: Array<{ source: string; dataset: string; resource_url: string; year: number | null; month: number | null }> = [];
  // Always queue epraccur (we use ?v=<date>-derived url for de-duplication based on quarter)
  const today = new Date();
  const epraccurKey = `${EPRACCUR_URL}#${today.getUTCFullYear()}Q${Math.floor(today.getUTCMonth() / 3) + 1}`;
  if (!skip.has(epraccurKey)) {
    queue.push({ source: SOURCE, dataset: "epraccur", resource_url: epraccurKey, year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 });
  }
  try {
    const latest = await findLatestPatientCsv();
    if (latest && !skip.has(latest.url)) {
      queue.push({ source: SOURCE, dataset: "patients-registered", resource_url: latest.url, year: latest.year, month: latest.month });
    }
  } catch (e) {
    console.warn("[ingest-england-gp-listsize] patient index discovery failed:", e instanceof Error ? e.message : e);
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
