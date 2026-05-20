import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

function authHeaders(extra: Record<string, string> = {}) {
  const lov = process.env.LOVABLE_API_KEY;
  const gm = process.env.GOOGLE_MAPS_API_KEY;
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

function extractPostcode(addr: string | undefined | null): string | null {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/);
  return m ? m[0].replace(/\s+/g, " ") : null;
}

function shapePlace(p: any): PlaceResult {
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

/** Free-text Places search restricted to UK pharmacies. */
export const searchPlacesText = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string }) =>
    z.object({ query: z.string().min(2).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const res = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
      method: "POST",
      headers: authHeaders({
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types",
      }),
      body: JSON.stringify({
        textQuery: `${data.query} pharmacy`,
        regionCode: "GB",
        includedType: "pharmacy",
        maxResultCount: 10,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Places searchText failed [${res.status}]: ${t}`);
    }
    const json = (await res.json()) as { places?: any[] };
    return { results: (json.places || []).map(shapePlace) };
  });

/** Nearby pharmacies + GP surgeries within radius (m) of a point. */
export const nearbyPharmaciesAndGPs = createServerFn({ method: "POST" })
  .inputValidator((input: { lat: number; lng: number; radiusM?: number }) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().min(100).max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const radius = data.radiusM ?? 1600; // ~1 mile
    const fetchType = async (type: string) => {
      const res = await fetch(`${GATEWAY}/places/v1/places:searchNearby`, {
        method: "POST",
        headers: authHeaders({
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types",
        }),
        body: JSON.stringify({
          includedTypes: [type],
          maxResultCount: 15,
          locationRestriction: {
            circle: { center: { latitude: data.lat, longitude: data.lng }, radius },
          },
          rankPreference: "DISTANCE",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Places searchNearby (${type}) failed [${res.status}]: ${t}`);
      }
      const json = (await res.json()) as { places?: any[] };
      return (json.places || []).map(shapePlace);
    };

    const [pharmacies, doctors] = await Promise.all([
      fetchType("pharmacy"),
      fetchType("doctor"),
    ]);
    return { pharmacies, doctors, center: { lat: data.lat, lng: data.lng }, radiusM: radius };
  });

/** Resolve a pharmacy in the DB to a lat/lng using a Places text search. */
export const geocodePharmacy = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string; postcode?: string | null; address?: string | null }) =>
    z
      .object({
        name: z.string().min(1).max(200),
        postcode: z.string().max(20).nullable().optional(),
        address: z.string().max(300).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const q = [data.name, data.postcode, data.address].filter(Boolean).join(" ");
    const res = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
      method: "POST",
      headers: authHeaders({
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location",
      }),
      body: JSON.stringify({
        textQuery: q,
        regionCode: "GB",
        includedType: "pharmacy",
        maxResultCount: 1,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Places geocode failed [${res.status}]: ${t}`);
    }
    const json = (await res.json()) as { places?: any[] };
    const first = (json.places || [])[0];
    if (!first) return { result: null };
    return { result: shapePlace(first) };
  });
