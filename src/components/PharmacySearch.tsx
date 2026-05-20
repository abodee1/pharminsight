import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CountryBadge } from "./CountryBadge";

type Pharmacy = {
  id: string;
  ods_code: string;
  name: string;
  address: string | null;
  postcode: string | null;
  country: string | null;
};

const ODS_RE = /^[A-Za-z][A-Za-z0-9]{2,9}$/;
const POSTCODE_RE = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]?(\s*[0-9][A-Za-z]{2})?$/;

export function PharmacySearch({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pharmacy[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // close on outside click / escape
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // debounced search
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      runSearch(term)
        .then((r) => setResults(r))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const onSelect = (p: Pharmacy) => {
    setOpen(false);
    setQ("");
    setResults([]);
    navigate({ to: "/pharmacy/$odsCode", params: { odsCode: p.ods_code } });
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={compact ? "Search pharmacies…" : "Search by pharmacy name, postcode, or ODS code..."}
          className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[420px] overflow-y-auto">
          {!loading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No pharmacies found. Try a different name or postcode.
            </p>
          )}
          {results.slice(0, 8).map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(p)}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-accent hover:text-accent-foreground border-b border-border/50 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate">{p.name}</p>
                  <CountryBadge country={p.country} />
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {[p.address, p.postcode].filter(Boolean).join(", ")}
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground shrink-0">{p.ods_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

async function runSearch(term: string): Promise<Pharmacy[]> {
  const cols = "id,ods_code,name,address,postcode,country";
  const looksLikeOds = ODS_RE.test(term);
  const looksLikePostcode = POSTCODE_RE.test(term);
  const upper = term.toUpperCase();

  const queries: Promise<Pharmacy[]>[] = [];

  // 1. Exact ODS match
  if (looksLikeOds) {
    queries.push(
      supabase.from("pharmacies").select(cols).eq("ods_code", upper).limit(1).then((r) => (r.data || []) as Pharmacy[])
    );
  }

  // 2. Postcode prefix
  if (looksLikePostcode || /^[A-Za-z]{1,2}[0-9]/.test(term)) {
    queries.push(
      supabase
        .from("pharmacies")
        .select(cols)
        .ilike("postcode", `${term}%`)
        .order("postcode", { ascending: true })
        .limit(20)
        .then((r) => (r.data || []) as Pharmacy[])
    );
  }

  // 3. Name (starts-with then contains) + address (contains)
  const escaped = term.replace(/[%_]/g, "\\$&");
  queries.push(
    supabase
      .from("pharmacies")
      .select(cols)
      .or(`name.ilike.${escaped}%,name.ilike.%${escaped}%,address.ilike.%${escaped}%`)
      .limit(20)
      .then((r) => (r.data || []) as Pharmacy[])
  );

  // 4. ODS prefix (fallback)
  if (!looksLikeOds && /^[A-Za-z][A-Za-z0-9]/.test(term)) {
    queries.push(
      supabase
        .from("pharmacies")
        .select(cols)
        .ilike("ods_code", `${upper}%`)
        .limit(10)
        .then((r) => (r.data || []) as Pharmacy[])
    );
  }

  const all = await Promise.all(queries);

  // dedupe by id, preserve priority order
  const seen = new Set<string>();
  const merged: Pharmacy[] = [];
  const lowerTerm = term.toLowerCase();
  for (const list of all) {
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
  }

  // Re-rank name results so starts-with beats contains
  merged.sort((a, b) => {
    const aRank = rank(a, lowerTerm, upper);
    const bRank = rank(b, lowerTerm, upper);
    return aRank - bRank;
  });

  return merged.slice(0, 8);
}

function rank(p: Pharmacy, lower: string, upper: string): number {
  if (p.ods_code?.toUpperCase() === upper) return 0;
  const pc = (p.postcode || "").toLowerCase().replace(/\s+/g, "");
  const t = lower.replace(/\s+/g, "");
  if (pc === t) return 1;
  if (pc.startsWith(t)) return 2;
  const name = (p.name || "").toLowerCase();
  if (name.startsWith(lower)) return 3;
  if (name.includes(lower)) return 4;
  if (p.ods_code?.toUpperCase().startsWith(upper)) return 5;
  return 6;
}
