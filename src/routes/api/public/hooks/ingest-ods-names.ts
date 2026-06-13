import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

const ODS_API = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations";
const PAGE = 1000;
const CONCURRENT = 15;

export const Route = createFileRoute("/api/public/hooks/ingest-ods-names")({
  async loader({ request }) {
    const auth = authorizeHookRequest(request);
    if (auth) return auth;

    // Fetch all pharmacies in pages, then filter where name === ods_code
    // PostgREST can't compare two columns directly, so we do it client-side.
    const targets: { id: string; ods_code: string }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from("pharmacies")
        .select("id, ods_code, name")
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      for (const p of data) {
        if (p.name === p.ods_code) targets.push({ id: p.id, ods_code: p.ods_code });
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const results = { found: targets.length, updated: 0, notFound: 0, errors: 0 };

    // Resolve names from ODS API concurrently in batches
    for (let i = 0; i < targets.length; i += CONCURRENT) {
      await Promise.all(targets.slice(i, i + CONCURRENT).map(async (p) => {
        try {
          const res = await fetch(`${ODS_API}/${encodeURIComponent(p.ods_code)}`, {
            headers: { Accept: "application/json" },
          });
          if (res.status === 404) { results.notFound++; return; }
          if (!res.ok) { results.errors++; return; }
          const json = await res.json();
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

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
