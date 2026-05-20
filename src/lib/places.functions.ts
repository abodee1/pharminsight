import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { geocodeOne, placesNearby, placesTextSearch, type PlaceResult } from "./places.server";

export type { PlaceResult } from "./places.server";

/** Free-text Places search restricted to UK pharmacies. */
export const searchPlacesText = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string }) =>
    z.object({ query: z.string().min(2).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const results = await placesTextSearch(`${data.query} pharmacy`, { includedType: "pharmacy", max: 10 });
    return { results };
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
    const radius = data.radiusM ?? 1600;
    const [pharmacies, doctors] = await Promise.all([
      placesNearby(data.lat, data.lng, "pharmacy", radius),
      placesNearby(data.lat, data.lng, "doctor", radius),
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
    const result: PlaceResult | null = await geocodeOne(data.name, data.postcode, data.address);
    return { result };
  });
