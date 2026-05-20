
ALTER TABLE public.dispensing_data
  ADD COLUMN IF NOT EXISTS pharmacy_first_payment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mcr_payment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ehc_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS methadone_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smoking_cessation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_payment numeric NOT NULL DEFAULT 0;
