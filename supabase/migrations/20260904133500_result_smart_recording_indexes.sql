create index if not exists result_smart_sheets_actor_idx
  on public.result_smart_sheets (created_by_person_id, created_at desc);
