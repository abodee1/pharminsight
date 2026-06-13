import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
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

const ODS_RE = /^[A-Za-z][A-Za-z0-9]{2,9}$/;
const POSTCODE_RE = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]?(\s*[0-9][A-Za-z]{2})?$/;

type Props = {
  compact?: boolean;
  placeholder?: string;
  /** Override what happens when a result is picked. Default: navigate to /pharmacy/[ods]. */
  onSelect?: (p: Pharmacy) => void;
  /** Pharmacy ids already chosen — shown with a "Selected" badge and de-prioritised. */
  excludeIds?: string[];
  /** When false, keep the query after selection (handy for add-multiple flows). Default true. */
  clearOnSelect?: boolean;
  autoFocus?: boolean;
  /** Pre-loaded suggestions shown when the query is empty (e.g. nearby pharmacies). */
  suggestions?: Pharmacy[];
  /** Label for the suggestions section header. */
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
  const [fuzzyResults, setFuzzyResults] = useState<Pharmacy[]>([]);
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const excludeSet = new Set(excludeIds ?? []);

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

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // debounced search
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setFuzzyResults([]);
      setLoading(false);
      setFuzzyLoading(false);
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

  const runFuzzySearch = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setFuzzyLoading(true);
    setFuzzyResults([]);
    try {
      const { data, error } = await supabase.rpc("search_pharmacies_fuzzy", {
        p_query: term,
        p_limit: 10,
      });
      if (error) throw error;
      const existing = new Set(results.map((r) => r.id));
      const extras = ((data || []) as Pharmacy[]).filter((r) => !existing.has(r.id));
      setFuzzyResults(extras);
      if (extras.length === 0) toast.info("No close matches found.");
    } catch (e: any) {
      toast.error(e?.message || "Fuzzy search failed.");
    } finally {
      setFuzzyLoading(false);
    }
  };

  const handleSelect = (p: Pharmacy) => {
    if (onSelect) {
      onSelect(p);
    } else {
      navigate({ to: "/pharmacy/$odsCode", params: { odsCode: p.ods_code } });
    }
    if (clearOnSelect) {
      setOpen(false);
      setQ("");
      setResults([]);
      setFuzzyResults([]);
    } else {
      inputRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            placeholder ?? (compact ? "Search pharmacies…" : "Search by pharmacy name, postcode, or ODS code...")
          }
          className="w-full h-9 rounded-md border border-input bg-background text-foreground pl-9 pr-9 text-sm placeholder:text-muted-foreground caret-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Suggestions panel — shown when query is empty and suggestions provided */}
      {open && q.trim().length < 2 && suggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          <p className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/50">
            {suggestionsLabel}
          </p>
          {suggestions.filter(p => !excludeSet.has(p.id)).slice(0, 8).map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(p)}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-accent hover:text-accent-foreground"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate">{pharmacyDisplayName(p.name, p.trading_name)}</p>
                  <CountryBadge country={p.country} />
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {[p.address, p.postcode].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground shrink-0">{p.ods_code}</span>
            </button>
          ))}
        </div>
      )}

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          {!loading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No pharmacies found. Try a different name or postcode.
            </p>
          )}
          {results.slice(0, 10).map((p) => {
            const already = excludeSet.has(p.id);
            return (
              <button
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !already && handleSelect(p)}
                disabled={already}
                className={[
                  "w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-b-0",
                  already
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-accent hover:text-accent-foreground",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{pharmacyDisplayName(p.name, p.trading_name)}</p>
                    <CountryBadge country={p.country} />
                    {already && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[p.address, p.postcode, p.region].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-xs font-mono text-muted-foreground shrink-0">{p.ods_code}</span>
              </button>
            );
          })}

          {/* Fuzzy match fallback */}
          <div className="border-t border-border bg-secondary/30">
            {fuzzyResults.length === 0 ? (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={runFuzzySearch}
                disabled={fuzzyLoading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {fuzzyLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {fuzzyLoading ? "Searching…" : `Can't find it? Try a fuzzy match for "${q.trim()}"`}
              </button>
            ) : (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Fuzzy matches
                </p>
                {fuzzyResults.map((p) => {
                  const already = excludeSet.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => !already && handleSelect(p)}
                      disabled={already}
                      className={[
                        "w-full text-left flex items-center gap-3 px-3 py-2.5 border-t border-border/30",
                        already ? "opacity-50 cursor-not-allowed" : "hover:bg-accent hover:text-accent-foreground",
                      ].join(" ")}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate">{pharmacyDisplayName(p.name, p.trading_name)}</p>
                          <CountryBadge country={p.country} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {[p.address, p.postcode, p.region].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{p.ods_code}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

async function runSearch(term: string): Promise<Pharmacy[]> {
  const cols = "id,ods_code,name,trading_name,address,postcode,country,region";
  const looksLikeOds = ODS_RE.test(term);
  const looksLikePostcode = POSTCODE_RE.test(term);
  const upper = term.toUpperCase();
  const esc = (s: string) => s.replace(/[%_,()]/g, " ").trim();

  const queries: PromiseLike<Pharmacy[]>[] = [];

  // 1. Exact ODS match
  if (looksLikeOds) {
    queries.push(
      supabase.from("pharmacies").select(cols).eq("ods_code", upper).limit(1).then((r) => (r.data || []) as Pharmacy[])
    );
  }

  // 2. Postcode prefix (also try with whitespace stripped, since stored postcodes
  // sometimes lack the space e.g. "KY112RA")
  if (looksLikePostcode || /^[A-Za-z]{1,2}[0-9]/.test(term)) {
    const compact = term.replace(/\s+/g, "");
    queries.push(
      supabase
        .from("pharmacies")
        .select(cols)
        .or(`postcode.ilike.${esc(term)}%,postcode.ilike.${esc(compact)}%`)
        .order("postcode", { ascending: true })
        .limit(20)
        .then((r) => (r.data || []) as Pharmacy[])
    );
  }

  // 3. Tokenised multi-word search. Each token must appear in at least one of
  // name/address/postcode/region. We seed with the most distinctive token
  // (longest) via an OR filter, then AND the rest in-memory.
  const tokens = term.split(/\s+/).map(esc).filter((t) => t.length >= 2);
  if (tokens.length) {
    const seed = [...tokens].sort((a, b) => b.length - a.length)[0];
    queries.push(
      supabase
        .from("pharmacies")
        .select(cols)
        .or(
          `name.ilike.%${seed}%,address.ilike.%${seed}%,postcode.ilike.%${seed}%,region.ilike.%${seed}%`,
        )
        .limit(200)
        .then((r) => {
          const rows = (r.data || []) as Pharmacy[];
          const lowers = tokens.map((t) => t.toLowerCase());
          return rows.filter((p) => {
            const hay = [p.name, p.address, p.postcode, (p as any).region]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return lowers.every((t) => hay.includes(t));
          });
        })
    );
  }

  // 4. ODS prefix (fallback)
  if (!looksLikeOds && /^[A-Za-z][A-Za-z0-9]/.test(term) && !term.includes(" ")) {
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
