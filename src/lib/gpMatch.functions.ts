import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

    const updates: Array<{ practice_code: string; google_place_id: string }> = [];

    for (const p of uncached) {
      const candidates: Candidate[] = [];

      // Postcode candidates
      if (p.postcode) {
        const k = normPc(p.postcode);
        candidates.push(...(byPc.get(k) ?? []));
      }

      // Geo candidates (within 400m)
      if (p.lat != null && p.lng != null) {
        const { data: nearRows } = await supabaseAdmin
          .rpc("gp_practices_near", { p_lat: p.lat, p_lng: p.lng, p_radius_m: 400, p_limit: 15 });
        for (const r of (nearRows as Candidate[] | null) ?? []) {
          if (!candidates.find((c) => c.practice_code === r.practice_code)) {
            candidates.push(r);
          }
        }
      }

      if (candidates.length === 0) continue;

      // Score every candidate.
      let best: { row: Candidate; score: number; conf: MatchedPractice["confidence"] } | null = null;
      for (const c of candidates) {
        const samePc = normPc(c.postcode) === normPc(p.postcode || "") && !!p.postcode;
        const ns = nameScore(p.name, c.practice_name);
        const addrNs = p.address ? nameScore(p.address, c.address_line) : 0;
        let dist = Infinity;
        if (p.lat != null && p.lng != null && c.lat != null && c.lng != null) {
          dist = haversineM({ lat: p.lat, lng: p.lng }, { lat: c.lat, lng: c.lng });
        }
        // Composite score in [0,1]
        const distScore = dist === Infinity ? 0 : Math.max(0, 1 - dist / 400);
        const score =
          ns * 0.55 +
          (samePc ? 0.25 : 0) +
          distScore * 0.15 +
          addrNs * 0.05;
        if (!best || score > best.score) {
          const conf: MatchedPractice["confidence"] =
            score >= 0.6 ? "high" : score >= 0.35 ? "medium" : "low";
          best = { row: c, score, conf };
        }
      }

      if (best && best.score >= 0.35) {
        matches.set(p.id, {
          placeId: p.id,
          practice_code: best.row.practice_code,
          practice_name: best.row.practice_name,
          postcode: best.row.postcode,
          confidence: best.conf,
          score: Number(best.score.toFixed(3)),
        });
        if (best.conf !== "low" && best.row.google_place_id !== p.id) {
          updates.push({ practice_code: best.row.practice_code, google_place_id: p.id });
        }
      }
    }

    // Persist cache writes (best-effort, ignore unique-violation race).
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
