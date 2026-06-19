import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdminAuth } from "@/integrations/supabase/admin-middleware";

/**
 * Batch-geocode every gp_practices row that lacks lat/lng using postcodes.io
 * (free, no API key, up to 100 postcodes per request).
 */
export const backfillGpGeocodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) =>
    z.object({ limit: z.number().min(1).max(20000).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const limit = data.limit ?? 5000;
    const { data: rows, error } = await supabaseAdmin
      .from("gp_practices")
      .select("practice_code,postcode")
      .is("lat", null)
      .not("postcode", "is", null)
      .limit(limit);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ practice_code: string; postcode: string | null }>;

    let updated = 0;
    let missed = 0;

    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      const postcodes = batch.map((r) => (r.postcode || "").trim()).filter(Boolean);
      if (!postcodes.length) continue;

      const res = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes }),
      });
      if (!res.ok) {
        missed += batch.length;
        continue;
      }
      const json = (await res.json()) as {
        result: Array<{ query: string; result: { latitude: number; longitude: number } | null }>;
      };

      const byQuery = new Map<string, { lat: number; lng: number }>();
      for (const r of json.result || []) {
        if (r.result) byQuery.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
      }

      for (const row of batch) {
        const pc = (row.postcode || "").toUpperCase();
        const loc = byQuery.get(pc);
        if (!loc) { missed++; continue; }
        const { error: upErr } = await supabaseAdmin
          .from("gp_practices")
          .update({ lat: loc.lat, lng: loc.lng })
          .eq("practice_code", row.practice_code);
        if (!upErr) updated++; else missed++;
      }
    }

    const { count: remaining } = await supabaseAdmin
      .from("gp_practices")
      .select("practice_code", { count: "exact", head: true })
      .is("lat", null)
      .not("postcode", "is", null);

    return { scanned: list.length, updated, missed, remaining: remaining ?? null };
  });

// ---------- Scotland GP contact details ingest ----------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export const refreshScotlandGpContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const pkgRes = await fetch(
      "https://www.opendata.nhs.scot/api/3/action/package_show?id=gp-practice-contact-details-and-list-sizes",
    );
    if (!pkgRes.ok) throw new Error(`CKAN package_show failed [${pkgRes.status}]`);
    const pkg = (await pkgRes.json()) as {
      result: { resources: Array<{ format: string; url: string; last_modified?: string; created?: string; name: string }> };
    };
    const csvs = pkg.result.resources
      .filter((r) => (r.format || "").toUpperCase() === "CSV")
      .sort((a, b) => (b.last_modified || b.created || "").localeCompare(a.last_modified || a.created || ""));
    if (!csvs.length) throw new Error("No CSV resource found");
    const url = csvs[0].url;

    const csvRes = await fetch(url);
    if (!csvRes.ok) throw new Error(`CSV download failed [${csvRes.status}]`);
    const text = await csvRes.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV appears empty");
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const iCode = idx("PracticeCode");
    const iName = idx("GPPracticeName");
    const iA1 = idx("AddressLine1");
    const iA2 = idx("AddressLine2");
    const iA3 = idx("AddressLine3");
    const iA4 = idx("AddressLine4");
    const iPc = idx("Postcode");
    const iHB = idx("HB");
    if (iCode < 0 || iName < 0 || iPc < 0) throw new Error("Required columns missing");

    const rows: Array<{
      practice_code: string; practice_name: string; postcode: string | null;
      address_line: string | null; health_board: string | null; country: string;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      const code = (c[iCode] ?? "").trim();
      if (!code) continue;
      const address = [iA1, iA2, iA3, iA4]
        .filter((j) => j >= 0)
        .map((j) => (c[j] ?? "").trim())
        .filter(Boolean)
        .join(", ");
      rows.push({
        practice_code: code,
        practice_name: (c[iName] ?? "").trim() || code,
        postcode: (c[iPc] ?? "").trim() || null,
        address_line: address || null,
        health_board: iHB >= 0 ? ((c[iHB] ?? "").trim() || null) : null,
        country: "Scotland",
      });
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("gp_practices")
        .upsert(slice, { onConflict: "practice_code" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }

    return { source: csvs[0].name, upserted };
  });

export const refreshEnglandGpContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    let offset = 1;
    const limit = 1000;
    let upserted = 0;
    let pages = 0;
    while (true) {
      const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?PrimaryRoleId=RO177&Status=Active&Limit=${limit}&Offset=${offset}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`ORD bulk failed [${res.status}] offset=${offset}`);
      const json = (await res.json()) as {
        Organisations?: Array<{ OrgId: string; Name: string; PostCode?: string }>;
      };
      const orgs = json.Organisations || [];
      if (!orgs.length) break;
      const rows = orgs.map((o) => ({
        practice_code: o.OrgId,
        practice_name: o.Name,
        postcode: o.PostCode || null,
        country: "England",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const { error } = await supabaseAdmin
          .from("gp_practices")
          .upsert(slice, { onConflict: "practice_code" });
        if (error) throw new Error(error.message);
        upserted += slice.length;
      }
      pages++;
      if (orgs.length < limit) break;
      offset += limit;
      if (pages > 30) break;
    }
    return { upserted, pages };
  });

/**
 * Coverage health snapshot for the admin dashboard.
 */
export const getGpCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const head = { count: "exact" as const, head: true };
    const [total, withName, withPostcode, withLat, scotTotal, engTotal] = await Promise.all([
      supabaseAdmin.from("gp_practices").select("practice_code", head),
      supabaseAdmin.from("gp_practices").select("practice_code", head).not("practice_name", "is", null),
      supabaseAdmin.from("gp_practices").select("practice_code", head).not("postcode", "is", null),
      supabaseAdmin.from("gp_practices").select("practice_code", head).not("lat", "is", null),
      supabaseAdmin.from("gp_practices").select("practice_code", head).eq("country", "Scotland"),
      supabaseAdmin.from("gp_practices").select("practice_code", head).eq("country", "England"),
    ]);

    const n = (x: { count: number | null }) => x.count ?? 0;
    const t = n(total) || 1;
    const pct = (x: number) => Math.round((x / t) * 1000) / 10;

    const score = Math.round(
      (n(withName) / t) * 30 +
      (n(withPostcode) / t) * 30 +
      (n(withLat) / t) * 40,
    );

    return {
      total: n(total),
      withName: n(withName),
      withPostcode: n(withPostcode),
      withLat: n(withLat),
      scotland: n(scotTotal),
      england: n(engTotal),
      pctName: pct(n(withName)),
      pctPostcode: pct(n(withPostcode)),
      pctLat: pct(n(withLat)),
      healthScore: Math.min(100, Math.max(0, score)),
    };
  });
