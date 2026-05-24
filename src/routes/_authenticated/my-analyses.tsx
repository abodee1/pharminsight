import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Star, Trash2, GitCompare, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-analyses")({ component: MyAnalyses });

type Row = {
  id: string; pharmacy_id: string; notes: string | null; is_shortlisted: boolean; created_at: string;
  pharmacy: { id: string; ods_code: string; name: string; address: string | null; postcode: string | null; region: string | null; country: string | null } | null;
  items_last: number; income_est: number; turnover: number | null;
  net_margin: number | null; eps_rate: number | null; red_flags: number; valuation_mid: number | null;
};

function MyAnalyses() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: sa } = await supabase
        .from("saved_analyses")
        .select("id,pharmacy_id,notes,is_shortlisted,created_at,pharmacies(id,ods_code,name,address,postcode,region,country)")
        .eq("user_id", user.id).order("created_at", { ascending: false });
      const list = (sa || []) as any[];
      const enriched: Row[] = [];
      for (const s of list) {
        const phId = s.pharmacy_id;
        const [{ data: disp }, { data: comp }] = await Promise.all([
          supabase.from("dispensing_data").select("month,year,items_dispensed,pharmacy_first_count,nms_count,flu_vaccinations,eps_items").eq("pharmacy_id", phId).order("year", { ascending: false }).order("month", { ascending: false }).limit(12),
          supabase.from("companies").select("turnover,operating_profit,net_profit").eq("pharmacy_id", phId).maybeSingle(),
        ]);
        const last12 = (disp || []).reverse();
        const last = last12[last12.length - 1];
        const itemsTotal = last12.reduce((s, r: any) => s + (r.items_dispensed || 0), 0);
        const pfTotal = last12.reduce((s, r: any) => s + (r.pharmacy_first_count || 0), 0);
        const nmsTotal = last12.reduce((s, r: any) => s + (r.nms_count || 0), 0);
        const fluTotal = last12.reduce((s, r: any) => s + (r.flu_vaccinations || 0), 0);
        const income = (itemsTotal * 1.27 + pfTotal * 15 + nmsTotal * 28 + fluTotal * 12.58) * 0.95;
        const c: any = comp;
        const ebitda = c?.operating_profit ? c.operating_profit + (c.turnover ? c.turnover * 0.02 : 0) : null;
        enriched.push({
          id: s.id, pharmacy_id: phId, notes: s.notes, is_shortlisted: s.is_shortlisted, created_at: s.created_at,
          pharmacy: s.pharmacies,
          items_last: last?.items_dispensed ?? 0,
          income_est: income,
          turnover: c?.turnover ?? null,
          net_margin: c?.turnover && c?.net_profit ? (c.net_profit / c.turnover) * 100 : null,
          eps_rate: last?.items_dispensed ? (last.eps_items / last.items_dispensed) * 100 : null,
          red_flags: 0, valuation_mid: ebitda ? ebitda * 5 : null,
        });
      }
      setRows(enriched);
      setLoading(false);
    })();
  }, [user]);

  const shortlisted = useMemo(() => rows.filter((r) => r.is_shortlisted), [rows]);

  const remove = async (id: string) => {
    await supabase.from("saved_analyses").delete().eq("id", id);
    setRows((c) => c.filter((r) => r.id !== id));
  };
  const toggleStar = async (id: string, cur: boolean) => {
    await supabase.from("saved_analyses").update({ is_shortlisted: !cur }).eq("id", id);
    setRows((c) => c.map((r) => r.id === id ? { ...r, is_shortlisted: !cur } : r));
  };
  const updateNotes = async (id: string, notes: string) => {
    await supabase.from("saved_analyses").update({ notes, updated_at: new Date().toISOString() }).eq("id", id);
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="My Analyses" subtitle="Pharmacies you've saved for further review." />

      {shortlisted.length >= 2 && shortlisted.length <= 3 && (
        <div className="mb-4 flex gap-2">
          <Button onClick={() => setShowCompare((s) => !s)} className="gap-2"><GitCompare className="h-4 w-4" />{showCompare ? "Hide comparison" : `Compare ${shortlisted.length} shortlisted`}</Button>
          {showCompare && <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer className="h-4 w-4" /> Download PDF</Button>}
        </div>
      )}

      {showCompare && shortlisted.length >= 2 && <CompareTable rows={shortlisted} />}

      {loading ? <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</div> :
        rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm">No saved analyses yet.</p>
            <p className="text-xs text-muted-foreground mt-2">Open a pharmacy, click "Analyse This Pharmacy", then save.</p>
          </div>
        ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-muted-foreground"><tr>
              <th className="text-left px-4 py-2 font-medium">Pharmacy</th>
              <th className="text-right px-4 py-2 font-medium">Items</th>
              <th className="text-right px-4 py-2 font-medium">Est. NHS income</th>
              <th className="text-left px-4 py-2 font-medium">Notes</th>
              <th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link to="/pharmacy/$odsCode" params={{ odsCode: r.pharmacy?.ods_code || "" }} className="font-medium hover:underline">{r.pharmacy?.name}</Link>
                    <p className="text-xs text-muted-foreground">{r.pharmacy?.region} · {r.pharmacy?.country}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.items_last.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">£{Math.round(r.income_est).toLocaleString()}</td>
                  <td className="px-4 py-3 w-64"><input defaultValue={r.notes || ""} onBlur={(e) => updateNotes(r.id, e.target.value)} placeholder="Add notes…" className="w-full bg-transparent border-b border-border focus:outline-none focus:border-gold text-sm py-1" /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => toggleStar(r.id, r.is_shortlisted)} className="p-2 rounded-md hover:bg-secondary" title="Shortlist">
                        <Star className={"h-4 w-4 " + (r.is_shortlisted ? "fill-gold text-gold" : "text-muted-foreground")} />
                      </button>
                      <Link to="/pharmacy/$odsCode" params={{ odsCode: r.pharmacy?.ods_code || "" }} className="text-sm font-medium text-primary hover:underline px-2">Open</Link>
                      <button onClick={() => remove(r.id)} className="p-2 rounded-md hover:bg-rose-50 text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompareTable({ rows }: { rows: Row[] }) {
  const metrics: { key: keyof Row; label: string; fmt: (v: any) => string }[] = [
    { key: "items_last", label: "Items dispensed (latest)", fmt: (v) => v ? v.toLocaleString() : "—" },
    { key: "income_est", label: "Est. NHS income", fmt: (v) => v ? "£" + Math.round(v).toLocaleString() : "—" },
    { key: "turnover", label: "Turnover", fmt: (v) => v ? "£" + Math.round(v).toLocaleString() : "—" },
    { key: "net_margin", label: "Net profit margin", fmt: (v) => v != null ? v.toFixed(1) + "%" : "—" },
    { key: "valuation_mid", label: "Valuation (mid)", fmt: (v) => v ? "£" + Math.round(v).toLocaleString() : "—" },
    { key: "eps_rate", label: "EPS rate", fmt: (v) => v != null ? v.toFixed(1) + "%" : "—" },
  ];
  return (
    <div className="mb-6 rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border"><h3 className="text-sm font-semibold">Shortlist comparison</h3></div>
      <table className="w-full text-sm">
        <thead className="bg-secondary text-muted-foreground"><tr>
          <th className="text-left px-4 py-2 font-medium">Metric</th>
          {rows.map((r) => <th key={r.id} className="text-right px-4 py-2 font-medium truncate max-w-[180px]">{r.pharmacy?.name}</th>)}
        </tr></thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={String(m.key)} className="border-t border-border">
              <td className="px-4 py-2 font-medium">{m.label}</td>
              {rows.map((r) => <td key={r.id} className="px-4 py-2 text-right tabular-nums">{m.fmt(r[m.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
