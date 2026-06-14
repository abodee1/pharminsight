const SMALL_WORDS = new Set(["a","an","the","and","but","or","for","nor","of","on","in","at","to","up","by","as","uk","ltd","llp","plc"]);

export function pharmacyDisplayName(name: string, tradingName?: string | null, odsCode?: string | null): string {
  if (tradingName?.trim()) return tradingName.trim();
  const trimmed = name.trim();
  // When name is literally the ODS code (ingestion fallback for blank CSV names),
  // show a human-readable placeholder instead of a cryptic code
  if (odsCode && trimmed.toUpperCase() === odsCode.toUpperCase()) {
    return `Pharmacy ${odsCode.toUpperCase()}`;
  }
  return trimmed
    .toLowerCase()
    .split(/\b/)
    .map((token, i) => {
      if (!/[a-z]/.test(token)) return token;
      if (i > 0 && SMALL_WORDS.has(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join("");
}
