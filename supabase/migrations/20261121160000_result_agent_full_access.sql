-- Full-access agent keys.
--
-- A key can be issued for marks only, or for the owner's own account: the
-- assistant then gets a short-lived session for the app it asks for, and can
-- do whatever that account can do there. Sessions are minted per call, expire
-- after eight hours, and every mint and every action is logged.

alter table public.result_agent_keys
  add column if not exists access_level text not null default 'scores';

alter table public.result_agent_keys
  drop constraint if exists result_agent_keys_access_level_check;
alter table public.result_agent_keys
  add constraint result_agent_keys_access_level_check
  check (access_level in ('scores', 'full'));

-- Creation gains the access level. The existing five-argument signature stays
-- valid for the marks-only callers.
create or replace function public.school_result_agent_key_create(
  p_session_id uuid,
  p_session_secret text,
  p_label text,
  p_class_scope text[],
  p_subject_scope text[] default null,
  p_can_clear boolean default true,
  p_access_level text default 'scores'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_person_id uuid;
  v_auth jsonb;
  v_key text;
  v_prefix text;
  v_scope text[];
  v_subject_scope text[];
  v_level text := lower(btrim(coalesce(p_access_level, 'scores')));
  v_id uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  v_auth := public.school_result_agent_key_authorize(p_session_id, p_session_secret);
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  if v_label is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_LABEL_REQUIRED');
  end if;

  if v_level not in ('scores', 'full') then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_LEVEL_INVALID');
  end if;

  -- A full-access key works as the account that created it, so only a global
  -- manager may issue one.
  if v_level = 'full'
     and not public.school_result_permission_allowed(
       coalesce(array(select jsonb_array_elements_text(v_auth -> 'permissions')), array[]::text[]),
       'results.manage'
     ) then
    return jsonb_build_object('ok', false, 'code', 'RESULT_PERMISSION_DENIED');
  end if;

  select array_agg(distinct btrim(c)) into v_scope
  from unnest(coalesce(p_class_scope, array[]::text[])) as c
  where nullif(btrim(c), '') is not null;

  if v_level = 'full' and (v_scope is null or array_length(v_scope, 1) is null) then
    -- A full key covers the whole school, but keep the column populated so the
    -- marks-only reader path still has a usable scope.
    v_scope := array(select c.class_key from public.school_classes c where c.is_active order by c.sort_order);
  end if;

  if v_scope is null or array_length(v_scope, 1) is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_SCOPE_REQUIRED');
  end if;

  if exists (
    select 1 from unnest(v_scope) as c(class_key)
    where not exists (
      select 1 from public.result_subject_catalog r where r.class_key = c.class_key
    )
    and not exists (
      select 1 from public.school_classes s where s.class_key = c.class_key
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_SCOPE_UNKNOWN');
  end if;

  select array_agg(distinct btrim(s)) into v_subject_scope
  from unnest(coalesce(p_subject_scope, array[]::text[])) as s
  where nullif(btrim(s), '') is not null;

  v_key := 'wtsak_' || encode(gen_random_bytes(24), 'hex');
  v_prefix := left(v_key, 14);

  insert into public.result_agent_keys(
    label, key_prefix, key_hash, class_scope, subject_scope, can_clear, created_by_person_id, access_level
  ) values (
    v_label, v_prefix, encode(digest(v_key, 'sha256'), 'hex'), v_scope, v_subject_scope,
    coalesce(p_can_clear, true), v_person_id, v_level
  ) returning id into v_id;

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'result_session', v_person_id::text, 'result.agent_key.created', 'result_agent_keys', v_id::text,
    jsonb_build_object('label', v_label, 'prefix', v_prefix, 'class_scope', v_scope,
                       'subject_scope', v_subject_scope, 'can_clear', coalesce(p_can_clear, true),
                       'access_level', v_level)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_AGENT_KEY_CREATED',
    'key', v_key,
    'id', v_id,
    'prefix', v_prefix,
    'label', v_label,
    'class_scope', v_scope,
    'subject_scope', v_subject_scope,
    'can_clear', coalesce(p_can_clear, true),
    'access_level', v_level
  );
end;
$function$;

-- Listing shows the level.
create or replace function public.school_result_agent_key_list(
  p_session_id uuid,
  p_session_secret text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
begin
  v_auth := public.school_result_agent_key_authorize(p_session_id, p_session_secret);
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;

  return jsonb_build_object(
    'ok', true,
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'label', k.label,
        'prefix', k.key_prefix,
        'class_scope', k.class_scope,
        'subject_scope', k.subject_scope,
        'can_clear', k.can_clear,
        'access_level', k.access_level,
        'enabled', k.enabled and k.revoked_at is null,
        'created_at', k.created_at,
        'last_used_at', k.last_used_at,
        'use_count', k.use_count,
        'revoked_at', k.revoked_at
      ) order by k.created_at desc)
      from public.result_agent_keys k
    ), '[]'::jsonb)
  );
