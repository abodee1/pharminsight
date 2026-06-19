// England — Practice Level Prescribing Data (EPD, monthly).
import { authorizeHookRequest } from "@/lib/hook-auth.server";
// Chunked range-fetching: each Worker invocation downloads ONE ~50MB byte
// range of the (often ~1GB) CSV, parses lines, aggregates SUM(ITEMS)+SUM(NIC)
// by (PRACTICE_CODE, PERIOD), and additively upserts via the
// `gp_prescribing_add` RPC. Progress is tracked on ingestion_queue:
//   total_bytes, chunk_size, total_chunks, last_completed_chunk,
//   leftover_bytes (partial line carried into the next chunk),
//   header_line (CSV header string remembered for chunks > 0).
// After each chunk the route fires a fire-and-forget POST back to itself to
// pick up the next chunk; pg_cron is the safety net if that POST is dropped.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildHeaderIndex, num, alreadyHandled, enqueue, ckanResources, parseYearMonth,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHSBSA_GP";
const CKAN_BASE = "https://opendata.nhsbsa.net/api/3/action";
// english-prescribing-data-epd-snomed was removed from NHSBSA CKAN (returns 404); EPD is the live package.
const PACKAGES = ["english-prescribing-data-epd"];
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB

// ---------- Discovery ----------
async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const queue: Array<{ source: string; dataset: string; resource_url: string; year: number | null; month: number | null }> = [];
  for (const pkg of PACKAGES) {
    let resources: Awaited<ReturnType<typeof ckanResources>> = [];
    try { resources = await ckanResources(CKAN_BASE, pkg); }
    catch (e) { console.error(`[ingest-england-gp] CKAN ${pkg}:`, e); continue; }
    for (const r of resources) {
      if (r.format?.toUpperCase() !== "CSV") continue;
      if (skip.has(r.url)) continue;
      const { year, month } = parseYearMonth(r.url, r.name);
      queue.push({ source: SOURCE, dataset: pkg, resource_url: r.url, year, month });
    }
  }
  return enqueue(queue);
}

// ---------- CSV line parsing (quote-aware) ----------
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; }
        else q = false;
      } else cell += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { out.push(cell); cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
  }
  out.push(cell);
  return out;
}

// Split a text blob into complete lines + a trailing remainder.
// Avoids splitting inside a quoted field that wraps a newline (rare in EPD).
function splitLines(text: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') q = !q;
    else if (ch === "\n" && !q) {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return { lines, rest: text.slice(start) };
}

// ---------- HEAD probe ----------
async function probeSize(url: string): Promise<{ size: number; rangeOk: boolean }> {
  // Try HEAD first.
  try {
    const h = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (h.ok) {
      const len = Number(h.headers.get("content-length") ?? 0);
      const ar = (h.headers.get("accept-ranges") ?? "").toLowerCase();
      if (len > 0) return { size: len, rangeOk: ar.includes("bytes") || ar === "" };
    }
  } catch (e) {
    console.warn(`[ingest-england-gp] HEAD failed for ${url}:`, e);
  }
  // Fallback: tiny Range request — also tells us the total size.
  const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow" });
  if (r.status === 206) {
    const cr = r.headers.get("content-range") ?? ""; // bytes 0-0/12345
    const m = cr.match(/\/(\d+)$/);
    return { size: m ? +m[1] : 0, rangeOk: true };
  }
  // No range support — final fallback to full content-length on GET.
  const len = Number(r.headers.get("content-length") ?? 0);
  return { size: len, rangeOk: false };
}

// ---------- Chunk processing ----------
type QItem = {
  id: string; dataset: string; resource_url: string;
  year: number | null; month: number | null;
  total_bytes: number | null; chunk_size: number | null;
  total_chunks: number | null; last_completed_chunk: number;
  leftover_bytes: string; header_line: string | null;
  status: string; attempts: number;
};

const MAX_ATTEMPTS = 3;

async function takeNextChunkable(): Promise<QItem | null> {
  // Prefer in-progress files so we finish what we started before opening another.
  const { data } = await supabaseAdmin
    .from("ingestion_queue")
    .select("id, dataset, resource_url, year, month, total_bytes, chunk_size, total_chunks, last_completed_chunk, leftover_bytes, header_line, status, attempts")
    .eq("source", SOURCE)
    .in("status", ["pending", "processing"])
    .order("year", { ascending: false, nullsFirst: false })
    .order("month", { ascending: false, nullsFirst: false })
    .limit(20);
  if (!data?.length) return null;
  const processing = data.find((d) => d.status === "processing");
  return ((processing ?? data[0]) as QItem | undefined) ?? null;
}

async function logSuccess(item: QItem, lastChunkRows: number) {
  // `lastChunkRows` only counts the final chunk; query gp_prescribing for
  // the true row count across all chunks.
  let totalRows = lastChunkRows;
  if (item.year && item.month) {
    const { count } = await supabaseAdmin
      .from("gp_prescribing")
      .select("*", { count: "exact", head: true })
      .eq("country", "England")
      .eq("year", item.year)
      .eq("month", item.month);
    if (count != null) totalRows = count;
  }
  await supabaseAdmin.from("ingestion_log").insert({
    source: SOURCE, dataset: item.dataset, resource_url: item.resource_url,
    year: item.year, month: item.month, status: "success", rows_ingested: totalRows,
  });
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "done", finished_at: new Date().toISOString() })
    .eq("id", item.id);
}

