-- Fix archive_student_command.
--
-- 1. min(uuid) does not exist: use array_agg instead.
-- 2. The function moved class_key to 'archived::<class>', but that class does not
--    exist in school_classes, so the school_registry_after_student trigger raised
--    CLASS_NOT_FOUND. Archive now keeps class_key (like school_registry_student_write_api)
--    and records the state through archived/lifecycle_status/student number fields.

CREATE OR REPLACE FUNCTION public.archive_student_command(
  p_student_name text,
  p_class text,
  p_reason text DEFAULT NULL::text,
  p_session text DEFAULT NULL::text,
  p_actor text DEFAULT 'ChatGPT Control Center'::text,
  p_source text DEFAULT 'chat_command'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_class_key text;
  v_count int;
  v_student_id uuid;
  v_old jsonb;
  v_new public.students%rowtype;
begin
  v_class_key := public.make_db_class_key(p_class, p_session);

  select count(*), (array_agg(id))[1] into v_count, v_student_id
  from public.students
  where class_key = v_class_key
    and archived = false
    and public.result_clean_key(name) = public.result_clean_key(p_student_name);

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'message', 'Student not found in active class.', 'class_key', v_class_key);
  elsif v_count > 1 then
    return jsonb_build_object('ok', false, 'status', 'ambiguous', 'message', 'More than one student matched.');
  end if;

  select to_jsonb(st.*) into v_old from public.students st where id = v_student_id;

  update public.students
  set archived = true,
      archived_at = now(),
      archived_reason = p_reason,
      lifecycle_status = 'archived',
      previous_class_key = class_key,
      student_number_status = 'revoked',
      student_number_revoked_at = now(),
      student_number_revoked_reason = p_reason,
      updated_at = now()
  where id = v_student_id
  returning * into v_new;

  update public.student_cards
  set status = 'suspended',
      disabled_at = now(),
      disabled_reason = 'Student archived: ' || coalesce(p_reason, ''),
      updated_at = now()
  where student_id = v_student_id
    and status = 'active';

  insert into public.command_audit_log(action, actor, source, target_table, target_id, student_id, class_key, old_value, new_value, details)
  values ('archive_student', p_actor, p_source, 'students', v_student_id, v_student_id, v_class_key, v_old, to_jsonb(v_new), jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'status', 'success', 'message', 'Student archived successfully.', 'student_id', v_student_id, 'previous_class_key', v_class_key, 'student', to_jsonb(v_new));
end;
$function$;
