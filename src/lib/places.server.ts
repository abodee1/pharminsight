// Server-only helpers for Google Places (Lovable connector gateway).
// Importable from any *.functions.ts file running on the server.

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

function headers(extra: Record<string, string> = {}) {
  const lov = process.env.LOVABLE_API_KEY;
  const gm = process.env.GOOGLE_MAPS_API_KEY_1 || process.env.GOOGLE_MAPS_API_KEY;
  if (!lov) throw new Error("LOVABLE_API_KEY is not configured");
  if (!gm) throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  return {
    Authorization: `Bearer ${lov}`,
    "X-Connection-Api-Key": gm,
    "Content-Type": "application/json",
    ...extra,
  };
}

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

export function shapePlace(p: any): PlaceResult {
  const addr: string = p.formattedAddress || "";
  return {
    id: p.id,
    name: p.displayName?.text || p.name || "",
    address: addr,
    postcode: extractPostcode(addr),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
  };
}

export async function placesTextSearch(query: string, opts?: { includedType?: string; max?: number }) {
  const res = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
    method: "POST",
    headers: headers({
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types",
    }),
    body: JSON.stringify({
      textQuery: query,
      regionCode: "GB",
      ...(opts?.includedType ? { includedType: opts.includedType } : {}),
      maxResultCount: opts?.max ?? 10,
    }),
  });
  if (!res.ok) throw new Error(`Places searchText failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { places?: any[] };
  return (json.places || []).map(shapePlace);
}

export async function placesNearby(lat: number, lng: number, includedType: string, radiusM = 1600, max = 15) {
  const res = await fetch(`${GATEWAY}/places/v1/places:searchNearby`, {
    method: "POST",
    headers: headers({
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types",
    }),
    body: JSON.stringify({
      includedTypes: [includedType],
      maxResultCount: max,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      rankPreference: "DISTANCE",
    }),
  });
  if (!res.ok) throw new Error(`Places searchNearby (${includedType}) failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { places?: any[] };
  return (json.places || []).map(shapePlace);
}

export async function geocodeOne(name: string, postcode?: string | null, address?: string | null) {
  const q = [name, postcode, address].filter(Boolean).join(" ");
  const list = await placesTextSearch(q, { includedType: "pharmacy", max: 1 });
  return list[0] || null;
}
