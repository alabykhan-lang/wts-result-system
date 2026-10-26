-- Result settings: registry defaults resolved per teacher scope, with result-system overrides.
-- Layer order (broad -> narrow): registry baseline, then result overrides at school -> stage -> class -> subject -> person.
-- Overrides never mutate the registry; they only win inside the result portal and are fully auditable.

create table if not exists public.school_result_setting_overrides (
  id uuid primary key default gen_random_uuid(),
  app_code text not null default 'results',
  scope_type text not null,
  scope_key text,
  setting_key text not null,
  setting_value jsonb not null,
  override_status text not null default 'active',
  reason text not null,
  created_by_person_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_by_person_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  constraint school_result_setting_overrides_scope_type_check
    check (scope_type in ('school', 'stage', 'class', 'subject', 'person')),
  constraint school_result_setting_overrides_scope_key_check
    check (
      (scope_type = 'school' and scope_key is null)
      or (scope_type <> 'school' and nullif(btrim(coalesce(scope_key, '')), '') is not null)
    ),
  constraint school_result_setting_overrides_setting_key_check
    check (setting_key ~ '^[A-Za-z][A-Za-z0-9_.:-]{1,80}$'),
  constraint school_result_setting_overrides_reason_check
    check (length(btrim(reason)) >= 8),
  constraint school_result_setting_overrides_status_check
    check (override_status in ('active', 'revoked'))
);

create unique index if not exists school_result_setting_overrides_active_uidx
  on public.school_result_setting_overrides (app_code, scope_type, coalesce(scope_key, ''), setting_key)
  where override_status = 'active';

create index if not exists school_result_setting_overrides_scope_idx
  on public.school_result_setting_overrides (app_code, scope_type, scope_key)
  where override_status = 'active';

alter table public.school_result_setting_overrides drop constraint if exists school_result_setting_overrides_setting_key_check;
alter table public.school_result_setting_overrides
  add constraint school_result_setting_overrides_setting_key_check
  check (setting_key ~ '^[A-Za-z][A-Za-z0-9_.:-]{1,80}$');

alter table public.school_result_setting_overrides enable row level security;

