// Deprivation ingestion hook.
//
// England: IMD 2025 (File 7) + LSOA 2021 population-weighted centroids (ArcGIS).
// Scotland: SIMD 2020v2 overall (NHS opendata CSV) + domain ranks (gov.scot XLSX)
//           + Data Zone 2011 centroids (maps.gov.scot ArcGIS).
//
// Triggered with ?phase=england-imd|england-centroids|scotland-simd|scotland-centroids|all
// Each phase processes its dataset to completion in a single request.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";
import { streamCsv } from "@/lib/ingest-utils.server";
import * as XLSX from "xlsx";

const IMD_URL =
  "https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv";

const LSOA_CENTROIDS_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA_PopCentroids_EW_2021_V4/FeatureServer/0/query";

const SIMD_CSV_URL =
  "https://www.opendata.nhs.scot/dataset/78d41fa9-1a62-4f7b-9edb-3e8522a93378/resource/acade396-8430-4b34-895a-b3e757fa346e/download/simd2020v2_22062020.csv";

const SIMD_RANKS_XLSX_URL =
  "https://www.gov.scot/binaries/content/documents/govscot/publications/statistics/2020/01/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/documents/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/govscot%3Adocument/SIMD%2B2020v2%2B-%2Branks.xlsx";

// Public ArcGIS Online mirror of Scottish Government Data Zone 2011 centroids
// (Easting/Northing reprojected to WGS84 server-side via outSR=4326).
const DZ_CENTROIDS_URL =
  "https://services2.arcgis.com/Ne8d9gKn5SJ3eAaw/arcgis/rest/services/SG_DataZoneCent_2011_(1)/FeatureServer/0/query";

// Loose key normaliser: lowercase, strip everything non-alphanumeric.
function k(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], ...needles: string[]): number {
  const norm = headers.map((h) => k(h));
  for (const n of needles) {
    const nn = k(n);
    const i = norm.indexOf(nn);
    if (i >= 0) return i;
  }
  // Substring match fallback
  for (const n of needles) {
    const nn = k(n);
    const i = norm.findIndex((h) => h.includes(nn));
    if (i >= 0) return i;
  }
  return -1;
}

const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;
const toSmallInt = (n: number | null): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.max(SMALLINT_MIN, Math.min(SMALLINT_MAX, Math.round(n)));

// IMD25 publishes deciles where 1 = most deprived. We store 1-10 where 10 = most deprived.
const normIMD = (d: number | null) =>
  d == null || d < 1 || d > 10 ? null : toSmallInt(11 - d);

// Convert a 1..N rank (1 = most deprived) into a normalised 1-10 decile where 10 = most deprived.
const rankToNormDecile = (rank: number | null, total: number): number | null => {
  if (rank == null || !Number.isFinite(rank) || rank < 1 || total < 1) return null;
  const decile = Math.ceil((rank / total) * 10); // 1=most deprived
  return toSmallInt(11 - decile);
};

