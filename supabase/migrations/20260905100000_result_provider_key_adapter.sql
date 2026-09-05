-- Store and use the handwriting provider key through the existing protected
-- Result settings boundary. The key is never returned to browser code.

create or replace function public.school_result_provider_key_authorize(
  p_session_id uuid,
  p_session_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
begin
  v_auth := public.school_result_authorize(
    p_session_id,
    p_session_secret,
    'results.manage'
  );
  if coalesce((v_auth ->> 'ok')::boolean, false) is true then
    return v_auth;
  end if;

  return public.school_result_authorize(
    p_session_id,
    p_session_secret,
    'result_settings.manage'
  );
end;
$function$;

revoke all on function public.school_result_provider_key_authorize(uuid, text)
  from public, anon, authenticated;

create or replace function public.school_result_provider_key_update(
  p_session_id uuid,
  p_session_secret text,
  p_provider_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_config jsonb := '{}'::jsonb;
  v_key text := trim(coalesce(p_provider_key, ''));
begin
  if length(v_key) < 20 or length(v_key) > 512 or v_key ~ '[[:cntrl:][:space:]]' then
    return jsonb_build_object('ok', false, 'code', 'RESULT_PROVIDER_KEY_INVALID');
  end if;

  v_auth := public.school_result_provider_key_authorize(p_session_id, p_session_secret);
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;

  select value::jsonb into v_config
  from public.settings
  where key = 'app_config';
  v_config := case when jsonb_typeof(v_config) = 'object' then v_config else '{}'::jsonb end;
  v_config := jsonb_set(v_config, '{geminiKey}', to_jsonb(v_key), true);

  insert into public.settings(key, value)
  values ('app_config', v_config::text)
  on conflict (key) do update set value = excluded.value;

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, details
  )
  values (
    'result_session',
    v_auth ->> 'person_id',
    'result.provider_key.updated',
    'settings',
    'app_config',
    jsonb_build_object('provider', 'gemini', 'source', 'result_portal_settings')
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_PROVIDER_KEY_UPDATED',
    'configured', true,
    'key_hint', right(v_key, 4)
  );
end;
$function$;

create or replace function public.school_result_provider_key_status(
  p_session_id uuid,
  p_session_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_config jsonb := '{}'::jsonb;
  v_key text := '';
begin
  v_auth := public.school_result_provider_key_authorize(p_session_id, p_session_secret);
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;

  select value::jsonb into v_config
  from public.settings
  where key = 'app_config';
  if jsonb_typeof(v_config) = 'object' then
    v_key := trim(coalesce(v_config ->> 'geminiKey', ''));
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_PROVIDER_KEY_STATUS',
    'configured', length(v_key) > 0,
    'key_hint', case when length(v_key) >= 4 then right(v_key, 4) else null end
  );
end;
$function$;

create or replace function public.school_result_smart_provider_key_read(
  p_session_id uuid,
  p_session_secret text,
  p_class_key text,
  p_subject_index integer,
  p_academic_session text,
  p_term text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_config jsonb := '{}'::jsonb;
  v_key text := '';
begin
  v_auth := public.school_result_authorize(
    p_session_id,
    p_session_secret,
    'scores.enter',
    p_class_key,
    p_subject_index,
    p_academic_session,
    p_term
  );
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;

  select value::jsonb into v_config
  from public.settings
  where key = 'app_config';
  if jsonb_typeof(v_config) = 'object' then
    v_key := trim(coalesce(v_config ->> 'geminiKey', ''));
  end if;

  if v_key = '' then
    return jsonb_build_object('ok', false, 'code', 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED');
  end if;

  -- This response is consumed only by the protected server endpoint. It is
  -- never forwarded to the browser.
  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_PROVIDER_KEY_AVAILABLE',
    'provider_key', v_key
  );
end;
$function$;

revoke all on function public.school_result_provider_key_update(uuid, text, text)
  from public;
revoke all on function public.school_result_provider_key_status(uuid, text)
  from public;
revoke all on function public.school_result_smart_provider_key_read(uuid, text, text, integer, text, text)
  from public;
grant execute on function public.school_result_provider_key_update(uuid, text, text)
  to anon, authenticated, service_role;
grant execute on function public.school_result_provider_key_status(uuid, text)
  to anon, authenticated, service_role;
grant execute on function public.school_result_smart_provider_key_read(uuid, text, text, integer, text, text)
  to anon, authenticated, service_role;
