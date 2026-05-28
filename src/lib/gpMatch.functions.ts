import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { placesNearby } from "@/lib/places.server";


// ---------- Name normalisation ----------
const STOPWORDS = new Set([
  "the", "and", "of", "at", "for", "in", "on", "to",
  "surgery", "surgeries", "practice", "practices", "medical", "centre",
  "center", "health", "healthcare", "clinic", "doctors", "doctor", "drs",
  "dr", "partners", "partnership", "group", "family", "the", "gp", "gps",
  "nhs", "community", "patients", "patient",
]);

function tokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );
}

function nameScore(a: string | null | undefined, b: string | null | undefined) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  // Jaccard-like, but reward shared tokens generously.
  return hit / Math.max(1, Math.min(ta.size, tb.size));
}

function normPc(pc: string | null | undefined) {
  return (pc || "").toUpperCase().replace(/\s+/g, "");
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type Candidate = {
  practice_code: string;
  practice_name: string | null;
  postcode: string | null;
  address_line: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
};

const placeInputSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  postcode: z.string().max(20).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

export type MatchedPractice = {
  placeId: string;
  practice_code: string;
  practice_name: string | null;
  postcode: string | null;
  confidence: "cached" | "high" | "medium" | "low";
  score: number;
};

/**
 * Match a batch of Google Places (GP surgeries) to gp_practices rows.
 * Strategy:
 *   1. Cache hit via google_place_id (instant, confidence "cached").
 *   2. Candidate pool = practices in same postcode + practices within 400m (if lat/lng given).
 *   3. Score candidates: postcode match + name token overlap + distance.
 *   4. Persist the winning practice_code → google_place_id back to gp_practices.
 */
export const matchGpPractices = createServerFn({ method: "POST" })
  .inputValidator((input: { places: Array<z.infer<typeof placeInputSchema>> }) =>
    z.object({ places: z.array(placeInputSchema).min(1).max(50) }).parse(input),
  )
  .handler(async ({ data }) => {
    const places = data.places;
    const matches = new Map<string, MatchedPractice>();

    // 1. Cache lookup by google_place_id.
    const ids = places.map((p) => p.id);
    const { data: cached } = await supabaseAdmin
      .from("gp_practices")
      .select("practice_code,practice_name,postcode,google_place_id")
      .in("google_place_id", ids);
    const cachedByPid = new Map<string, Candidate>();
    for (const row of (cached as Candidate[] | null) ?? []) {
      if (row.google_place_id) cachedByPid.set(row.google_place_id, row);
    }
    // Practice codes that are already claimed by another google_place_id —
    // never let a different place re-claim them in this batch.
    const claimedCodes = new Set<string>();
    for (const p of places) {
      const hit = cachedByPid.get(p.id);
      if (hit) {
        matches.set(p.id, {
          placeId: p.id,
          practice_code: hit.practice_code,
          practice_name: hit.practice_name,
          postcode: hit.postcode,
          confidence: "cached",
          score: 1,
        });
        claimedCodes.add(hit.practice_code);
      }
    }

    // 2. For uncached places, build candidate set from postcode + geo proximity.
    const uncached = places.filter((p) => !matches.has(p.id));
    const postcodes = Array.from(
      new Set(uncached.map((p) => p.postcode).filter(Boolean) as string[]),
    );
    let byPc = new Map<string, Candidate[]>();
    if (postcodes.length) {
      const variants = Array.from(new Set(postcodes.flatMap((p) => [p, p.replace(/\s+/g, "")])));
      const { data: pcRows } = await supabaseAdmin
        .from("gp_practices")
        .select("practice_code,practice_name,postcode,address_line,lat,lng,google_place_id")
        .or(variants.map((p) => `postcode.ilike.${p}`).join(","))
        .limit(500);
      for (const row of (pcRows as Candidate[] | null) ?? []) {
        const k = normPc(row.postcode);
        if (!k) continue;
        if (!byPc.has(k)) byPc.set(k, []);
        byPc.get(k)!.push(row);
      }
    }

    // 3. Score every place × candidate. We collect a flat list of scored pairs
    //    and then assign greedily (highest score first), ensuring each practice
    //    code is consumed at most once per batch — this prevents two nearby
    //    surgeries (e.g. Park Road vs Priory) from linking to the same record.
    type Pair = { placeId: string; row: Candidate; score: number; conf: MatchedPractice["confidence"] };
    const pairs: Pair[] = [];

    for (const p of uncached) {
      const candMap = new Map<string, Candidate>();

      if (p.postcode) {
        for (const c of byPc.get(normPc(p.postcode)) ?? []) candMap.set(c.practice_code, c);
      }
      if (p.lat != null && p.lng != null) {
        const { data: nearRows } = await supabaseAdmin
          .rpc("gp_practices_near", { p_lat: p.lat, p_lng: p.lng, p_radius_m: 400, p_limit: 15 });
        for (const r of (nearRows as Candidate[] | null) ?? []) candMap.set(r.practice_code, r);
      }

      for (const c of candMap.values()) {
        // Skip candidates already mapped to a *different* Google place — that
        // pairing is locked in by the DB and stealing it would corrupt the cache.
        if (c.google_place_id && c.google_place_id !== p.id) continue;
        if (claimedCodes.has(c.practice_code)) continue;

        const samePc = !!p.postcode && normPc(c.postcode) === normPc(p.postcode);
        const ns = nameScore(p.name, c.practice_name);
        const addrNs = p.address ? nameScore(p.address, c.address_line) : 0;
        let dist = Infinity;
        if (p.lat != null && p.lng != null && c.lat != null && c.lng != null) {
          dist = haversineM({ lat: p.lat, lng: p.lng }, { lat: c.lat, lng: c.lng });
        }
        const distScore = dist === Infinity ? 0 : Math.max(0, 1 - dist / 400);
        // Require *some* name overlap when there's no postcode and no geo signal —
        // otherwise a generic postcode bucket alone can pair anything with anything.
        const hasSignal = ns > 0 || samePc || dist !== Infinity;
        if (!hasSignal) continue;
        const score =
          ns * 0.55 +
          (samePc ? 0.25 : 0) +
          distScore * 0.15 +
          addrNs * 0.05;
        const conf: MatchedPractice["confidence"] =
          score >= 0.6 ? "high" : score >= 0.35 ? "medium" : "low";
        pairs.push({ placeId: p.id, row: c, score, conf });
      }
    }

    // Greedy assignment: best score first, one practice per place + one place per practice.
    pairs.sort((a, b) => b.score - a.score);
    const updates: Array<{ practice_code: string; google_place_id: string }> = [];
    for (const pair of pairs) {
      if (matches.has(pair.placeId)) continue;
      if (claimedCodes.has(pair.row.practice_code)) continue;
      if (pair.score < 0.35) continue; // confidence floor
      matches.set(pair.placeId, {
        placeId: pair.placeId,
        practice_code: pair.row.practice_code,
        practice_name: pair.row.practice_name,
        postcode: pair.row.postcode,
        confidence: pair.conf,
        score: Number(pair.score.toFixed(3)),
      });
      claimedCodes.add(pair.row.practice_code);
      if (pair.conf !== "low" && pair.row.google_place_id !== pair.placeId) {
        updates.push({ practice_code: pair.row.practice_code, google_place_id: pair.placeId });
      }
    }

    // Persist cache writes (only when the slot is still empty — avoids overwriting
    // an existing mapping if another request raced us).
    for (const u of updates) {
      await supabaseAdmin
        .from("gp_practices")
        .update({ google_place_id: u.google_place_id })
        .eq("practice_code", u.practice_code)
        .is("google_place_id", null);
    }

    return { matches: Array.from(matches.values()) };
  });

/**
 * Batch-geocode every gp_practices row that lacks lat/lng using postcodes.io
 * (free, no API key, up to 100 postcodes per request).
 */
export const backfillGpGeocodes = createServerFn({ method: "POST" })
  .inputValidator((input: { limit?: number }) =>
    z.object({ limit: z.number().min(1).max(20000).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const limit = data.limit ?? 5000;
    const { data: rows, error } = await supabaseAdmin
      .from("gp_practices")
      .select("practice_code,postcode")
      .is("lat", null)
      .not("postcode", "is", null)
      .limit(limit);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ practice_code: string; postcode: string | null }>;

    let updated = 0;
    let missed = 0;

    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      const postcodes = batch.map((r) => (r.postcode || "").trim()).filter(Boolean);
      if (!postcodes.length) continue;

      const res = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes }),
      });
      if (!res.ok) {
        missed += batch.length;
        continue;
      }
      const json = (await res.json()) as {
        result: Array<{ query: string; result: { latitude: number; longitude: number } | null }>;
      };

      // postcodes.io preserves order; map by query string (case-insensitive).
      const byQuery = new Map<string, { lat: number; lng: number }>();
      for (const r of json.result || []) {
        if (r.result) byQuery.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
      }

      for (const row of batch) {
        const pc = (row.postcode || "").toUpperCase();
        const loc = byQuery.get(pc);
        if (!loc) { missed++; continue; }
        const { error: upErr } = await supabaseAdmin
          .from("gp_practices")
          .update({ lat: loc.lat, lng: loc.lng })
          .eq("practice_code", row.practice_code);
        if (!upErr) updated++; else missed++;
      }
    }

    const { count: remaining } = await supabaseAdmin
      .from("gp_practices")
      .select("practice_code", { count: "exact", head: true })
      .is("lat", null)
      .not("postcode", "is", null);

    return { scanned: list.length, updated, missed, remaining: remaining ?? null };
  });

