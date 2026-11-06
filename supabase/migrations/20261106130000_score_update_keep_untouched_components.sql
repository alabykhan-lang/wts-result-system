-- Saving one score component no longer blanks the other components.
--
-- Before this migration every argument overwrote its column, so a save that
-- carried only the component being typed (for example CA2 from the CA2 tab)
-- wrote null over CA1 and left dashes on the report sheet. Now a null
-- argument keeps the stored value and only p_clear_components wipes a mark.
-- All-null still deletes the row.

drop function if exists public.school_result_score_update(uuid, text, uuid, text, integer, text, text, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.school_result_score_update(p_session_id uuid, p_session_secret text, p_student_id uuid, p_class_key text, p_subject_index integer, p_term text, p_academic_session text, p_ca1 numeric, p_ca2 numeric, p_ca3 numeric, p_exam numeric, p_clear_components text[] default '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_session jsonb;
  v_auth jsonb;
  v_person_id uuid;
  v_staff_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_before jsonb;
  v_after jsonb;
  v_score_id uuid;
  v_failure_code text;
  v_action_type text;
  v_current_class text;
  v_ca1 numeric;
  v_ca2 numeric;
  v_ca3 numeric;
  v_exam numeric;
begin
  v_session := public.school_identity_session_validate(
    p_session_id,
    p_session_secret,
    'results'
  );
  if coalesce((v_session ->> 'ok')::boolean, false) is not true then
    return v_session;
  end if;

  v_person_id := (v_session ->> 'person_id')::uuid;
  select s.id
    into v_staff_id
  from public.staff_attendance_profiles s
  where s.central_person_id = v_person_id
  order by s.id
  limit 1;

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
    insert into public.school_result_score_audit(
      request_id, actor_person_id, staff_id, student_id, class_key,
      subject_index, academic_session, term, component, action_type,
      source_application, success, failure_code
    ) values (
      v_request_id, v_person_id, v_staff_id, p_student_id, p_class_key,
      p_subject_index, p_academic_session, p_term, 'score_record',
      'score_write_rejected', 'result_portal', false,
      coalesce(v_auth ->> 'code', 'RESULT_SCORE_WRITE_REJECTED')
    );

    insert into public.school_registry_audit(
      actor_type, actor_id, action, entity_type, entity_id, request_id,
      details
    ) values (
      'result_session', v_person_id::text, 'result.score.write_failed',
      'scores', p_student_id::text, v_request_id,
      jsonb_build_object(
        'staff_id', v_staff_id,
        'person_id', v_person_id,
        'class_key', p_class_key,
        'subject_index', p_subject_index,
        'academic_session', p_academic_session,
        'term', p_term,
        'source_application', 'result_portal',
        'success', false,
        'failure_code', coalesce(v_auth ->> 'code', 'RESULT_SCORE_WRITE_REJECTED')
      )
    );

    return v_auth || jsonb_build_object('request_id', v_request_id);
  end if;

  if p_student_id is null
     or nullif(trim(coalesce(p_class_key, '')), '') is null
     or p_subject_index is null
     or p_subject_index < 0
     or nullif(trim(coalesce(p_term, '')), '') is null
     or nullif(trim(coalesce(p_academic_session, '')), '') is null then
    v_failure_code := 'RESULT_SCORE_PAYLOAD_INVALID';
  elsif not exists (
    select 1
    from public.result_subject_catalog r
    where r.class_key = trim(p_class_key)
      and r.subject_index = p_subject_index
  ) then
    v_failure_code := 'RESULT_SUBJECT_NOT_ASSIGNED';
  else
    select s.class_key
      into v_current_class
    from public.students s
    where s.id = p_student_id
      and coalesce(s.archived, false) = false;

    if v_current_class is null or v_current_class <> trim(p_class_key) then
      v_failure_code := 'RESULT_STUDENT_CLASS_MISMATCH';
    elsif (p_ca1 is not null and (p_ca1 < 0 or p_ca1 > 100))
       or (p_ca2 is not null and (p_ca2 < 0 or p_ca2 > 100))
       or (p_ca3 is not null and (p_ca3 < 0 or p_ca3 > 100))
       or (p_exam is not null and (p_exam < 0 or p_exam > 100)) then
      v_failure_code := 'RESULT_SCORE_RANGE_INVALID';
    end if;
  end if;

  if v_failure_code is not null then
    insert into public.school_result_score_audit(
      request_id, actor_person_id, staff_id, student_id, class_key,
      subject_index, academic_session, term, component, action_type,
      source_application, success, failure_code
    ) values (
      v_request_id, v_person_id, v_staff_id, p_student_id, p_class_key,
      p_subject_index, p_academic_session, p_term, 'score_record',
      'score_write_rejected', 'result_portal', false, v_failure_code
    );

    insert into public.school_registry_audit(
      actor_type, actor_id, action, entity_type, entity_id, request_id,
      details
    ) values (
      'result_session', v_person_id::text, 'result.score.write_failed',
      'scores', p_student_id::text, v_request_id,
      jsonb_build_object(
        'staff_id', v_staff_id,
        'person_id', v_person_id,
        'class_key', p_class_key,
        'subject_index', p_subject_index,
        'academic_session', p_academic_session,
        'term', p_term,
        'source_application', 'result_portal',
        'success', false,
        'failure_code', v_failure_code
      )
    );

    return jsonb_build_object(
      'ok', false,
      'code', v_failure_code,
      'request_id', v_request_id
    );
  end if;

  select to_jsonb(s), s.id
    into v_before, v_score_id
  from public.scores s
  where s.student_id = p_student_id
    and s.class_key = trim(p_class_key)
    and s.subject_index = p_subject_index
    and s.academic_session = trim(p_academic_session)
    and s.term = trim(p_term)
  for update;

  -- A null input means "leave this component as it was"; only an explicit
  -- clear entry wipes a component. This keeps component-only saves (for
  -- example CA2 alone) from erasing CA1, CA3 or exam.
  v_ca1 := case
    when 'ca1' = any(coalesce(p_clear_components, '{}'::text[])) then null
    when p_ca1 is not null then p_ca1
    else nullif(v_before ->> 'ca1', '')::numeric
  end;
  v_ca2 := case
    when 'ca2' = any(coalesce(p_clear_components, '{}'::text[])) then null
    when p_ca2 is not null then p_ca2
    else nullif(v_before ->> 'ca2', '')::numeric
  end;
  v_ca3 := case
    when 'ca3' = any(coalesce(p_clear_components, '{}'::text[])) then null
    when p_ca3 is not null then p_ca3
    else nullif(v_before ->> 'ca3', '')::numeric
  end;
  v_exam := case
    when 'exam' = any(coalesce(p_clear_components, '{}'::text[])) then null
    when p_exam is not null then p_exam
    else nullif(v_before ->> 'exam', '')::numeric
  end;

  begin
    if v_ca1 is null and v_ca2 is null and v_ca3 is null and v_exam is null then
      delete from public.scores
      where student_id = p_student_id
        and class_key = trim(p_class_key)
        and subject_index = p_subject_index
        and academic_session = trim(p_academic_session)
        and term = trim(p_term)
      returning id into v_score_id;
      v_after := null;
    else
      insert into public.scores(
        student_id, class_key, subject_index, academic_session, term, ca1, ca2, ca3, exam
      ) values (
        p_student_id, trim(p_class_key), p_subject_index, trim(p_academic_session), trim(p_term),
        v_ca1, v_ca2, v_ca3, v_exam
      )
      on conflict (student_id, class_key, subject_index, academic_session, term) do update
      set class_key = excluded.class_key,
          ca1 = v_ca1,
          ca2 = v_ca2,
          ca3 = v_ca3,
          exam = v_exam
      returning id into v_score_id;

      select to_jsonb(s)
        into v_after
      from public.scores s
      where s.id = v_score_id;
    end if;
  exception when others then
    insert into public.school_result_score_audit(
      request_id, actor_person_id, staff_id, student_id, class_key,
      subject_index, academic_session, term, component, action_type,
      old_record, source_application, success, failure_code
    ) values (
      v_request_id, v_person_id, v_staff_id, p_student_id, p_class_key,
      p_subject_index, p_academic_session, p_term, 'score_record',
      'score_write_failed', v_before, 'result_portal', false,
      'RESULT_SCORE_SAVE_FAILED'
    );

    insert into public.school_registry_audit(
      actor_type, actor_id, action, entity_type, entity_id, request_id,
      before_data, details
    ) values (
      'result_session', v_person_id::text, 'result.score.write_failed',
      'scores', coalesce(v_score_id, p_student_id)::text, v_request_id,
      v_before,
      jsonb_build_object(
        'staff_id', v_staff_id,
        'person_id', v_person_id,
        'class_key', p_class_key,
        'subject_index', p_subject_index,
        'academic_session', p_academic_session,
        'term', p_term,
        'source_application', 'result_portal',
        'success', false,
        'failure_code', 'RESULT_SCORE_SAVE_FAILED',
        'error_detail', SQLERRM
      )
    );

    return jsonb_build_object(
      'ok', false,
      'code', 'RESULT_SCORE_SAVE_FAILED',
      'error_detail', SQLERRM,
      'request_id', v_request_id
    );
  end;

  v_action_type := case
    when v_before is null then 'score_entry'
    when (v_before ->> 'ca1') is distinct from (v_after ->> 'ca1')
      or (v_before ->> 'ca2') is distinct from (v_after ->> 'ca2')
      or (v_before ->> 'ca3') is distinct from (v_after ->> 'ca3')
      or (v_before ->> 'exam') is distinct from (v_after ->> 'exam')
      then 'score_correction'
    else 'score_save_confirmed'
  end;

  insert into public.school_result_score_audit(
    request_id, actor_person_id, staff_id, student_id, class_key,
    subject_index, academic_session, term, component, old_value,
    new_value, old_record, new_record, action_type, source_application,
    success, failure_code
  )
  select
    v_request_id, v_person_id, v_staff_id, p_student_id, trim(p_class_key),
    p_subject_index, trim(p_academic_session), trim(p_term), x.component,
    x.old_value, x.new_value, v_before, v_after, v_action_type,
    'result_portal', true, null
  from (
    values
      ('ca1'::text, nullif(v_before ->> 'ca1', '')::numeric, nullif(v_after ->> 'ca1', '')::numeric),
      ('ca2'::text, nullif(v_before ->> 'ca2', '')::numeric, nullif(v_after ->> 'ca2', '')::numeric),
      ('ca3'::text, nullif(v_before ->> 'ca3', '')::numeric, nullif(v_after ->> 'ca3', '')::numeric),
      ('exam'::text, nullif(v_before ->> 'exam', '')::numeric, nullif(v_after ->> 'exam', '')::numeric)
  ) as x(component, old_value, new_value);

  insert into public.school_registry_audit(
    actor_type, actor_id, action, entity_type, entity_id, request_id,
    before_data, after_data, details
  ) values (
    'result_session', v_person_id::text,
    case when v_action_type = 'score_entry'
      then 'result.score.entered'
      else 'result.score.corrected'
    end,
    'scores', coalesce(v_score_id, (v_before->>'id')::uuid, p_student_id)::text, v_request_id, v_before, v_after,
    jsonb_build_object(
      'staff_id', v_staff_id,
      'person_id', v_person_id,
      'student_id', p_student_id,
      'class_key', trim(p_class_key),
      'subject_index', p_subject_index,
      'academic_session', trim(p_academic_session),
      'term', trim(p_term),
      'source_application', 'result_portal',
      'success', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_SCORE_SAVED',
    'request_id', v_request_id,
    'persisted', true,
    'student_id', p_student_id,
    'class_key', trim(p_class_key),
    'subject_index', p_subject_index,
    'term', trim(p_term),
    'academic_session', trim(p_academic_session),
    'score', jsonb_build_object(
      'id', coalesce(v_after ->> 'id', v_before ->> 'id'),
      'student_id', p_student_id,
      'class_key', trim(p_class_key),
      'subject_index', p_subject_index,
      'academic_session', trim(p_academic_session),
      'term', trim(p_term),
      'ca1', v_after -> 'ca1',
      'ca2', v_after -> 'ca2',
      'ca3', v_after -> 'ca3',
      'exam', v_after -> 'exam'
    )
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'code', 'RESULT_SCORE_SAVE_FAILED',
    'error_detail', SQLERRM,
    'request_id', v_request_id
  );
end;
$function$;

grant execute on function public.school_result_score_update(uuid, text, uuid, text, integer, text, text, numeric, numeric, numeric, numeric, text[]) to anon, authenticated, service_role;