async function logFailure(item: QItem, error: string) {
  const attempts = (item.attempts ?? 0) + 1;
  await supabaseAdmin.from("ingestion_log").insert({
    source: SOURCE, dataset: item.dataset, resource_url: item.resource_url,
    year: item.year, month: item.month, status: "failed",
    error: `attempt ${attempts}/${MAX_ATTEMPTS}: ${error}`,
  });
  if (attempts < MAX_ATTEMPTS) {
    // Idempotent retry: clear chunk progress so the next first-touch deletes
    // any partial rows for this (year, month) and restarts at chunk 0.
    await supabaseAdmin.from("ingestion_queue").update({
      status: "pending", attempts, error,
      total_bytes: null, chunk_size: null, total_chunks: null,
      last_completed_chunk: 0, leftover_bytes: "", header_line: null,
      started_at: null, finished_at: null,
    }).eq("id", item.id);
  } else {
    await supabaseAdmin.from("ingestion_queue")
      .update({ status: "failed", attempts, error, finished_at: new Date().toISOString() })
      .eq("id", item.id);
  }
}

async function processChunk(item: QItem) {
  // First touch: size the file and reset prior data for this period.
  if (item.total_bytes == null || item.total_chunks == null) {
    const { size, rangeOk } = await probeSize(item.resource_url);
    if (!size) throw new Error("Could not determine file size");
    const total_chunks = rangeOk ? Math.max(1, Math.ceil(size / CHUNK_SIZE)) : 1;
    // Reset any prior partial data for this (year, month) so additive RPC starts clean.
    if (item.year && item.month) {
      await supabaseAdmin.from("gp_prescribing").delete()
        .eq("country", "England").eq("year", item.year).eq("month", item.month);
    }
    await supabaseAdmin.from("ingestion_queue").update({
      status: "processing", started_at: new Date().toISOString(),
      total_bytes: size, chunk_size: CHUNK_SIZE, total_chunks,
      last_completed_chunk: -1, leftover_bytes: "", header_line: null,
    }).eq("id", item.id);
    item.total_bytes = size;
    item.chunk_size = CHUNK_SIZE;
    item.total_chunks = total_chunks;
    item.last_completed_chunk = -1;
    item.leftover_bytes = "";
    item.header_line = null;
    item.status = "processing";
  }

  const chunkIdx = item.last_completed_chunk + 1;
  const isLast = chunkIdx >= item.total_chunks! - 1;
  const start = chunkIdx * item.chunk_size!;
  const end = Math.min(start + item.chunk_size! - 1, item.total_bytes! - 1);

  // Fetch the byte range.
  const useRange = item.total_chunks! > 1;
  const res = await fetch(item.resource_url, {
    redirect: "follow",
    headers: useRange ? { Range: `bytes=${start}-${end}` } : {},
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Chunk ${chunkIdx} fetch ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(new Uint8Array(buf));

  // Prepend any partial line carried from the previous chunk.
  const combined = (item.leftover_bytes ?? "") + text;
  const { lines, rest } = splitLines(combined);
  // On the final chunk, the trailing rest is a real final row (no terminating \n).
  if (isLast && rest.length) { lines.push(rest); }

  // Determine column indices.
  let headerCells: string[] | null = null;
  let dataStart = 0;
  if (chunkIdx === 0) {
    if (!lines.length) throw new Error("Chunk 0 had no lines");
    headerCells = parseCsvLine(lines[0]);
    dataStart = 1;
  } else {
    if (!item.header_line) throw new Error("Missing header_line on continuation chunk");
    headerCells = parseCsvLine(item.header_line);
  }
  const h = buildHeaderIndex(headerCells);
  const codeIdx = h.find("PRACTICE_CODE");
  const nameIdx = h.find("PRACTICE_NAME");
  const itemsIdx = h.find("ITEMS");
  const nicIdx = h.find("NIC", "ACTUAL_COST");
  const periodIdx = h.find("YEAR_MONTH", "PERIOD");
  if (codeIdx < 0) throw new Error("No PRACTICE_CODE column");

  type Agg = { code: string; name: string; year: number; month: number; items: number; nic: number };
  const agg = new Map<string, Agg>();
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = parseCsvLine(line);
    const code = (cells[codeIdx] ?? "").trim();
    if (!code) continue;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (periodIdx >= 0) {
      const s = (cells[periodIdx] ?? "").trim();
      if (/^\d{6}$/.test(s)) { year = +s.slice(0, 4); month = +s.slice(4, 6); }
    }
    if (!year || !month) continue;
    const key = `${code}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) {
      c = {
        code,
        name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code,
        year, month, items: 0, nic: 0,
      };
      agg.set(key, c);
    }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    if (nicIdx >= 0) c.nic += num(cells[nicIdx]);
  }

  // Upsert practices encountered in this chunk.
  const practices = Array.from(
    new Map(Array.from(agg.values()).map((a) => [a.code, {
      practice_code: a.code, practice_name: a.name, country: "England", status_code: "A",
    }])).values(),
  );
  for (let i = 0; i < practices.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_practices")
      .upsert(practices.slice(i, i + 500), { onConflict: "practice_code" });
    if (error) throw error;
  }

  // Additive upsert of partial totals via RPC.
  const rows = Array.from(agg.values()).map((a) => ({
    practice_code: a.code, year: a.year, month: a.month, country: "England",
    total_items: Math.round(a.items), total_nic: a.nic,
    is_provisional: false, data_source: SOURCE,
  }));
  let pushed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin.rpc("gp_prescribing_add", { rows: slice });
    if (error) throw error;
    pushed += slice.length;
  }

  // Persist progress.
  const newLeftover = isLast ? "" : rest;
  const newHeader = chunkIdx === 0 ? lines[0] : item.header_line;
  await supabaseAdmin.from("ingestion_queue").update({
    last_completed_chunk: chunkIdx,
    leftover_bytes: newLeftover,
    header_line: newHeader,
  }).eq("id", item.id);

  if (isLast) await logSuccess(item, pushed);
  return { chunkIdx, totalChunks: item.total_chunks, rowsThisChunk: pushed, isLast, bytes: end - start + 1 };
}

// Fire-and-forget self-trigger for the next chunk.
function triggerSelf(reqUrl: string) {
  try {
    const u = new URL(reqUrl);
    const target = `${u.origin}/api/public/hooks/ingest-england-gp`;
    // Don't await; just initiate. pg_cron is the fallback if dropped.
    void fetch(target, { method: "POST" }).catch(() => {});
  } catch { /* noop */ }
}

export const Route = createFileRoute("/api/public/hooks/ingest-england-gp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
        try {
          const queued = await discover();
          const item = await takeNextChunkable();
          if (!item) {
            return Response.json({ ok: true, queued, processed: 0, pending: 0 });
          }
          let result: Awaited<ReturnType<typeof processChunk>> | null = null;
          try {
            result = await processChunk(item);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[ingest-england-gp] chunk ${item.resource_url}`, msg);
            await logFailure(item, msg);
            return Response.json({ ok: false, queued, error: msg, item: item.resource_url }, { status: 500 });
          }
          const { count: pending } = await supabaseAdmin.from("ingestion_queue")
            .select("id", { count: "exact", head: true })
            .eq("source", SOURCE).in("status", ["pending", "processing"]);
          // More chunks remaining for this file, OR more files queued → keep the chain alive.
          if (result && (!result.isLast || (pending ?? 0) > 0)) triggerSelf(request.url);
          return Response.json({ ok: true, queued, processed: 1, result, pending });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
      GET: async () => {
        const { count: pending } = await supabaseAdmin.from("ingestion_queue")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE).in("status", ["pending", "processing"]);
        return Response.json({ ok: true, pending });
      },
    },
  },
});
