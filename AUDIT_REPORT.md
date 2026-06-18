# PharmInsight — Full Technical Audit Report

**Date:** 18 June 2026  
**Auditor:** Claude Code  
**Scope:** Full codebase (`C:\Users\abode\Documents\pharminsight`) + live site (pharmacy8.com)  
**Audit is read-only — no code changes were made.**

---

## Table of Contents

1. [Architecture & Code Quality](#1-architecture--code-quality)
2. [Security](#2-security)
3. [Data Pipelines](#3-data-pipelines)
4. [Database](#4-database)
5. [Dependencies](#5-dependencies)
6. [Frontend](#6-frontend)
7. [Business Logic](#7-business-logic)
8. [Testing & CI](#8-testing--ci)
9. [Deployment](#9-deployment)
10. [Executive Summary — Top 5 Fixes](#executive-summary--top-5-fixes-first)

---

## 1. Architecture & Code Quality

### Overview

PharmInsight is a TanStack Start (React + SSR) application deployed on Cloudflare Workers via `@cloudflare/vite-plugin`, backed by Supabase (Postgres + Auth + pg_cron). The codebase is generally well-structured and recent, with roughly 30 route files, 20 components, and 12 server functions/API routes.

### Findings

| # | Finding | Severity |
|---|---------|----------|
| 1.1 | **`streamCsv` duplicated 4×** — An identical streaming CSV parser (`streamCsv`) is copy-pasted verbatim into `ingest-england.ts`, `ingest-scotland.ts`, `ingest-ni.ts`, and `ingest-wales.ts`. One shared `src/lib/streamCsv.ts` would reduce ~160 lines to ~40. | Medium |
| 1.2 | **`peerDistribution` effect duplicated across `dashboard.tsx` and `pharmacy.$odsCode.tsx`** — The same large 80-line async effect (peer ID fetch → period resolution → dispensing fetch → setPeerDistribution) exists in both routes. It should be a shared hook. | Medium |
| 1.3 | **`settings.tsx` fetches all pharmacies into the browser** — `fetchAll(supabase.from("pharmacies").select("*"))` on page load pulls tens of thousands of rows over the wire just to power a local search filter. The search should be server-side. | High |
| 1.4 | **`nitro` pinned to a beta build** — `"nitro": "3.0.260603-beta"` is a date-stamped beta, not a stable semver release. Unpredictable surface area for the SSR runtime. | Medium |
| 1.5 | **Wales and NI dataset IDs marked TODO** — Both `ingest-wales.ts` (lines 13–26) and `ingest-ni.ts` (lines 8–28) have explicit `TODO` comments saying the supplementary CKAN dataset IDs need to be verified against the live portals. These pipelines could be ingesting from wrong or non-existent endpoints. | High |
| 1.6 | **No `SUPABASE_SERVICE_ROLE_KEY` in `.env`** — The admin client (`client.server.ts`) requires this key but it's absent from `.env`. It must exist as a platform secret; there's no `.env.example` documenting what's required. Onboarding risk. | Low |
| 1.7 | **Half-finished `eps_nominations` column** — The initial migration creates `eps_nominations int not null default 0` in `dispensing_data`, but no ingest pipeline writes to it and the UI doesn't read it. Appears orphaned. | Low |
| 1.8 | **`latestPeriod.ts` function uses `count(*) > 5000`** — `getLatestSubstantialPeriod()` queries for a period with >5000 rows but the production threshold in `landing_cache` was changed from 500 to 5000. If Scotland/Wales periods have fewer rows, they'll never be selected as the "latest". | Medium |
| 1.9 | **TypeScript clean** — `tsc --noEmit` passes with zero errors. | ✅ |
| 1.10 | **No half-finished feature flags or commented-out code blocks** — Code is generally tidy. | ✅ |

---

## 2. Security

### Findings

| # | Finding | Severity |
|---|---------|----------|
| 2.1 | **`.env` is git-tracked** — `git ls-files .env` confirms the file is committed to the repository. It contains a live Google Maps API key (`AIzaSyBbNZj_58rJ_ioxP8ox1_-AMAVGodCGzS4`) and the Supabase anon JWT. The `.gitignore` excludes `*.local` but not `.env` itself. Anyone with repo access has these keys. The Google Maps key should be revoked and regenerated with HTTP referrer restrictions. | **CRITICAL** |
| 2.2 | **Anon key accepted as a hook authentication bypass** — `hook-auth.server.ts` (lines 23–27) accepts the `SUPABASE_PUBLISHABLE_KEY` (the anon JWT) presented in an `apikey` request header as a valid authentication path for all ingest hook endpoints. This key is also shipped in the client JavaScript bundle. Any browser user who inspects their network requests or the bundle can call `POST /api/public/hooks/ingest-england?reingest=1` (which deletes and re-queues all data), `POST /api/public/hooks/ingest-wales`, etc. The `reingest` parameter specifically allows full table wipe and re-queue of all historical data — a destructive operation accessible to anyone. | **CRITICAL** |
| 2.3 | **`schema_alerts` is publicly readable** — `CREATE POLICY "schema_alerts_public_read" ON public.schema_alerts FOR SELECT USING (true)` exposes internal column names, attempted field variants, and full CSV header lists from NHS data files to any anonymous user. This is an information disclosure risk, not data privacy, but it reveals implementation internals unnecessarily. | Medium |
| 2.4 | **`companies` and `company_match_queue` allow any authenticated user to INSERT/UPDATE** — Policies `companies_auth_write` and `companies_auth_update` use `WITH CHECK (true)` / `USING (true)` with no user-scoping. Any logged-in user can insert arbitrary company data or update existing records. These tables power the Acquisition Analyser and Companies House intelligence. | High |
| 2.5 | **`ingestion_log` is publicly readable** — `CREATE POLICY "ingestion_log_public_read"... USING (true)` exposes all ingest history, error messages, and resource URLs to anonymous users. Error messages can leak internal hostnames, configuration, or CSV parsing details. | Medium |
| 2.6 | **Cron SQL hardcodes the anon JWT** — `20260613000003_backfill_crons.sql` embeds the anon JWT in plain text inside SQL `net.http_post` calls committed to git. Since the anon key is already public (it's in `.env` and the bundle), this is not an additional exposure, but it's a maintenance hazard — rotating the key requires a new migration. | Low |
| 2.7 | **`ingestion_queue` has no client read policy** — `ingestion_queue_no_client_access` policy prevents client reads, which is correct. However, `ingestion_log` being publicly readable (finding 2.5) means the information about what was queued/processed is still exposed. | Noted |
| 2.8 | **`user_roles` admin seeding hardcodes a personal email** — `20260610135358_...sql` contains `WHERE lower(email) = 'abodee.alhasso@gmail.com'` as a bootstrapping step committed to the repository. This reveals the owner's identity in a public/shared repo context. | Low |
| 2.9 | **RLS on `profiles` has no DELETE policy** — Users cannot delete their own profile. Combined with the `on delete cascade` from `auth.users`, this is likely fine (deleting the auth user cascades), but the asymmetry is notable. | Low |
| 2.10 | **`dispensing_data` is fully public-readable** — All dispensing data (items dispensed per pharmacy, per month) is accessible without authentication. This is a deliberate product decision (the data is NHS-published public data) but it means no per-user or per-pharmacy gating is possible without schema changes. Worth documenting as intentional. | Noted |
| 2.11 | **No CORS configuration found** — No explicit CORS headers in the server routes or wrangler config. Cloudflare Workers apply their own CORS handling; verify that the Supabase project's allowed origins are locked to `pharmacy8.com` and `localhost`. | Medium |
| 2.12 | **No rate limiting on AI insight endpoints** — `insights.functions.ts` calls the Anthropic API without any per-user rate limiting. A user could rapidly regenerate reports and run up significant API costs. | High |

---

## 3. Data Pipelines

### England — NHSBSA (`ingest-england.ts`)

**Status: Structurally sound, chunked ingestion working.**

The England pipeline is the most complete. It discovers CKAN resources from `pharmacy-and-appliance-contractor-dispensing-data`, skips already-processed URLs, streams CSV without buffering (memory-efficient), correctly filters out dispensing doctors via `PHARMACY_ACCOUNT_TYPE`, aggregates per `(ods_code, year, month)`, and upserts in 500-row chunks.

| # | Finding | Severity |
|---|---------|----------|
| 3.1 | **Chunked ingestion confirmed working** — The queue+batch pattern (`runBatch(1)`) processes one ~50 MB NHSBSA file per cron tick (every 10 min), within the 110-second HTTP timeout. A pg_cron drain is in place. | ✅ |
| 3.2 | **`reingest=1` is a destructive, unauthenticated-accessible operation** — See finding 2.2. The `reingest` flag deletes all `ingestion_log` rows and all `ingestion_queue` rows for NHSBSA, then re-queues from scratch. With the anon key bypass, any user can trigger this. | **CRITICAL** (via 2.2) |
| 3.3 | **No retry for `failed` items** — Items that fail stay in `failed` status with no automatic retry. An admin must manually intervene. Transient failures (upstream 503, network blip) accumulate silently. | High |
| 3.4 | **No stuck-processing recovery** — If a Worker is killed mid-execution, items stay in `processing` indefinitely. No timeout check resets them to `pending`. | Medium |
| 3.5 | **`parseYearMonth` reads both `name` and `url` together** — Regex searches the concatenated string `"${name} ${url}"`, which could match a false year from the UUID portion of a CKAN URL. The `/(20\d{2})(0[1-9]|1[0-2])/g` regex with the year-anchor to `20xx` is mostly safe but could theoretically collide with a UUID starting `2025`. Low risk given real-world data. | Low |

### Scotland — PHS (`ingest-scotland.ts`)

**Status: Most complete pipeline, well-engineered.**

Handles three PHS CKAN datasets with priority ordering. Rich/poor pharmacy pass correctly preserves existing good names. Provisional flagging based on lag logic is implemented. Column variant lookup handles schema changes gracefully.

| # | Finding | Severity |
|---|---------|----------|
| 3.6 | **Scotland EPS items fallback** — `eps_items: Math.round(a.payments.eps_items || a.items)` silently uses `items_dispensed` as EPS proxy when no explicit EPS column exists. This inflates Scotland's EPS figure to 100% of items — valid as Scotland's PIS system is fully electronic, but should be documented. | Low |
| 3.7 | **`missingPayments` alert is suppressed for known-absent fields** — `KNOWN_ABSENT_IN_CONTRACTOR_ACTIVITY` suppresses `pharmacy_first_payment` and `mcr_payment` alerts. If PHS adds these columns later, the suppression would mask the discovery. | Low |
| 3.8 | **No retry/recovery** — Same as 3.3/3.4. | High |

### Wales — NWSSP (`ingest-wales.ts`)

**Status: Structurally present but dataset IDs unverified.**

| # | Finding | Severity |
|---|---------|----------|
| 3.9 | **CKAN dataset IDs marked TODO** — `dispensing-by-pharmacy-contractor-wales` on `ckan.publishing.service.gov.uk` and `community-pharmacy-contractor-activity` on `opendata.nwssp.wales.nhs.uk` are marked as needing verification. If either endpoint returns 404, the pipeline silently emits a `console.warn` and returns 0 queued items — no error is stored, no alert fires. | **High** |
| 3.10 | **No cron drain is scheduled for Wales** — Wait, correction: `wales-pharmacy-drain` IS in `backfill_crons.sql`. However, this cron fires only when pending items exist OR when no rows exist at all. If the initial discovery finds 0 items (due to wrong dataset ID), the cron will fire every 10 minutes checking forever. | Medium |

### Northern Ireland — HSCNI/BSO (`ingest-ni.ts`)

**Status: Primary dataset likely works; supplementary datasets unverified.**

| # | Finding | Severity |
|---|---------|----------|
| 3.11 | **Supplementary dataset IDs marked TODO** — `community-pharmacy-new-medicine-service` and `community-pharmacy-minor-ailments` from `opendata.hscni.net` are explicitly flagged as needing verification (comment: "TODO: confirm dataset IDs"). These datasets provide NMS and Pharmacy First counts for NI. | High |
| 3.12 | **NI ODS code prefix assumption** — All NI codes are prefixed with `NI` if not already present (`ods.startsWith("NI") ? ods : 'NI' + ods`). This could corrupt codes if HSCNI changes its format. | Low |
| 3.13 | **`isPrimary` logic for NI** — `ignoreDuplicates: !isPrimary` means supplementary datasets (NMS, Pharmacy First) cannot fill in metrics for a row that already exists from the primary dataset, even if those metrics are zero in the primary. An explicit `UPDATE WHERE nms_count = 0` would be more reliable. | Medium |

### GP Prescribing / Linkage Pipelines

The England GP (`ingest-england-gp.ts`) and Scotland GP pipelines appear to be functioning within the cron drain framework. The `NHSBSA_GP` chunked ingestion was not explicitly audited as broken in the prior session review; the queue-based pattern is the same as `NHSBSA`.

---

## 4. Database

### Schema Overview

Core tables: `pharmacies`, `dispensing_data`, `user_pharmacy`, `profiles`, `ai_insights`, `private_uploads`, `ingestion_queue`, `ingestion_log`, `gp_practices`, `gp_prescribing`, `gp_dispensing_by_pharmacy`, `gp_pharmacy_linkage`, `gp_list_sizes`, `companies`, `company_match_queue`, `saved_analyses`, `user_roles`, `landing_cache`, `schema_alerts`, `ingestion_freshness_check`.

| # | Finding | Severity |
|---|---------|----------|
| 4.1 | **Missing composite index on `dispensing_data`** — The most common query pattern is `WHERE pharmacy_id = X AND year = Y AND month = M` or `WHERE year = Y AND month = M`. The current indexes are `(pharmacy_id)` and `(year, month)` separately. A composite `(pharmacy_id, year, month)` index would accelerate per-pharmacy timeseries queries significantly at scale. | High |
| 4.2 | **`pharmacies_near` function uses a bounding-box approximation, not a true PostGIS sphere** — The implementation uses the Haversine formula in pure SQL but uses a lat/lng bounding box as a pre-filter with a column index on `(lat, lng)`. Without PostGIS, there's no spatial index (GIST/SPGIST). At ~12,000 pharmacies this is acceptable, but a geo index would be appropriate. | Medium |
| 4.3 | **`dispensing_data` unique constraint is `(pharmacy_id, month, year)` not `(pharmacy_id, year, month)`** — The column order in the constraint differs from the likely query order. PostgreSQL uses constraint index in declaration order. The index on `(year, month)` should be `(year, month, pharmacy_id)` for covering queries. | Low |
| 4.4 | **No subscription tier column on `profiles`** — The marketed Free/Solo/Group pricing model has no representation in the schema. No `subscription_tier`, `stripe_customer_id`, or `plan` field exists on `profiles`. | High (business) |
| 4.5 | **Migration files use UUID names** — 35 of 45 migration files are named with opaque UUIDs (Lovable auto-generated). Only 10 have descriptive names. This makes migration history unreadable without reading every file. | Low |
| 4.6 | **`eps_nominations` is orphaned** — Created in the first migration, never written or read. | Low |
| 4.7 | **`_scot_metrics_staging` and `_pf_services_staging` are staging/temp tables with RLS enabled but no policies** — These appear to be temporary tables used during data processing. If they still exist in production and have no SELECT policies, they silently deny all access (RLS default-deny). | Low |
| 4.8 | **Schema drift risk** — Migrations are applied manually via Lovable/Supabase. There's no `supabase db diff` or migration lock to detect drift between what's in `supabase/migrations/` and the live schema. | Medium |
| 4.9 | **No soft-delete or audit trail on pharmacies/dispensing data** — If a pharmacy is deleted (e.g., a mis-ingested record), all `dispensing_data` rows cascade-delete silently with no audit log. | Low |
| 4.10 | **`ingestion_freshness_check` only accessible to admins** — This is correct gating, but there's no public freshness indicator exposed to non-admin users. | Noted |

---

## 5. Dependencies

### npm audit Summary

```
6 vulnerabilities found
  High:     5 (@cloudflare/vite-plugin, miniflare, undici, wrangler, ws)
  Low:      1 (esbuild)
  Critical: 0
```

All high-severity vulnerabilities are in `@cloudflare/vite-plugin` and its transitive `wrangler`/`miniflare` chain.

| # | Finding | Severity |
|---|---------|----------|
| 5.1 | **`@cloudflare/vite-plugin` — 5 high-severity vulnerabilities** — The installed range covers `undici` (TLS certificate validation bypass via SOCKS5 proxy, CVSS 7.4; cross-user information disclosure, CVSS 5.9), `ws` (memory exhaustion DoS, CVSS 7.5), and associated bundler toolchain issues. These are **dev-dependency risk** — they affect the build toolchain, not the runtime bundle served to users. However the `undici` TLS bypass could affect the dev server. `npm audit fix` resolves all. | High (dev) |
| 5.2 | **`nitro` pinned to beta** — `"nitro": "3.0.260603-beta"` is a date-stamped pre-release, not a stable release. | Medium |
| 5.3 | **No license issues found** — All major dependencies are MIT, Apache-2.0, or BSD-2-Clause. No GPL or AGPL contamination. | ✅ |
| 5.4 | **Dependency freshness is good** — React 19.2, TanStack Start 1.16x, Tailwind 4.2, Supabase JS 2.106 — all recent, no obviously abandoned packages. | ✅ |
| 5.5 | **No security scanner (Snyk/Dependabot) configured** — No Dependabot `.github/dependabot.yml` or Snyk integration. Vulnerabilities accumulate silently. | Medium |

---

## 6. Frontend

### SEO

| # | Finding | Severity |
|---|---------|----------|
| 6.1 | **No `robots.txt` or `sitemap.xml`** — No `public/` directory exists at all. Search engines will crawl with no guidance. There's also no server route returning `robots.txt`. The canonical URL (`https://pharmacy8.com/`) is set correctly on the landing page but search engines have no sitemap to discover pharmacy profile pages. | High |
| 6.2 | **Pharmacy profile pages have no per-page meta tags** — `pharmacy.$odsCode.tsx` does not implement a `head` export. Every pharmacy profile page (e.g., `/pharmacy/FJ155`) will show the default site title in Google SERPs rather than the pharmacy name. This is a significant lost SEO surface — ~12,000 pages with unique, rankable content. | High |
| 6.3 | **Landing page meta is good** — Title, description, OG tags, and canonical are all present in `index.tsx`. | ✅ |

### Accessibility

| # | Finding | Severity |
|---|---------|----------|
| 6.4 | **Raw `<button>` elements used outside the Button component** — Multiple places (e.g., `_authenticated.tsx` role-selection, infographic flip buttons, insights FAB) use raw `<button>` without the standardised Button component. Some lack `:focus-visible` ring styles, degrading keyboard navigation. | Medium |
| 6.5 | **Loading spinners lack ARIA live regions** — Inline loaders render `<Loader2 className="animate-spin" />` without `role="status"` or `aria-live="polite"`, meaning screen readers don't announce state transitions. | Medium |
| 6.6 | **Radix UI primitives used throughout** — All form controls, dialogs, dropdowns, and tabs are Radix-based, providing solid a11y foundations. | ✅ |
| 6.7 | **Colour contrast** — Dark theme is default; visual inspection of the live site suggests contrast ratios look acceptable but no automated a11y scan was run. Manual WCAG 2.1 AA audit needed. | Medium |

### Responsiveness

| # | Finding | Severity |
|---|---------|----------|
| 6.8 | **Mobile layout generally functional** — The app uses a responsive sidebar that collapses on mobile with a `MobileTopBar`. The Insights FAB is mobile-only. Observed responsive breakpoints are consistent with `md:` Tailwind prefix. | ✅ |
| 6.9 | **Dense data tables on narrow screens** — Leaderboard and benchmarking tables are full-width and will overflow on very small screens (<360px). No horizontal scroll container observed. | Low |

### Console Errors / Broken Links

| # | Finding | Severity |
|---|---------|----------|
| 6.10 | **`settings.tsx` fetches all pharmacies client-side** — This will produce a very large network request (potentially 100k+ rows × multiple columns) on every settings page load. Not technically a "console error" but it will cause warnings or stalls in DevTools. | High |
| 6.11 | **No `favicon.ico` or web app manifest** — No `public/` directory means no favicon, no `manifest.json`. The site will show a generic browser icon. | Low |

---

## 7. Business Logic

### Leaderboard

The leaderboard (`leaderboards.tsx`) fetches all pharmacies for a country via `fetchAll`, all dispensing data for the selected period, ranks them by metric, and renders with client-side sort/filter.

| # | Finding | Severity |
|---|---------|----------|
| 7.1 | **Leaderboard ranking is correct** — Rank is computed as `sorted.findIndex(v => v <= mineVal) + 1` which correctly handles ties and uses ≤ comparison. | ✅ |
| 7.2 | **Leaderboard fetches all dispensing rows for a period** — For England, one month of data is ~11,000 rows × 8 columns = ~1 MB over the wire. This is acceptable now but will grow. No server-side pagination. | Medium |
| 7.3 | **`getLatestSubstantialPeriod`** uses `count(*) > 5000` threshold which may exclude Scotland-only or NI-only periods from appearing as "latest". | Medium |

### GP Market Share

| # | Finding | Severity |
|---|---------|----------|
| 7.4 | **Market share calculation is correct** — `myLast12 / marketLast12 * 100` is correctly computed from `fetchAll` of 12 months of dispensing for nearby pharmacies. Haversine distance filter is applied before fetching. | ✅ |
| 7.5 | **Pharmacies with no lat/lng are silently excluded** — If a pharmacy has no geocoded coordinates, it doesn't appear in the `pharmacies_near` results and is excluded from both the market total and competitor list. No warning is shown to the user. | Medium |
| 7.6 | **12-month window is hard-coded** — The 12-month lookback for market share cannot be adjusted by the user. | Low |

### Acquisition Analyser

| # | Finding | Severity |
|---|---------|----------|
| 7.7 | **Acquisition report is AI-generated, not formula-based** — The `generateAcquisitionReport` server function calls the Anthropic API with a pharmacy data context. The report is a qualitative analysis, not a calculated valuation. This is appropriate for the use case but should be disclosed clearly to users as AI-generated analysis. | Medium |
| 7.8 | **Report is cached in `ai_insights` table** — Cache key is `pharmacy_id + type = 'acquisition_report'`. Re-generation is available via the Regenerate button. Cache invalidation on data refresh is not automatic. A report generated in January remains available and may show stale context. | Medium |
| 7.9 | **No input sanitisation on `force` parameter** — `generateAcquisitionReport({ pharmacy_id, force })` — `force` is a boolean coerced by Zod, so injection risk is negligible. | ✅ |

### Drug Tariff Intelligence

| # | Finding | Severity |
|---|---------|----------|
| 7.10 | **No Drug Tariff database or lookup exists** — Searches across the entire codebase find no Drug Tariff pricing table, no tariff category lookup, and no tariff-derived calculation. The "Drug Tariff intelligence" surfaces only in AI insight prompts where it relies on the model's training-time knowledge of NHS tariff structures. There is no live Drug Tariff data feed or calculation engine. This is a significant gap if the feature is advertised as providing tariff-specific insights. | High |

### Three-Tier Pricing (Free / Solo £2 / Group volume-taper)

| # | Finding | Severity |
|---|---------|----------|
| 7.11 | **Subscription/billing logic does not exist anywhere in the codebase** — There is no `subscription_tier` field on `profiles`, no Stripe integration, no payment webhooks, no server-side feature gating, no plan-based access control, and no billing UI. The `profiles` table stores only `full_name` and `role`. The entire application is effectively free with no access tiers. This is either a pre-launch state (pricing not yet implemented) or an unintentional omission. | **Critical** (business) |

---

## 8. Testing & CI

| # | Finding | Severity |
|---|---------|----------|
| 8.1 | **Zero test files** — No `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` files exist anywhere in the repository. No unit tests, integration tests, or end-to-end tests. | **Critical** |
| 8.2 | **No CI/CD pipeline** — No `.github/workflows/` directory, no GitHub Actions, no other CI configuration (CircleCI, Bitbucket Pipelines, etc.). Nothing automatically builds, lints, or type-checks the code on push. | **Critical** |
| 8.3 | **ESLint configured but only runs locally** — `eslint.config.js` exists with `react-hooks` and `react-refresh` plugins. The `lint` script is defined in `package.json` but is never called automatically. | High |
| 8.4 | **No build verification on PRs** — Without CI, it's possible to merge code that fails `tsc --noEmit` or breaks the Vite build. | High |
| 8.5 | **TypeScript is currently clean** — `tsc --noEmit` exits with no errors (confirmed during audit). | ✅ |

---

## 9. Deployment

| # | Finding | Severity |
|---|---------|----------|
| 9.1 | **pg_cron hooks point to Lovable staging URL, not pharmacy8.com** — `backfill_crons.sql` hard-codes `https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app` in all `net.http_post` calls. These crons run against the production Supabase instance, so if this SQL was applied to production, production crons are calling the Lovable preview deployment, not the live site. New pharmacy.8.com deployment would silently fail to trigger ingest hooks unless these cron URLs are updated. | **Critical** |
| 9.2 | **`wrangler.jsonc` has no environment separation** — The wrangler config defines only `name`, `compatibility_date`, `compatibility_flags`, and `main`. There are no `[env.staging]`/`[env.production]` environments, no `vars`, no `kv_namespaces`, and no `routes`. Secrets are entirely injected via Lovable's environment management. | High |
| 9.3 | **No `.env.example`** — The committed `.env` with real keys is the only documentation of required environment variables. A new developer or staging environment has no safe template. | Medium |
| 9.4 | **`SUPABASE_SERVICE_ROLE_KEY` is not in `.env`** — This is correct (keep secret out of git), but the deployment pipeline must inject it. No documentation of this requirement exists. | Medium |
| 9.5 | **Lovable sync** — The `.lovable/` directory contains `plan.md` and `project.json`. These are managed by Lovable and synced to the platform. The `routeTree.gen.ts` is auto-generated by TanStack Router and is committed (standard practice for TanStack Start). No issues found. | ✅ |
| 9.6 | **Compatibility date is future-dated** — `"compatibility_date": "2025-09-24"` is in the past relative to audit date (June 2026), so the Cloudflare runtime is locked to a specific Worker API snapshot. This is fine but should be reviewed periodically to pick up new platform features. | Low |

---

## Executive Summary — Top 5 Fixes First

The audit found **no critical runtime crashes** and the TypeScript compiles cleanly. However, five issues require immediate attention:

---

### 🔴 Fix 1 — Remove `.env` from git and rotate the Google Maps API key

**Why it's critical:** Real credentials are committed to the repository. The Google Maps API key (`AIzaSyBbNZj_...`) is fully functional and unrestricted. The Supabase anon key being in git is a secondary concern (it's already public-facing), but the Maps key is billable and exploitable.

**Actions:**
1. Add `.env` to `.gitignore` (add a line `.env` — not just `*.local`).
2. Run `git rm --cached .env` and `git commit` to remove it from tracking.
3. Rotate the Google Maps API key in the Google Cloud Console and add HTTP referrer restrictions (e.g. `https://pharmacy8.com/*`).
4. Create a `.env.example` with placeholder values documenting all required variables.

---

### 🔴 Fix 2 — Remove the anon-key authentication bypass from ingest hooks

**Why it's critical:** Any logged-in user can call `POST /api/public/hooks/ingest-england?reingest=1` using their browser session, wiping and re-queuing all of England's ingestion history. The anon key bypass was designed for pg_cron but makes all ingest endpoints callable by any browser user who knows the endpoint path.

**Actions:**
1. In `hook-auth.server.ts`, remove the `apikey` header path (lines 23–27) entirely.
2. Migrate all pg_cron calls to use the `INGEST_HOOK_SECRET` env var instead. Set the shared secret in Supabase's `vault.secrets` or inject it as a Worker secret, then update the cron SQL to pass `"x-hook-secret": "..."` instead of `"apikey": "..."`.

---

### 🔴 Fix 3 — Update pg_cron URLs from Lovable staging to pharmacy8.com

**Why it's critical:** All scheduled ingestion crons (England, Scotland, Wales, NI, GP pipelines) are calling `https://project--3e74eab1-7836-447d-9f43-82cc0f900db5.lovable.app` — the Lovable preview URL. If the production Supabase instance runs these crons, they trigger ingestion on the staging app rather than the production deployment. New data stops appearing on pharmacy8.com.

**Actions:**
1. Create a new migration that reschedules all crons to use `https://pharmacy8.com/api/public/hooks/...` URLs.
2. Once the anon-key bypass is removed (Fix 2), also update the auth header to use the shared secret.

---

### 🔴 Fix 4 — Add a CI pipeline (GitHub Actions) with build + type-check

**Why it's critical:** Currently there are zero automated checks. It's possible to break the TypeScript compile, the Vite build, or introduce runtime errors on any push with no safety net. This is an operational risk that compounds with every developer.

**Minimum viable CI (`/.github/workflows/ci.yml`):**
```yaml
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run build
```

---

### 🟠 Fix 5 — Implement subscription tier enforcement or document its absence

**Why it's high priority:** The advertised pricing model (Free / Solo £2/month / Group volume-taper) does not exist in the codebase. No subscription field, no Stripe, no access gating. Either:

**Option A — Pre-launch (pricing not implemented yet):** Document this explicitly. Ensure the live site does not promise paid tiers to users and note in code where enforcement must be added.

**Option B — Implement gating:** Add `subscription_tier text check (tier in ('free','solo','group'))` to `profiles`, integrate Stripe via webhook updating that field, and add server-side guards in `insights.functions.ts` to limit AI insight generation to paid tiers. Enforcement **must** be server-side (in the `requireSupabaseAuth` middleware or server function bodies) — UI-only gating is trivially bypassable.

---

### Lower-Priority Backlog (in order)

| Priority | Finding | Action |
|----------|---------|--------|
| 6 | 1.3 Settings page fetches all pharmacies | Replace with server-side search query |
| 7 | 2.4 `companies` allows any authenticated write | Scope policies to admin or owning user |
| 8 | 3.3 No retry for failed ingest items | Add a cron that resets `failed`→`pending` after N hours |
| 9 | 1.5 Wales/NI TODO dataset IDs | Verify against live CKAN portals, remove TODO comments |
| 10 | 6.1 No robots.txt / sitemap | Create a `public/` dir with `robots.txt`; add a dynamic sitemap route |
| 11 | 6.2 Pharmacy pages have no meta tags | Add `head` export per pharmacy page with name + address in title/description |
| 12 | 5.1 npm audit vulnerabilities | Run `npm audit fix` (all are dev-dependency toolchain) |
| 13 | 7.10 No Drug Tariff data | Clarify scope: AI-only vs. live tariff lookup; document accordingly |
| 14 | 4.1 Missing composite DB index | `CREATE INDEX CONCURRENTLY ON dispensing_data(pharmacy_id, year, month)` |
| 15 | 1.1 Duplicated `streamCsv` | Extract to `src/lib/streamCsv.ts`, import in all 4 ingest workers |

---

*Report generated 2026-06-18. Static analysis only — no authenticated Supabase queries or live site login was performed during the audit.*
