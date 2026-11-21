-- Agent write keys for the result portal.
--
-- An outside assistant (Muse, or any automation) cannot sign in to the portal:
-- the public login is SSO only and the scores table only accepts writes from
-- the school's server. A key minted here lets it post marks through the same
-- server paths, scoped to the classes it was given, with every write logged
-- against the person who created the key.

create table if not exists public.result_agent_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key_prefix text not null,
  key_hash text not null unique,
  class_scope text[] not null,
  subject_scope text[],
  can_clear boolean not null default true,
  enabled boolean not null default true,
  created_by_person_id uuid not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_source text,
  use_count bigint not null default 0,
  revoked_at timestamptz,
  revocation_reason text
);

create index if not exists result_agent_keys_hash_idx on public.result_agent_keys (key_hash);

alter table public.result_agent_keys enable row level security;
drop policy if exists result_agent_keys_server_only on public.result_agent_keys;
create policy result_agent_keys_server_only on public.result_agent_keys
  for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------- key issuing

create or replace function public.school_result_agent_key_create(
  p_session_id uuid,
  p_session_secret text,
  p_label text,
  p_class_scope text[],
  p_subject_scope text[] default null,
  p_can_clear boolean default true
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
  v_id uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'results.manage');
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  if v_label is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_LABEL_REQUIRED');
  end if;

  select array_agg(distinct btrim(c)) into v_scope
  from unnest(coalesce(p_class_scope, array[]::text[])) as c
  where nullif(btrim(c), '') is not null;

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
    label, key_prefix, key_hash, class_scope, subject_scope, can_clear, created_by_person_id
  ) values (
    v_label, v_prefix, encode(digest(v_key, 'sha256'), 'hex'), v_scope, v_subject_scope,
    coalesce(p_can_clear, true), v_person_id
  ) returning id into v_id;

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'result_session', v_person_id::text, 'result.agent_key.created', 'result_agent_keys', v_id::text,
    jsonb_build_object('label', v_label, 'prefix', v_prefix, 'class_scope', v_scope,
                       'subject_scope', v_subject_scope, 'can_clear', coalesce(p_can_clear, true))
  );

  -- The key itself is returned once and never stored in clear text.
  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_AGENT_KEY_CREATED',
    'key', v_key,
    'id', v_id,
    'prefix', v_prefix,
    'label', v_label,
    'class_scope', v_scope,
    'subject_scope', v_subject_scope,
    'can_clear', coalesce(p_can_clear, true)
  );
end;
$function$;

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
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'results.manage');
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

create or replace function public.school_result_agent_key_revoke(
  p_session_id uuid,
  p_session_secret text,
  p_key_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_auth jsonb;
  v_person_id uuid;
  v_id uuid;
begin
  v_auth := public.school_result_authorize(p_session_id, p_session_secret, 'results.manage');
  if coalesce((v_auth ->> 'ok')::boolean, false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth ->> 'person_id')::uuid;

  update public.result_agent_keys
  set enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      revocation_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), revocation_reason)
  where id = p_key_id
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_NOT_FOUND');
  end if;

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    'result_session', v_person_id::text, 'result.agent_key.revoked', 'result_agent_keys', v_id::text,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'code', 'RESULT_AGENT_KEY_REVOKED', 'id', v_id);
end;
$function$;

-- ---------------------------------------------------------------- key gate

create or replace function public.result_agent_key_resolve(p_key text)
returns public.result_agent_keys
language sql
stable
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
  select k.*
  from public.result_agent_keys k
  where coalesce(p_key, '') <> ''
    and k.key_hash = encode(digest(p_key, 'sha256'), 'hex')
    and k.enabled
    and k.revoked_at is null
  limit 1;
$function$;

-- ---------------------------------------------------------------- read

create or replace function public.school_result_agent_roster(
  p_key text,
  p_class_key text,
  p_term text,
  p_academic_session text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_key public.result_agent_keys;
  v_class text := btrim(coalesce(p_class_key, ''));
begin
  v_key := public.result_agent_key_resolve(p_key);
  if v_key.id is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_INVALID');
  end if;

  if v_class = '' or not (v_class = any(v_key.class_scope)) then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_CLASS_DENIED', 'class_key', v_class);
  end if;

  update public.result_agent_keys
  set last_used_at = now(), last_used_source = 'roster', use_count = use_count + 1
  where id = v_key.id;

  return jsonb_build_object(
    'ok', true,
    'class_key', v_class,
    'term', p_term,
    'academic_session', p_academic_session,
    'can_clear', v_key.can_clear,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('index', r.subject_index, 'name', r.subject_name)
                       order by r.subject_index)
      from public.result_subject_catalog r
      where r.class_key = v_class
        and (v_key.subject_scope is null or r.subject_name = any(v_key.subject_scope))
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'name', s.name,
        'admno', s.admno,
        'ca1', sc.ca1, 'ca2', sc.ca2, 'ca3', sc.ca3, 'exam', sc.exam
      ) order by s.name)
      from public.students s
      left join public.scores sc
        on sc.student_id = s.id
       and sc.class_key = v_class
       and sc.term = p_term
       and sc.academic_session = p_academic_session
      where s.class_key = v_class
        and coalesce(s.archived, false) = false
        and coalesce(s.lifecycle_status, 'active') = 'active'
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------- write

