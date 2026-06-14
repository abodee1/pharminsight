import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

const ODS_API = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations";
const BATCH_SIZE = 250;   // pharmacies resolved per invocation
const CONCURRENT = 10;

export const Route = createFileRoute("/api/public/hooks/ingest-ods-names")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });

        try {
          // Only grab a slice per invocation — the ODS API + per-row updates
          // easily exceed the 110s worker budget if we try to process all
          // ~1.7k unresolved pharmacies in one go.
          const { data: targets, error: fetchErr } = await supabaseAdmin
            .from("pharmacies")
            .select("id, ods_code, name")
            .filter("name", "eq", "ods_code")  // hint; refined below
            .order("ods_code", { ascending: true })
            .limit(BATCH_SIZE * 4);

          // PostgREST can't compare two columns, so the filter above is a
          // no-op string match. Do the real comparison client-side.
          const pending = (targets ?? [])
            .filter((p) => p.name === p.ods_code)
            .slice(0, BATCH_SIZE);

          if (fetchErr) throw new Error(fetchErr.message);

          const results = { batch: pending.length, updated: 0, notFound: 0, errors: 0 };

          for (let i = 0; i < pending.length; i += CONCURRENT) {
            await Promise.all(pending.slice(i, i + CONCURRENT).map(async (p) => {
              try {
                const res = await fetch(`${ODS_API}/${encodeURIComponent(p.ods_code)}`, {
                  headers: { Accept: "application/json" },
                });
                if (res.status === 404) { results.notFound++; return; }
                if (!res.ok) { results.errors++; return; }
                const json: any = await res.json().catch(() => null);
                const fetchedName: string | undefined = json?.Organisation?.Name;
                if (!fetchedName?.trim()) { results.notFound++; return; }
                const { error } = await supabaseAdmin
                  .from("pharmacies")
                  .update({ name: fetchedName.trim() })
                  .eq("id", p.id);
                if (error) results.errors++;
                else results.updated++;
              } catch {
                results.errors++;
              }
            }));
          }

          const { count: remaining } = await supabaseAdmin
            .from("pharmacies")
            .select("id", { count: "exact", head: true })
            .filter("name", "eq", "ods_code");

          return Response.json({ ok: true, ...results, remaining: remaining ?? null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[ingest-ods-names]", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },

      GET: async () => {
        // Two-column compare not possible in PostgREST; count client-side.
        const { data, error } = await supabaseAdmin
          .from("pharmacies")
          .select("id, ods_code, name")
          .limit(20000);
        if (error) return Response.json({ pending: 0, error: error.message }, { status: 500 });
        const pending = (data ?? []).filter((p) => p.name === p.ods_code).length;
        return Response.json({ pending });
      },
    },
  },
});
