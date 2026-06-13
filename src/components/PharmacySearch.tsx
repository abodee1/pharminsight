import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CountryBadge } from "./CountryBadge";
import { pharmacyDisplayName } from "@/lib/pharmacyName";

export type Pharmacy = {
  id: string;
  ods_code: string;
  name: string;
  trading_name?: string | null;
  address: string | null;
  postcode: string | null;
  country: string | null;
  region?: string | null;
};

type Props = {
  compact?: boolean;
  placeholder?: string;
  onSelect?: (p: Pharmacy) => void;
  excludeIds?: string[];
  clearOnSelect?: boolean;
  autoFocus?: boolean;
  suggestions?: Pharmacy[];
  suggestionsLabel?: string;
};

export function PharmacySearch({
  compact = false,
  placeholder,
  onSelect,
  excludeIds,
  clearOnSelect = true,
  autoFocus = false,
  suggestions,
  suggestionsLabel = "Nearby pharmacies",
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const excludeSet = new Set(excludeIds ?? []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { setResults(await runSearch(term)); }
      finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const handleSelect = (p: Pharmacy) => {
    if (onSelect) { onSelect(p); }
    else { navigate({ to: "/pharmacy/$odsCode", params: { odsCode: p.ods_code } }); }
    if (clearOnSelect) { setOpen(false); setQ(""); setResults([]); }
    else { inputRef.current?.focus(); }
  };

  const showSuggestions = open && q.trim().length < 2 && !!suggestions?.length;
  const showResults = open && q.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={
            placeholder ??
            (compact ? "Search pharmacies…" : "Search by name, trading name, postcode or ODS code…")
          }
          className="w-full h-9 rounded-md border border-input bg-background text-foreground pl-9 pr-9 text-sm placeholder:text-muted-foreground caret-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Nearby suggestions panel (shown when query is empty) */}
      {showSuggestions && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          <p className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/50 flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> {suggestionsLabel}
          </p>
          {suggestions!
            .filter((p) => !excludeSet.has(p.id))
            .slice(0, 8)
            .map((p) => (
              <ResultRow key={p.id} p={p} already={false} onSelect={handleSelect} />
            ))}
        </div>
      )}

      {/* Unified search results */}
      {showResults && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          {!loading && results.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">No pharmacies found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Try a trading name (e.g. "Boots"), postcode, address or ODS code
              </p>
            </div>
          )}
          {results.map((p) => (
            <ResultRow
              key={p.id}
              p={p}
              already={excludeSet.has(p.id)}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  p,
  already,
  onSelect,
}: {
  p: Pharmacy;
  already: boolean;
  onSelect: (p: Pharmacy) => void;
}) {
  const displayName = pharmacyDisplayName(p.name, p.trading_name);
  const location = [p.address, p.postcode].filter(Boolean).join(", ");

  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => !already && onSelect(p)}
      disabled={already}
      className={[
        "w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/40 last:border-b-0 transition-colors",
        already
          ? "opacity-50 cursor-not-allowed bg-secondary/30"
          : "hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-semibold text-sm truncate">{displayName}</p>
          <CountryBadge country={p.country} />
          {already && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
              Selected
            </span>
          )}
        </div>
        {location && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{location}</p>
        )}
      </div>
      <span className="text-[11px] font-mono text-muted-foreground/70 shrink-0">{p.ods_code}</span>
    </button>
  );
}

// ── Search logic ────────────────────────────────────────────────────────────

async function runSearch(term: string): Promise<Pharmacy[]> {
  // Primary: unified RPC (uses GIN indices + trigram scoring)
  const { data, error } = await supabase.rpc("search_pharmacies", {
    p_query: term,
    p_limit: 10,
  });
  if (!error && Array.isArray(data) && data.length > 0) return data as Pharmacy[];

  // Fallback: basic PostgREST queries if RPC isn't deployed yet
  return basicSearch(term);
}

async function basicSearch(term: string): Promise<Pharmacy[]> {
  const cols = "id,ods_code,name,trading_name,address,postcode,country,region";
  const colsFallback = "id,ods_code,name,address,postcode,country,region";
  const upper = term.toUpperCase();
  const safe = term.replace(/[%_]/g, "").trim();
  const compact = safe.replace(/\s+/g, "");

  // Probe whether trading_name exists
  const probe = await supabase.from("pharmacies").select(cols).limit(0);
  const c = probe.error ? colsFallback : cols;

  const [byOds, byPostcode, byName] = await Promise.all([
    supabase.from("pharmacies").select(c).eq("ods_code", upper).limit(1),
    compact.length >= 2
      ? supabase.from("pharmacies").select(c).ilike("postcode", compact + "%").limit(10)
      : Promise.resolve({ data: [] }),
    safe.length >= 2
      ? supabase.from("pharmacies").select(c)
          .or(`name.ilike.%${safe}%,address.ilike.%${safe}%`)
          .limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set<string>();
  const merged: Pharmacy[] = [];
  for (const row of [
    ...(byOds.data || []),
    ...(byPostcode.data || []),
    ...(byName.data || []),
  ] as Pharmacy[]) {
    if (!seen.has(row.id)) { seen.add(row.id); merged.push(row); }
  }
  return merged.slice(0, 10);
}