-- Resolution: registry baseline (operating mode, write policy for this person, portal feature defaults)
-- plus every active override whose scope matches the caller's class/subject/person context.
create or replace function public.school_result_settings_effective(
  p_person_id uuid,
  p_class_key text default null,
  p_subject_index integer default null,
  p_app_code text default 'results'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_app text := lower(trim(coalesce(p_app_code, 'results')));
  v_operating text;
  v_write boolean := false;
  v_features jsonb := '{}'::jsonb;
  v_perms text[] := array[]::text[];
  v_stage text;
  v_baseline jsonb;
  v_effective jsonb;
  v_provenance jsonb := '{}'::jsonb;
  v_overrides jsonb := '[]'::jsonb;
  v_config_overrides jsonb := '{}'::jsonb;
  v_row record;
begin
  select m.operating_mode into v_operating
  from public.school_module_operating_controls m
  where m.app_code = v_app;
  v_operating := coalesce(v_operating, 'read_only');

  if p_person_id is not null then
    v_write := coalesce(public.school_result_write_enabled(p_person_id), false);
    begin
      v_perms := coalesce(wts_internal.institutional_permissions(p_person_id, v_app), array[]::text[]);
    exception when others then
      v_perms := array[]::text[];
    end;
  end if;

  -- Feature defaults are capability-aware: a policy default of false still opens for an account
  -- holding the policy's minimum capability (or the wildcard), which is how the portal gates them.
  select coalesce(jsonb_object_agg(
           'feature.' || f.feature_code,
           to_jsonb(f.default_enabled or ('*' = any(v_perms)) or (f.minimum_capability = any(v_perms)))
         ), '{}'::jsonb)
  into v_features
  from public.school_portal_feature_policy f
  where f.app_code = v_app;

  if nullif(btrim(coalesce(p_class_key, '')), '') is not null then
    select c.stage_code into v_stage
    from public.school_classes c
    where c.class_key = btrim(p_class_key);
  end if;

  v_baseline := jsonb_build_object(
    'write.entry_enabled', (v_write and v_operating in ('active', 'pilot')),
    'module.operating_mode', v_operating
  ) || coalesce(v_features, '{}'::jsonb);

  if p_person_id is not null then
    v_baseline := v_baseline || jsonb_build_object(
      'scope.classes', (
        select coalesce(jsonb_agg(distinct s.class_key), '[]'::jsonb)
        from public.school_staff_access_scopes s
        where s.person_id = p_person_id and s.app_code = v_app and s.scope_status = 'active'
      ),
      'scope.subjects', (
        select coalesce(jsonb_agg(jsonb_build_object('class_key', s.class_key, 'subject_index', s.subject_index)
                                  order by s.class_key, s.subject_index), '[]'::jsonb)
        from public.school_staff_access_scopes s
        where s.person_id = p_person_id and s.app_code = v_app and s.scope_status = 'active'
          and s.scope_type = 'subject'
      )
    );
  end if;

  v_effective := v_baseline;

  select coalesce(jsonb_object_agg(k, jsonb_build_object('layer', 'registry', 'scope', 'school')), '{}'::jsonb)
  into v_provenance
  from jsonb_object_keys(v_baseline) as k;

  for v_row in
    select o.id, o.scope_type, o.scope_key, o.setting_key, o.setting_value, o.updated_at
    from public.school_result_setting_overrides o
    where o.app_code = v_app
      and o.override_status = 'active'
      and (
        o.scope_type = 'school'
        or (o.scope_type = 'stage' and v_stage is not null and o.scope_key = v_stage)
        or (o.scope_type = 'class' and nullif(btrim(coalesce(p_class_key, '')), '') is not null and o.scope_key = btrim(p_class_key))
        or (o.scope_type = 'subject'
            and nullif(btrim(coalesce(p_class_key, '')), '') is not null
            and p_subject_index is not null
            and o.scope_key = btrim(p_class_key) || '::' || p_subject_index::text)
        or (o.scope_type = 'person' and p_person_id is not null and o.scope_key = p_person_id::text)
      )
    order by case o.scope_type
               when 'school' then 0
               when 'stage' then 1
               when 'class' then 2
               when 'subject' then 3
               else 4
             end,
             o.updated_at
  loop
    v_effective := jsonb_set(v_effective, array[v_row.setting_key], v_row.setting_value, true);
    v_provenance := jsonb_set(
      v_provenance,
      array[v_row.setting_key],
      jsonb_build_object(
        'layer', 'result_override',
        'scope', v_row.scope_type,
        'scope_key', v_row.scope_key,
        'override_id', v_row.id,
        'updated_at', v_row.updated_at
      ),
      true
    );
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'scope_type', o.scope_type,
           'scope_key', o.scope_key,
           'setting_key', o.setting_key,
           'setting_value', o.setting_value,
           'reason', o.reason,
           'updated_at', o.updated_at
         ) order by o.scope_type, o.setting_key), '[]'::jsonb)
  into v_overrides
  from public.school_result_setting_overrides o
  where o.app_code = v_app
    and o.override_status = 'active';

  -- Any override whose key starts with "config." is a result-system app_config path
  -- (e.g. config.cards.showFees). Collect the winning values so the portal can merge them.
  select coalesce(jsonb_object_agg(
           substr(e.key, 8),
           e.value
         ), '{}'::jsonb)
  into v_config_overrides
  from jsonb_each(v_effective) as e(key, value)
  where e.key like 'config.%'
    and (v_provenance -> e.key ->> 'layer') = 'result_override';

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_SETTINGS_EFFECTIVE',
    'app_code', v_app,
    'person_id', p_person_id,
    'class_key', nullif(btrim(coalesce(p_class_key, '')), ''),
    'subject_index', p_subject_index,
    'stage', v_stage,
    'baseline', v_baseline,
    'effective', v_effective,
    'provenance', v_provenance,
    'overrides', v_overrides,
    'config_overrides', v_config_overrides
  );
end;
$function$;

