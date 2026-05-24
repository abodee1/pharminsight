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
    nms_last: z.number(), nms_rank: z.number().nullable(), nms_total: z.number().nullable(),
    pf_last: z.number(), pf_rank: z.number().nullable(), pf_total: z.number().nullable(),
    eps_rate: z.number(), eps_nominations_last: z.number(),
  }).parse(d))
  .handler(async ({ data }) => {
    const msg = `Summarise the performance of ${data.pharmacy_name} in ${data.region ?? "—"}, ${data.country ?? "—"}. Last 3 months average items: ${data.last3_avg_items}. Items trend (12 months): [${data.items_trend.join(", ")}]. NMS last month: ${data.nms_last} (rank ${data.nms_rank ?? "—"} of ${data.nms_total ?? "—"}). Pharmacy First last month: ${data.pf_last} (rank ${data.pf_rank ?? "—"} of ${data.pf_total ?? "—"}). EPS rate: ${data.eps_rate.toFixed(1)}%. EPS nominations: ${data.eps_nominations_last}.`;
    const text = await callLovableAI(msg);
    return { text, generated_at: new Date().toISOString() };
  });

export const generateBenchmarkingInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_name: z.string(),
    items_self: z.number(), items_local: z.number(), items_national: z.number(),
    nms_self: z.number(), nms_local: z.number(), nms_national: z.number(),
    pf_self: z.number(), pf_local: z.number(), pf_national: z.number(),
    eps_rate_self: z.number(), eps_rate_national: z.number(),
  }).parse(d))
  .handler(async ({ data }) => {
    const msg = `Write a 3-paragraph benchmarking assessment for ${data.pharmacy_name}. Items: ${data.items_self} vs local avg ${data.items_local} vs national ${data.items_national}. NMS: ${data.nms_self} vs local ${data.nms_local} vs national ${data.nms_national}. Pharmacy First: ${data.pf_self} vs local ${data.pf_local} vs national ${data.pf_national}. EPS rate: ${data.eps_rate_self.toFixed(1)}% vs national ${data.eps_rate_national.toFixed(1)}%. Identify the 2 strongest and 2 weakest areas. End with one specific actionable recommendation.`;
    const text = await callLovableAI(msg);
    return { text, generated_at: new Date().toISOString() };
  });
