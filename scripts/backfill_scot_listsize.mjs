// Pull the latest 8 Scotland GP Practice Populations CSVs and write
// AllAges (Sex=All) into gp_list_sizes for the correct quarter date.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i=0;i<line.length;i++){const c=line[i];
    if (inQ){ if (c==='"'&&line[i+1]==='"'){cur+='"';i++;} else if (c==='"'){inQ=false;} else cur+=c; }
    else { if (c==='"'){inQ=true;} else if (c===','){out.push(cur);cur="";} else cur+=c; }
  }
  out.push(cur); return out;
}
function dateFromYmd(s){ if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); return null; }

const pkg = await (await fetch("https://www.opendata.nhs.scot/api/3/action/package_show?id=gp-practice-populations")).json();
const csvs = pkg.result.resources
  .filter(r => (r.format||"").toUpperCase()==="CSV")
  .sort((a,b)=>(b.last_modified||b.created||"").localeCompare(a.last_modified||a.created||""))
  .slice(0, 12);

let total = 0;
for (const r of csvs) {
  console.log("→", r.name);
  const text = await (await fetch(r.url)).text();
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if (lines.length < 2) continue;
  const headers = splitCsvLine(lines[0]).map(h=>h.trim());
  const idx = n => headers.findIndex(h => h.toLowerCase() === n.toLowerCase());
  const iDate = idx("Date"), iCode = idx("PracticeCode"), iSex = idx("Sex"), iAll = idx("AllAges");
  if (iCode<0 || iAll<0) { console.log("  skip — no AllAges/PracticeCode"); continue; }

  const rows = new Map();
  for (let i=1;i<lines.length;i++) {
    const c = splitCsvLine(lines[i]);
    const code = (c[iCode]||"").trim();
    if (!code) continue;
    const sex = iSex>=0 ? (c[iSex]||"").trim() : "All";
    if (iSex>=0 && sex !== "All") continue;
    const date = iDate>=0 ? dateFromYmd((c[iDate]||"").trim()) : null;
    if (!date) continue;
    const pat = +(c[iAll]||"0").replace(/,/g,"") || 0;
    rows.set(`${code}|${date}`, { practice_code: code, list_size_date: date, registered_patients: pat, country: "Scotland", data_source: "NHS_SCOT_LISTSIZE" });
  }
  const arr = Array.from(rows.values());
  for (let i=0;i<arr.length;i+=500) {
    const { error } = await sb.from("gp_list_sizes").upsert(arr.slice(i,i+500), { onConflict: "practice_code,list_size_date" });
    if (error) throw error;
  }
  total += arr.length;
  console.log(`  upserted ${arr.length}`);
}
console.log("DONE total:", total);
