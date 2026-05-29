// Server-only helpers for places lookups. Backed by free OpenStreetMap services
// (Nominatim for geocoding/text search, Overpass for nearby POIs) — no API key.
//
// We keep the same PlaceResult shape and exported function names that the rest
// of the app already consumes (geocodeOne, placesNearby, placesTextSearch), so
// callers don't need to change.
//
// Fair-use guidelines we follow:
//   - Nominatim: max 1 req/sec, descriptive User-Agent, countrycodes=gb.
//   - Overpass: descriptive User-Agent, modest timeout, single bbox query.
// If either service throttles us we surface the error to the caller.

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "Pharmacy8/1.0 (https://pharmacy8.com; contact: support@pharmacy8.com)";

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
};

export function extractPostcode(addr: string | undefined | null): string | null {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/);
  return m ? m[0].replace(/\s+/g, " ") : null;
}

// --- tiny in-process throttle so we never burst Nominatim ---
let lastNominatim = 0;
async function nominatimThrottle() {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastNominatim));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

type NominatimRow = {
  osm_type?: string;
  osm_id?: number | string;
  place_id?: number | string;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
};

function shapeNominatim(r: NominatimRow): PlaceResult {
  const addr = r.display_name || "";
  const postcode = r.address?.postcode || extractPostcode(addr);
  const id = r.osm_type && r.osm_id ? `osm:${r.osm_type}/${r.osm_id}` : `nom:${r.place_id}`;
  const name =
    r.name ||
    r.address?.amenity ||
    r.address?.shop ||
    r.address?.healthcare ||
    addr.split(",")[0] ||
    "";
  return {
    id,
    name,
    address: addr,
    postcode: postcode ? postcode.toUpperCase() : null,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lon ? Number(r.lon) : null,
    rating: null,
    userRatingCount: null,
  };
}

export async function placesTextSearch(
  query: string,
  opts?: { includedType?: string; max?: number },
) {
  await nominatimThrottle();
  const max = opts?.max ?? 10;
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "gb");
  url.searchParams.set("limit", String(max));
  const res = await fetch(url.toString(), { headers: { "User-Agent": UA, "Accept-Language": "en-GB" } });
  if (!res.ok) throw new Error(`Nominatim search failed [${res.status}]: ${await res.text()}`);
  const rows = (await res.json()) as NominatimRow[];
  return rows.map(shapeNominatim);
}

// Build a bounding box (in degrees) from a centre + radius in metres.
function bbox(lat: number, lng: number, radiusM: number) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return { s: lat - dLat, w: lng - dLng, n: lat + dLat, e: lng + dLng };
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dL = r(b.lat - a.lat);
  const dG = r(b.lng - a.lng);
  const s = Math.sin(dL / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dG / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function shapeOverpass(el: OverpassEl): PlaceResult {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const parts = [
    t["addr:housenumber"], t["addr:street"], t["addr:city"] || t["addr:town"] || t["addr:suburb"], t["addr:postcode"],
  ].filter(Boolean);
  const address = parts.length ? parts.join(", ") : (t["addr:full"] || "");
  return {
    id: `osm:${el.type}/${el.id}`,
    name: t.name || t["operator"] || (t.amenity === "pharmacy" ? "Pharmacy" : "Surgery"),
    address,
    postcode: (t["addr:postcode"] || extractPostcode(address) || "").toUpperCase() || null,
    lat,
    lng,
    rating: null,
    userRatingCount: null,
  };
}

export async function placesNearby(
  lat: number,
  lng: number,
  includedType: string,
  radiusM = 1600,
  max = 15,
) {
  // Map our two consumer types onto OSM tag filters.
  let filter: string;
  if (includedType === "pharmacy") {
    filter = `nwr["amenity"="pharmacy"](around:${radiusM},${lat},${lng});`;
  } else {
    // GP surgeries — cover both amenity=doctors and healthcare=doctor/clinic, exclude hospitals.
    filter =
      `nwr["amenity"="doctors"](around:${radiusM},${lat},${lng});` +
      `nwr["healthcare"~"^(doctor|clinic|centre)$"]["amenity"!="hospital"](around:${radiusM},${lat},${lng});`;
  }
  const ql = `[out:json][timeout:25];(${filter});out tags center ${max * 3};`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(ql),
  });
  if (!res.ok) throw new Error(`Overpass nearby (${includedType}) failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { elements?: OverpassEl[] };
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const el of json.elements || []) {
    const p = shapeOverpass(el);
    if (p.lat == null || p.lng == null) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  // Sort by distance and trim to max — Overpass doesn't rank.
  out.sort((a, b) => haversine({ lat, lng }, { lat: a.lat!, lng: a.lng! }) - haversine({ lat, lng }, { lat: b.lat!, lng: b.lng! }));
  return out.slice(0, max);
}

export async function geocodeOne(name: string, postcode?: string | null, address?: string | null) {
  const q = [name, postcode, address].filter(Boolean).join(", ");
  const list = await placesTextSearch(q, { max: 1 });
  return list[0] || null;
}

// Kept for source-compat with any caller that imported it.
export function shapePlace(p: NominatimRow): PlaceResult {
  return shapeNominatim(p);
}
