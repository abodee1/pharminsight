import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function geocodePostcode(postcode: string | null | undefined): Promise<{ lat: number; lng: number } | null> {
  if (!postcode) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
    if (!res.ok) return null;
    const j = await res.json() as { result?: { latitude: number; longitude: number } };
    if (j.result?.latitude == null) return null;
    return { lat: j.result.latitude, lng: j.result.longitude };
  } catch { return null; }
}

// ============================================================
// Shared expert framing — same standard used by Acquisition Report
// ============================================================
const EXPERT_SYSTEM = `You are a senior M&A advisor and operations consultant for UK community pharmacy, with deep command of NHS pharmacy economics across England, Scotland, Wales and Northern Ireland — drug tariff, ESPS, Pharmacy First, MCR, EPS, flu, NMS, smoking cessation, EHC and supervised consumption. You write in crisp, professional British English with the tone of a partner at a specialist healthcare brokerage briefing an investment committee: direct, commercially sharp, clinically informed, never generic.

You will be given a structured data pack for one pharmacy: identity, 24 months of dispensing and service activity, NHS payment lines, country/regional peer benchmarks, and the local landscape from our own NHS dataset (nearby competitor pharmacies and GP surgeries with distances in metres).

ABSOLUTE RULES
- Be specific to the actual numbers in the data. Quote figures (items, £, %, YoY) inline.
- Never invent numbers. If something is missing, say so and lower your confidence rather than guess.
- Where you estimate £ uplift, anchor it to observed NHS tariff economics and the gap vs the peer benchmark in the pack.
- Use British English. No emojis. No fluff. No throat-clearing ("In conclusion…", "It is important to note…").
- Output ONLY markdown (no JSON, no code fences around the whole reply).
- RESPECT JURISDICTION: only reference NHS services, contracts, tariffs and bodies that apply in the pharmacy's nation (see JURISDICTION SCOPE block). Never mention out-of-jurisdiction services (e.g. NMS or English Pharmacy First in Scotland; MCR or PFS in England/Wales/NI) even if the data pack has a zero/null for them.`;

// Country-specific service & contract scope. Injected into every prompt so the
// model only references services that actually exist in the pharmacy's nation.
function countryScope(country: string | null | undefined): string {
  const c = (country || "").trim().toLowerCase();
  if (c === "scotland") {
    return `JURISDICTION SCOPE — SCOTLAND
- Contractor: NHS Scotland community pharmacy contract; payments via PSD (Practitioner Services Division).
- Core clinical services to analyse: **Pharmacy First Scotland (PFS / NHS PFS Plus)**, **MCR (Medicines: Care & Review — formerly CMS)**, **Public Health Service (smoking cessation, EHC, sexual health)**, **OST: methadone / buprenorphine + supervised consumption**, **Stoma / AMS** where present.
- Dispensing economics: items dispensed, gross ingredient cost, ESPS, professional fees, MCR capitation; no Drug Tariff Cat M concept — use Scottish reimbursement logic.
- DO NOT mention or analyse: NMS (does not exist in Scotland), English Pharmacy First clinical pathways, Flu under the English Advanced Service spec, EPS / EPS nominations (Scotland uses CMS / ePharmacy, not EPS), DMS, Hypertension Case-Finding, Contraception Service (English spec), CPCS.
- Peer framing: compare to other Scottish community pharmacies only.`;
  }
  if (c === "wales") {
    return `JURISDICTION SCOPE — WALES
- Contractor: NHS Wales Community Pharmacy Contractual Framework; payments via NWSSP.
- Core clinical services to analyse: **Common Ailments Service (CAS)**, **Independent Prescribing Service (IPS)**, **Emergency Contraception**, **Smoking cessation (Help Me Quit)**, **Flu vaccination (Welsh spec)**, **Discharge Medicines Review (DMR)**, **Sore Throat Test & Treat** where in scope.
- DO NOT mention or analyse: English NMS, English Pharmacy First clinical pathways, EPS / EPS nominations (Wales uses its own electronic transfer), MCR (Scotland-only), CPCS.
- Peer framing: compare to other Welsh community pharmacies only.`;
  }
  if (c === "northern ireland" || c === "ni") {
    return `JURISDICTION SCOPE — NORTHERN IRELAND
- Contractor: HSC Northern Ireland community pharmacy contract; payments via BSO.
- Core clinical services to analyse: **Pharmacy First NI (minor ailments / acute medication / living well)**, **Managing Your Medicines (MYM)**, **Substance misuse / supervised consumption**, **Smoking cessation**, **Flu vaccination (NI spec)**, **Emergency hormonal contraception**.
- DO NOT mention or analyse: English NMS, English Pharmacy First clinical pathways, EPS / EPS nominations (NI does not use EPS), MCR (Scotland-only), CPCS, DMS (English).
- Peer framing: compare to other Northern Ireland community pharmacies only.`;
  }
  // Default: England (also covers null / unknown — England is the largest cohort)
  return `JURISDICTION SCOPE — ENGLAND
- Contractor: NHS England Community Pharmacy Contractual Framework (CPCF); payments via NHSBSA.
- Core clinical services to analyse: **Pharmacy First (England — 7 clinical pathways)**, **New Medicine Service (NMS)**, **Flu vaccination (Advanced Service)**, **Hypertension Case-Finding**, **Contraception Service (Tier 1 & 2)**, **Discharge Medicines Service (DMS)**, **Smoking Cessation Service (SCS)**, **EPS items & nominations**, **Lateral Flow / Pandemic services** where in scope.
- Dispensing economics: Drug Tariff (Cat M, A, C), single activity fee, transitional payment, establishment payment where applicable.
- DO NOT mention or analyse: MCR / CMS (Scotland-only), Pharmacy First Scotland, Welsh CAS / IPS, NI Pharmacy First. Supervised consumption / methadone is locally commissioned — only reference if the pack shows activity.
- Peer framing: compare to other English community pharmacies only.`;
}

