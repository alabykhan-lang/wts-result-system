-- A QR scan may start without the user having selected a class first.
-- Set the existing protected portal context internally, then apply normal score authorization.
create or replace function public.school_result_smart_sheet_read(
  p_session_id uuid,
  p_session_secret text,
  p_sheet_id uuid default null,
  p_class_key text default null,
  p_subject_index integer default null,
  p_term text default null,
  p_academic_session text default null
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare v_sheet public.result_smart_sheets%rowtype; v_auth jsonb; v_session jsonb; v_context jsonb;
begin
  v_session:=public.school_identity_session_validate(p_session_id,p_session_secret,'results');
  if coalesce((v_session->>'ok')::boolean,false) is not true then return v_session; end if;
  if p_sheet_id is not null then
    select * into v_sheet from public.result_smart_sheets where id=p_sheet_id and status='active';
  else
    select * into v_sheet from public.result_smart_sheets
     where class_key=trim(p_class_key) and subject_index=p_subject_index and term=trim(p_term)
       and academic_session=trim(p_academic_session) and status='active'
     order by created_at desc limit 1;
  end if;
  if v_sheet.id is null then return jsonb_build_object('ok',false,'code','SMART_SHEET_NOT_FOUND'); end if;
  v_context:=public.school_result_context_set(p_session_id,p_session_secret,v_sheet.class_key,v_sheet.academic_session,v_sheet.term);
  if coalesce((v_context->>'ok')::boolean,false) is not true then return v_context; end if;
  v_auth := public.school_result_authorize(p_session_id,p_session_secret,'scores.enter',v_sheet.class_key,v_sheet.subject_index,v_sheet.academic_session,v_sheet.term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  return jsonb_build_object('ok',true,'code','SMART_SHEET_FOUND','sheet',to_jsonb(v_sheet),
    'existing_scores',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select student_id,ca1,ca2,ca3,exam from public.scores
      where class_key=v_sheet.class_key and subject_index=v_sheet.subject_index
        and academic_session=v_sheet.academic_session and term=v_sheet.term
    ) x),'[]'::jsonb));
end;
$function$;

revoke all on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) from public;
grant execute on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) to anon, authenticated, service_role;
