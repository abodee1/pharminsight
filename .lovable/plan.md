## Goal
Ingest GP practice and prescribing data from the exact URLs you specified, schedule recurring pulls via pg_cron, and surface coverage in the admin panel.

## Database (new tables, all public-read; admin/cron writes via service role)

- `gp_practices` — `practice_code` (PK), `practice_name`, `country`, `health_board`, `postcode`, `status_code`
- `gp_prescribing` — `practice_code`, `year`, `month`, `country`, `total_items`, `total_nic`, `is_provisional`, unique on (practice_code, year, month, country)
- `gp_dispensing_by_pharmacy` — Scotland prescriber→pharmacy dispenser summary (`pharmacy_ods_code`, `year`, `month`, `items_dispensed`, `gross_cost`)
- `gp_pharmacy_linkage` — `practice_code`, `pharmacy_ods_code`, `year`, `month`, `items_dispensed`, `is_provisional` (Scotland quarterly)
- `gp_list_sizes` — `practice_code`, `list_size_date`, `registered_patients`, `country`
- Reuse existing `ingestion_queue` / `ingestion_log` for status (add new `source` values: `NHS_SCOT_GP`, `NHS_SCOT_LINKAGE`, `NHS_SCOT_LISTSIZE`, `NHSBSA_GP`, `NHSBSA_LISTSIZE`).

## Ingestion server routes (all under `/api/public/hooks/`)

Each route discovers resources via the CKAN/HTTPS URLs you provided (no hardcoded resource IDs), queues missing months/quarters, and processes one item per invocation (streaming CSV parser, batched upserts of 500). Errors recorded in `ingestion_log`.

1. `ingest-scotland-gp` — CKAN `prescriptions-in-the-community`. Discovers Prescriber Location + Dispenser Location files; skips "Data by Board".
2. `ingest-scotland-gp-linkage` — CKAN `prescribed-dispensed`. Quarterly → first month of quarter. Sets `is_provisional` for May 2023+.
3. `ingest-scotland-gp-listsize` — CKAN `gp-practice-populations`.
4. `ingest-england-gp` — CKAN `english-prescribing-data-epd-snomed` (Sep 2025+) and `english-prescribing-data-epd` (earlier). Streams ~1GB CSVs, aggregates `SUM(ITEMS)` by `(PRACTICE_CODE, PERIOD)` in memory per file, upserts.
5. `ingest-england-gp-listsize` — downloads `epraccur.zip` for practice directory (active only) + scrapes the latest "Patients Registered at a GP Practice" quarterly CSV link from the NHS Digital publications page.

Manual trigger via POST `?period=YYYYMM` (or `?quarter=YYYYQ#`) to ingest a specific period from the admin UI.

## Cron (pg_cron + pg_net)

| Job | Schedule (UTC) | Hook |
|---|---|---|
| scotland-gp-monthly | `30 9 11 * *` | `/api/public/hooks/ingest-scotland-gp` |
| scotland-gp-linkage-quarterly | `0 10 15 3,6,9,12 *` | `/api/public/hooks/ingest-scotland-gp-linkage` |
| scotland-gp-listsize-quarterly | `0 10 15 1,4,7,10 *` | `/api/public/hooks/ingest-scotland-gp-listsize` |
| england-gp-monthly | `0 6 20 * *` | `/api/public/hooks/ingest-england-gp` |
| england-gp-listsize-quarterly | `0 8 15 1,4,7,10 *` | `/api/public/hooks/ingest-england-gp-listsize` |

Auth uses the `apikey` header pattern (anon key), matching existing hooks.

## Admin UI

Add a "GP Data" tab to `/admin/data` (the existing `/_authenticated/admin/payments-import` page becomes tabbed, or a new `/admin/gp-data` route — I'll add a new sibling route to keep things clean). The tab shows a coverage grid from Jan 2020 → present with 5 rows:

- Scotland GP prescribing (monthly)
- Scotland GP-pharmacy linkage (quarterly)
- Scotland GP list sizes (quarterly)
- England GP prescribing (monthly)
- England GP list sizes (quarterly)

Cells colored from `ingestion_log` + `ingestion_queue`: green = success, red = failed, grey = absent (with a "Load" button POSTing to the matching hook with `?period=…`).

## Notes / caveats

- England monthly EPD CSVs are ~1GB. Streaming + per-file aggregation keeps memory bounded, but a single Worker invocation may exceed CPU/time limits for the largest months. If that happens I'll add chunked range-fetching as a follow-up — the schema and routes won't change.
- NHS Digital "Patients Registered at a GP Practice" doesn't expose a stable CSV URL, so I'll scrape the latest publication's "All patients by practice" link from the index page; if their HTML changes the route will log a `schema_alerts` entry.
- All new tables get `GRANT SELECT TO anon, authenticated` (public read, like existing `dispensing_data`) and `GRANT ALL TO service_role`.

Ship it?