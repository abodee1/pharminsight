ALTER TABLE public.dispensing_data
  ADD COLUMN IF NOT EXISTS mcr_registrations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mcr_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supervised_methadone_doses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smoking_cessation_payment numeric NOT NULL DEFAULT 0;