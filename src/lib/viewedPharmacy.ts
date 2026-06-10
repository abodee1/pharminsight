// Tracks the pharmacy the user is currently "browsing" — i.e. viewing on
// /pharmacy/$odsCode when it differs from their saved home pharmacy. The
// Compare and benchmarking tools read this to treat the browsed pharmacy as
// the subject of comparison. When the user returns to their saved pharmacy
// (e.g. opens the dashboard) the override is cleared and behaviour reverts.

const KEY = "pharminsight.viewedPharmacy";

export type ViewedPharmacy = {
  id: string;
  ods_code: string;
  name?: string | null;
};

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function setViewedPharmacy(p: ViewedPharmacy) {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ id: p.id, ods_code: p.ods_code, name: p.name ?? null }));
  } catch { /* ignore */ }
}

export function getViewedPharmacy(): ViewedPharmacy | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ViewedPharmacy;
    if (!v?.id || !v?.ods_code) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearViewedPharmacy() {
  const s = safeStorage();
  if (!s) return;
  try { s.removeItem(KEY); } catch { /* ignore */ }
}
