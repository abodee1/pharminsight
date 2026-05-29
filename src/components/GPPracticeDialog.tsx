import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Loader2, Stethoscope, Users, FileText, MapPin } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practiceCode: string | null;
  fallbackName?: string;
  fallbackAddress?: string;
};

type Practice = {
  practice_code: string;
  practice_name: string | null;
  google_name: string | null;
  name_verified_at: string | null;
  country: string | null;
  health_board: string | null;
  postcode: string | null;
};

type Prescribing = { year: number; month: number; total_items: number; total_nic: number; is_provisional: boolean };
type ListSize = { list_size_date: string; registered_patients: number };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function GPPracticeDialog({ open, onOpenChange, practiceCode, fallbackName, fallbackAddress }: Props) {
  const [loading, setLoading] = useState(false);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [prescribing, setPrescribing] = useState<Prescribing[]>([]);
  const [listSize, setListSize] = useState<ListSize | null>(null);

  useEffect(() => {
    if (!open || !practiceCode) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: prac }, { data: presc }, { data: ls }] = await Promise.all([
          supabase.from("gp_practices").select("practice_code,practice_name,google_name,name_verified_at,country,health_board,postcode").eq("practice_code", practiceCode).maybeSingle(),
          supabase.from("gp_prescribing").select("year,month,total_items,total_nic,is_provisional").eq("practice_code", practiceCode).order("year", { ascending: false }).order("month", { ascending: false }).limit(24),
          supabase.from("gp_list_sizes").select("list_size_date,registered_patients").eq("practice_code", practiceCode).order("list_size_date", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (cancelled) return;
        setPractice((prac as Practice) ?? null);
        setPrescribing(((presc as Prescribing[]) ?? []).slice().reverse());
        setListSize((ls as ListSize) ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, practiceCode]);

  const chartData = prescribing.map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    items: Number(r.total_items) || 0,
  }));

  const rawName = practice?.google_name || practice?.practice_name || fallbackName || "";
  const prettyName = rawName ? rawName.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : "GP practice";
  const isVerified = !!practice?.google_name && !!practice?.name_verified_at;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5" />
            {prettyName}
          </DialogTitle>
          <DialogDescription>
            {practice?.postcode ? <span>{practice.postcode}</span> : fallbackAddress ? <span>{fallbackAddress}</span> : null}
            {practice?.country ? <span> · {practice.country}</span> : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading practice data…
          </div>
        ) : !practiceCode ? (
          <p className="py-8 text-sm text-muted-foreground">
            This surgery isn't yet matched to a practice in our dataset.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={Users} label="Registered patients" value={listSize ? listSize.registered_patients.toLocaleString() : "—"} sub={listSize ? `as of ${listSize.list_size_date}` : "No list size yet"} />
              <Stat icon={FileText} label="Items (latest month)" value={prescribing.length ? Number(prescribing[prescribing.length - 1].total_items).toLocaleString() : "—"} sub={prescribing.length ? `${MONTHS[prescribing[prescribing.length - 1].month - 1]} ${prescribing[prescribing.length - 1].year}${prescribing[prescribing.length - 1].is_provisional ? " (provisional)" : ""}` : "No prescribing data yet"} />
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <FileText className="h-3 w-3" /> Prescribing items — last {chartData.length || 0} months
              </h4>
              {chartData.length > 1 ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={50} />
                      <Tooltip />
                      <Line type="monotone" dataKey="items" stroke="var(--primary)" strokeWidth={2} dot={false} />

                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No prescribing data ingested yet for this practice.</p>
              )}
            </div>

            {(practice?.health_board || fallbackAddress) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {practice?.health_board || fallbackAddress}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-md p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
