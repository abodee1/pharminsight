import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Loader2, X, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CountryBadge } from "./CountryBadge";

export type Pharmacy = {
  id: string;
  ods_code: string;
  name: string;
  trading_name?: string | null;
  address: string | null;
  postcode: string | null;
  country: string | null;
  region?: string | null;
  chain_group?: string | null;
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

// ---- Recent searches helpers ----
const LS_KEY = "pharminsight_recent_searches";
const MAX_RECENT = 10;

function getLocalRecent(): Pharmacy[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}
function saveLocalRecent(p: Pharmacy) {
  const list = getLocalRecent().filter(r => r.id !== p.id);
  localStorage.setItem(LS_KEY, JSON.stringify([p, ...list].slice(0, MAX_RECENT)));
}
function removeLocalRecentById(id: string) {
  localStorage.setItem(LS_KEY, JSON.stringify(getLocalRecent().filter(r => r.id !== id)));
}
function clearLocalRecent() {
  localStorage.removeItem(LS_KEY);
}

// ---- Match highlight ----
function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-amber-100 dark:bg-amber-900/40 rounded-sm">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

// ---- Unified search via enhanced fuzzy RPC ----
async function runSearch(term: string): Promise<Pharmacy[]> {
  if (term.length < 2) return [];
  const { data, error } = await supabase.rpc("search_pharmacies_fuzzy", {
    p_query: term,
    p_limit: 10,
  });
  if (error || !data) return [];
  return (data as any[]).map(r => ({
    id: r.id,
    ods_code: r.ods_code,
    name: r.name,
    trading_name: r.trading_name ?? null,
    address: r.address,
    postcode: r.postcode,
    country: r.country,
    region: r.region ?? null,
    chain_group: r.chain_group ?? null,
  }));
}

// ---- Supabase recent search helpers ----
// Cast to any because the generated types don't reflect the migration until it's applied
const db = supabase as any;

async function loadDbRecent(userId: string): Promise<Pharmacy[]> {
  const { data } = await db
    .from("recent_searches")
    .select("pharmacy_id,ods_code,name,trading_name,address,postcode,country,region")
    .eq("user_id", userId)
    .order("searched_at", { ascending: false })
    .limit(MAX_RECENT);
  return ((data as any[]) || []).map(r => ({
    id: r.pharmacy_id || r.ods_code,
    ods_code: r.ods_code,
    name: r.name,
    trading_name: r.trading_name ?? null,
    address: r.address,
    postcode: r.postcode,
    country: r.country,
    region: r.region ?? null,
  }));
}

async function saveDbRecent(userId: string, p: Pharmacy) {
  await db.from("recent_searches").upsert(
    {
      user_id: userId,
      pharmacy_id: p.id,
      ods_code: p.ods_code,
      name: p.name,
      trading_name: p.trading_name,
      address: p.address,
      postcode: p.postcode,
      country: p.country,
      region: p.region,
      searched_at: new Date().toISOString(),
    },
    { onConflict: "user_id,ods_code" }
  );
  // Trim oldest beyond MAX_RECENT
  const { data: all } = await db
    .from("recent_searches")
    .select("id,searched_at")
    .eq("user_id", userId)
    .order("searched_at", { ascending: false });
  if (all && all.length > MAX_RECENT) {
    const toDelete = ((all as any[]).slice(MAX_RECENT)).map((r: any) => r.id);
    await db.from("recent_searches").delete().in("id", toDelete);
  }
}

async function removeDbRecent(userId: string, odsCode: string) {
  await db
    .from("recent_searches")
    .delete()
    .eq("user_id", userId)
    .eq("ods_code", odsCode);
}

async function clearDbRecent(userId: string) {
  await db.from("recent_searches").delete().eq("user_id", userId);
}

// ---- Main component ----
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
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pharmacy[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<Pharmacy[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const excludeSet = new Set(excludeIds ?? []);

  // Load recent searches when auth state known
  useEffect(() => {
    if (user) {
      loadDbRecent(user.id).then(setRecentSearches).catch(() => setRecentSearches([]));
    } else {
      setRecentSearches(getLocalRecent());
    }
  }, [user]);

  // Close on outside click / escape
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

  // Debounced search
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      runSearch(term).then(setResults).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const saveRecent = useCallback((p: Pharmacy) => {
    if (user) {
      saveDbRecent(user.id, p).catch(() => {});
    } else {
      saveLocalRecent(p);
    }
    setRecentSearches(prev => [p, ...prev.filter(r => r.id !== p.id)].slice(0, MAX_RECENT));
  }, [user]);

  const removeRecent = useCallback((p: Pharmacy) => {
    if (user) {
      removeDbRecent(user.id, p.ods_code).catch(() => {});
    } else {
      removeLocalRecentById(p.id);
    }
    setRecentSearches(prev => prev.filter(r => r.id !== p.id));
  }, [user]);

  const clearAllRecent = useCallback(() => {
    if (user) {
      clearDbRecent(user.id).catch(() => {});
    } else {
      clearLocalRecent();
    }
    setRecentSearches([]);
  }, [user]);

  const handleSelect = (p: Pharmacy) => {
    saveRecent(p);
    if (onSelect) {
      onSelect(p);
    } else {
      navigate({ to: "/pharmacy/$odsCode", params: { odsCode: p.ods_code } });
    }
    if (clearOnSelect) {
      setOpen(false);
      setQ("");
      setResults([]);
    } else {
      inputRef.current?.focus();
    }
  };

  const showRecent = open && q.trim().length < 2 && recentSearches.length > 0;
  const showSuggestions = open && q.trim().length < 2 && suggestions && suggestions.length > 0 && recentSearches.length === 0;
  const showResults = open && q.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={
            placeholder ?? (compact ? "Search pharmacies…" : "Search by name, postcode, or ODS code...")
          }
          className="w-full h-9 rounded-md border border-input bg-background text-foreground pl-9 pr-9 text-sm placeholder:text-muted-foreground caret-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Recent searches panel */}
      {showRecent && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-border/50">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recent searches</p>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={clearAllRecent}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>
          {recentSearches.filter(p => !excludeSet.has(p.id)).map(p => {
            const displayName = p.trading_name || p.name;
            const showLegal = p.trading_name && p.trading_name !== p.name;
            return (
              <div key={p.id} className="flex items-stretch border-b border-border/50 last:border-0">
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => handleSelect(p)}
                  className="flex-1 text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors min-w-0"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-medium text-sm truncate">{displayName}</p>
                      <CountryBadge country={p.country} />
                    </div>
                    {showLegal && (
                      <p className="text-[11px] text-muted-foreground truncate">{p.name}</p>
                    )}
                    {p.postcode && (
                      <p className="text-xs text-muted-foreground truncate">{p.postcode}</p>
                    )}
                  </div>
                </button>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => removeRecent(p)}
                  className="px-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="Remove from recent searches"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {/* Fall through to suggestions below recent */}
          {suggestions && suggestions.length > 0 && (
            <>
              <p className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/50">
                {suggestionsLabel}
              </p>
              {suggestions.filter(p => !excludeSet.has(p.id)).slice(0, 5).map(p => (
                <PharmResultRow key={p.id} p={p} query="" already={false} onSelect={() => handleSelect(p)} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Nearby suggestions panel (no recent searches yet) */}
      {showSuggestions && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          <p className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/50">
            {suggestionsLabel}
          </p>
          {suggestions!.filter(p => !excludeSet.has(p.id)).slice(0, 8).map(p => (
            <PharmResultRow key={p.id} p={p} query="" already={false} onSelect={() => handleSelect(p)} />
          ))}
        </div>
      )}

      {/* Search results panel */}
      {showResults && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto overscroll-contain">
          {!loading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results found — try a different spelling or postcode
            </p>
          )}
          {results.map(p => {
            const already = excludeSet.has(p.id);
            return (
              <PharmResultRow
                key={p.id}
                p={p}
                query={q}
                already={already}
                onSelect={() => !already && handleSelect(p)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Shared result row ----
function PharmResultRow({
  p, query, already, onSelect,
}: { p: Pharmacy; query: string; already: boolean; onSelect: () => void }) {
  const displayName = p.trading_name || p.name;
  const showLegal = p.trading_name && p.trading_name !== p.name;
  return (
    <button
      onMouseDown={e => e.preventDefault()}
      onClick={onSelect}
      disabled={already}
      className={[
        "w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-0",
        already
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="font-semibold text-sm truncate">
            {query.trim().length >= 2 ? highlightMatch(displayName, query) : displayName}
          </p>
          <CountryBadge country={p.country} />
          {p.chain_group && (
            <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
              {p.chain_group}
            </span>
          )}
          {already && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
              Selected
            </span>
          )}
        </div>
        {showLegal && (
          <p className="text-[11px] text-muted-foreground truncate">{p.name}</p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {[p.address, p.postcode].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span className="text-xs font-mono text-muted-foreground shrink-0">{p.ods_code}</span>
    </button>
  );
}