const numOrNull = (v: string | undefined | null): number | null => {
  if (v == null) return null;
  const s = String(v).replace(/[,£"\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function bulkUpsert(rows: any[]) {
  const total = rows.length;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin
      .from("deprivation_zones")
      // defaultToNull:false keeps existing lat/lng (and any column not in our payload)
      // intact instead of overwriting with NULL on conflict.
      .upsert(slice, { onConflict: "nation,zone_code", defaultToNull: false });
    if (error) throw new Error(error.message || JSON.stringify(error));
    upserted += slice.length;
  }
  return { total, upserted };
}

// ── England IMD25 ─────────────────────────────────────────────────────────────
async function ingestEnglandImd() {
  let headers: string[] = [];
  let idx = {
    code: -1, name: -1,
    score: -1, decile: -1, rank: -1,
    income: -1, emp: -1, edu: -1, health: -1, crime: -1, housing: -1, access: -1,
    idaci: -1, idaopi: -1,
    pop: -1,
  };
  const rows: any[] = [];
  let n = 0;
  await streamCsv(IMD_URL, (cells) => {
    if (n++ === 0) {
      headers = cells;
      idx.code = findHeader(headers, "LSOA code (2021)", "LSOA21CD");
      idx.name = findHeader(headers, "LSOA name (2021)");
      idx.score = findHeader(headers, "Index of Multiple Deprivation (IMD) Score");
      idx.rank = findHeader(headers, "Index of Multiple Deprivation (IMD) Rank");
      idx.decile = findHeader(headers, "Index of Multiple Deprivation (IMD) Decile");
      idx.income = findHeader(headers, "Income Decile");
      idx.emp = findHeader(headers, "Employment Decile");
      idx.edu = findHeader(headers, "Education Skills and Training Decile", "Education, Skills and Training Decile");
      idx.health = findHeader(headers, "Health Deprivation and Disability Decile");
      idx.crime = findHeader(headers, "Crime Decile");
      idx.housing = findHeader(headers, "Barriers to Housing and Services Decile");
      idx.access = findHeader(headers, "Living Environment Decile");
      idx.idaci = findHeader(headers, "IDACI Decile", "Income Deprivation Affecting Children Index (IDACI) Decile");
      idx.idaopi = findHeader(headers, "IDAOPI Decile", "Income Deprivation Affecting Older People (IDAOPI) Decile");
      idx.pop = findHeader(headers, "Total population", "Population");
      return;
    }
    if (idx.code < 0) return;
    const code = (cells[idx.code] ?? "").trim();
    if (!code) return;
    rows.push({
      zone_code: code,
      zone_name: idx.name >= 0 ? (cells[idx.name] ?? "").trim() : null,
      nation: "england",
      overall_score: numOrNull(cells[idx.score]),
      overall_rank: toSmallInt(numOrNull(cells[idx.rank])),
      overall_decile: normIMD(numOrNull(cells[idx.decile])),
      income_decile: normIMD(numOrNull(cells[idx.income])),
      employment_decile: normIMD(numOrNull(cells[idx.emp])),
      education_decile: normIMD(numOrNull(cells[idx.edu])),
      health_decile: normIMD(numOrNull(cells[idx.health])),
      crime_decile: normIMD(numOrNull(cells[idx.crime])),
      housing_decile: normIMD(numOrNull(cells[idx.housing])),
      access_decile: normIMD(numOrNull(cells[idx.access])),
      idaci_decile: normIMD(numOrNull(cells[idx.idaci])),
      idaopi_decile: normIMD(numOrNull(cells[idx.idaopi])),
      population: idx.pop >= 0 ? toSmallInt(numOrNull(cells[idx.pop])) : null,
    });
  });
  if (!rows.length) throw new Error("IMD25 CSV parsed 0 rows");
  return await bulkUpsert(rows);
}

// ── England LSOA21 centroids via ArcGIS (WGS84) ───────────────────────────────
async function ingestEnglandCentroids() {
  let offset = 0;
  const PAGE = 2000;
  let updated = 0;
  let total = 0;
  for (;;) {
    const url = `${LSOA_CENTROIDS_URL}?where=1%3D1&outFields=LSOA21CD&outSR=4326&f=json&resultRecordCount=${PAGE}&resultOffset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ArcGIS LSOA centroids ${res.status}`);
    const j: any = await res.json();
    const feats: any[] = j.features ?? [];
    if (!feats.length) break;
    total += feats.length;
    // Update each in a batched upsert. We only know the (nation, zone_code) so do partial update via upsert with merge semantics.
    // Since upsert requires full row, we'll fetch existing and update lat/lng in chunks of 500 via raw SQL.
    const updates = feats
      .map((f) => ({
        zone_code: f.attributes?.LSOA21CD,
        lat: f.geometry?.y as number,
        lng: f.geometry?.x as number,
      }))
      .filter((u) => u.zone_code && Number.isFinite(u.lat) && Number.isFinite(u.lng));

    for (let i = 0; i < updates.length; i += 500) {
      const slice = updates.slice(i, i + 500);
      // Update lat/lng per zone_code. Use upsert with only lat/lng + key — but upsert with missing required columns is OK
      // because the row already exists (or is partially created). However onConflict will INSERT NULLs for new ones; we
      // only want to update existing rows. Use update via .in() loop instead.
      const codes = slice.map((s) => s.zone_code);
      // Build a temp values table via rpc? Simpler: loop per row in small batches with .update.
      // 500 updates per page * 17 pages = 8500 sequential updates — too slow.
      // Use a single UPDATE FROM VALUES via supabase rpc.
      const { error } = await supabaseAdmin.rpc("deprivation_set_centroids", {
        p_nation: "england",
        p_codes: codes,
        p_lats: slice.map((s) => s.lat),
        p_lngs: slice.map((s) => s.lng),
      });
      if (error) throw new Error("set_centroids: " + (error.message || JSON.stringify(error)));
      updated += slice.length;
    }
    if (!j.exceededTransferLimit) break;
    offset += feats.length;
    if (offset > 100_000) break; // safety
  }
  return { total, updated };
}