// ============================================================
// generateInsight — SWOT and Performance Commentary
// Both now get the same rich data context the Acquisition Report uses.
// ============================================================

export const generateInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      insight_type: z.enum([
        "swot", "benchmark", "trend", "acquisition",
        "opportunities", "action_plan", "income_quality", "service_mix",
      ]),
      pharmacy_id: z.string().uuid().nullable().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured");

    let aiContext: any = data.context ?? {};
    if (data.pharmacy_id) {
      aiContext = await buildPharmacyContext(supabase, data.pharmacy_id);
    }

    const userPrompt = buildPromptForType(data.insight_type, aiContext);
    const scope = countryScope(aiContext?.pharmacy?.country);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: EXPERT_SYSTEM },
          { role: "system", content: scope },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (res.status === 429) throw new Error("Rate limit exceeded. Please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace Settings.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI gateway error (${res.status})${body ? `: ${body}` : ""}`);
    }
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";

    const { data: saved, error } = await supabase
      .from("ai_insights").insert({
        user_id: userId, pharmacy_id: data.pharmacy_id ?? null,
        insight_type: data.insight_type, prompt_context: aiContext as any, insight_text: text,
      }).select().single();
    if (error) throw new Error(error.message);
    return { insight: saved };
  });

function buildPromptForType(type: string, ctx: any): string {
  const dataBlock = `TARGET DATA PACK:\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\``;

  if (type === "swot") {
    return `Produce a board-grade **SWOT analysis** for this UK community pharmacy.

Structure (use these exact H2 headings, in this order):

## Executive read
2–3 sentences: the one-line story of this pharmacy today, grounded in its biggest numbers.

## Strengths
4–6 bullets. Each bullet leads with a bold one-line claim, then a sentence of evidence quoting the actual figure (e.g. items YoY %, PF income £, EPS share, peer gap).

## Weaknesses
4–6 bullets, same format. Be specific about underperformance vs the peer benchmark and vs the pharmacy's own prior 12 months.

## Opportunities
4–6 bullets. For each, give an indicative annual £ uplift range (low–high) tied to NHS tariff logic and the peer gap. Mention which service (Pharmacy First, NMS, flu, MCR, EPS nominations, smoking cessation, EHC, methadone) and why it is achievable here.

## Threats
4–6 bullets. Cover local competitive density, GP cluster dependency, ratings risk, NHS funding/contract risk, service mix concentration, dispensing volume direction.

## Bottom line
2–3 sentences with a clear strategic stance (lean in / hold / de-risk) and the single most important move in the next 90 days.

${dataBlock}`;
  }

  if (type === "benchmark") {
    return `Write a **Performance Commentary** for this UK community pharmacy — a plain-English narrative that an owner or investor could read in three minutes and instantly understand how the business is performing versus its own history and its country peers.

Structure (use these exact H2 headings):

## Headline
2–3 sentences: the single most important thing happening in this pharmacy right now, with the defining numbers.

## Dispensing volume
A paragraph on items dispensed: latest 12 months vs prior 12 (with YoY %), trajectory across the last 24 months, and how this compares to the country peer average in the data pack. State whether the gap is favourable or unfavourable, and by how much.

## NHS service mix
A paragraph each (or tight bullets with a lead sentence) for: **Pharmacy First**, **NMS**, **EPS**, **Flu**, plus **MCR** if Scotland. Quote current vs prior, peer gap where available, and what the trend implies clinically and commercially.

## Income quality
A paragraph on gross cost, final NHS payment and service income lines (£). Comment on mix shift between dispensing and clinical service income, and what that signals about resilience.

## Where this pharmacy is winning
3–5 bullets, each a concrete, evidenced win.

## Where it is leaking value
3–5 bullets, each a concrete, evidenced gap — quantified in £ where the tariff allows.

## Next 90 days
3–5 numbered actions, each with the expected metric to move and a rough £ or % impact.

${dataBlock}`;
  }

  if (type === "opportunities") {
    return `Produce an **Opportunity Radar** for this UK community pharmacy — a ranked list of the highest-£ growth opportunities, anchored to the actual peer gap and NHS tariff economics.

Structure (use these exact H2 headings):

## Top 5 opportunities (ranked by annual £ uplift)
A numbered list. For each: a bold one-line headline naming the service/lever, then 2–3 sentences with: the current value vs the peer benchmark, the calculated gap, the indicative annual £ uplift range (low–high) tied to tariff logic, and the single most concrete action to close the gap in the next 60 days. Always quote a number.

## Quick wins (under 30 days, under £1k cost)
3–4 bullets, each a tactical move with the metric to watch.

## Structural plays (90+ days)
2–3 bullets, each a bigger move with an indicative £ range and the operating change required.

## What to ignore
2 bullets: things that look like opportunities but are not, given the data.

${dataBlock}`;
  }

  if (type === "action_plan") {
    return `Produce a **90-day Action Plan** for this UK community pharmacy. This is an executable plan an owner can hand to a manager on Monday morning.

Structure (use these exact H2 headings):

## North star metric
1 sentence naming the single KPI to move in 90 days and the target (with current baseline).

## Week 1 — set up
4–6 bullets, each a specific action with owner role (Pharmacist / Counter / Manager), the system or template needed, and the success check by end of week 1.

## Weeks 2–4 — execute
4–6 bullets, each a specific behavioural change at the counter or in workflow, with the daily/weekly target and the £ or volume impact expected.

## Weeks 5–12 — scale
4–6 bullets, each a structural change (rota, nomination drive, GP liaison, range, signage, MUR list, supplier renegotiation) with the metric to monitor and rough £ impact.

## Risks & dependencies
3–4 bullets, each a thing that could derail the plan and the mitigation.

## End-of-90-day scorecard
A compact markdown table with columns: Metric | Baseline | Target | Stretch. 5–7 rows covering the key services and income lines from the data pack.

${dataBlock}`;
  }

  if (type === "income_quality") {
    return `Produce an **Income Quality Scorecard** for this UK community pharmacy — a hard look at the resilience and quality of the £ coming in.

Structure (use these exact H2 headings):

## Overall income quality grade
A single letter (A / B / C / D) with a one-paragraph justification using the actual £ figures and mix from the data pack.

## Income mix breakdown
A markdown table with columns: Stream | Last 12m £ | % of total | YoY % | Quality note. Cover dispensing economics, Pharmacy First, NMS (where reported as £), MCR (Scotland), Flu, Smoking cessation, and any residual. Comment on which streams are recurring vs episodic.

## Concentration risk
2 paragraphs on dependency: how much of income depends on a single service line, a GP cluster, or one tariff mechanism. Quote the % share.

## Resilience signals
3–4 bullets on what is structurally healthy (e.g. growing service mix, EPS nomination share, repeat dispensing) — each with the supporting number.

## Fragility signals
3–4 bullets on what looks fragile (e.g. dispensing volume decline, single-service concentration, declining clawback headroom).

## Three moves to upgrade quality
A numbered list of 3 specific moves that would shift the grade up, each with the metric and rough £ impact.

${dataBlock}`;
  }

  if (type === "service_mix") {
    return `Produce a **Service Mix Deep Dive** for this UK community pharmacy. Owner wants to know exactly which clinical services are pulling weight and which are leaking value vs peers.

Structure (use these exact H2 headings):

## Mix snapshot
2–3 sentences naming the dominant services by volume and by £, and the single biggest mismatch vs peers.

## Service-by-service read
For each of: **Pharmacy First**, **NMS**, **EPS / nominations**, **Flu**, **MCR** (if Scotland), **EHC**, **Smoking cessation**, **Methadone / supervised consumption** — give a 2–3 sentence read with current 12m volume, YoY %, peer gap where available, and the one operational lever to move it.

## Mix shape verdict
2 sentences on whether the mix is balanced, dispensing-heavy, or service-heavy, and what that implies for future NHS funding direction.

## Mix moves
3–5 bullets, each a specific rebalancing move with the service to grow, the service to defend, and the £ or % expected shift.

${dataBlock}`;
  }

  // Fallback for "trend" / "acquisition" via this endpoint
  return `Produce an expert analysis (type: ${type}) using clear H2 markdown sections. Be specific to the numbers.\n\n${dataBlock}`;
}

