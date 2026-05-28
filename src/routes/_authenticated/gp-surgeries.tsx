import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Stethoscope } from "lucide-react";
import { GPPracticeDialog } from "@/components/GPPracticeDialog";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/gp-surgeries")({
  head: () => ({
    meta: [{ title: "GP Surgeries — PharmInsight" }],
  }),
  component: GPSurgeriesPage,
});

type Row = {
  practice_code: string;
  practice_name: string | null;
  country: string | null;
  health_board: string | null;
  postcode: string | null;
};

const PAGE_SIZE = 50;

function GPSurgeriesPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(0);
  }, [debounced, country]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("gp_practices")
        .select("practice_code,practice_name,country,health_board,postcode", { count: "exact" });
      if (country !== "all") q = q.eq("country", country);
      if (debounced) {
        const pattern = `%${debounced}%`;
        q = q.or(
          [
            `practice_name.ilike.${pattern}`,
            `practice_code.ilike.${pattern}`,
            `postcode.ilike.${pattern}`,
          ].join(","),
        );
      }
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count } = await q
        .order("practice_name", { ascending: true, nullsFirst: false })
        .range(from, to);
      if (cancelled) return;
      setRows((data as Row[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, country, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = useMemo(() => (total === 0 ? 0 : page * PAGE_SIZE + 1), [page, total]);
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <PageHeader
        title="GP Surgeries"
        subtitle="Browse every GP practice in our dataset. Click a surgery to see prescribing activity and registered patients."
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, practice code or postcode…"
            className="pl-9"
          />
        </div>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            <SelectItem value="England">England</SelectItem>
            <SelectItem value="Scotland">Scotland</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Practice</TableHead>
              <TableHead className="hidden md:table-cell">Code</TableHead>
              <TableHead className="hidden sm:table-cell">Postcode</TableHead>
              <TableHead className="hidden lg:table-cell">Health board / region</TableHead>
              <TableHead>Country</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading surgeries…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No surgeries match your search.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.practice_code}
                  className="cursor-pointer"
                  onClick={() => setOpenCode(r.practice_code)}
                >
                  <TableCell className="font-medium flex items-center gap-2">
                    <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
                    {r.practice_name || "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-xs">
                    {r.practice_code}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{r.postcode || "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {r.health_board || "—"}
                  </TableCell>
                  <TableCell>{r.country || "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${total.toLocaleString()}`
            : "—"}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </Button>
          <span>
            Page {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <GPPracticeDialog
        open={!!openCode}
        onOpenChange={(o) => !o && setOpenCode(null)}
        practiceCode={openCode}
      />
    </div>
  );
}