// ── Scotland SIMD ─────────────────────────────────────────────────────────────
async function ingestScotlandSimd() {
  // Step A: NHS CSV → overall rank, decile + intermediate zone name
  type Overall = {
    zone_code: string; zone_name: string | null;
    overall_rank: number | null; overall_decile: number | null;
  };
  const overall = new Map<string, Overall>();
  let row = 0;
  let dzIdx = -1, izIdx = -1, rankIdx = -1, decIdx = -1;
  await streamCsv(SIMD_CSV_URL, (cells) => {
    if (row++ === 0) {
      dzIdx = findHeader(cells, "DataZone");
      izIdx = findHeader(cells, "IntZone", "Intermediate Zone");
      rankIdx = findHeader(cells, "SIMD2020V2Rank", "SIMD2020Rank", "Rank");
      decIdx = findHeader(cells, "SIMD2020V2CountryDecile", "SIMD2020CountryDecile", "CountryDecile");
      return;
    }
    if (dzIdx < 0) return;
    const code = (cells[dzIdx] ?? "").trim();
    if (!code) return;
    overall.set(code, {
      zone_code: code,
      zone_name: izIdx >= 0 ? (cells[izIdx] ?? "").trim() || null : null,
      overall_rank: numOrNull(cells[rankIdx]),
      overall_decile: numOrNull(cells[decIdx]),
    });
  });
  if (!overall.size) throw new Error("SIMD NHS CSV parsed 0 rows");

  // Step B: gov.scot XLSX → domain ranks
  const xres = await fetch(SIMD_RANKS_XLSX_URL);
  if (!xres.ok) throw new Error(`SIMD XLSX fetch ${xres.status}`);
  const buf = new Uint8Array(await xres.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames.find((n) => /rank/i.test(n)) ?? wb.SheetNames[0]];
  const records: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  if (!records.length) throw new Error("SIMD XLSX empty");

  const sample = records[0];
  const sampleKeys = Object.keys(sample);
  const xk = (...needles: string[]) => {
    for (const n of needles) {
      const nn = k(n);
      const f = sampleKeys.find((sk) => k(sk) === nn);
      if (f) return f;
    }
    for (const n of needles) {
      const nn = k(n);
      const f = sampleKeys.find((sk) => k(sk).includes(nn));
      if (f) return f;
    }
    return null;
  };

  const C = {
    dz: xk("Data_Zone", "DataZone"),
    pop: xk("Total_population", "TotalPopulation"),
    income: xk("Income_Domain_Rank", "Income Domain Rank"),
    emp: xk("Employment_Domain_Rank"),
    health: xk("Health_Domain_Rank"),
    edu: xk("Education_Domain_Rank"),
    access: xk("Access_Domain_Rank"),
    crime: xk("Crime_Domain_Rank"),
    housing: xk("Housing_Domain_Rank"),
  };
  if (!C.dz) throw new Error("SIMD XLSX: no Data_Zone column");

  const totalZones = records.length; // ~6976
  const domainRanks = new Map<string, {
    population: number | null;
    income: number | null; emp: number | null; health: number | null;
    edu: number | null; access: number | null; crime: number | null; housing: number | null;
  }>();
  for (const r of records) {
    const code = String(r[C.dz] ?? "").trim();
    if (!code) continue;
    domainRanks.set(code, {
      population: C.pop ? numOrNull(String(r[C.pop])) : null,
      income: C.income ? numOrNull(String(r[C.income])) : null,
      emp: C.emp ? numOrNull(String(r[C.emp])) : null,
      health: C.health ? numOrNull(String(r[C.health])) : null,
      edu: C.edu ? numOrNull(String(r[C.edu])) : null,
      access: C.access ? numOrNull(String(r[C.access])) : null,
      crime: C.crime ? numOrNull(String(r[C.crime])) : null,
      housing: C.housing ? numOrNull(String(r[C.housing])) : null,
    });
  }

  // Merge
  const out: any[] = [];
  for (const [code, o] of overall) {
    const d = domainRanks.get(code);
    out.push({
      zone_code: code,
      zone_name: o.zone_name,
      nation: "scotland",
      overall_rank: toSmallInt(o.overall_rank),
      overall_decile: normIMD(o.overall_decile), // NHS decile is 1 = most deprived → normalise
      income_decile: rankToNormDecile(d?.income ?? null, totalZones),
      employment_decile: rankToNormDecile(d?.emp ?? null, totalZones),
      health_decile: rankToNormDecile(d?.health ?? null, totalZones),
      education_decile: rankToNormDecile(d?.edu ?? null, totalZones),
      crime_decile: rankToNormDecile(d?.crime ?? null, totalZones),
      housing_decile: rankToNormDecile(d?.housing ?? null, totalZones),
      access_decile: rankToNormDecile(d?.access ?? null, totalZones),
      population: d?.population != null ? toSmallInt(d.population) : null,
    });
  }
  return await bulkUpsert(out);
}

