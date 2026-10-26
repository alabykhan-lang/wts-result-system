-- Honour scoped result settings overrides in the write gate: a class/subject freeze wins over the registry default.
CREATE OR REPLACE FUNCTION public.school_result_authorize(p_session_id uuid, p_session_secret text, p_action text, p_class_key text DEFAULT NULL::text, p_subject_index integer DEFAULT NULL::integer, p_academic_session text DEFAULT NULL::text, p_term text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_session jsonb;
  v_identity jsonb;
  v_person_id uuid;
  v_identity_account_id uuid;
  v_permissions text[];
  v_access_role text;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_requires_scope boolean := false;
  v_broad_access boolean := false;
  v_class_scope boolean := false;
  v_subject_scope boolean := false;
  v_context_required boolean := false;
  v_current jsonb;
  v_write_gate jsonb;
  v_operating_mode text := 'read_only';
  v_hold_exempt boolean := false;
  v_write_enabled boolean := false;
  v_can_write boolean := false;
  v_entry_action boolean := false;
begin
  v_session := public.school_identity_session_validate(p_session_id, p_session_secret, 'results');
  if coalesce((v_session ->> 'ok')::boolean, false) is not true then
    return v_session;
  end if;

  v_person_id := (v_session ->> 'person_id')::uuid;
  v_identity_account_id := (v_session ->> 'identity_account_id')::uuid;
  v_permissions := coalesce(array(select jsonb_array_elements_text(v_session -> 'permissions')), array[]::text[]);
  v_access_role := v_session ->> 'access_role';
  
  v_identity := public.school_result_identity_resolve(v_person_id, v_identity_account_id);
  if coalesce((v_identity ->> 'ok')::boolean, false) is not true then
    return v_identity;
  end if;

  select operating_mode into v_operating_mode
  from public.school_module_operating_controls
  where app_code = 'results';
  v_operating_mode := coalesce(v_operating_mode, 'read_only');
  v_hold_exempt := wts_internal.school_registry_is_protected_actor(v_person_id);

  v_entry_action := v_action in (
    'scores.enter', 'smart.sheet.create', 'smart.scores.commit',
    'traits.enter', 'remarks.enter', 'fees.update'
  );
  
  v_write_enabled := v_hold_exempt
    or public.school_result_permission_allowed(v_permissions, 'results.manage')
    or public.school_result_write_enabled(v_person_id);

  -- Scoped write freeze: a class/subject-level override beats the registry default, for everyone.
  if nullif(btrim(coalesce(p_class_key, '')), '') is not null then
    if coalesce(
         (public.school_result_settings_effective(v_person_id, p_class_key, p_subject_index, 'results')
            -> 'effective' ->> 'write.entry_enabled')::boolean,
         v_write_enabled
       ) is not true then
      v_write_enabled := false;
    end if;
  end if;
  
  v_can_write := v_write_enabled and (
    public.school_result_permission_allowed(v_permissions, 'scores.enter')
    or public.school_result_permission_allowed(v_permissions, 'results.manage')
  );

  if not v_can_write then
    v_permissions := array(
      select distinct x.permission
      from unnest(v_permissions) as x(permission)
      where x.permission not in (
        'scores.enter', 'result_entry.create', 'result_entry.edit',
        'result_entry.submit', 'traits.enter', 'remarks.enter', 'fees.update'
      )
    );
  end if;

  if v_action = 'identity.context' then
    return jsonb_build_object(
      'ok', true,
      'code', 'RESULT_AUTHORIZED',
      'person_id', v_person_id,
      'identity_account_id', v_identity_account_id,
      'access_role', v_access_role,
      'permissions', v_permissions,
      'result_user', v_identity -> 'result_user',
      'staff', v_identity -> 'staff',
      'expires_at', v_session -> 'expires_at',
      'operating_mode', v_operating_mode,
      'read_only', not v_can_write,
      'result_write_enabled', v_can_write
    );
  end if;

  if v_entry_action and not v_can_write then
    return jsonb_build_object(
      'ok', false,
      'code', 'RESULT_STAFF_WRITE_DISABLED',
      'operating_mode', v_operating_mode,
      'result_write_enabled', false
    );
  end if;

  if not public.school_result_permission_allowed(v_permissions, v_action) then
    return jsonb_build_object(
      'ok', false,
      'code', 'RESULT_PERMISSION_DENIED',
      'required_permission', v_action
    );
  end if;

  v_broad_access := public.school_result_permission_allowed(v_permissions, 'results.manage')
    or (
      v_can_write
      and coalesce((
        select write_scope
        from public.school_result_staff_write_access
        where app_code = 'results' and person_id = v_person_id
      ), 'default') = 'override'
    );

  v_requires_scope := v_action in (
    'scores.enter', 'traits.enter', 'remarks.enter', 'results.view_assigned',
    'results.review', 'results.approve', 'results.publish', 'results.unpublish',
    'report_cards.generate', 'results.export'
  );

  if v_action = 'scores.enter' and p_subject_index is null then
    return jsonb_build_object('ok', false, 'code', 'RESULT_SUBJECT_SCOPE_REQUIRED');
  end if;

  if v_requires_scope and not v_broad_access then
    if nullif(trim(coalesce(p_class_key, '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'RESULT_CLASS_SCOPE_REQUIRED');
    end if;

    select exists(
      select 1
      from public.school_staff_access_scopes s
      where s.person_id = v_person_id
        and s.app_code = 'results'
        and s.scope_type in ('class', 'subject')
        and s.class_key = trim(p_class_key)
        and s.scope_status = 'active'
        and (s.effective_from is null or s.effective_from <= now())
        and (s.effective_until is null or s.effective_until > now())
        and public.school_result_scope_context_matches(s.metadata, p_academic_session, p_term)
    ) into v_class_scope;

    if not v_class_scope then
      return jsonb_build_object('ok', false, 'code', 'RESULT_CLASS_SCOPE_DENIED');
    end if;

    if p_subject_index is not null then
      select exists(
        select 1
        from public.school_staff_access_scopes s
        where s.person_id = v_person_id
          and s.app_code = 'results'
          and s.scope_type = 'subject'
          and s.class_key = trim(p_class_key)
          and s.subject_index = p_subject_index
          and s.scope_status = 'active'
          and (s.effective_from is null or s.effective_from <= now())
          and (s.effective_until is null or s.effective_until > now())
          and public.school_result_scope_context_matches(s.metadata, p_academic_session, p_term)
      ) into v_subject_scope;

      if not v_subject_scope then
        return jsonb_build_object('ok', false, 'code', 'RESULT_SUBJECT_SCOPE_DENIED');
      end if;
    end if;
  end if;

  v_context_required := v_entry_action or v_action in (
    'report_cards.generate', 'results.review', 'results.approve',
    'results.publish', 'results.unpublish'
  );

  if v_context_required then
    v_current := public.school_academic_current();
    if nullif(trim(coalesce(p_academic_session, '')), '') is null
       or nullif(trim(coalesce(p_term, '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'RESULT_CONTEXT_REQUIRED');
    end if;

    if p_academic_session != (v_current ->> 'academic_session')
       or p_term != (v_current ->> 'term') then
      return jsonb_build_object('ok', false, 'code', 'RESULT_HISTORICAL_ENTRY_DENIED');
    end if;

    if v_entry_action then
      v_write_gate := public.school_result_write_gate_check(v_operating_mode, v_hold_exempt);
      if coalesce((v_write_gate ->> 'ok')::boolean, false) is not true then
        return v_write_gate;
      end if;

      v_write_gate := public.school_academic_term_write_gate(trim(p_academic_session), trim(p_term));
      if coalesce((v_write_gate ->> 'ok')::boolean, false) is not true then
        return jsonb_build_object(
          'ok', false,
          'code', 'RESULT_ACADEMIC_TERM_READ_ONLY',
          'term_status', v_write_gate ->> 'term_status'
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_AUTHORIZED',
    'person_id', v_person_id,
    'broad_access', v_broad_access,
    'class_scope', v_class_scope,
    'subject_scope', v_subject_scope,
    'operating_mode', v_operating_mode,
    'read_only', not v_can_write,
    'result_write_enabled', v_can_write
  );
end;
$function$

