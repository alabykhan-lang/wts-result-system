-- Add Marketing to the Business arms (SS2 and SS3).
-- The subject sits after Livestock at index 9, so the existing indexes stay
-- unchanged and no stored score moves.

insert into public.result_subject_catalog
  (class_key, subject_index, subject_name, aliases, active)
values
  ('ss2-business', 9, 'Marketing', array['Marketing']::text[], true),
  ('ss3-business', 9, 'Marketing', array['Marketing']::text[], true)
on conflict (class_key, subject_index) do update
  set subject_name = excluded.subject_name,
      aliases = excluded.aliases,
      active = true,
      updated_at = now();