end;
$function$;

-- Mint a session for the key's owner.
create or replace function public.school_agent_session(
  p_key text,
  p_app_code text default 'results'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_key public.result_agent_keys;
  v_app text := lower(btrim(coalesce(p_app_code, 'results')));
  v_person public.school_people%rowtype;
  v_staff public.staff_attendance_profiles%rowtype;
  v_account public.school_identity_accounts%rowtype;
  v_credential public.school_identity_credentials%rowtype;
  v_secret text;
  v_session_id uuid := gen_random_uuid();
  v_expires timestamptz := now() + interval '8 hours';
begin
  v_key := public.result_agent_key_resolve(p_key);
  if v_key.id is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_INVALID');
  end if;

  if v_key.access_level <> 'full' then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_SCORES_ONLY');
  end if;

  if v_app not in ('results', 'central_registry') then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_APP_INVALID');
  end if;

  select * into v_person from public.school_people where id = v_key.created_by_person_id;
  select * into v_staff from public.staff_attendance_profiles where central_person_id = v_key.created_by_person_id limit 1;
  select * into v_account from public.school_identity_accounts where person_id = v_key.created_by_person_id and account_status = 'active' limit 1;
  select * into v_credential from public.school_identity_credentials where person_id = v_key.created_by_person_id and credential_status = 'active' order by created_at limit 1;

  if v_person.id is null or v_person.person_status <> 'active'
     or v_staff.id is null or v_staff.registration_status <> 'active' or v_staff.employment_status <> 'active'
     or v_account.id is null or v_credential.id is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_OWNER_NOT_ACTIVE');
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.school_identity_sessions(
    id, person_id, identity_account_id, originating_app_code, target_app_code,
    secret_hash, created_at, expires_at, last_seen_at, metadata
  ) values (
    v_session_id, v_person.id, v_account.id, 'agent_key', v_app,
    encode(digest(v_secret, 'sha256'), 'hex'), now(), v_expires, now(),
    jsonb_build_object('agent_key_id', v_key.id, 'agent_key_label', v_key.label,
                       'agent_key_prefix', v_key.key_prefix)
  );

  update public.result_agent_keys
  set last_used_at = now(), last_used_source = 'session:' || v_app, use_count = use_count + 1
  where id = v_key.id;

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'agent_key', v_key.id::text, 'result.agent_key.session', 'school_identity_sessions', v_session_id::text,
    jsonb_build_object('app_code', v_app, 'person_id', v_person.id, 'expires_at', v_expires,
                       'agent_key_label', v_key.label, 'agent_key_prefix', v_key.key_prefix)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_AGENT_SESSION_CREATED',
    'session_id', v_session_id,
    'session_secret', v_secret,
    'app_code', v_app,
    'person_id', v_person.id,
    'expires_at', v_expires
  );
end;
$function$;

grant execute on function public.school_agent_session(text, text) to anon, authenticated, service_role;
grant execute on function public.school_result_agent_key_create(uuid, text, text, text[], text[], boolean, text) to anon, authenticated, service_role;
