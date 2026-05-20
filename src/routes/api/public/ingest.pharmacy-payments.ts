import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Public ingestion endpoint for monthly pharmacy payment data.
// Auth: requires the Supabase anon `apikey` header (matches our pg_cron pattern).
// Body: { rows: [{ ods_code, year, month, pharmacy_first_payment?, mcr_payment?,
//                  ehc_items?, methadone_items?, smoking_cessation?, final_payment?,
//                  items_dispensed?, eps_items?, eps_nominations?, nms_count?,
//                  pharmacy_first_count?, flu_vaccinations?, gross_cost? }] }

const RowSchema = z.object({
  ods_code: z.string().min(1).max(32),
  year: z.number().int().min(2018).max(2100),
  month: z.number().int().min(1).max(12),
  pharmacy_first_payment: z.number().nonnegative().optional(),
  mcr_payment: z.number().nonnegative().optional(),
  ehc_items: z.number().int().nonnegative().optional(),
  methadone_items: z.number().int().nonnegative().optional(),
  smoking_cessation: z.number().int().nonnegative().optional(),
  final_payment: z.number().nonnegative().optional(),
  items_dispensed: z.number().int().nonnegative().optional(),
  eps_items: z.number().int().nonnegative().optional(),
  eps_nominations: z.number().int().nonnegative().optional(),
  nms_count: z.number().int().nonnegative().optional(),
  pharmacy_first_count: z.number().int().nonnegative().optional(),
  flu_vaccinations: z.number().int().nonnegative().optional(),
  gross_cost: z.number().nonnegative().optional(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
  data_source: z.string().min(1).max(64).optional(),
  is_actual_payment: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/ingest/pharmacy-payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        let parsed;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), { status: 400 });
        }

        const codes = Array.from(new Set(parsed.rows.map((r) => r.ods_code.toUpperCase())));
        const { data: pharmacies, error: pErr } = await supabaseAdmin
          .from("pharmacies")
          .select("id, ods_code")
          .in("ods_code", codes);
        if (pErr) return new Response(pErr.message, { status: 500 });

        const idByCode = new Map((pharmacies ?? []).map((p) => [p.ods_code.toUpperCase(), p.id]));
        const unknown: string[] = [];
        const payload = parsed.rows.flatMap((r) => {
          const id = idByCode.get(r.ods_code.toUpperCase());
          if (!id) { unknown.push(r.ods_code); return []; }
          const { ods_code, ...rest } = r;
          return [{ pharmacy_id: id, data_source: parsed.data_source ?? "manual", ...rest }];
        });

        if (payload.length === 0) {
          return Response.json({ inserted: 0, unknown }, { status: 200 });
        }

        // Upsert by (pharmacy_id, year, month). Requires a unique index — fall back to delete+insert.
        // Strategy: delete matching keys, then insert.
        const keys = payload.map((p) => ({ pid: p.pharmacy_id, y: p.year as number, m: p.month as number }));
        for (const k of keys) {
          await supabaseAdmin.from("dispensing_data")
            .delete().eq("pharmacy_id", k.pid).eq("year", k.y).eq("month", k.m);
        }
        const { error: iErr } = await supabaseAdmin.from("dispensing_data").insert(payload);
        if (iErr) return new Response(iErr.message, { status: 500 });

        return Response.json({ inserted: payload.length, unknown });
      },
    },
  },
});
