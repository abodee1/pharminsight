alter table ai_insights
  drop constraint if exists ai_insights_type_check;

alter table ai_insights
  add constraint ai_insights_type_check
  check (insight_type in (
    'swot', 'benchmark', 'trend', 'acquisition', 'acquisition_report',
    'opportunities', 'action_plan', 'income_quality', 'service_mix'
  ));
