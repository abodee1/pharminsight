import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";
const headers = () => ({ Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY_1, "Content-Type": "application/json", "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" });
const STOP = new Set("the and of at for in on to surgery surgeries practice practices medical centre center health healthcare clinic doctors doctor drs dr partners partnership group family gp gps nhs community patients patient".split(" "));
const tokens = s => { if(!s) return new Set(); return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(t=>t.length>=2&&!STOP.has(t))); };
const nameScore = (a,b)=>{const ta=tokens(a),tb=tokens(b);if(!ta.size||!tb.size)return 0;let h=0;for(const t of ta)if(tb.has(t))h++;return h/Math.max(1,Math.min(ta.size,tb.size));};
const normPc = p => (p||"").toUpperCase().replace(/\s+/g,"");
const extractPc = a => { if(!a) return null; const m=a.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/); return m?m[0].replace(/\s+/g," "):null; };
const haversine = (a,b)=>{const R=6371000,toRad=d=>d*Math.PI/180;const dL=toRad(b.lat-a.lat),dG=toRad(b.lng-a.lng);const s=Math.sin(dL/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dG/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
async function nearby(lat,lng){const r=await fetch(`${GATEWAY}/places/v1/places:searchNearby`,{method:"POST",headers:headers(),body:JSON.stringify({includedTypes:["doctor"],maxResultCount:8,locationRestriction:{circle:{center:{latitude:lat,longitude:lng},radius:300}},rankPreference:"DISTANCE"})});if(!r.ok)throw new Error(`${r.status}`);const j=await r.json();return (j.places||[]).map(p=>({id:p.id,name:p.displayName?.text||"",postcode:extractPc(p.formattedAddress),lat:p.location?.latitude,lng:p.location?.longitude}));}
let cursor="",totalMatched=0,totalScanned=0,pass=0;
const DEADLINE = Date.now() + 540*1000;
while(Date.now() < DEADLINE){
  pass++;
  const { data: rows, error } = await sb.from("gp_practices").select("practice_code,practice_name,postcode,lat,lng").is("google_place_id",null).not("lat","is",null).not("lng","is",null).gt("practice_code",cursor).order("practice_code").limit(150);
  if(error){console.error(error);break;}
  if(!rows.length)break;
  let matched=0,low=0,nc=0,tk=0,er=0;
  for(const r of rows){
    let pls;try{pls=await nearby(r.lat,r.lng);}catch{er++;continue;}
    if(!pls.length){nc++;continue;}
    let best=null;
    for(const p of pls){
      const ns=nameScore(p.name,r.practice_name);
      const sp=!!p.postcode&&!!r.postcode&&normPc(p.postcode)===normPc(r.postcode);
      let d=Infinity; if(p.lat!=null) d=haversine({lat:r.lat,lng:r.lng},{lat:p.lat,lng:p.lng});
      const ds=d===Infinity?0:Math.max(0,1-d/300);
      if(ns<0.2&&!sp&&d>150)continue;
      const sc=ns*0.6+(sp?0.25:0)+ds*0.15;
      if(!best||sc>best.score)best={placeId:p.id,placeName:p.name,score:sc};
    }
    if(!best||best.score<0.4){low++;continue;}
    const {data:ex}=await sb.from("gp_practices").select("practice_code").eq("google_place_id",best.placeId).maybeSingle();
    if(ex&&ex.practice_code!==r.practice_code){tk++;continue;}
    const {error:ue}=await sb.from("gp_practices").update({google_place_id:best.placeId,google_name:best.placeName||null,name_verified_at:new Date().toISOString()}).eq("practice_code",r.practice_code).is("google_place_id",null);
    if(!ue)matched++;
  }
  totalScanned+=rows.length; totalMatched+=matched;
  cursor=rows[rows.length-1].practice_code;
  console.log(`p${pass} scanned=${rows.length} m=${matched} low=${low} nc=${nc} tk=${tk} er=${er} cur=${cursor} (Σ${totalScanned}/${totalMatched})`);
}
const {count:um}=await sb.from("gp_practices").select("practice_code",{count:"exact",head:true}).is("google_place_id",null);
const {count:tot}=await sb.from("gp_practices").select("practice_code",{count:"exact",head:true});
console.log(`DONE scanned=${totalScanned} matched=${totalMatched} | total=${tot} stillUnmatched=${um}`);