// ── Scotland Data Zone centroids ──────────────────────────────────────────────
async function ingestScotlandCentroids() {
  let offset = 0;
  const PAGE = 1000;
  let total = 0;
  let updated = 0;
  for (;;) {
    const url = `${DZ_CENTROIDS_URL}?where=1%3D1&outFields=DataZone&outSR=4326&f=json&resultRecordCount=${PAGE}&resultOffset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ArcGIS DZ centroids ${res.status}`);
    const j: any = await res.json();
    const feats: any[] = j.features ?? [];
    if (!feats.length) break;
    total += feats.length;
    const updates = feats
      .map((f) => ({
        zone_code: f.attributes?.DataZone,
        lat: f.geometry?.y as number,
        lng: f.geometry?.x as number,
      }))
      .filter((u) => u.zone_code && Number.isFinite(u.lat) && Number.isFinite(u.lng));
    for (let i = 0; i < updates.length; i += 500) {
      const slice = updates.slice(i, i + 500);
      const { error } = await supabaseAdmin.rpc("deprivation_set_centroids", {
        p_nation: "scotland",
        p_codes: slice.map((s) => s.zone_code),
        p_lats: slice.map((s) => s.lat),
        p_lngs: slice.map((s) => s.lng),
      });
      if (error) throw new Error("set_centroids: " + (error.message || JSON.stringify(error)));
      updated += slice.length;
    }
    if (!j.exceededTransferLimit) break;
    offset += feats.length;
    if (offset > 20_000) break;
  }
  return { total, updated };
}

const PHASES: Record<string, () => Promise<any>> = {
  "england-imd": ingestEnglandImd,
  "england-centroids": ingestEnglandCentroids,
  "scotland-simd": ingestScotlandSimd,
  "scotland-centroids": ingestScotlandCentroids,
};

export const Route = createFileRoute("/api/public/hooks/ingest-deprivation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
        const u = new URL(request.url);
        const phase = u.searchParams.get("phase") ?? "all";
        try {
          if (phase === "all") {
            const results: Record<string, any> = {};
            for (const p of Object.keys(PHASES)) {
              const t0 = Date.now();
              results[p] = await PHASES[p]();
              results[p].ms = Date.now() - t0;
            }
            return Response.json({ ok: true, results });
          }
          const fn = PHASES[phase];
          if (!fn) return Response.json({ ok: false, error: `Unknown phase: ${phase}` }, { status: 400 });
          const t0 = Date.now();
          const result = await fn();
          return Response.json({ ok: true, phase, ms: Date.now() - t0, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[ingest-deprivation phase=${phase}]`, msg);
          return Response.json({ ok: false, phase, error: msg }, { status: 500 });
        }
      },
      GET: async () => Response.json({
        ok: true,
        usage: "POST ?phase=england-imd|england-centroids|scotland-simd|scotland-centroids|all",
      }),
    },
  },
});
