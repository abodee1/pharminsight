import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYS_PROMPT =
  "You are a senior pharmacy business analyst. Write in clear professional British English. Be direct and specific — no generic advice. Use the data provided to make specific observations. Maximum 150 words.";

async function callLovableAI(userMessage: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit — please retry in a moment");
  if (res.status === 402) throw new Error("AI credits exhausted — please top up in workspace settings");
  if (!res.ok) throw new Error(`AI gateway ${res.status}`);
  const json: any = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

export const generatePerformanceSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_name: z.string(),
    region: z.string().nullable(),
    country: z.string().nullable(),
    last3_avg_items: z.number(),
    items_trend: z.array(z.number()),
    // English service metrics (optional — omitted for Scottish pharmacies)
    nms_last: z.number().nullable().optional(),
    pf_last: z.number().nullable().optional(),
    flu_last: z.number().nullable().optional(),
    eps_rate: z.number().nullable().optional(),
    eps_nominations_last: z.number().nullable().optional(),
    // Scottish service metrics (optional — omitted for English pharmacies)
    mcr_registrations_last: z.number().nullable().optional(),
    mcr_items_last: z.number().nullable().optional(),
    methadone_items_last: z.number().nullable().optional(),
    supervised_doses_last: z.number().nullable().optional(),
    ehc_items_last: z.number().nullable().optional(),
    smoking_cessation_last: z.number().nullable().optional(),
    pharmacy_first_payment_last: z.number().nullable().optional(),
    mcr_payment_last: z.number().nullable().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const isScot = (data.country || "").toLowerCase() === "scotland";
    const head = `Summarise the performance of ${data.pharmacy_name} in ${data.region ?? "—"}, ${data.country ?? "—"}. Last 3 months average items: ${data.last3_avg_items}. Items trend (12 months): [${data.items_trend.join(", ")}].`;
    const body = isScot
      ? ` This is a Scottish community pharmacy — DO NOT mention NMS, Pharmacy First (English), flu vaccinations or EPS, which do not apply. Use the Scottish service metrics. Pharmacy First (Scotland) consultations: see MCR caseload context. MCR registrations: ${data.mcr_registrations_last ?? "—"}. MCR items dispensed: ${data.mcr_items_last ?? "—"}. Methadone items: ${data.methadone_items_last ?? "—"}. Supervised methadone doses: ${data.supervised_doses_last ?? "—"}. EHC supplies: ${data.ehc_items_last ?? "—"}. Smoking cessation interventions: ${data.smoking_cessation_last ?? "—"}. Pharmacy First payment (latest month): £${Math.round(data.pharmacy_first_payment_last ?? 0).toLocaleString()}. MCR payment (latest month): £${Math.round(data.mcr_payment_last ?? 0).toLocaleString()}. Comment on caseload scale, OST workload, and service-income mix.`
      : ` NMS last month: ${data.nms_last ?? "—"}. Pharmacy First last month: ${data.pf_last ?? "—"}. Flu vaccinations last month: ${data.flu_last ?? "—"}. EPS rate: ${(data.eps_rate ?? 0).toFixed(1)}%. EPS nominations: ${data.eps_nominations_last ?? "—"}.`;
    const text = await callLovableAI(head + body);
    return { text, generated_at: new Date().toISOString() };
  });

export const generateBenchmarkingInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_name: z.string(),
    country: z.string().nullable(),
    rows: z.array(z.object({
      label: z.string(),
      self: z.number(),
      local: z.number(),
      national: z.number(),
    })),
  }).parse(d))
  .handler(async ({ data }) => {
    const lines = data.rows.map((r) => `${r.label}: ${Math.round(r.self).toLocaleString()} vs local avg ${Math.round(r.local).toLocaleString()} vs national avg ${Math.round(r.national).toLocaleString()}`).join("\n");
    const ctx = (data.country || "").toLowerCase() === "scotland"
      ? " This is a Scottish community pharmacy — DO NOT mention NMS, English Pharmacy First, flu vaccinations or EPS. Use only the metrics provided below."
      : " This is an English/NI/Welsh community pharmacy — DO NOT reference Scottish-only services such as MCR or supervised methadone unless they appear in the metrics below.";
    const msg = `Write a 3-paragraph benchmarking assessment for ${data.pharmacy_name}.${ctx}\n\n${lines}\n\nIdentify the 2 strongest and 2 weakest areas relative to peers. End with one specific, actionable recommendation.`;
    const text = await callLovableAI(msg);
    return { text, generated_at: new Date().toISOString() };
  });
