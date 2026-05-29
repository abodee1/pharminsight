import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";
const headers = () => ({
  Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
  "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY_1,
  "Content-Type": "application/json",
  "X-Goog-FieldMask":
    "places.id,places.displayName,places.formattedAddress,places.location",
});

const STOP = new Set("the and of at for in on to surgery surgeries practice practices medical centre center health healthcare clinic doctors doctor drs dr partners partnership group family gp gps nhs community patients patient".split(" "));
function tokens(s) {
  if (!s) return new Set();
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 2 && !STOP.has(t)));
}
function nameScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(1, Math.min(ta.size, tb.size));
}
function normPc(p) { return (p || "").toUpperCase().replace(/\s+/g, ""); }
function extractPc(addr) {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/);
  return m ? m[0].replace(/\s+/g, " ") : null;
}
function haversine(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

async function placesNearby(lat, lng, radiusM = 300, max = 8) {
  const res = await fetch(`${GATEWAY}/places/v1/places:searchNearby`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      includedTypes: ["doctor"],
      maxResultCount: max,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      rankPreference: "DISTANCE",
    }),
  });
  if (!res.ok) throw new Error(`nearby ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return (j.places || []).map(p => ({
    id: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    postcode: extractPc(p.formattedAddress),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  }));
}

async function geocodeAll() {
  let totalUpd = 0, totalMiss = 0;
  for (;;) {
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from("gp_practices")
        .select("practice_code,postcode")
        .is("lat", null).not("postcode", "is", null)
        .range(from, from + 999);
      if (error) throw error;
      if (!data.length) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    if (!all.length) break;
    console.log(`[geo] pass: ${all.length} pending`);
    let upd = 0, miss = 0;
    for (let i = 0; i < all.length; i += 100) {
      const batch = all.slice(i, i + 100);
      const postcodes = batch.map(r => (r.postcode || "").trim()).filter(Boolean);
      if (!postcodes.length) continue;
      const res = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes }),
      });
      if (!res.ok) { miss += batch.length; continue; }
      const j = await res.json();
      const byQ = new Map();
      for (const r of j.result || []) if (r.result) byQ.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
      for (const row of batch) {
        const loc = byQ.get((row.postcode || "").toUpperCase());
        if (!loc) { miss++; continue; }
        const { error } = await sb.from("gp_practices").update({ lat: loc.lat, lng: loc.lng }).eq("practice_code", row.practice_code);
        if (!error) upd++; else miss++;
      }
    }
    totalUpd += upd; totalMiss += miss;
    console.log(`[geo] updated=${upd} missed=${miss}`);
    if (!upd) break; // no progress
  }
  console.log(`[geo] DONE updated=${totalUpd} missed=${totalMiss}`);
}

async function sweep() {
  let totalMatched = 0, totalScanned = 0, totalErrors = 0, pass = 0;
  let cursor = "";
  for (;;) {
    pass++;
    const { data: rows, error } = await sb.from("gp_practices")
      .select("practice_code,practice_name,postcode,lat,lng")
      .is("google_place_id", null)
      .not("lat", "is", null).not("lng", "is", null)
      .gt("practice_code", cursor)
      .order("practice_code")
      .limit(200);
    if (error) throw error;
    if (!rows.length) break;
    let matched = 0, lowScore = 0, noCand = 0, taken = 0, apiErr = 0;
    for (const r of rows) {
      let places;
      try { places = await placesNearby(r.lat, r.lng, 300, 8); }
      catch (e) { apiErr++; totalErrors++; if (totalErrors % 20 === 1) console.warn("api err:", String(e).slice(0,200)); continue; }
      if (!places.length) { noCand++; continue; }
      let best = null;
      for (const p of places) {
        const ns = nameScore(p.name, r.practice_name);
        const samePc = !!p.postcode && !!r.postcode && normPc(p.postcode) === normPc(r.postcode);
        let dist = Infinity;
        if (p.lat != null && p.lng != null) dist = haversine({ lat: r.lat, lng: r.lng }, { lat: p.lat, lng: p.lng });
        const distScore = dist === Infinity ? 0 : Math.max(0, 1 - dist / 300);
        if (ns < 0.2 && !samePc && dist > 150) continue;
        const score = ns * 0.6 + (samePc ? 0.25 : 0) + distScore * 0.15;
        if (!best || score > best.score) best = { placeId: p.id, placeName: p.name, score };
      }
      if (!best || best.score < 0.4) { lowScore++; continue; }
      const { data: existing } = await sb.from("gp_practices").select("practice_code").eq("google_place_id", best.placeId).maybeSingle();
      if (existing && existing.practice_code !== r.practice_code) { taken++; continue; }
      const { error: upErr } = await sb.from("gp_practices")
        .update({ google_place_id: best.placeId, google_name: best.placeName || null, name_verified_at: new Date().toISOString() })
        .eq("practice_code", r.practice_code).is("google_place_id", null);
      if (!upErr) matched++;
    }
    totalScanned += rows.length; totalMatched += matched;
    cursor = rows[rows.length - 1].practice_code;
    console.log(`[sweep] pass ${pass}: scanned=${rows.length} matched=${matched} low=${lowScore} noCand=${noCand} taken=${taken} apiErr=${apiErr} cursor=${cursor} (total scanned=${totalScanned} matched=${totalMatched})`);
  }
  console.log(`[sweep] DONE scanned=${totalScanned} matched=${totalMatched}`);
}

await geocodeAll();
await sweep();

const { count: stillUnmatched } = await sb.from("gp_practices").select("practice_code", { count: "exact", head: true }).is("google_place_id", null);
const { count: stillUnverified } = await sb.from("gp_practices").select("practice_code", { count: "exact", head: true }).is("google_name", null);
const { count: total } = await sb.from("gp_practices").select("practice_code", { count: "exact", head: true });
console.log(`FINAL: total=${total} unmatched=${stillUnmatched} unverified=${stillUnverified}`);