// ============================================================
// Shared context builder (used by SWOT, Commentary, Acquisition Report)
// ============================================================

type Row = {
  month: number; year: number;
  items_dispensed: number | null; nms_count: number | null; pharmacy_first_count: number | null;
  flu_vaccinations: number | null; eps_items: number | null; eps_nominations: number | null;
  gross_cost: number | string | null; pharmacy_first_payment: number | string | null;
  mcr_payment: number | string | null; mcr_registrations: number | null; mcr_items: number | null;
  ehc_items: number | null; methadone_items: number | null; supervised_methadone_doses: number | null;
  smoking_cessation: number | null; smoking_cessation_payment: number | string | null;
  final_payment: number | string | null; is_actual_payment: boolean | null;
  pharmacy_first_services: Record<string, number> | null;
};

const n = (v: any) => (v == null ? 0 : Number(v) || 0);
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

function distM(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) {
  if (b.lat == null || b.lng == null) return null;
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

async function buildPharmacyContext(supabase: any, pharmacy_id: string) {
  const { data: pharmacy, error: phErr } = await supabase
    .from("pharmacies").select("*").eq("id", pharmacy_id).single();
  if (phErr || !pharmacy) throw new Error("Pharmacy not found");

  const { data: dispRows } = await supabase
    .from("dispensing_data").select("*")
    .eq("pharmacy_id", pharmacy_id)
    .order("year", { ascending: true }).order("month", { ascending: true });
  const rows = (dispRows || []) as Row[];

  const last12 = rows.slice(-12);
  const prev12 = rows.slice(-24, -12);
  const k = (sel: (r: Row) => number) => ({ last: sum(last12.map(sel)), prev: sum(prev12.map(sel)) });
  const items = k((r) => n(r.items_dispensed));
  const nms = k((r) => n(r.nms_count));
  const pf = k((r) => n(r.pharmacy_first_count));
  const flu = k((r) => n(r.flu_vaccinations));
  const eps = k((r) => n(r.eps_items));
  const grossCost = k((r) => n(r.gross_cost));
  const finalPay = k((r) => n(r.final_payment));
  const pfPay = k((r) => n(r.pharmacy_first_payment));
  const mcrPay = k((r) => n(r.mcr_payment));
  const yoy = (x: { last: number; prev: number }) =>
    x.prev > 0 ? Math.round(((x.last - x.prev) / x.prev) * 1000) / 10 : null;

  const latest = rows[rows.length - 1];

  let peerStats: { avg_items_12m: number; avg_pf_12m: number; avg_nms_12m: number; n: number } | null = null;
  if (pharmacy.country && latest) {
    const { data: peerPhs } = await supabaseAdmin
      .from("pharmacies").select("id").eq("country", pharmacy.country).neq("id", pharmacy.id).limit(400);
    const ids = (peerPhs || []).map((p: any) => p.id);
    if (ids.length) {
      const minIdx = Math.max(0, rows.length - 12);
      const earliestYM = rows[minIdx];
      const cutoffYear = earliestYM?.year ?? latest.year - 1;
      const cutoffMonth = earliestYM?.month ?? latest.month;
      // Use supabaseAdmin to avoid the 1000-row PostgREST default limit —
      // 400 peers × 12 months = up to 4800 rows.
      const { data: peerRows } = await supabaseAdmin
        .from("dispensing_data")
        .select("pharmacy_id,items_dispensed,pharmacy_first_count,nms_count,year,month")
        .in("pharmacy_id", ids)
        .or(`year.gt.${cutoffYear},and(year.eq.${cutoffYear},month.gte.${cutoffMonth})`);
      const grouped = new Map<string, { items: number; pf: number; nms: number }>();
      for (const r of (peerRows || []) as any[]) {
        const cur = grouped.get(r.pharmacy_id) || { items: 0, pf: 0, nms: 0 };
        cur.items += n(r.items_dispensed); cur.pf += n(r.pharmacy_first_count); cur.nms += n(r.nms_count);
        grouped.set(r.pharmacy_id, cur);
      }
      const arr = Array.from(grouped.values());
      if (arr.length) {
        peerStats = {
          avg_items_12m: Math.round(avg(arr.map((x) => x.items))),
          avg_pf_12m: Math.round(avg(arr.map((x) => x.pf))),
          avg_nms_12m: Math.round(avg(arr.map((x) => x.nms))),
          n: arr.length,
        };
      }
    }
  }

  let nearby: any = { competitors: [], gps: [], center: null, error: null };
  try {
    let center: { lat: number; lng: number } | null = null;
    if (pharmacy.lat != null && pharmacy.lng != null) {
      center = { lat: pharmacy.lat, lng: pharmacy.lng };
    } else {
      center = await geocodePostcode(pharmacy.postcode);
    }
    if (center) {
      const [{ data: pharm }, { data: gps }] = await Promise.all([
        supabase.rpc("pharmacies_near", { p_lat: center.lat, p_lng: center.lng, p_radius_m: 1600, p_limit: 15 }),
        supabase.rpc("gp_practices_near", { p_lat: center.lat, p_lng: center.lng, p_radius_m: 1600, p_limit: 15 }),
      ]);
      const others = (pharm || []).filter((p: any) => p.id !== pharmacy.id);
      nearby = {
        center,
        competitors: others.map((p: any) => ({
          name: p.name, distance_m: Math.round(p.distance_m), postcode: p.postcode,
        })),
        gps: (gps || []).map((p: any) => ({
          name: p.practice_name || p.google_name || p.practice_code, distance_m: Math.round(p.distance_m), postcode: p.postcode,
        })),
      };
    }
  } catch (e: any) {
    nearby.error = e?.message || "nearby lookup failed";
  }

  return {
    pharmacy: {
      name: pharmacy.name, ods_code: pharmacy.ods_code, country: pharmacy.country,
      region: pharmacy.region, address: pharmacy.address, postcode: pharmacy.postcode,
    },
    reporting_period: latest ? { latest_month: latest.month, latest_year: latest.year, months_of_history: rows.length } : null,
    twelve_month: {
      items_dispensed: { current: items.last, prior: items.prev, yoy_pct: yoy(items) },
      nms: { current: nms.last, prior: nms.prev, yoy_pct: yoy(nms) },
      pharmacy_first: { current: pf.last, prior: pf.prev, yoy_pct: yoy(pf) },
      flu_vaccinations: { current: flu.last, prior: flu.prev, yoy_pct: yoy(flu) },
      eps_items: { current: eps.last, prior: eps.prev, yoy_pct: yoy(eps) },
      gross_cost_gbp: { current: Math.round(grossCost.last), prior: Math.round(grossCost.prev), yoy_pct: yoy(grossCost) },
      final_nhs_payment_gbp: { current: Math.round(finalPay.last), prior: Math.round(finalPay.prev), yoy_pct: yoy(finalPay) },
      pharmacy_first_payment_gbp: { current: Math.round(pfPay.last), prior: Math.round(pfPay.prev), yoy_pct: yoy(pfPay) },
      mcr_payment_gbp: { current: Math.round(mcrPay.last), prior: Math.round(mcrPay.prev), yoy_pct: yoy(mcrPay) },
    },
    latest_month_snapshot: latest ? {
      items_dispensed: n(latest.items_dispensed), nms: n(latest.nms_count),
      pharmacy_first: n(latest.pharmacy_first_count), flu: n(latest.flu_vaccinations),
      eps_items: n(latest.eps_items), eps_nominations: n(latest.eps_nominations),
      ehc_items: n(latest.ehc_items), methadone_items: n(latest.methadone_items),
      smoking_cessation: n(latest.smoking_cessation),
      pharmacy_first_services: latest.pharmacy_first_services || {},
    } : null,
    peer_benchmark: peerStats ? { country: pharmacy.country, ...peerStats } : null,
    monthly_items_last_24: rows.slice(-24).map((r) => ({ y: r.year, m: r.month, items: n(r.items_dispensed) })),
    local_landscape: nearby,
  };
}

// ============================================================
// Acquisition Report (unchanged behaviour, now shares the context builder)
// ============================================================

const ACQ_SYSTEM_PROMPT = EXPERT_SYSTEM + `\n\nFor this task, return ONLY a single JSON object that exactly matches the requested schema. Do NOT wrap it in markdown fences. Do NOT add commentary. UK acquisition multiples for community pharmacy typically sit between 4×–8× adjusted EBITDA — use the data to anchor a sensible range. If data is sparse, lower confidence and say so.`;

const RESPONSE_SCHEMA_HINT = `Return JSON with this exact shape:
{
  "headline_score": number (0-100, overall acquisition attractiveness),
  "confidence": "low" | "medium" | "high",
  "recommendation": "BUY" | "HOLD" | "PASS",
  "verdict_oneliner": string (<= 140 chars, plain English),
  "executive_summary": string (3-5 short paragraphs, markdown allowed, no bullet lists),
  "kpis": [ { "label": string, "value": string, "hint": string } ] (4-6 items, key acquisition KPIs derived from data),
  "location": {
    "summary": string (2-3 paragraphs on catchment, footfall drivers, GP cluster, isolation/competition density),
    "competitor_count_1mi": number,
    "gp_count_1mi": number,
    "catchment_verdict": "strong" | "average" | "weak"
  },
  "nhs_performance": {
    "summary": string (2-3 paragraphs analysing dispensing trend, service uptake vs peers, areas of strength and underperformance),
    "trend": "growing" | "stable" | "declining",
    "vs_peers": "above" | "in-line" | "below"
  },
  "service_potential": {
    "summary": string (2-3 paragraphs on quick wins and structural upside),
    "opportunities": [ { "title": string, "annual_uplift_gbp_low": number, "annual_uplift_gbp_high": number, "rationale": string } ] (3-5 items, conservative ranges)
  },
  "competitive": {
    "summary": string (2 paragraphs on competitive intensity, share-of-voice, ratings vs neighbours),
    "key_competitors": [ { "name": string, "distance_m": number, "threat": "low" | "med" | "high", "note": string } ] (3-5 items)
  },
  "valuation": {
    "summary": string (2-3 paragraphs explaining the valuation thinking),
    "implied_annual_nhs_income_gbp": number,
    "ebitda_estimate_gbp_low": number,
    "ebitda_estimate_gbp_high": number,
    "multiple_low": number,
    "multiple_high": number,
    "value_low_gbp": number,
    "value_high_gbp": number,
    "basis": string (1 paragraph, methodology + caveats)
  },
  "risks": [ { "title": string, "severity": "low" | "med" | "high", "note": string } ] (3-5 items),
  "opportunities_summary": [ { "title": string, "impact": "low" | "med" | "high", "note": string } ] (3-5 items),
  "due_diligence_checklist": [ string ] (6-10 items, specific to this target),
  "next_steps": [ string ] (3-5 actions)
}`;

export const generateAcquisitionReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      pharmacy_id: z.string().uuid(),
      force: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured");

    if (!data.force) {
      const { data: existing } = await supabase
        .from("ai_insights")
        .select("*")
        .eq("user_id", userId)
        .eq("pharmacy_id", data.pharmacy_id)
        .eq("insight_type", "acquisition_report")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing && (Date.now() - new Date(existing.generated_at).getTime()) < 1000 * 60 * 60 * 24 * 14) {
        try {
          const parsed = JSON.parse(existing.insight_text);
          return { report: parsed, context: existing.prompt_context, generated_at: existing.generated_at, cached: true };
        } catch { /* fall through */ }
      }
    }

    const aiContext = await buildPharmacyContext(supabase, data.pharmacy_id);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ACQ_SYSTEM_PROMPT },
          { role: "system", content: countryScope(aiContext?.pharmacy?.country) },
          { role: "user", content: `${RESPONSE_SCHEMA_HINT}\n\nTARGET DATA:\n${JSON.stringify(aiContext, null, 2)}` },
        ],
      }),
    });
    if (aiRes.status === 429) throw new Error("Rate limit exceeded. Please try again shortly.");
    if (aiRes.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace Settings.");
    if (!aiRes.ok) throw new Error(`AI gateway error (${aiRes.status}): ${await aiRes.text()}`);
    const aiJson = await aiRes.json();
    const rawText: string = aiJson.choices?.[0]?.message?.content ?? "";
    const cleaned = rawText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
    let report: any;
    try { report = JSON.parse(cleaned); }
    catch { throw new Error("AI returned malformed JSON. Please retry."); }

    const { data: saved, error: saveErr } = await supabase
      .from("ai_insights").insert({
        user_id: userId,
        pharmacy_id: data.pharmacy_id,
        insight_type: "acquisition_report",
        prompt_context: aiContext as any,
        insight_text: JSON.stringify(report),
      }).select().single();
    if (saveErr) throw new Error(saveErr.message);

    return { report, context: aiContext, generated_at: saved.generated_at, cached: false };
  });

