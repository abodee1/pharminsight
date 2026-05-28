import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur); return out;
}

async function refreshScotland() {
  console.log("[Scotland] fetching CKAN package…");
  const pkg = await (await fetch("https://www.opendata.nhs.scot/api/3/action/package_show?id=gp-practice-contact-details-and-list-sizes")).json();
  const csvs = pkg.result.resources
    .filter(r => (r.format||"").toUpperCase() === "CSV")
    .sort((a,b) => (b.last_modified||b.created||"").localeCompare(a.last_modified||a.created||""));
  const url = csvs[0].url;
  console.log("[Scotland] CSV:", csvs[0].name);
  const text = await (await fetch(url)).text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const idx = n => headers.findIndex(h => h.toLowerCase() === n.toLowerCase());
  const iCode=idx("PracticeCode"), iName=idx("GPPracticeName"),
        iA1=idx("AddressLine1"), iA2=idx("AddressLine2"),
        iA3=idx("AddressLine3"), iA4=idx("AddressLine4"),
        iPc=idx("Postcode"), iHB=idx("HB");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const code = (c[iCode]||"").trim(); if (!code) continue;
    const address = [iA1,iA2,iA3,iA4].filter(j=>j>=0).map(j=>(c[j]||"").trim()).filter(Boolean).join(", ");
    rows.push({
      practice_code: code,
      practice_name: (c[iName]||"").trim() || code,
      postcode: (c[iPc]||"").trim() || null,
      address_line: address || null,
      health_board: iHB>=0 ? ((c[iHB]||"").trim() || null) : null,
      country: "Scotland",
    });
  }
  console.log(`[Scotland] ${rows.length} rows. Upserting…`);
  let n=0;
  for (let i=0;i<rows.length;i+=500) {
    const slice = rows.slice(i,i+500);
    const { error } = await sb.from("gp_practices").upsert(slice, { onConflict: "practice_code" });
    if (error) throw error;
    n += slice.length;
  }
  console.log(`[Scotland] upserted ${n}`);
}

async function refreshEngland() {
  console.log("[England] fetching ORD…");
  let offset = 1, limit = 1000, upserted = 0, pages = 0;
  while (true) {
    const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?PrimaryRoleId=RO177&Status=Active&Limit=${limit}&Offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`ORD failed ${res.status} offset=${offset}`);
    const json = await res.json();
    const orgs = json.Organisations || [];
    if (!orgs.length) break;
    const rows = orgs.map(o => ({
      practice_code: o.OrgId, practice_name: o.Name,
      postcode: o.PostCode || null, country: "England",
    }));
    for (let i=0;i<rows.length;i+=500) {
      const slice = rows.slice(i,i+500);
      const { error } = await sb.from("gp_practices").upsert(slice, { onConflict: "practice_code" });
      if (error) throw error;
      upserted += slice.length;
    }
    pages++;
    console.log(`[England] page ${pages} offset ${offset} +${orgs.length} (total ${upserted})`);
    if (orgs.length < limit) break;
    offset += limit;
    if (pages > 30) break;
  }
  console.log(`[England] upserted ${upserted} over ${pages} pages`);
}

async function geocode() {
  console.log("[Geo] loading practices missing lat…");
  // Page through to avoid 1000-row default
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from("gp_practices")
      .select("practice_code,postcode")
      .is("lat", null).not("postcode","is",null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`[Geo] ${all.length} to geocode`);
  let updated=0, missed=0;
  for (let i=0;i<all.length;i+=100) {
    const batch = all.slice(i,i+100);
    const postcodes = batch.map(r => (r.postcode||"").trim()).filter(Boolean);
    if (!postcodes.length) continue;
    const res = await fetch("https://api.postcodes.io/postcodes", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ postcodes }),
    });
    if (!res.ok) { missed += batch.length; continue; }
    const json = await res.json();
    const byQ = new Map();
    for (const r of json.result||[]) {
      if (r.result) byQ.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
    }
    for (const row of batch) {
      const loc = byQ.get((row.postcode||"").toUpperCase());
      if (!loc) { missed++; continue; }
      const { error } = await sb.from("gp_practices")
        .update({ lat: loc.lat, lng: loc.lng })
        .eq("practice_code", row.practice_code);
      if (!error) updated++; else missed++;
    }
    if (i % 1000 === 0) console.log(`[Geo] ${i+batch.length}/${all.length} (updated ${updated})`);
  }
  console.log(`[Geo] done. updated=${updated} missed=${missed}`);
}

await refreshEngland();
await geocode();
console.log("ALL DONE");
console.log("ALL DONE");
