import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

// PHS publishes a monthly "Dispenser Details" CSV with the contractor's
// real trading name, address, postcode and HB2019 health-board code.
// We use it to backfill Scottish pharmacies whose names default to the
// raw contractor code (e.g. "2575") and whose region is missing/raw code.

const PACKAGE = "dispenser-location-contact-details";
const CKAN = `https://www.opendata.nhs.scot/api/3/action/package_show?id=${PACKAGE}`;

const HB: Record<string, string> = {
  S08000015: "Ayrshire and Arran", S08000016: "Borders",
  S08000017: "Dumfries and Galloway", S08000018: "Fife",
  S08000019: "Forth Valley", S08000020: "Grampian",
  S08000021: "Greater Glasgow and Clyde", S08000022: "Highland",
  S08000023: "Lanarkshire", S08000024: "Lothian",
  S08000025: "Orkney", S08000026: "Shetland",
  S08000027: "Tayside", S08000028: "Western Isles",
  S08000029: "Fife", S08000030: "Tayside",
  S08000031: "Greater Glasgow and Clyde", S08000032: "Lanarkshire",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const Route = createFileRoute("/api/public/hooks/ingest-scotland-dispenser-details")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });

        try {
          // 1. discover newest monthly CSV
          const pkg = await fetch(CKAN).then((r) => r.json() as Promise<any>);
          const resources: any[] = pkg?.result?.resources ?? [];
          const csvs = resources.filter((r) => (r.format || "").toUpperCase() === "CSV");
          const latest = csvs.sort((a, b) =>
            (b.last_modified ?? b.created ?? "").localeCompare(a.last_modified ?? a.created ?? ""))[0];
          if (!latest?.url) throw new Error("No CSV resource found");

          // 2. fetch + parse
          const csvText = await fetch(latest.url).then((r) => r.text());
          const rows = parseCsv(csvText);
          if (rows.length < 2) throw new Error("Empty CSV");
          const header = rows[0].map((h) => h.trim());
          const ix = (n: string) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
          const iCode = ix("DispCode");
          const iName = ix("DispLocationName");
          const iA1 = ix("DispLocationAddress1");
          const iA2 = ix("DispLocationAddress2");
          const iA3 = ix("DispLocationAddress3");
          const iA4 = ix("DispLocationAddress4");
          const iPC = ix("DispLocationPostcode");
          const iHB = ix("HB2019");
          if (iCode < 0 || iName < 0) throw new Error("Unexpected CSV schema");

          type R = { ods_code: string; nm: string; addr: string | null; pc: string | null; reg: string | null };
          const records: R[] = [];
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const code = (r[iCode] || "").trim();
            const nm = (r[iName] || "").trim();
            if (!code || !nm) continue;
            const addrParts = [iA1, iA2, iA3, iA4]
              .map((j) => (j >= 0 ? (r[j] || "").trim() : ""))
              .filter((p) => p && p.toUpperCase() !== "NA");
            const addr = addrParts.length ? addrParts.join(", ") : null;
            const pc = iPC >= 0 ? ((r[iPC] || "").trim() || null) : null;
            const hbCode = iHB >= 0 ? ((r[iHB] || "").trim()) : "";
            const reg = HB[hbCode] || hbCode || null;
            records.push({ ods_code: code, nm, addr, pc, reg });
          }

          // 3. fetch existing Scottish pharmacies in one go
          const odsCodes = records.map((r) => r.ods_code);
          const existing = new Map<string, { id: string; name: string; trading_name: string | null; address: string | null; postcode: string | null; region: string | null }>();
          for (let i = 0; i < odsCodes.length; i += 500) {
            const slice = odsCodes.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("pharmacies")
              .select("id, ods_code, name, trading_name, address, postcode, region")
              .eq("country", "Scotland")
              .in("ods_code", slice);
            if (error) throw new Error(error.message);
            for (const row of data ?? []) existing.set(row.ods_code, row as any);
          }

          // 4. compute per-row diff, only update what's actually empty/raw
          let nameFixed = 0, regionFixed = 0, addrFixed = 0, total = 0;
          for (const r of records) {
            const cur = existing.get(r.ods_code);
            if (!cur) continue;
            const patch: Record<string, string | null> = {};
            if (!cur.name || cur.name === r.ods_code) { patch.name = r.nm; nameFixed++; }
            if (!cur.trading_name) patch.trading_name = r.nm;
            if (!cur.address && r.addr) { patch.address = r.addr; addrFixed++; }
            if (!cur.postcode && r.pc) patch.postcode = r.pc;
            if (r.reg && (!cur.region || /^S08\d+$/.test(cur.region))) {
              patch.region = r.reg;
              regionFixed++;
            }
            if (Object.keys(patch).length === 0) continue;
            total++;
            const { error } = await supabaseAdmin
              .from("pharmacies")
              .update(patch)
              .eq("id", cur.id);
            if (error) throw new Error(error.message);
          }

          // 5. normalise any leftover raw S08 codes (pharmacies not in this CSV)
          for (const [code, name] of Object.entries(HB)) {
            await supabaseAdmin
              .from("pharmacies")
              .update({ region: name })
              .eq("country", "Scotland")
              .eq("region", code);
          }

          return Response.json({
            ok: true,
            source_file: latest.name,
            csv_rows: records.length,
            updated: total,
            names_filled: nameFixed,
            regions_filled: regionFixed,
            addresses_filled: addrFixed,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[ingest-scotland-dispenser-details]", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },

      GET: async () => {
        const { count } = await supabaseAdmin
          .from("pharmacies")
          .select("id", { count: "exact", head: true })
          .eq("country", "Scotland");
        return Response.json({ scotland_total: count ?? 0 });
      },
    },
  },
});