// ============================================================
// Peer benchmark snapshot — quick stat cards
// ============================================================

export const getInsightsSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pharmacy_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const ctx = await buildPharmacyContext(supabase, data.pharmacy_id);
    const extras = await buildSnapshotExtras(supabase, data.pharmacy_id, ctx);
    return {
      pharmacy: ctx.pharmacy,
      reporting_period: ctx.reporting_period,
      twelve_month: ctx.twelve_month,
      peer_benchmark: ctx.peer_benchmark,
      monthly_items_last_24: ctx.monthly_items_last_24,
      latest_month_snapshot: ctx.latest_month_snapshot,
      ...extras,
    };
  });

// ---- snapshot extras: per-metric monthly series, mix, peer distributions ----
async function buildSnapshotExtras(supabase: any, pharmacy_id: string, ctx: any) {
  // Per-metric monthly series (24 months)
  const { data: rows } = await supabase
    .from("dispensing_data")
    .select("year,month,items_dispensed,pharmacy_first_count,nms_count,flu_vaccinations,eps_items,mcr_items,ehc_items,methadone_items,smoking_cessation,gross_cost,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment")
    .eq("pharmacy_id", pharmacy_id)
    .order("year", { ascending: true }).order("month", { ascending: true });
  const r24 = ((rows || []) as any[]).slice(-24);

  const series = (key: string) => r24.map((r: any) => ({ y: r.year, m: r.month, v: Number(r[key]) || 0 }));
  const monthly = {
    items: series("items_dispensed"),
    pharmacy_first: series("pharmacy_first_count"),
    nms: series("nms_count"),
    flu: series("flu_vaccinations"),
    eps: series("eps_items"),
    final_payment: series("final_payment"),
  };

  // Service mix (last 12m volumes)
  const l12 = r24.slice(-12);
  const s = (key: string) => l12.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const service_mix_12m = [
    { label: "Pharmacy First", value: s("pharmacy_first_count") },
    { label: "NMS", value: s("nms_count") },
    { label: "Flu", value: s("flu_vaccinations") },
    { label: "EPS items", value: s("eps_items") },
    { label: "MCR items", value: s("mcr_items") },
    { label: "EHC", value: s("ehc_items") },
    { label: "Methadone", value: s("methadone_items") },
    { label: "Smoking cessation", value: s("smoking_cessation") },
  ].filter((x) => x.value > 0);

  // Income mix (last 12m £)
  const pfPay = s("pharmacy_first_payment");
  const mcrPay = s("mcr_payment");
  const smPay = s("smoking_cessation_payment");
  const total = s("final_payment");
  const namedClinical = pfPay + mcrPay + smPay;
  const dispensingResidual = Math.max(0, total - namedClinical);
  const income_mix_12m = [
    { label: "Dispensing & other", value: Math.round(dispensingResidual) },
    { label: "Pharmacy First", value: Math.round(pfPay) },
    { label: "MCR (Scotland)", value: Math.round(mcrPay) },
    { label: "Smoking cessation", value: Math.round(smPay) },
  ].filter((x) => x.value > 0);

  // Peer distributions (use country peers, 12m totals per pharmacy)
  let peer_distribution: { items: number[]; pf: number[]; nms: number[]; final_payment: number[] } | null = null;
  try {
    const country = ctx.pharmacy?.country;
    const latest = r24[r24.length - 1];
    if (country && latest) {
      // Paginate all country peers (England ~11k+, Scotland ~1.8k) without a cap
      const ids: string[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 50_000; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("pharmacies")
          .select("id")
          .eq("country", country)
          .neq("id", pharmacy_id)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        ids.push(...(data as any[]).map((p: any) => p.id));
        if (data.length < PAGE) break;
      }
      if (ids.length) {
        const earliest = r24[Math.max(0, r24.length - 12)];
        const cy = earliest?.year ?? latest.year - 1;
        const cm = earliest?.month ?? latest.month;
        // Chunk IDs into batches of 500 to stay within Supabase .in() limits
        const CHUNK = 500;
        const allPeerRows: any[] = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { data: chunkRows } = await supabaseAdmin
            .from("dispensing_data")
            .select("pharmacy_id,items_dispensed,pharmacy_first_count,nms_count,final_payment,year,month")
            .in("pharmacy_id", chunk)
            .or(`year.gt.${cy},and(year.eq.${cy},month.gte.${cm})`);
          if (chunkRows) allPeerRows.push(...chunkRows);
        }
        const g = new Map<string, { items: number; pf: number; nms: number; fp: number }>();
        for (const r of allPeerRows) {
          const cur = g.get(r.pharmacy_id) || { items: 0, pf: 0, nms: 0, fp: 0 };
          cur.items += Number(r.items_dispensed) || 0;
          cur.pf += Number(r.pharmacy_first_count) || 0;
          cur.nms += Number(r.nms_count) || 0;
          cur.fp += Number(r.final_payment) || 0;
          g.set(r.pharmacy_id, cur);
        }
        const arr = Array.from(g.values());
        if (arr.length) {
          peer_distribution = {
            items: arr.map((x) => x.items).sort((a, b) => a - b),
            pf: arr.map((x) => x.pf).sort((a, b) => a - b),
            nms: arr.map((x) => x.nms).sort((a, b) => a - b),
            final_payment: arr.map((x) => Math.round(x.fp)).sort((a, b) => a - b),
          };
        }
      }
    }
  } catch { /* non-critical */ }

  return { monthly, service_mix_12m, income_mix_12m, peer_distribution };
}