-- Write path: create or replace an override. Registry capability gate is the same one that guards app_config updates.
create or replace function public.school_result_settings_override_set(
  p_session_id uuid,
  p_session_secret text,
  p_scope_type text,
  p_scope_key text,
  p_setting_key text,
  p_setting_value jsonb,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_scope text := lower(btrim(coalesce(p_scope_type, '')));
  v_key text := nullif(btrim(coalesce(p_scope_key, '')), '');
  v_setting text := btrim(coalesce(p_setting_key, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_person_id uuid;
  v_existing uuid;
  v_id uuid;
  v_subject_index integer;
begin
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'results.manage');
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  if v_scope not in ('school', 'stage', 'class', 'subject', 'person') then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SCOPE_INVALID');
  end if;
  if v_scope = 'school' then
    v_key := null;
  elsif v_key is null then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SCOPE_KEY_REQUIRED');
  end if;
  if v_setting = '' or v_setting !~ '^[A-Za-z][A-Za-z0-9_.:-]{1,80}$' then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SETTING_KEY_INVALID');
  end if;
  if p_setting_value is null then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_VALUE_REQUIRED');
  end if;
  if length(v_reason) < 8 then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_REASON_REQUIRED');
  end if;

  if v_scope = 'class' and not exists (
    select 1 from public.school_classes c where c.class_key = v_key and c.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_CLASS_NOT_FOUND');
  end if;

  if v_scope = 'stage' and not exists (
    select 1 from public.school_classes c where c.stage_code = v_key
  ) then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_STAGE_NOT_FOUND');
  end if;

  if v_scope = 'subject' then
    if position('::' in v_key) = 0 then
      return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SUBJECT_KEY_INVALID');
    end if;
    begin
      v_subject_index := nullif(split_part(v_key, '::', 2), '')::integer;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SUBJECT_KEY_INVALID');
    end;
    if v_subject_index is null or not exists (
      select 1 from public.result_subject_catalog s
      where s.class_key = split_part(v_key, '::', 1) and s.subject_index = v_subject_index and s.active
    ) then
      return jsonb_build_object('ok', false, 'code', 'OVERRIDE_SUBJECT_NOT_FOUND');
    end if;
  end if;

  if v_scope = 'person' then
    begin
      if not exists (select 1 from public.school_people p where p.id = v_key::uuid) then
        return jsonb_build_object('ok', false, 'code', 'OVERRIDE_PERSON_NOT_FOUND');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'OVERRIDE_PERSON_KEY_INVALID');
    end;
  end if;

  select o.id into v_existing
  from public.school_result_setting_overrides o
  where o.app_code = 'results'
    and o.scope_type = v_scope
    and coalesce(o.scope_key, '') = coalesce(v_key, '')
    and o.setting_key = v_setting
    and o.override_status = 'active'
  limit 1;

  if v_existing is not null then
    update public.school_result_setting_overrides
    set setting_value = p_setting_value,
        reason = v_reason,
        updated_at = now()
    where id = v_existing;
    v_id := v_existing;
  else
    insert into public.school_result_setting_overrides (
      app_code, scope_type, scope_key, setting_key, setting_value, reason, created_by_person_id
    ) values (
      'results', v_scope, v_key, v_setting, p_setting_value, v_reason, v_person_id
    )
    returning id into v_id;
  end if;

  insert into public.school_registry_audit (
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'result_session', v_person_id::text,
    case when v_existing is null then 'result.setting_override.created' else 'result.setting_override.updated' end,
    'school_result_setting_override', v_id::text,
    jsonb_build_object(
      'scope_type', v_scope,
      'scope_key', v_key,
      'setting_key', v_setting,
      'setting_value', p_setting_value,
      'reason', v_reason,
      'source', 'school_result_settings_override_set'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when v_existing is null then 'OVERRIDE_CREATED' else 'OVERRIDE_UPDATED' end,
    'override_id', v_id
  );
end;
$function$;

-- Write path: revoke an override. Rows are never deleted; history stays readable.
create or replace function public.school_result_settings_override_clear(
  p_session_id uuid,
  p_session_secret text,
  p_override_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_person_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.school_result_setting_overrides%rowtype;
begin
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'results.manage');
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  if length(v_reason) < 8 then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_REASON_REQUIRED');
  end if;

  select * into v_row
  from public.school_result_setting_overrides
  where id = p_override_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_NOT_FOUND');
  end if;
  if v_row.override_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'OVERRIDE_NOT_ACTIVE');
  end if;

  update public.school_result_setting_overrides
  set override_status = 'revoked',
      revoked_at = now(),
      revoked_by_person_id = v_person_id,
      revocation_reason = v_reason,
      updated_at = now()
  where id = p_override_id;

  insert into public.school_registry_audit (
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'result_session', v_person_id::text, 'result.setting_override.revoked',
    'school_result_setting_override', p_override_id::text,
    jsonb_build_object(
      'scope_type', v_row.scope_type,
      'scope_key', v_row.scope_key,
      'setting_key', v_row.setting_key,
      'reason', v_reason,
      'source', 'school_result_settings_override_clear'
    )
  );

  return jsonb_build_object('ok', true, 'code', 'OVERRIDE_REVOKED', 'override_id', p_override_id);
end;
$function$;
