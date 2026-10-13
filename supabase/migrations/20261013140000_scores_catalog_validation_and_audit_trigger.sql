-- ============================================================================
-- Migration: Scores Subject Catalog Validation & Audit Trigger
-- Timestamp: 2026-10-13 14:00:00
-- Purpose:
--   1. Enforce that any score inserted or updated on public.scores must have
--      a subject_index that exists in public.result_subject_catalog for that class.
--   2. Automatically record an audit row in public.school_result_score_audit
--      for every change (INSERT, UPDATE, DELETE) made to public.scores, including
--      direct database writes.
--   3. Normalize class_key, academic_session, and term formatting on write.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Validation Function: Rejects invalid subject_index for the specified class
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_result_scores_validate_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_subject_name text;
begin
  -- Normalize class_key, academic_session, and term
  NEW.class_key := lower(trim(coalesce(NEW.class_key, '')));
  if NEW.academic_session is not null then
    NEW.academic_session := trim(NEW.academic_session);
  end if;
  if NEW.term is not null then
    NEW.term := trim(NEW.term);
  end if;

  if NEW.class_key = '' then
    raise exception 'class_key cannot be empty'
      using errcode = 'not_null_violation';
  end if;

  if NEW.subject_index is null or NEW.subject_index < 0 then
    raise exception 'subject_index must be a non-negative integer'
      using errcode = 'check_violation';
  end if;

  -- Validate presence in result_subject_catalog for this class
  select r.subject_name
    into v_subject_name
  from public.result_subject_catalog r
  where r.class_key = NEW.class_key
    and r.subject_index = NEW.subject_index;

  if v_subject_name is null then
    raise exception 'Invalid subject_index % for class "%": not found in result_subject_catalog',
      NEW.subject_index, NEW.class_key
      using errcode = 'foreign_key_violation',
            detail = jsonb_build_object(
              'class_key', NEW.class_key,
              'subject_index', NEW.subject_index,
              'student_id', NEW.student_id,
              'academic_session', NEW.academic_session,
              'term', NEW.term
            )::text,
            hint = 'Every score record must reference an existing subject_index in result_subject_catalog for the specified class.';
  end if;

  return NEW;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2. Audit Trigger Function: Logs every score change to school_result_score_audit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_result_scores_audit_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_action_type text;
  v_student_id uuid;
  v_class_key text;
  v_subject_index integer;
  v_session text;
  v_term text;
  v_before jsonb := null;
  v_after jsonb := null;
  v_changed text[] := array[]::text[];
begin
  if TG_OP = 'INSERT' then
    v_action_type := 'score_insert';
    v_student_id := NEW.student_id;
    v_class_key := NEW.class_key;
    v_subject_index := NEW.subject_index;
    v_session := NEW.academic_session;
    v_term := NEW.term;
    v_after := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    -- Skip audit if no fields actually changed
    if (OLD.* is not distinct from NEW.*) then
      return NEW;
    end if;

    v_action_type := 'score_update';
    v_student_id := NEW.student_id;
    v_class_key := NEW.class_key;
    v_subject_index := NEW.subject_index;
    v_session := NEW.academic_session;
    v_term := NEW.term;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);

    if OLD.ca1 is distinct from NEW.ca1 then v_changed := array_append(v_changed, 'ca1'); end if;
    if OLD.ca2 is distinct from NEW.ca2 then v_changed := array_append(v_changed, 'ca2'); end if;
    if OLD.ca3 is distinct from NEW.ca3 then v_changed := array_append(v_changed, 'ca3'); end if;
    if OLD.exam is distinct from NEW.exam then v_changed := array_append(v_changed, 'exam'); end if;
    if OLD.class_key is distinct from NEW.class_key then v_changed := array_append(v_changed, 'class_key'); end if;
    if OLD.subject_index is distinct from NEW.subject_index then v_changed := array_append(v_changed, 'subject_index'); end if;
    if OLD.academic_session is distinct from NEW.academic_session then v_changed := array_append(v_changed, 'academic_session'); end if;
    if OLD.term is distinct from NEW.term then v_changed := array_append(v_changed, 'term'); end if;
  elsif TG_OP = 'DELETE' then
    v_action_type := 'score_delete';
    v_student_id := OLD.student_id;
    v_class_key := OLD.class_key;
    v_subject_index := OLD.subject_index;
    v_session := OLD.academic_session;
    v_term := OLD.term;
    v_before := to_jsonb(OLD);
  end if;

  insert into public.school_result_score_audit (
    request_id,
    actor_person_id,
    staff_id,
    student_id,
    class_key,
    subject_index,
    academic_session,
    term,
    component,
    old_value,
    new_value,
    old_record,
    new_record,
    action_type,
    source_application,
    success,
    failure_code,
    created_at,
    correction_reason,
    audit_metadata
  ) values (
    coalesce(nullif(current_setting('app.request_id', true), '')::uuid, gen_random_uuid()),
    nullif(current_setting('app.actor_person_id', true), '')::uuid,
    nullif(current_setting('app.staff_id', true), '')::uuid,
    v_student_id,
    v_class_key,
    v_subject_index,
    v_session,
    v_term,
    'score_record',
    null,
    null,
    v_before,
    v_after,
    v_action_type,
    coalesce(nullif(current_setting('app.source_application', true), ''), 'database_direct'),
    true,
    null,
    now(),
    nullif(current_setting('app.correction_reason', true), ''),
    jsonb_build_object(
      'operation', TG_OP,
      'table', 'scores',
      'db_user', current_user,
      'client_addr', inet_client_addr(),
      'changed_components', to_jsonb(v_changed),
      'changed_at', now()
    )
  );

  return coalesce(NEW, OLD);
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.school_result_scores_validate_catalog() FROM public;
GRANT EXECUTE ON FUNCTION public.school_result_scores_validate_catalog() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.school_result_scores_audit_change() FROM public;
GRANT EXECUTE ON FUNCTION public.school_result_scores_audit_change() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Triggers on public.scores
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_scores_validate_catalog ON public.scores;
CREATE TRIGGER trg_scores_validate_catalog
  BEFORE INSERT OR UPDATE ON public.scores
  FOR EACH ROW
  EXECUTE FUNCTION public.school_result_scores_validate_catalog();

DROP TRIGGER IF EXISTS trg_scores_audit_change ON public.scores;
CREATE TRIGGER trg_scores_audit_change
  AFTER INSERT OR UPDATE OR DELETE ON public.scores
  FOR EACH ROW
  EXECUTE FUNCTION public.school_result_scores_audit_change();