// ============================================================
// AI Q&A — chat grounded in the pharmacy's data pack
// ============================================================

const QA_SYSTEM = EXPERT_SYSTEM + `\n\nYou are answering ad-hoc questions from the pharmacy owner/operator. Keep replies tight (under ~250 words unless a table is needed). Use British English. Quote figures from the data pack. If a question cannot be answered from the pack, say so plainly and suggest what data would unlock it. Output markdown only.`;

export const askInsightsQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      pharmacy_id: z.string().uuid(),
      question: z.string().min(1).max(2000),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })).max(20).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured");

    const aiContext = await buildPharmacyContext(supabase, data.pharmacy_id);
    const dataBlock = `TARGET DATA PACK:\n\`\`\`json\n${JSON.stringify(aiContext, null, 2)}\n\`\`\``;

    const messages: { role: string; content: string }[] = [
      { role: "system", content: QA_SYSTEM },
      { role: "system", content: countryScope(aiContext?.pharmacy?.country) },
      { role: "system", content: dataBlock },
      ...(data.history ?? []),
      { role: "user", content: data.question },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });
    if (res.status === 429) throw new Error("Rate limit exceeded. Please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace Settings.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI gateway error (${res.status})${body ? `: ${body}` : ""}`);
    }
    const json = await res.json();
    const answer: string = json.choices?.[0]?.message?.content ?? "";

    // Best-effort follow-up suggestions (separate, cheap call, never blocks UX)
    let followups: string[] = [];
    try {
      const fRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: "You suggest 3 short, concrete follow-up questions a UK pharmacy owner would ask next. Return ONLY a JSON array of 3 strings, no prose. Each under 90 chars, specific to the prior answer." },
            { role: "user", content: `Question: ${data.question}\n\nAnswer:\n${answer}\n\nReturn JSON array of 3 follow-up questions.` },
          ],
        }),
      });
      if (fRes.ok) {
        const fj = await fRes.json();
        const raw: string = fj.choices?.[0]?.message?.content ?? "[]";
        const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) followups = arr.filter((x) => typeof x === "string").slice(0, 3);
      }
    } catch { /* ignore */ }

    return { answer, followups };
  });
