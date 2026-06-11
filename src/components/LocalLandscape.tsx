import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Stethoscope, Pill, Loader2, GitCompare } from "lucide-react";
import { GPPracticeDialog } from "@/components/GPPracticeDialog";

type Props = {
  pharmacyName: string;
  postcode: string | null;
  address: string | null;
};

type NearbyPharmacy = {
  id: string;
  ods_code: string;
  name: string;
  address: string | null;
  postcode: string | null;
  distance_m: number;
};

type NearbyGP = {
  practice_code: string;
  practice_name: string;
  google_name: string | null;
  postcode: string | null;
  address_line: string | null;
  distance_m: number;
};

function displayPracticeName(g: { google_name?: string | null; practice_name?: string | null; practice_code?: string }) {
  return g.practice_name || g.google_name || g.practice_code || "GP Practice";
}

function fmtDist(m: number | null) {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.result;
    if (r?.latitude && r?.longitude) return { lat: r.latitude, lng: r.longitude };
    return null;
  } catch {
    return null;
  }
}

export function LocalLandscape({ pharmacyName, postcode, address }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [pharmacies, setPharmacies] = useState<NearbyPharmacy[]>([]);
  const [doctors, setDoctors] = useState<NearbyGP[]>([]);
  const [openPractice, setOpenPractice] = useState<
    { code: string | null; name?: string; address?: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!postcode) {
          setError("No postcode on record for this pharmacy.");
          setLoading(false);
          return;
        }
        const c = await geocodePostcode(postcode);
        if (cancelled) return;
        if (!c) {
          setError("Couldn't locate this pharmacy from its postcode.");
          setLoading(false);
          return;
        }
        setCenter(c);

        const [pRes, gpRes] = await Promise.all([
          supabase.rpc("pharmacies_near", {
            p_lat: c.lat,
            p_lng: c.lng,
            p_radius_m: 1600,
            p_limit: 25,
          }),
          supabase.rpc("gp_practices_near", {
            p_lat: c.lat,
            p_lng: c.lng,
            p_radius_m: 1600,
            p_limit: 20,
          }),
        ]);
        if (cancelled) return;

        const selfName = pharmacyName.toLowerCase().trim();
        const pcCompact = postcode.toUpperCase().replace(/\s+/g, "");
        const others = ((pRes.data ?? []) as NearbyPharmacy[]).filter((p) => {
          const samePc = (p.postcode || "").toUpperCase().replace(/\s+/g, "") === pcCompact;
          const sameName = (p.name || "").toLowerCase().trim() === selfName;
          return !(samePc && sameName);
        });
        setPharmacies(others.slice(0, 10));
        setDoctors(((gpRes.data ?? []) as NearbyGP[]).slice(0, 10));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load local landscape.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pharmacyName, postcode, address]);

  if (loading) {
    return (
      <section className="mt-8 border border-border rounded-lg p-6 bg-card">
        <h2 className="text-lg font-semibold mb-2">Local landscape</h2>
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Finding nearby pharmacies & GP surgeries…
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

  return (
    <section className="mt-8 border border-border rounded-lg p-6 bg-card">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-semibold">Local landscape</h2>
        <span className="text-xs text-muted-foreground">Within ~1 mile</span>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Other community pharmacies and GP surgeries from our dataset around this branch.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            <Pill className="h-4 w-4" /> Competitor pharmacies ({pharmacies.length})
          </h3>
          <ul className="space-y-3">
            {pharmacies.length === 0 && (
              <li className="text-sm text-muted-foreground">
                No other pharmacies within 1 mile.
              </li>
            )}
            {pharmacies.map((p) => (
              <li
                key={p.id}
                className="border border-border/60 rounded-md p-3 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to="/pharmacy/$odsCode"
                    params={{ odsCode: p.ods_code }}
                    className="block flex-1 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-sm">{p.name}</p>
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {fmtDist(p.distance_m)}
                      </span>
                    </div>
                    {p.address && (
                      <p className="text-xs text-muted-foreground mt-0.5">{p.address}</p>
                    )}
                    <p className="text-xs text-primary font-medium mt-1">View profile →</p>
                  </Link>
                  <Link
                    to="/compare"
                    search={{ add: p.ods_code }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                    title="Add to comparison"
                    aria-label={`Add ${p.name} to comparison`}
                  >
                    <GitCompare className="h-3 w-3" /> Compare
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            <Stethoscope className="h-4 w-4" /> GP surgeries ({doctors.length})
          </h3>
          <ul className="space-y-3">
            {doctors.length === 0 && (
              <li className="text-sm text-muted-foreground">
                No GP surgeries within 1 mile.
              </li>
            )}
            {doctors.map((p) => {
              const displayName = displayPracticeName(p);
              return (
              <li key={p.practice_code}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenPractice({
                      code: p.practice_code,
                      name: displayName,
                      address: p.address_line ?? undefined,
                    })
                  }
                  className="w-full text-left border border-border/60 rounded-md p-3 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm">{displayName}</p>
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {fmtDist(p.distance_m)}
                    </span>
                  </div>
                  {p.address_line && (
                    <p className="text-xs text-muted-foreground mt-0.5">{p.address_line}</p>
                  )}
                  <p className="text-xs text-primary font-medium mt-1">View details →</p>
                </button>
              </li>
            );})}
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
