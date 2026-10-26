-- Session-scoped read of the resolved settings for an explicit class/subject context.
-- The settings page uses this to preview what a teacher in that class actually gets.

create or replace function public.school_result_settings_effective_read(
  p_session_id uuid,
  p_session_secret text,
  p_class_key text default null,
  p_subject_index integer default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_person_id uuid;
begin
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'identity.context');
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  return public.school_result_settings_effective(
    v_person_id,
    nullif(btrim(coalesce(p_class_key, '')), ''),
    p_subject_index,
    'results'
  );
end;
$function$;
