// Shared display helpers for GP practices. We surface the practice address
// (or postcode) instead of the NHS practice code anywhere a user-facing label
// is needed — the code is an internal identifier, not something a pharmacy
// owner would recognise.

type GpLike = {
  practice_name?: string | null;
  google_name?: string | null;
  address_line?: string | null;
  postcode?: string | null;
  practice_code?: string | null;
};

function titleCase(s: string): string {
  return s.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Best human-readable name. Falls back to address / postcode (never the GP code). */
export function gpDisplayName(g: GpLike): string {
  const g1 = g.google_name?.trim();
  if (g1) return g1;
  const n = g.practice_name?.trim();
  if (n) return titleCase(n);
  if (g.address_line?.trim()) return g.address_line.trim();
  if (g.postcode?.trim()) return g.postcode.trim();
  return "GP Practice";
}

/** Combined address line for use as secondary text under the name. */
export function gpDisplayAddress(g: GpLike): string {
  const parts = [g.address_line?.trim(), g.postcode?.trim()].filter(Boolean) as string[];
  return parts.join(", ");
}
