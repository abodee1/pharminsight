// Server-only helpers for Companies House integration. Do NOT import from client code.

const BASE = "https://api.company-information.service.gov.uk";
const DOC_BASE = "https://document-api.company-information.service.gov.uk";

export const CHAIN_LOOKUP: { match: string; company_number: string; chain_name: string }[] = [
  { match: "boots", company_number: "00492880", chain_name: "Boots" },
  { match: "lloyds", company_number: "00508311", chain_name: "Lloyds Pharmacy" },
  { match: "well pharmacy", company_number: "07698563", chain_name: "Well Pharmacy" },
  { match: "rowlands", company_number: "00500435", chain_name: "Rowlands Pharmacy" },
  { match: "day lewis", company_number: "01237098", chain_name: "Day Lewis" },
  { match: "superdrug", company_number: "00807043", chain_name: "Superdrug" },
  { match: "tesco", company_number: "00445790", chain_name: "Tesco" },
  { match: "asda", company_number: "00464777", chain_name: "Asda" },
  { match: "morrisons", company_number: "00274977", chain_name: "Morrisons" },
  { match: "sainsbury", company_number: "00185647", chain_name: "Sainsbury's" },
  { match: "cohens", company_number: "00234881", chain_name: "Cohens Chemist" },
  { match: "gordons", company_number: "01099502", chain_name: "Gordons Chemist" },
  { match: "peak pharmacy", company_number: "05583948", chain_name: "Peak Pharmacy" },
];

export function findChain(name: string): { company_number: string; chain_name: string } | null {
  const lc = name.toLowerCase();
  for (const c of CHAIN_LOOKUP) if (lc.includes(c.match)) return { company_number: c.company_number, chain_name: c.chain_name };
  return null;
}

export function cleanName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bpharmacy\b/g, " ")
    .replace(/\bchemist[s]?\b/g, " ")
    .replace(/\bdispensing\b/g, " ")
    .replace(/\blimited\b/g, " ")
    .replace(/\bltd\b/g, " ")
    .replace(/\b& co\b/g, " ")
    .replace(/\band co\b/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY not set");
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

export async function chFetch<T = any>(path: string, opts: { doc?: boolean; accept?: string } = {}): Promise<T> {
  const base = opts.doc ? DOC_BASE : BASE;
  const res = await fetch(base + path, {
    headers: { Authorization: authHeader(), Accept: opts.accept ?? "application/json" },
  });
  if (!res.ok) throw new Error(`Companies House ${res.status} on ${path}`);
  if (opts.accept && !opts.accept.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

export function scoreCandidate(
  candidate: { title?: string; address_snippet?: string; company_status?: string; sic_codes?: string[]; description?: string },
  cleanedName: string,
  postcode: string | null,
): number {
  let score = 0;
  const candName = (candidate.title || "").toLowerCase();
  const addr = (candidate.address_snippet || "").toLowerCase();
  const pc = (postcode || "").toLowerCase().replace(/\s+/g, "");
  if (pc && addr.replace(/\s+/g, "").includes(pc)) score += 3;
  else if (pc && pc.length >= 2 && addr.replace(/\s+/g, "").includes(pc.slice(0, Math.ceil(pc.length / 2)))) score += 2;

  const words = cleanedName.split(/\s+/).filter((w) => w.length >= 2);
  const present = words.filter((w) => candName.includes(w)).length;
  if (words.length && present === words.length) score += 3;
  else if (words.length && present >= Math.max(1, Math.floor(words.length * 0.5))) score += 2;
  else if (present > 0) score += 1;

  const status = (candidate.company_status || "").toLowerCase();
  if (status === "active") score += 2;
  if (["dissolved", "liquidation", "in-administration", "administration"].some((s) => status.includes(s))) score -= 3;

  const sics = candidate.sic_codes || [];
  if (sics.some((s) => ["47730", "47741", "86900"].includes(s))) score += 1;

  return score;
}

// Best-effort iXBRL extraction. Returns nulls when fields can't be found.
export function extractAccountsFigures(iXbrl: string): {
  turnover: number | null;
  gross_profit: number | null;
  operating_profit: number | null;
  net_profit: number | null;
  total_payroll: number | null;
  avg_employees: number | null;
  net_assets: number | null;
} {
  const grab = (names: string[]): number | null => {
    for (const n of names) {
      // Match <ix:nonFraction name="...:Name" ...>1,234,567</ix:nonFraction>
      const re = new RegExp(`<ix:nonFraction[^>]*name="[^"]*:${n}"[^>]*>([^<]+)</ix:nonFraction>`, "i");
      const m = iXbrl.match(re);
      if (m) {
        const num = Number(m[1].replace(/[,\s]/g, ""));
        if (!Number.isNaN(num)) return num;
      }
    }
    return null;
  };
  return {
    turnover: grab(["Turnover", "Revenue", "TurnoverRevenue", "TurnoverGrossProfit"]),
    gross_profit: grab(["GrossProfitLoss", "GrossProfit"]),
    operating_profit: grab(["OperatingProfitLoss", "OperatingProfit"]),
    net_profit: grab(["ProfitLoss", "ProfitLossOnOrdinaryActivitiesAfterTaxation", "ProfitBeforeTax"]),
    total_payroll: grab(["StaffCostsEmployeeBenefitsExpense", "WagesAndSalaries", "StaffCosts"]),
    avg_employees: grab(["AverageNumberEmployeesDuringPeriod", "AverageNumberOfEmployees"]),
    net_assets: grab(["NetAssetsLiabilities", "TotalAssetsLessCurrentLiabilities", "ShareholdersFunds"]),
  };
}
