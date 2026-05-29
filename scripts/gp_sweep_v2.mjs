import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GW = "https://connector-gateway.lovable.dev/google_maps";
const H = () => ({ Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY_1, "Content-Type": "application/json", "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" });
const STOP = new Set("the and of at for in on to surgery surgeries practice practices medical centre center health healthcare clinic doctors doctor drs dr partners partnership group family gp gps nhs community patients patient east west north south".split(" "));
const tok = s => { if(!s) return new Set(); return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(t=>t.length>=2&&!STOP.has(t))); };
const ns = (a,b)=>{const ta=tok(a),tb=tok(b);if(!ta.size||!tb.size)return 0;let h=0;for(const t of ta)if(tb.has(t))h++;return h/Math.max(1,Math.min(ta.size,tb.size));};
const npc = p => (p||"").toUpperCase().replace(/\s+/g,"");
const xpc = a => { if(!a) return null; const m=a.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/); return m?m[0].replace(/\s+/g," "):null; };
const hv = (a,b)=>{const R=6371000,r=d=>d*Math.PI/180;const dL=r(b.lat-a.lat),dG=r(b.lng-a.lng);const s=Math.sin(dL/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dG/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
async function near(lat,lng,rad){const r=await fetch(`${GW}/places/v1/places:searchNearby`,{method:"POST",headers:H(),body:JSON.stringify({includedTypes:["doctor"],maxResultCount:15,locationRestriction:{circle:{center:{latitude:lat,longitude:lng},radius:rad}},rankPreference:"DISTANCE"})});if(!r.ok)throw new Error(`${r.status}`);const j=await r.json();return (j.places||[]).map(p=>({id:p.id,name:p.displayName?.text||"",postcode:xpc(p.formattedAddress),lat:p.location?.latitude,lng:p.location?.longitude}));}

const args = process.argv.slice(2);
const startCursor = args[0] || "";
const RADIUS = parseInt(args[1] || "800");
const THRESH = parseFloat(args[2] || "0.3");

let cursor=startCursor, tm=0, ts=0, pass=0;
const DEADLINE = Date.now() + 560*1000;
while (Date.now() < DEADLINE) {
  pass++;
  const { data: rows, error } = await sb.from("gp_practices").select("practice_code,practice_name,postcode,lat,lng").is("google_place_id",null).not("lat","is",null).not("lng","is",null).gt("practice_code",cursor).order("practice_code").limit(120);
  if (error) { console.error(error); break; }
  if (!rows.length) break;
  let m=0,lo=0,nc=0,tk=0,er=0;
  for (const r of rows) {
    let pls; try { pls = await near(r.lat, r.lng, RADIUS); } catch { er++; continue; }
    if (!pls.length) { nc++; continue; }
    let best=null;
    for (const p of pls) {
      const s = ns(p.name, r.practice_name);
      const sp = !!p.postcode && !!r.postcode && npc(p.postcode)===npc(r.postcode);
      let d=Infinity; if (p.lat!=null) d = hv({lat:r.lat,lng:r.lng},{lat:p.lat,lng:p.lng});
      const ds = d===Infinity?0:Math.max(0,1-d/RADIUS);
      // accept candidate: postcode match, OR decent name match, OR very close
      if (!sp && s<0.15 && d>200) continue;
      const sc = s*0.55 + (sp?0.3:0) + ds*0.15;
      if (!best || sc>best.score) best = { id:p.id, n:p.name, score:sc, sp, s, d };
    }
    if (!best || best.score < THRESH) { lo++; continue; }
    const { data: ex } = await sb.from("gp_practices").select("practice_code").eq("google_place_id", best.id).maybeSingle();
    if (ex && ex.practice_code !== r.practice_code) { tk++; continue; }
    const { error: ue } = await sb.from("gp_practices").update({ google_place_id: best.id, google_name: best.n||null, name_verified_at: new Date().toISOString() }).eq("practice_code", r.practice_code).is("google_place_id", null);
    if (!ue) m++;
  }
  ts += rows.length; tm += m;
  cursor = rows[rows.length-1].practice_code;
  console.log(`p${pass} s=${rows.length} m=${m} lo=${lo} nc=${nc} tk=${tk} er=${er} cur=${cursor} (Σ${ts}/${tm})`);
}
const {count:um}=await sb.from("gp_practices").select("practice_code",{count:"exact",head:true}).is("google_place_id",null);
const {count:tot}=await sb.from("gp_practices").select("practice_code",{count:"exact",head:true});
console.log(`DONE scanned=${ts} matched=${tm} | total=${tot} unmatched=${um} lastCursor=${cursor}`);