create or replace function public.school_result_agent_score_update(
  p_key text,
  p_student_id uuid,
  p_class_key text,
  p_subject_index integer,
  p_term text,
  p_academic_session text,
  p_ca1 numeric default null,
  p_ca2 numeric default null,
  p_ca3 numeric default null,
  p_exam numeric default null,
  p_clear_components text[] default '{}'::text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  v_key public.result_agent_keys;
  v_class text := btrim(coalesce(p_class_key, ''));
  v_term text := btrim(coalesce(p_term, ''));
  v_session text := btrim(coalesce(p_academic_session, ''));
  v_subject_name text;
  v_before jsonb;
  v_after jsonb;
  v_score_id uuid;
  v_ca1 numeric;
  v_ca2 numeric;
  v_ca3 numeric;
  v_exam numeric;
  v_clear text[];
  v_request_id uuid := gen_random_uuid();
  v_failure text;
  v_current_class text;
  v_mode text;
begin
  v_key := public.result_agent_key_resolve(p_key);
  if v_key.id is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_AGENT_KEY_INVALID');
  end if;

  v_clear := coalesce(array(
    select lower(btrim(c)) from unnest(coalesce(p_clear_components, array[]::text[])) as c
    where lower(btrim(c)) in ('ca1', 'ca2', 'ca3', 'exam')
  ), array[]::text[]);

  if v_class = '' or not (v_class = any(v_key.class_scope)) then
    v_failure := 'RESULT_AGENT_CLASS_DENIED';
  elsif v_key.subject_scope is not null then
    select r.subject_name into v_subject_name
    from public.result_subject_catalog r
    where r.class_key = v_class and r.subject_index = p_subject_index;
    if v_subject_name is null or not (v_subject_name = any(v_key.subject_scope)) then
      v_failure := 'RESULT_AGENT_SUBJECT_DENIED';
    end if;
  end if;

  if v_failure is null then
    select operating_mode into v_mode
    from public.school_module_operating_controls where app_code = 'results';
    if coalesce(v_mode, 'read_only') = 'read_only' then
      v_failure := 'RESULT_OPERATING_MODE_READ_ONLY';
    end if;
  end if;

  if v_failure is null then
    if p_student_id is null or p_subject_index is null or p_subject_index < 0
       or v_term = '' or v_session = '' then
      v_failure := 'RESULT_SCORE_PAYLOAD_INVALID';
    elsif not exists (
      select 1 from public.school_academic_terms t
      where t.academic_session = v_session and t.term_name = v_term and t.term_status = 'open'
    ) then
      v_failure := 'RESULT_TERM_NOT_ACTIVE';
    elsif not exists (
      select 1 from public.result_subject_catalog r
      where r.class_key = v_class and r.subject_index = p_subject_index
    ) then
      v_failure := 'RESULT_SUBJECT_NOT_ASSIGNED';
    else
      select s.class_key into v_current_class
      from public.students s
      where s.id = p_student_id and coalesce(s.archived, false) = false;
      if v_current_class is null or v_current_class <> v_class then
        v_failure := 'RESULT_STUDENT_CLASS_MISMATCH';
      elsif (p_ca1 is not null and (p_ca1 < 0 or p_ca1 > 100))
         or (p_ca2 is not null and (p_ca2 < 0 or p_ca2 > 100))
         or (p_ca3 is not null and (p_ca3 < 0 or p_ca3 > 100))
         or (p_exam is not null and (p_exam < 0 or p_exam > 100)) then
        v_failure := 'RESULT_SCORE_RANGE_INVALID';
      elsif array_length(v_clear, 1) is not null and not v_key.can_clear then
        v_failure := 'RESULT_AGENT_CLEAR_NOT_ALLOWED';
      end if;
    end if;
  end if;

  if v_failure is not null then
    insert into public.school_result_score_audit(
      request_id, actor_person_id, student_id, class_key, subject_index,
      academic_session, term, component, action_type, source_application,
      success, failure_code, audit_metadata
    ) values (
      v_request_id, v_key.created_by_person_id, p_student_id, v_class, p_subject_index,
      v_session, v_term, 'score_record', 'score_write_rejected', 'agent_key',
      false, v_failure,
      jsonb_build_object('agent_key_id', v_key.id, 'agent_key_label', v_key.label,
                         'agent_key_prefix', v_key.key_prefix)
    );
    return jsonb_build_object('ok', false, 'code', v_failure, 'request_id', v_request_id);
  end if;

  select to_jsonb(s), s.id into v_before, v_score_id
  from public.scores s
  where s.student_id = p_student_id
    and s.class_key = v_class
    and s.subject_index = p_subject_index
    and s.academic_session = v_session
    and s.term = v_term
  for update;

  -- Same rule as the portal: a null keeps the stored mark, only an explicit
  -- clear erases it.
  v_ca1 := case when 'ca1' = any(v_clear) then null
                when p_ca1 is not null then p_ca1
                else nullif(v_before ->> 'ca1', '')::numeric end;
  v_ca2 := case when 'ca2' = any(v_clear) then null
                when p_ca2 is not null then p_ca2
                else nullif(v_before ->> 'ca2', '')::numeric end;
  v_ca3 := case when 'ca3' = any(v_clear) then null
                when p_ca3 is not null then p_ca3
                else nullif(v_before ->> 'ca3', '')::numeric end;
  v_exam := case when 'exam' = any(v_clear) then null
                 when p_exam is not null then p_exam
                 else nullif(v_before ->> 'exam', '')::numeric end;

  begin
    if v_ca1 is null and v_ca2 is null and v_ca3 is null and v_exam is null then
      delete from public.scores
      where student_id = p_student_id and class_key = v_class
        and subject_index = p_subject_index and academic_session = v_session and term = v_term
      returning id into v_score_id;
      v_after := null;
    else
      insert into public.scores(student_id, class_key, subject_index, academic_session, term, ca1, ca2, ca3, exam)
      values (p_student_id, v_class, p_subject_index, v_session, v_term, v_ca1, v_ca2, v_ca3, v_exam)
      on conflict (student_id, class_key, subject_index, academic_session, term) do update
      set ca1 = v_ca1, ca2 = v_ca2, ca3 = v_ca3, exam = v_exam
      returning id into v_score_id;

      select to_jsonb(s) into v_after from public.scores s where s.id = v_score_id;
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'RESULT_SCORE_SAVE_FAILED',
                              'error_detail', SQLERRM, 'request_id', v_request_id);
  end;

  insert into public.school_result_score_audit(
    request_id, actor_person_id, student_id, class_key, subject_index,
    academic_session, term, component, old_value, new_value, old_record, new_record,
    action_type, source_application, success, audit_metadata
  )
  select v_request_id, v_key.created_by_person_id, p_student_id, v_class, p_subject_index,
         v_session, v_term, x.component, x.old_value, x.new_value, v_before, v_after,
         case when v_before is null then 'score_entry' else 'score_correction' end,
         'agent_key', true,
         jsonb_build_object('agent_key_id', v_key.id, 'agent_key_label', v_key.label,
                            'agent_key_prefix', v_key.key_prefix)
  from (values
    ('ca1'::text, nullif(v_before ->> 'ca1', '')::numeric, nullif(v_after ->> 'ca1', '')::numeric),
    ('ca2'::text, nullif(v_before ->> 'ca2', '')::numeric, nullif(v_after ->> 'ca2', '')::numeric),
    ('ca3'::text, nullif(v_before ->> 'ca3', '')::numeric, nullif(v_after ->> 'ca3', '')::numeric),
    ('exam'::text, nullif(v_before ->> 'exam', '')::numeric, nullif(v_after ->> 'exam', '')::numeric)
  ) as x(component, old_value, new_value);

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, request_id, before_data, after_data, details
  ) values (
    'agent_key', v_key.id::text,
    case when v_before is null then 'result.score.entered' else 'result.score.corrected' end,
    'scores', coalesce(v_score_id, (v_before ->> 'id')::uuid, p_student_id)::text,
    v_request_id, v_before, v_after,
    jsonb_build_object('agent_key_id', v_key.id, 'agent_key_label', v_key.label,
                       'agent_key_prefix', v_key.key_prefix,
                       'created_by_person_id', v_key.created_by_person_id,
                       'student_id', p_student_id, 'class_key', v_class,
                       'subject_index', p_subject_index, 'academic_session', v_session,
                       'term', v_term, 'source_application', 'agent_key', 'success', true)
  );

  update public.result_agent_keys
  set last_used_at = now(), last_used_source = 'scores.write', use_count = use_count + 1
  where id = v_key.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_SCORE_SAVED',
    'persisted', true,
    'request_id', v_request_id,
    'student_id', p_student_id,
    'class_key', v_class,
    'subject_index', p_subject_index,
    'term', v_term,
    'academic_session', v_session,
    'cleared', to_jsonb(v_clear),
    'score', jsonb_build_object(
      'ca1', v_after -> 'ca1',
      'ca2', v_after -> 'ca2',
      'ca3', v_after -> 'ca3',
      'exam', v_after -> 'exam'
    )
  );
end;
$function$;

revoke all on function public.result_agent_key_resolve(text) from anon, authenticated;
grant execute on function public.school_result_agent_key_create(uuid, text, text, text[], text[], boolean) to anon, authenticated, service_role;
grant execute on function public.school_result_agent_key_list(uuid, text) to anon, authenticated, service_role;
grant execute on function public.school_result_agent_key_revoke(uuid, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.school_result_agent_roster(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.school_result_agent_score_update(text, uuid, text, integer, text, text, numeric, numeric, numeric, numeric, text[]) to anon, authenticated, service_role;