// ---------- Scotland GP contact details ingest ----------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Refresh practice_name / postcode / address_line / health_board for Scotland
 * practices from Public Health Scotland's "GP Practices and List Sizes" CSV.
 */
export const refreshScotlandGpContacts = createServerFn({ method: "POST" })
  .handler(async () => {
    // 1. Find the most recent CSV resource via CKAN.
    const pkgRes = await fetch(
      "https://www.opendata.nhs.scot/api/3/action/package_show?id=gp-practice-contact-details-and-list-sizes",
    );
    if (!pkgRes.ok) throw new Error(`CKAN package_show failed [${pkgRes.status}]`);
    const pkg = (await pkgRes.json()) as {
      result: { resources: Array<{ format: string; url: string; last_modified?: string; created?: string; name: string }> };
    };
    const csvs = pkg.result.resources
      .filter((r) => (r.format || "").toUpperCase() === "CSV")
      .sort((a, b) => (b.last_modified || b.created || "").localeCompare(a.last_modified || a.created || ""));
    if (!csvs.length) throw new Error("No CSV resource found");
    const url = csvs[0].url;

    // 2. Download + parse.
    const csvRes = await fetch(url);
    if (!csvRes.ok) throw new Error(`CSV download failed [${csvRes.status}]`);
    const text = await csvRes.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV appears empty");
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const iCode = idx("PracticeCode");
    const iName = idx("GPPracticeName");
    const iA1 = idx("AddressLine1");
    const iA2 = idx("AddressLine2");
    const iA3 = idx("AddressLine3");
    const iA4 = idx("AddressLine4");
    const iPc = idx("Postcode");
    const iHB = idx("HB");
    if (iCode < 0 || iName < 0 || iPc < 0) throw new Error("Required columns missing");

    const rows: Array<{
      practice_code: string; practice_name: string; postcode: string | null;
      address_line: string | null; health_board: string | null; country: string;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      const code = (c[iCode] ?? "").trim();
      if (!code) continue;
      const address = [iA1, iA2, iA3, iA4]
        .filter((j) => j >= 0)
        .map((j) => (c[j] ?? "").trim())
        .filter(Boolean)
        .join(", ");
      rows.push({
        practice_code: code,
        practice_name: (c[iName] ?? "").trim() || code,
        postcode: (c[iPc] ?? "").trim() || null,
        address_line: address || null,
        health_board: iHB >= 0 ? ((c[iHB] ?? "").trim() || null) : null,
        country: "Scotland",

      });
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("gp_practices")
        .upsert(slice, { onConflict: "practice_code" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }

    return { source: csvs[0].name, upserted };
  });

/**
 * Refresh practice_name / postcode for England practices from NHS Digital ODS
 * (ePraccur). Reads the CSV that's hosted unzipped on the NHS Digital mirror.
 */
export const refreshEnglandGpContacts = createServerFn({ method: "POST" })
  .handler(async () => {
    // ORD Bulk API: list all English GP practices.
    // PrimaryRoleId RO177 = PRESCRIBING COST CENTRE (GP Practice). Offset starts at 1.
    let offset = 1;
    const limit = 1000;
    let upserted = 0;
    let pages = 0;
    while (true) {
      const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?PrimaryRoleId=RO177&Status=Active&Limit=${limit}&Offset=${offset}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`ORD bulk failed [${res.status}] offset=${offset}`);
      const json = (await res.json()) as {
        Organisations?: Array<{ OrgId: string; Name: string; PostCode?: string }>;
      };
      const orgs = json.Organisations || [];
      if (!orgs.length) break;
      const rows = orgs.map((o) => ({
        practice_code: o.OrgId,
        practice_name: o.Name,
        postcode: o.PostCode || null,
        country: "England",

      }));
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const { error } = await supabaseAdmin
          .from("gp_practices")
          .upsert(slice, { onConflict: "practice_code" });
        if (error) throw new Error(error.message);
        upserted += slice.length;
      }
      pages++;
      if (orgs.length < limit) break;
      offset += limit;
      if (pages > 30) break; // safety cap
    }
    return { upserted, pages };
  });

