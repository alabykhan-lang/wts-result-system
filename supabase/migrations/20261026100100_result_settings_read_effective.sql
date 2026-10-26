-- Extend result settings read with registry defaults, effective values and provenance (additive; existing keys unchanged).
CREATE OR REPLACE FUNCTION public.school_result_settings_read(p_session_id uuid, p_session_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_auth jsonb;
  v_current jsonb;
  v_config jsonb := '{}'::jsonb;
  v_settings jsonb := '{}'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_final jsonb := '{}'::jsonb;
  v_scope_class text;
begin
  v_auth := public.school_result_authorize(
    p_session_id,
    p_session_secret,
    'identity.context'
  );
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;

  v_current := public.school_academic_current();

  select coalesce(value::jsonb, '{}'::jsonb) - 'geminiKey'
    into v_config
  from public.settings
  where key = 'app_config';

  v_config := jsonb_set(
    jsonb_set(
      coalesce(v_config, '{}'::jsonb),
      '{session}',
      to_jsonb(coalesce(v_current ->> 'academic_session', '')),
      true
    ),
    '{term}',
    to_jsonb(coalesce(v_current ->> 'term', '')),
    true
  );

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    into v_settings
  from public.settings
  where key in (
    'session', 'term', 'school_name', 'school_addr', 'school_phone',
    'school_email', 'card_theme', 'next_term_resumption'
  );

  v_settings := coalesce(v_settings, '{}'::jsonb) || jsonb_build_object(
    'session', coalesce(v_current ->> 'academic_session', ''),
    'term', coalesce(v_current ->> 'term', ''),
    'term_status', coalesce(v_current ->> 'term_status', 'open')
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'academic_session', x.academic_session,
      'term', x.term,
      'term_status', x.term_status,
      'is_current', x.is_current
    ) order by x.academic_session desc,
      case x.term when '1st Term' then 1 when '2nd Term' then 2 when '3rd Term' then 3 else 9 end
  ), '[]'::jsonb)
    into v_history
  from (
    select t.academic_session, t.term_name as term, t.term_status, t.is_current
    from public.school_academic_terms t
    union
    select h.academic_session, h.term, 'archived'::text, false
    from (
      select distinct s.academic_session, s.term from public.scores s
      union
      select distinct t.academic_session, t.term from public.traits t
      union
      select distinct r.academic_session, r.term from public.remarks r
      union
      select distinct f.academic_session, f.term from public.fees f
      union
      select distinct p.academic_session, p.term from public.published_subjects p
    ) h
    where not exists (
      select 1 from public.school_academic_terms t
      where t.academic_session = h.academic_session and t.term_name = h.term
    )
  ) x;

  select nullif(btrim(coalesce(c.class_key, '')), '')
    into v_scope_class
  from public.school_result_context c
  where c.session_id = p_session_id;

  v_final := public.school_result_settings_effective(
    (v_auth ->> 'person_id')::uuid,
    v_scope_class,
    null,
    'results'
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_SETTINGS_READ',
    'settings', jsonb_build_object(
      'app_config', coalesce(v_config, '{}'::jsonb),
      'safe', v_settings,
      'academic_context', jsonb_build_object(
        'academic_session', v_current ->> 'academic_session',
        'term', v_current ->> 'term',
        'term_status', v_current ->> 'term_status',
        'term_id', v_current -> 'term_id'
      ),
      'academic_history', v_history,
      'registry_defaults', coalesce(v_final -> 'baseline', '{}'::jsonb),
      'effective', coalesce(v_final -> 'effective', '{}'::jsonb),
      'provenance', coalesce(v_final -> 'provenance', '{}'::jsonb),
      'overrides', coalesce(v_final -> 'overrides', '[]'::jsonb),
      'config_overrides', coalesce(v_final -> 'config_overrides', '{}'::jsonb),
      'scope_context', jsonb_build_object(
        'class_key', v_scope_class,
        'stage', v_final -> 'stage',
        'person_id', v_auth ->> 'person_id'
      )
    )
  );
end;
$function$
