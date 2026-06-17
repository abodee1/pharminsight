ALTER TABLE public.ai_insights DROP CONSTRAINT IF EXISTS ai_insights_insight_type_check;
ALTER TABLE public.ai_insights ADD CONSTRAINT ai_insights_insight_type_check
  CHECK (insight_type = ANY (ARRAY[
    'swot','benchmark','trend','acquisition','acquisition_report',
    'opportunities','action_plan','income_quality','service_mix'
  ]));