// Free OSM/Nominatim sweep for GP practices. No Google credits required.
// Usage: node scripts/gp_sweep_osm.mjs [startCursor] [threshold]
// Respects Nominatim's 1 req/sec fair-use policy.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "Pharmacy8-GP-Sweep/1.0 (+https://pharmacy8.com; support@pharmacy8.com)";

const STOP = new Set("the and of at for in on to surgery surgeries practice practices medical centre center health healthcare clinic doctors doctor drs dr partners partnership group family gp gps nhs community patients patient east west north south".split(" "));
const tok = s => { if(!s) return new Set(); return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(t=>t.length>=2&&!STOP.has(t))); };
const ns = (a,b)=>{const ta=tok(a),tb=tok(b);if(!ta.size||!tb.size)return 0;let h=0;for(const t of ta)if(tb.has(t))h++;return h/Math.max(1,Math.min(ta.size,tb.size));};
const npc = p => (p||"").toUpperCase().replace(/\s+/g,"");
const hv = (a,b)=>{const R=6371000,r=d=>d*Math.PI/180;const dL=r(b.lat-a.lat),dG=r(b.lng-a.lng);const s=Math.sin(dL/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dG/2)**2;return 2*R*Math.asin(Math.sqrt(s));};

let last = 0;
async function throttled() {
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
}

async function search(query, lat, lng) {
  await throttled();
  const u = new URL(NOMINATIM);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("countrycodes", "gb");
  u.searchParams.set("limit", "5");
  // Bias to a 5km box around the practice if we have coords
  if (lat != null && lng != null) {
    const dLat = 5000/111320, dLng = 5000/(111320*Math.cos(lat*Math.PI/180));
    u.searchParams.set("viewbox", `${lng-dLng},${lat+dLat},${lng+dLng},${lat-dLat}`);
    u.searchParams.set("bounded", "0");
  }
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en-GB" }});
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows.map(x => ({
    id: x.osm_type && x.osm_id ? `osm:${x.osm_type}/${x.osm_id}` : `nom:${x.place_id}`,
    name: x.name || (x.display_name||"").split(",")[0] || "",
    postcode: x.address?.postcode || null,
    lat: x.lat ? Number(x.lat) : null,
    lng: x.lon ? Number(x.lon) : null,
    cls: x.class, type: x.type,
  }));
}

const args = process.argv.slice(2);
let cursor = args[0] || "";
const THRESH = parseFloat(args[1] || "0.35");
const DEADLINE = Date.now() + 560*1000;

let tm = 0, ts = 0, pass = 0;
while (Date.now() < DEADLINE) {
  pass++;
  const { data: rows, error } = await sb.from("gp_practices")
    .select("practice_code,practice_name,postcode,lat,lng")
    .is("google_place_id", null).not("postcode","is",null).not("practice_name","is",null)
    .gt("practice_code", cursor).order("practice_code").limit(60);
  if (error) { console.error(error); break; }
  if (!rows.length) break;

  let m=0,lo=0,nc=0,tk=0,er=0;
  for (const r of rows) {
    if (Date.now() > DEADLINE) break;
    const q = `${r.practice_name}, ${r.postcode}, UK`;
    let pls;
    try { pls = await search(q, r.lat, r.lng); } catch(e) { er++; continue; }
    if (!pls.length) { nc++; continue; }
    let best = null;
    for (const p of pls) {
      const sName = ns(p.name, r.practice_name);
      const sp = !!p.postcode && !!r.postcode && npc(p.postcode) === npc(r.postcode);
      let d = Infinity;
      if (p.lat != null && r.lat != null) d = hv({lat:r.lat,lng:r.lng}, {lat:p.lat,lng:p.lng});
      const isMed = (p.cls === "amenity" && (p.type === "doctors" || p.type === "clinic" || p.type === "hospital"))
                 || (p.cls === "healthcare");
      if (!sp && sName < 0.25 && !(isMed && d < 500)) continue;
      const ds = d === Infinity ? 0 : Math.max(0, 1 - d/2000);
      const sc = sName*0.5 + (sp?0.3:0) + ds*0.1 + (isMed?0.1:0);
      if (!best || sc > best.score) best = { id:p.id, n:p.name, score:sc };
    }
    if (!best || best.score < THRESH) { lo++; continue; }
    const { data: ex } = await sb.from("gp_practices").select("practice_code").eq("google_place_id", best.id).maybeSingle();
    if (ex && ex.practice_code !== r.practice_code) { tk++; continue; }
    const { error: ue } = await sb.from("gp_practices")
      .update({ google_place_id: best.id, google_name: best.n || null, name_verified_at: new Date().toISOString() })
      .eq("practice_code", r.practice_code).is("google_place_id", null);
    if (!ue) m++;
  }
  ts += rows.length; tm += m;
  cursor = rows[rows.length-1].practice_code;
  console.log(`p${pass} s=${rows.length} m=${m} lo=${lo} nc=${nc} tk=${tk} er=${er} cur=${cursor} (Σ${ts}/${tm})`);
}
const { count: um } = await sb.from("gp_practices").select("practice_code", { count:"exact", head:true }).is("google_place_id", null);
const { count: tot } = await sb.from("gp_practices").select("practice_code", { count:"exact", head:true });
console.log(`DONE scanned=${ts} matched=${tm} | total=${tot} unmatched=${um} lastCursor=${cursor}`);
