import { supabase } from "@/integrations/supabase/client";

// Find the most recent (year, month) in dispensing_data that has substantive
// data. The very latest month often has only a handful of test/preview rows
// loaded ahead of the official release, which makes pages look empty. We
// scan the newest rows, group by period, and pick the latest period whose
// row count clears a sensible threshold.
export async function getLatestSubstantialPeriod(
  minRows = 500,
): Promise<{ year: number; month: number } | null> {
  const { data, error } = await supabase
    .from("dispensing_data")
    .select("year,month")
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(5000);
  if (error || !data || data.length === 0) return null;

  const counts = new Map<string, { year: number; month: number; n: number }>();
  for (const r of data) {
    const k = `${r.year}-${r.month}`;
    const cur = counts.get(k) || { year: r.year, month: r.month, n: 0 };
    cur.n += 1;
    counts.set(k, cur);
  }

  const periods = [...counts.values()].sort(
    (a, b) => b.year * 12 + b.month - (a.year * 12 + a.month),
  );

  // If we hit the 5000 cap, the oldest periods in the slice may be undercounted;
  // still good enough — we only care about the newest substantive period.
  const hit = periods.find((p) => p.n >= minRows);
  return hit ? { year: hit.year, month: hit.month } : periods[0] ?? null;
}
