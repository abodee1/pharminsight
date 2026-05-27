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

// epraccur.csv has no header row — columns are positional per ODS publication.
// 1=code, 2=name, 10=postcode, 12=status (A=active)
async function ingestPracticeDirectory() {
  const res = await fetch(EPRACCUR_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`epraccur ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, { filter: (f) => f.name.toLowerCase().endsWith(".csv") });
  const name = Object.keys(files)[0];
  if (!name) throw new Error("No CSV in epraccur.zip");
  const text = strFromU8(files[name]);
  const lines = text.split(/\r?\n/);
  const rows: Array<{ practice_code: string; practice_name: string; country: string; postcode: string | null; status_code: string }> = [];
  for (const line of lines) {
    if (!line) continue;
    const cells = line.split(",");
    const code = (cells[0] ?? "").trim();
    const status = (cells[12] ?? "").trim();
    if (!code || status !== "A") continue;
    rows.push({
      practice_code: code,
      practice_name: (cells[1] ?? "").trim().replace(/^"|"$/g, ""),
      country: "England",
      postcode: (cells[9] ?? "").trim() || null,
      status_code: status,
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_practices")
      .upsert(rows.slice(i, i + 500), { onConflict: "practice_code" });
    if (error) throw error;
  }
  return rows.length;
}

// Discover the latest "All patients by practice" CSV URL from the NHS Digital publications index.
async function findLatestPatientCsv(): Promise<{ url: string; year: number | null; month: number | null } | null> {
  const res = await fetch(PATIENT_INDEX_URL);
  if (!res.ok) throw new Error(`patient index ${res.status}`);
  const html = await res.text();
  // Find any link to a .csv that mentions "all" or "practice" patients
  const csvLinks = Array.from(html.matchAll(/href="([^"]+\.csv)"/gi)).map((m) => m[1]);
  // Heuristic: pick first CSV whose URL mentions gp-reg-pat or all-patients-by-practice
  const target = csvLinks.find((u) => /gp-reg-pat|all[-_ ]?patients?[-_ ]?by[-_ ]?practice/i.test(u))
    ?? csvLinks[0];
  if (!target) return null;
  const url = target.startsWith("http") ? target : new URL(target, "https://digital.nhs.uk").toString();
  // Extract YYYY-MM or month from filename
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
  const latest = await findLatestPatientCsv();
  if (latest && !skip.has(latest.url)) {
    queue.push({ source: SOURCE, dataset: "patients-registered", resource_url: latest.url, year: latest.year, month: latest.month });
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
      POST: async () => {
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
