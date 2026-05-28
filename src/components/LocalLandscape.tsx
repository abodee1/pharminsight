import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { geocodePharmacy, nearbyPharmaciesAndGPs, type PlaceResult } from "@/lib/places.functions";
import { matchGpPractices, type MatchedPractice } from "@/lib/gpMatch.functions";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Stethoscope, Pill, Star, Loader2 } from "lucide-react";
import { GPPracticeDialog } from "@/components/GPPracticeDialog";

type Props = {
  pharmacyName: string;
  postcode: string | null;
  address: string | null;
  selfPlaceNameHint?: string;
};

type LinkedPharmacy = { id: string; ods_code: string; name: string; postcode: string | null };
type LinkedPractice = { practice_code: string; practice_name: string | null; postcode: string | null };

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) {
  if (b.lat == null || b.lng == null) return null;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtDist(m: number | null) {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function LocalLandscape({ pharmacyName, postcode, address, selfPlaceNameHint }: Props) {
  const geocode = useServerFn(geocodePharmacy);
  const nearby = useServerFn(nearbyPharmaciesAndGPs);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [pharmacies, setPharmacies] = useState<PlaceResult[]>([]);
  const [doctors, setDoctors] = useState<PlaceResult[]>([]);
  const [matched, setMatched] = useState<Map<string, LinkedPharmacy>>(new Map());
  const [matchedGPs, setMatchedGPs] = useState<Map<string, LinkedPractice>>(new Map());
  const [openPractice, setOpenPractice] = useState<{ code: string | null; name?: string; address?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const g = await geocode({ data: { name: pharmacyName, postcode, address } });
        if (cancelled) return;
        if (!g.result?.lat || !g.result?.lng) {
          setError("Couldn't locate this pharmacy on the map.");
          setLoading(false);
          return;
        }
        const c = { lat: g.result.lat, lng: g.result.lng };
        setCenter(c);
        const n = await nearby({ data: { lat: c.lat, lng: c.lng, radiusM: 1600 } });
        if (cancelled) return;

        // Exclude the subject pharmacy itself (by id or name match)
        const selfName = (selfPlaceNameHint || pharmacyName).toLowerCase();
        const others = n.pharmacies.filter(
          (p) => p.id !== g.result!.id && p.name.toLowerCase() !== selfName,
        );
        setPharmacies(others);
        setDoctors(n.doctors);

        // Match nearby pharmacies to DB rows by postcode
        const postcodes = Array.from(
          new Set(others.map((p) => p.postcode).filter(Boolean) as string[]),
        );
        if (postcodes.length) {
          const compact = postcodes.map((p) => p.replace(/\s+/g, ""));
          const { data } = await supabase
            .from("pharmacies")
            .select("id,ods_code,name,postcode")
            .or(
              postcodes
                .concat(compact)
                .map((p) => `postcode.ilike.${p}`)
                .join(","),
            )
            .limit(200);
          if (!cancelled && data) {
            const map = new Map<string, LinkedPharmacy>();
            for (const row of data as LinkedPharmacy[]) {
              const key = (row.postcode || "").toUpperCase().replace(/\s+/g, "");
              if (key) map.set(key, row);
            }
            const linked = new Map<string, LinkedPharmacy>();
            for (const p of others) {
              if (!p.postcode) continue;
              const k = p.postcode.toUpperCase().replace(/\s+/g, "");
              const hit = map.get(k);
              if (hit) linked.set(p.id, hit);
            }
            setMatched(linked);
          }
        }

        // Match nearby GP surgeries to gp_practices by postcode
        const gpPostcodes = Array.from(
          new Set(n.doctors.map((p) => p.postcode).filter(Boolean) as string[]),
        );
        if (gpPostcodes.length) {
          const compact = gpPostcodes.map((p) => p.replace(/\s+/g, ""));
          const variants = Array.from(new Set(gpPostcodes.concat(compact)));
          const { data: gpRows } = await supabase
            .from("gp_practices")
            .select("practice_code,practice_name,postcode")
            .or(variants.map((p) => `postcode.ilike.${p}`).join(","))
            .limit(200);
          if (!cancelled && gpRows) {
            const byPc = new Map<string, LinkedPractice>();
            for (const row of gpRows as LinkedPractice[]) {
              const key = (row.postcode || "").toUpperCase().replace(/\s+/g, "");
              if (key) byPc.set(key, row);
            }
            const linkedGP = new Map<string, LinkedPractice>();
            for (const p of n.doctors) {
              if (!p.postcode) continue;
              const k = p.postcode.toUpperCase().replace(/\s+/g, "");
              const hit = byPc.get(k);
              if (hit) linkedGP.set(p.id, hit);
            }
            setMatchedGPs(linkedGP);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load local landscape.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pharmacyName, postcode, address]);

  if (loading) {
    return (
      <section className="mt-8 border border-border rounded-lg p-6 bg-card">
        <h2 className="text-lg font-semibold mb-2">Local landscape</h2>
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Locating pharmacy & finding neighbours…
        </p>
      </section>
    );
  }

  if (error || !center) {
    return (
      <section className="mt-8 border border-border rounded-lg p-6 bg-card">
        <h2 className="text-lg font-semibold mb-2">Local landscape</h2>
        <p className="text-sm text-muted-foreground">{error || "No location data available."}</p>
      </section>
    );
  }

  const withDist = (list: PlaceResult[]) =>
    list
      .map((p) => ({ ...p, _d: distanceMeters(center, p) }))
      .sort((a, b) => (a._d ?? Infinity) - (b._d ?? Infinity));

  const pList = withDist(pharmacies).slice(0, 10);
  const dList = withDist(doctors).slice(0, 10);

  return (
    <section className="mt-8 border border-border rounded-lg p-6 bg-card">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-semibold">Local landscape</h2>
        <span className="text-xs text-muted-foreground">Within ~1 mile</span>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Nearest competitor pharmacies and GP surgeries around this branch, sourced from Google
        Places. Where a competitor is in our dataset, click through to its profile.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            <Pill className="h-4 w-4" /> Competitor pharmacies ({pList.length})
          </h3>
          <ul className="space-y-3">
            {pList.length === 0 && (
              <li className="text-sm text-muted-foreground">No other pharmacies within 1 mile.</li>
            )}
            {pList.map((p) => {
              const link = matched.get(p.id);
              const body = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm">{p.name}</p>
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {fmtDist(p._d)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.address}</p>
                  {p.rating != null && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Star className="h-3 w-3 fill-current" /> {p.rating.toFixed(1)}
                      {p.userRatingCount ? ` · ${p.userRatingCount} reviews` : ""}
                      {link && <span className="ml-2 text-primary font-medium">In our data →</span>}
                    </p>
                  )}
                </>
              );
              return (
                <li key={p.id} className="border border-border/60 rounded-md p-3 hover:bg-secondary/40 transition-colors">
                  {link ? (
                    <Link to="/pharmacy/$odsCode" params={{ odsCode: link.ods_code }} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            <Stethoscope className="h-4 w-4" /> GP surgeries ({dList.length})
          </h3>
          <ul className="space-y-3">
            {dList.length === 0 && (
              <li className="text-sm text-muted-foreground">No GP surgeries within 1 mile.</li>
            )}
            {dList.map((p) => {
              const link = matchedGPs.get(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpenPractice({ code: link?.practice_code ?? null, name: p.name, address: p.address })}
                    className="w-full text-left border border-border/60 rounded-md p-3 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-sm">{p.name}</p>
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {fmtDist(p._d)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.address}</p>
                    {p.rating != null && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Star className="h-3 w-3 fill-current" /> {p.rating.toFixed(1)}
                        {p.userRatingCount ? ` · ${p.userRatingCount} reviews` : ""}
                        {link && <span className="ml-2 text-primary font-medium">In our data →</span>}
                      </p>
                    )}
                    {p.rating == null && link && (
                      <p className="text-xs text-primary font-medium mt-1">In our data →</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <GPPracticeDialog
        open={!!openPractice}
        onOpenChange={(o) => !o && setOpenPractice(null)}
        practiceCode={openPractice?.code ?? null}
        fallbackName={openPractice?.name}
        fallbackAddress={openPractice?.address}
      />
    </section>
  );
}
