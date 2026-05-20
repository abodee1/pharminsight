import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a senior pharmacy business analyst with expertise in NHS community pharmacy performance metrics, UK drug tariff, and private healthcare economics. You write in clear, professional British English. Your analysis is direct, clinically informed, and commercially useful. Do not use bullet points for everything — use structured paragraphs with clear section headers. Avoid generic advice; ground every observation in the specific data provided.`;

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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
      .from("ai_insights")
      .insert({
        user_id: userId,
        pharmacy_id: data.pharmacy_id ?? null,
        insight_type: data.insight_type,
        prompt_context: data.context as any,
        insight_text: text,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { insight: saved };
  });
