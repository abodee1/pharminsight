import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chFetch, cleanName, extractAccountsFigures, findChain, scoreCandidate } from "./companiesHouse.server";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const searchCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_id: z.string().uuid(),
    pharmacy_name: z.string().min(1).max(300),
    postcode: z.string().max(20).nullable().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    // 1) Cached?
    const { data: existing } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("pharmacy_id", data.pharmacy_id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.fetched_at && Date.now() - new Date(existing.fetched_at).getTime() < NINETY_DAYS_MS) {
      return { cached: true, data: existing, candidates: [], chain: null, auto_suggest: false };
    }

    // 2) Chain match?
    const chain = findChain(data.pharmacy_name);
    if (chain) {
      return { cached: false, data: null, candidates: [], chain, auto_suggest: true };
    }

    // 3) Clean name
    const cleaned = cleanName(data.pharmacy_name);
    if (cleaned.length < 3) return { cached: false, error: "name_too_short", candidates: [], chain: null };

    // 4) Search
    let raw: any;
    try {
      raw = await chFetch(`/search/companies?q=${encodeURIComponent(cleaned)}&items_per_page=5`);
    } catch (e: any) {
      return { cached: false, error: e.message || "ch_error", candidates: [], chain: null };
    }
    const items: any[] = raw.items || [];
    const scored = items.map((c) => ({
      company_number: c.company_number,
      company_name: c.title,
      company_status: c.company_status,
      address: c.address_snippet,
      postcode: c.address?.postal_code ?? null,
      score: scoreCandidate(c, cleaned, data.postcode ?? null),
    })).sort((a, b) => b.score - a.score).slice(0, 3);

    // Persist queue
    if (scored.length) {
      await supabaseAdmin.from("company_match_queue").insert(
        scored.map((s) => ({
          pharmacy_id: data.pharmacy_id,
          candidate_company_number: s.company_number,
          candidate_company_name: s.company_name,
          candidate_address: s.address,
          candidate_postcode: s.postcode,
          match_score: s.score,
          status: "pending",
        })),
      );
    }

    const auto_suggest = scored.length > 0 && scored[0].score >= 6;
    return { cached: false, data: null, candidates: scored, chain: null, auto_suggest };
  });

export const confirmCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_id: z.string().uuid(),
    company_number: z.string().min(1).max(20),
    is_chain: z.boolean().optional(),
    chain_name: z.string().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const profile: any = await chFetch(`/company/${encodeURIComponent(data.company_number)}`);
    const filings: any = await chFetch(
      `/company/${encodeURIComponent(data.company_number)}/filing-history?category=accounts&items_per_page=10`,
    ).catch(() => ({ items: [] }));

    const wantedTypes = new Set(["full-accounts", "total-exemption-full", "total-exemption-small", "micro-entity", "small-full", "small", "abbreviated-accounts"]);
    const filing = (filings.items || []).find((f: any) => wantedTypes.has(f.type));

    let figures = {
      turnover: null as number | null, gross_profit: null as number | null,
      operating_profit: null as number | null, net_profit: null as number | null,
      total_payroll: null as number | null, avg_employees: null as number | null,
      net_assets: null as number | null,
    };
    let raw_filing: any = filing ?? null;

    if (filing?.links?.document_metadata) {
      try {
        const metaPath = String(filing.links.document_metadata).replace(/^https?:\/\/[^/]+/, "");
        const meta: any = await chFetch(metaPath, { doc: true });
        const docId = meta?.links?.document ? String(meta.links.document).split("/").pop() : null;
        if (docId) {
          const xhtml = await chFetch<string>(`/document/${docId}/content`, { doc: true, accept: "application/xhtml+xml" });
          figures = extractAccountsFigures(xhtml);
          raw_filing = { ...filing, document_meta: meta };
        }
      } catch (e) {
        // best-effort, ignore
      }
    }

    const sic = profile?.sic_codes || null;
    const addrParts = profile?.registered_office_address || {};
    const registered_address = [addrParts.address_line_1, addrParts.address_line_2, addrParts.locality, addrParts.region, addrParts.postal_code, addrParts.country]
      .filter(Boolean).join(", ");

    const made_up = filing?.action_date || profile?.accounts?.last_accounts?.made_up_to || null;

    // Upsert
    const { data: upserted, error } = await supabaseAdmin.from("companies").upsert({
      pharmacy_id: data.pharmacy_id,
      company_number: profile.company_number,
      company_name: profile.company_name,
      company_status: profile.company_status,
      incorporation_date: profile.date_of_creation || null,
      sic_codes: sic,
      registered_address,
      registered_postcode: addrParts.postal_code || null,
      last_accounts_date: made_up,
      accounts_type: filing?.type || null,
      turnover: figures.turnover, gross_profit: figures.gross_profit,
      operating_profit: figures.operating_profit, net_profit: figures.net_profit,
      total_payroll: figures.total_payroll, avg_employees: figures.avg_employees,
      net_assets: figures.net_assets,
      accounts_year: made_up ? new Date(made_up).getFullYear() : null,
      match_confidence: data.is_chain ? "chain" : "confirmed",
      matched_by: data.is_chain ? "hardcoded" : "manual",
      is_chain: !!data.is_chain,
      chain_name: data.chain_name || null,
      raw_filing,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "company_number" }).select("*").maybeSingle();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("company_match_queue")
      .update({ status: "confirmed" })
      .eq("pharmacy_id", data.pharmacy_id)
      .eq("candidate_company_number", data.company_number);

    return { data: upserted };
  });

export const rejectCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pharmacy_id: z.string().uuid(),
    company_number: z.string().min(1).max(20),
  }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("company_match_queue")
      .update({ status: "rejected" })
      .eq("pharmacy_id", data.pharmacy_id)
      .eq("candidate_company_number", data.company_number);
    return { ok: true };
  });

export const refreshCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pharmacy_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: existing } = await supabaseAdmin.from("companies").select("company_number,is_chain,chain_name").eq("pharmacy_id", data.pharmacy_id).maybeSingle();
    if (!existing?.company_number) throw new Error("No match to refresh");
    // delegate to confirm with same number to re-fetch
    return { needs_confirm: true, company_number: existing.company_number, is_chain: existing.is_chain, chain_name: existing.chain_name };
  });
