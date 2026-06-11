import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { CountryBadge } from "@/components/CountryBadge";
import { Link } from "@tanstack/react-router";
import { Info, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/distance-selling")({ component: DistanceSelling });

type DspPharmacy = {
  id: string;
  ods_code: string;
  name: string;
  address: string | null;
  postcode: string | null;
  country: string | null;
  region: string | null;
  type: string | null;
  totalItems: number;
  epsRatio: number;
  nmsCount: number;
  pfCount: number;
};

type IcbBucket = {
  region: string;
  count: number;
  totalItems: number;
};

const DSP_TYPE_VALUES = ["distance selling", "distance_selling", "dsp", "Distance Selling", "DS"];

function isDspType(t: string | null): boolean {
  return t !== null && DSP_TYPE_VALUES.some(v => t.toLowerCase().includes(v.toLowerCase()));
}

function DistanceSelling() {
  const [dsps, setDsps] = useState<DspPharmacy[]>([]);
  const [icbBreakdown, setIcbBreakdown] = useState<IcbBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPharms, setTotalPharms] = useState(0);
  const [hasTypeData, setHasTypeData] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Get total pharmacy count
      const { count } = await supabase
        .from("pharmacies")
        .select("id", { count: "exact", head: true });
      setTotalPharms(count ?? 0);

      // Try to find DSPs by type column
      const { data: byType } = await supabase
        .from("pharmacies")
        .select("id,ods_code,name,address,postcode,country,region,type")
        .not("type", "is", null)
        .limit(500);

      const typedDsps = (byType ?? []).filter(p => isDspType(p.type));
      setHasTypeData(typedDsps.length > 0);

      // Proxy detection: England pharmacies with very high EPS % and no community services
      // Use dispensing_data aggregation
      const { data: highEpsRows } = await supabase
        .from("dispensing_data")
        .select("pharmacy_id,items_dispensed,eps_items,eps_nominations,nms_count,pharmacy_first_count,year,month")
        .gte("year", new Date().getFullYear() - 1)
        .order("year", { ascending: false })
        .limit(50000);

      // Aggregate per pharmacy
      const pharmAgg = new Map<string, {
        items: number; eps: number; nom: number; nms: number; pf: number;
      }>();
      for (const r of highEpsRows ?? []) {
        const agg = pharmAgg.get(r.pharmacy_id) ?? { items: 0, eps: 0, nom: 0, nms: 0, pf: 0 };
        agg.items += r.items_dispensed ?? 0;
        agg.eps += r.eps_items ?? 0;
        agg.nom += r.eps_nominations ?? 0;
        agg.nms += r.nms_count ?? 0;
        agg.pf += r.pharmacy_first_count ?? 0;
        pharmAgg.set(r.pharmacy_id, agg);
      }

      // DSP proxy: eps% > 97%, high volume, no NMS/PF
      const dspCandidateIds = Array.from(pharmAgg.entries())
        .filter(([, a]) => a.items > 5000 && a.eps / Math.max(1, a.items) > 0.97 && a.nms === 0 && a.pf === 0)
        .map(([id]) => id);

      // Merge with type-column DSPs
      const allDspIds = Array.from(new Set([
        ...typedDsps.map(p => p.id),
        ...dspCandidateIds,
      ]));

      if (allDspIds.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch pharmacy details
      const { data: pharmDetails } = await supabase
        .from("pharmacies")
        .select("id,ods_code,name,address,postcode,country,region,type")
        .in("id", allDspIds.slice(0, 200));

      const dspList: DspPharmacy[] = (pharmDetails ?? []).map(p => {
        const agg = pharmAgg.get(p.id) ?? { items: 0, eps: 0, nom: 0, nms: 0, pf: 0 };
        return {
          ...p,
          totalItems: agg.items,
          epsRatio: agg.items > 0 ? (agg.eps / agg.items) * 100 : 0,
          nmsCount: agg.nms,
          pfCount: agg.pf,
        };
      }).sort((a, b) => b.totalItems - a.totalItems);

      setDsps(dspList);

      // ICB breakdown (England only, region as ICB proxy)
      const englandDsps = dspList.filter(p => p.country === "England" && p.region);
      const icbMap = new Map<string, IcbBucket>();
      for (const p of englandDsps) {
        const region = p.region!;
        const bucket = icbMap.get(region) ?? { region, count: 0, totalItems: 0 };
        bucket.count++;
        bucket.totalItems += p.totalItems;
        icbMap.set(region, bucket);
      }
      setIcbBreakdown(
        Array.from(icbMap.values()).sort((a, b) => b.totalItems - a.totalItems).slice(0, 15)
      );

      setLoading(false);
    })();
  }, []);

  const englandDsps = dsps.filter(p => p.country === "England");
  const scotlandDsps = dsps.filter(p => p.country === "Scotland");

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      <PageHeader
        title="Distance Selling Pharmacies"
        subtitle="National overview of distance-selling and high-volume remote dispensing pharmacies"
      />

      {/* Schema limitation notice */}
      {!hasTypeData && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-400">DSP classification estimated</p>
            <p className="text-muted-foreground mt-0.5">
              The pharmacy register does not include a contract-type flag in this dataset. Pharmacies below are
              identified as likely distance-sellers using EPS% {">"}97%, volume {">"}5,000 items/year, and no
              community-facing services (NMS = 0, Pharmacy First = 0).
            </p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-lg bg-card border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground">DSPs identified</p>
          <p className="text-2xl font-bold mt-1">{loading ? "…" : dsps.length.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-card border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground">% of all pharmacies</p>
          <p className="text-2xl font-bold mt-1">
            {loading || totalPharms === 0 ? "…" : `${((dsps.length / totalPharms) * 100).toFixed(1)}%`}
          </p>
        </div>
        <div className="rounded-lg bg-card border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground">England DSPs</p>
          <p className="text-2xl font-bold mt-1">{loading ? "…" : englandDsps.length}</p>
        </div>
        <div className="rounded-lg bg-card border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground">Scotland DSPs</p>
          <p className="text-2xl font-bold mt-1">{loading ? "…" : scotlandDsps.length}</p>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground animate-pulse py-12 text-center">Loading distance-selling data…</div>
      )}

      {!loading && dsps.length === 0 && (
        <div className="rounded-lg border border-border bg-secondary/40 p-6 text-sm text-muted-foreground text-center">
          No distance-selling pharmacies could be identified with the current data. This may mean the EPS/nomination
          data is not yet fully loaded, or that the dispensing data does not contain enough months to classify pharmacies.
        </div>
      )}

      {!loading && dsps.length > 0 && (
        <>
          {/* ICB breakdown (England) */}
          {icbBreakdown.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> ICB penetration (England)
              </h2>
              <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Region / ICB</th>
                      <th className="text-right px-4 py-2 font-medium">DSPs</th>
                      <th className="text-right px-4 py-2 font-medium">Items (12M)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {icbBreakdown.map(b => (
                      <tr key={b.region} className="border-t border-border">
                        <td className="px-4 py-2 truncate max-w-xs">{b.region}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.count}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.totalItems.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* DSP leaderboard */}
          <section>
            <h2 className="text-sm font-semibold mb-3">DSP leaderboard — top 20 by volume</h2>
            <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">#</th>
                      <th className="text-left px-4 py-2 font-medium">Pharmacy</th>
                      <th className="text-left px-4 py-2 font-medium">Country</th>
                      <th className="text-right px-4 py-2 font-medium">Items (12M)</th>
                      <th className="text-right px-4 py-2 font-medium">EPS %</th>
                      <th className="text-left px-4 py-2 font-medium">Detected by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dsps.slice(0, 20).map((p, i) => (
                      <tr key={p.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2">
                          <Link
                            to="/pharmacy/$odsCode"
                            params={{ odsCode: p.ods_code }}
                            className="font-medium hover:text-primary transition-colors"
                          >
                            {p.name}
                          </Link>
                          {p.postcode && <span className="text-xs text-muted-foreground ml-2">{p.postcode}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <CountryBadge country={p.country} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.totalItems.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.epsRatio.toFixed(1)}%</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {isDspType(p.type) ? `Type: ${p.type}` : "EPS proxy"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      <DataAttribution />
    </div>
  );
}
