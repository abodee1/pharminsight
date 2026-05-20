ALTER TABLE public.dispensing_data
ADD COLUMN IF NOT EXISTS is_actual_payment boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_dispensing_data_is_actual_payment
  ON public.dispensing_data (is_actual_payment);