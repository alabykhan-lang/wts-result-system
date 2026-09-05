-- Smart sheet creation must establish the protected academic context itself.
-- The browser can render several departments for one merged sheet, so a
-- separate context.set call is not a safe prerequisite for this RPC.

create or replace function public.school_result_smart_sheet_create(
  p_session_id uuid,
  p_session_secret text,
  p_class_key text,
  p_subject_index integer,
  p_term text,
  p_academic_session text,
  p_assessment_config jsonb default '{"ca1":10,"ca2":10,"ca3":10,"exam":70}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare
  v_context jsonb;
  v_auth jsonb;
  v_id uuid := gen_random_uuid();
  v_person_id uuid;
  v_subject text;
  v_roster jsonb;
  v_geometry jsonb;
  v_hash text;
  v_code text;
begin
  v_context := public.school_result_context_set(
    p_session_id,
    p_session_secret,
    p_class_key,
    p_academic_session,
    p_term
  );
  if coalesce((v_context->>'ok')::boolean,false) is not true then
    return v_context;
  end if;

  v_auth := public.school_result_authorize(
    p_session_id,
    p_session_secret,
    'scores.enter',
    p_class_key,
    p_subject_index,
    p_academic_session,
    p_term
  );
  if coalesce((v_auth->>'ok')::boolean,false) is not true then
    return v_auth;
  end if;
  v_person_id := (v_auth->>'person_id')::uuid;

  select r.subject_name into v_subject
  from public.result_subject_catalog r
  where r.class_key=trim(p_class_key)
    and r.subject_index=p_subject_index
    and r.active=true;
  if v_subject is null then
    return jsonb_build_object('ok',false,'code','RESULT_SUBJECT_NOT_ASSIGNED');
  end if;

  if jsonb_typeof(p_assessment_config) <> 'object'
     or exists (
       select 1
       from jsonb_each_text(p_assessment_config) x
       where x.key not in ('ca1','ca2','ca3','exam')
          or x.value::numeric <= 0
          or x.value::numeric > 100
     )
  then
    return jsonb_build_object('ok',false,'code','SMART_ASSESSMENT_CONFIG_INVALID');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',s.id,
    'name',s.name,
    'admno',s.admno,
    'row_index',x.rn,
    'page_index',((x.rn-1)/40),
    'page_row',((x.rn-1)%40)+1
  ) order by x.rn),'[]'::jsonb)
  into v_roster
  from (
    select s.*, row_number() over(order by lower(s.name),s.id)::integer rn
    from public.students s
    where s.class_key=trim(p_class_key)
      and coalesce(s.archived,false)=false
  ) x
  join public.students s on s.id=x.id;

  if jsonb_array_length(v_roster)=0 then
    return jsonb_build_object('ok',false,'code','SMART_SHEET_EMPTY_ROSTER');
  end if;

  v_hash := encode(digest(v_roster::text,'sha256'),'hex');
  v_code := 'WTS-SR1-'||v_id::text;
  v_geometry := jsonb_build_object(
    'canonical_width',1240,
    'canonical_height',1754,
    'rows_per_page',40,
    'table',jsonb_build_object('x',54,'y',292,'width',1132,'row_height',33),
    'columns',jsonb_build_object(
      'ca1',jsonb_build_object('x',710,'width',105),
      'ca2',jsonb_build_object('x',815,'width',105),
      'ca3',jsonb_build_object('x',920,'width',105),
      'exam',jsonb_build_object('x',1025,'width',161)
    ),
    'alignment_marks',jsonb_build_array(
      jsonb_build_object('x',35,'y',35),
      jsonb_build_object('x',1205,'y',35),
      jsonb_build_object('x',35,'y',1719),
      jsonb_build_object('x',1205,'y',1719)
    )
  );

  insert into public.result_smart_sheets(
    id,sheet_code,academic_session,term,class_key,subject_index,subject_name,
    assessment_config,roster,geometry,roster_hash,created_by_person_id
  ) values(
    v_id,v_code,trim(p_academic_session),trim(p_term),trim(p_class_key),
    p_subject_index,v_subject,p_assessment_config,v_roster,v_geometry,
    v_hash,v_person_id
  );

  return jsonb_build_object(
    'ok',true,
    'code','SMART_SHEET_CREATED',
    'sheet',(select to_jsonb(s) from public.result_smart_sheets s where s.id=v_id)
  );
exception when others then
  return jsonb_build_object('ok',false,'code','SMART_SHEET_CREATE_FAILED');
end;
$function$;

revoke all on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) from public;
grant execute on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) to anon, authenticated, service_role;
