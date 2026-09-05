-- Keep the Result Portal subject catalog aligned with the senior-secondary
-- configuration used by Smart Recording.  The existing subject indexes are
-- preserved; only missing rows are added.

insert into public.result_subject_catalog
  (class_key, subject_index, subject_name, aliases, active)
values
  ('ss3-arts', 9, 'Livestock Farming', array['Livestock']::text[], true),
  ('ss3-business', 0, 'English Language', array[]::text[], true),
  ('ss3-business', 1, 'Mathematics', array[]::text[], true),
  ('ss3-business', 2, 'Digital Technology', array[]::text[], true),
  ('ss3-business', 3, 'Economics', array[]::text[], true),
  ('ss3-business', 4, 'Citizenship & Heritage Studies', array['Citizenship/Civic Education']::text[], true),
  ('ss3-business', 5, 'Financial Accounting', array[]::text[], true),
  ('ss3-business', 6, 'Commerce', array[]::text[], true),
  ('ss3-business', 7, 'Government', array[]::text[], true),
  ('ss3-business', 8, 'Livestock', array['Livestock Farming']::text[], true)
on conflict (class_key, subject_index) do update
  set active = true,
      aliases = case
        when excluded.subject_name in ('Livestock', 'Livestock Farming')
          then array['Livestock','Livestock Farming']::text[]
        when excluded.subject_name = 'Citizenship & Heritage Studies'
          then array['Citizenship/Civic Education']::text[]
        else public.result_subject_catalog.aliases
      end,
      updated_at = now();

-- Add the shared-subject aliases to the rows already present in the catalog.
update public.result_subject_catalog
set aliases = array['Livestock','Livestock Farming']::text[], updated_at = now()
where class_key in ('ss2-science','ss2-arts','ss2-business','ss3-science','ss3-arts')
  and lower(regexp_replace(subject_name, '[^a-zA-Z0-9]', '', 'g')) in ('livestock','livestockfarming');

update public.result_subject_catalog
set aliases = array['Citizenship/Civic Education']::text[], updated_at = now()
where class_key in ('ss2-science','ss2-arts','ss2-business','ss3-science','ss3-arts','ss3-business')
  and lower(regexp_replace(subject_name, '[^a-zA-Z0-9]', '', 'g')) = 'citizenshipheritagestudies';
