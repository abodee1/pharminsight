import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { geocodeOne, placesNearby } from "./places.server";

const SYSTEM_PROMPT = `You are a senior M&A advisor for UK community pharmacy acquisitions, combining deep NHS pharmacy economics (drug tariff, ESPS, Pharmacy First, MCR, EPS, flu, NMS), local catchment dynamics and operational nous. You write in clear, professional British English. Your tone is direct, commercially sharp and clinically informed — like a partner at a specialist healthcare brokerage briefing an investment committee.

You will be given structured data for a target pharmacy: location, dispensing history, NHS service mix, country/regional benchmarks, nearby competitor pharmacies and GP surgeries.

Return ONLY a single JSON object that exactly matches the requested schema. Do NOT wrap it in markdown fences. Do NOT add commentary. Be specific to the actual numbers; never invent figures. Where you reason about £ uplift potential, base it on observed NHS tariffs and the gap to peers in the data. UK acquisition multiples for community pharmacy typically sit between 4×–8× adjusted EBITDA — use the data to anchor a sensible range. If data is sparse, lower confidence and say so.`;

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

export const generateInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      insight_type: z.enum(["swot", "benchmark", "trend", "acquisition"]),
      pharmacy_id: z.string().uuid().nullable().optional(),
      context: z.record(z.string(), z.unknown()),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured");

    const userPrompt = `Generate a ${data.insight_type.toUpperCase()} analysis for the following pharmacy.\n\nData:\n${JSON.stringify(data.context, null, 2)}\n\nUse clear section headers (in markdown, e.g. ## Strengths). Be specific to the numbers above.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are a senior pharmacy business analyst. Write clear British English." },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (res.status === 429) throw new Error("Rate limit exceeded. Please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace Settings.");
    if (!res.ok) throw new Error(`AI gateway error (${res.status})`);
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";

    const { data: saved, error } = await supabase
      .from("ai_insights").insert({
        user_id: userId, pharmacy_id: data.pharmacy_id ?? null,
        insight_type: data.insight_type, prompt_context: data.context as any, insight_text: text,
      }).select().single();
    if (error) throw new Error(error.message);
    return { insight: saved };
  });

// --- Acquisition report ---

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

    // 1. Reuse most recent report unless force
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
        // <14 days old, reuse
        try {
          const parsed = JSON.parse(existing.insight_text);
          return { report: parsed, context: existing.prompt_context, generated_at: existing.generated_at, cached: true };
        } catch { /* fall through */ }
      }
    }

    // 2. Load pharmacy + dispensing
    const { data: pharmacy, error: phErr } = await supabase
      .from("pharmacies").select("*").eq("id", data.pharmacy_id).single();
    if (phErr || !pharmacy) throw new Error("Pharmacy not found");

    const { data: dispRows } = await supabase
      .from("dispensing_data").select("*")
      .eq("pharmacy_id", data.pharmacy_id)
      .order("year", { ascending: true }).order("month", { ascending: true });
    const rows = (dispRows || []) as Row[];

    // 3. Derived KPIs (last 12 months vs previous 12)
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
      x.prev > 0 ? ((x.last - x.prev) / x.prev) * 100 : null;

    const latest = rows[rows.length - 1];

    // 4. Country peer benchmarks (avg of last 12 months items per pharmacy)
    let peerStats: { avg_items_12m: number; avg_pf_12m: number; avg_nms_12m: number; n: number } | null = null;
    if (pharmacy.country && latest) {
      // sample peers in the same country, take their items over latest 12 months
      const { data: peerPhs } = await supabase
        .from("pharmacies").select("id").eq("country", pharmacy.country).neq("id", pharmacy.id).limit(400);
      const ids = (peerPhs || []).map((p: any) => p.id);
      if (ids.length) {
        const minIdx = Math.max(0, rows.length - 12);
        const earliestYM = rows[minIdx];
        const cutoffYear = earliestYM?.year ?? latest.year - 1;
        const cutoffMonth = earliestYM?.month ?? latest.month;
        const { data: peerRows } = await supabase
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

    // 5. Location / Places intelligence
    let nearby: any = { competitors: [], gps: [], center: null, error: null };
    try {
      const geo = await geocodeOne(pharmacy.name, pharmacy.postcode, pharmacy.address);
      if (geo?.lat && geo?.lng) {
        const center = { lat: geo.lat, lng: geo.lng, id: geo.id };
        const [pharm, doctors] = await Promise.all([
          placesNearby(center.lat, center.lng, "pharmacy", 1600, 15),
          placesNearby(center.lat, center.lng, "doctor", 1600, 15),
        ]);
        const others = pharm.filter((p) => p.id !== geo.id && p.name.toLowerCase() !== pharmacy.name.toLowerCase());
        nearby = {
          center,
          competitors: others.map((p) => ({
            name: p.name, distance_m: distM(center, p), rating: p.rating ?? null,
            user_rating_count: p.userRatingCount ?? null, postcode: p.postcode,
          })),
          gps: doctors.map((p) => ({
            name: p.name, distance_m: distM(center, p), rating: p.rating ?? null,
            user_rating_count: p.userRatingCount ?? null, postcode: p.postcode,
          })),
        };
      }
    } catch (e: any) {
      nearby.error = e?.message || "places lookup failed";
    }

    // 6. Build compact context for the model
    const aiContext = {
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

    // 7. Ask AI for structured JSON
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
