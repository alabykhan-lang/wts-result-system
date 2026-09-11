create or replace function public.school_result_smart_sheet_rows_per_page(p_class_key text)
returns integer
language sql
immutable
as $function$
  select case
    when lower(coalesce(p_class_key,'')) ~ '^(creche|kg1|kg2|nursery1|nursery2|primary[1-5])$' then 50
    when lower(coalesce(p_class_key,'')) ~ '^(jss|ss)' then 58
    else 58
  end
$function$;

revoke all on function public.school_result_smart_sheet_rows_per_page(text) from public;
grant execute on function public.school_result_smart_sheet_rows_per_page(text) to anon, authenticated, service_role;

create or replace function public.school_result_smart_sheet_create(
  p_session_id uuid,p_session_secret text,p_class_key text,p_subject_index integer,
  p_term text,p_academic_session text,
  p_assessment_config jsonb default '{"ca1":10,"ca2":10,"ca3":10,"exam":70}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare
  v_auth jsonb; v_id uuid:=gen_random_uuid(); v_person_id uuid; v_subject text;
  v_roster jsonb; v_geometry jsonb; v_hash text; v_code text;
  v_rows_per_page integer:=public.school_result_smart_sheet_rows_per_page(p_class_key);
  v_landscape boolean:=lower(trim(coalesce(p_class_key,''))) ~ '^(creche|kg1|kg2|nursery1|nursery2|primary[1-5])$';
begin
  v_auth:=public.school_result_authorize(p_session_id,p_session_secret,'scores.enter',p_class_key,p_subject_index,p_academic_session,p_term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  v_person_id:=(v_auth->>'person_id')::uuid;
  select r.subject_name into v_subject from public.result_subject_catalog r
    where r.class_key=trim(p_class_key) and r.subject_index=p_subject_index and r.active=true;
  if v_subject is null then return jsonb_build_object('ok',false,'code','RESULT_SUBJECT_NOT_ASSIGNED'); end if;
  if jsonb_typeof(p_assessment_config)<>'object'
    or exists(select 1 from jsonb_each_text(p_assessment_config) x
      where x.key not in ('ca1','ca2','ca3','exam') or x.value::numeric<=0 or x.value::numeric>100)
  then return jsonb_build_object('ok',false,'code','SMART_ASSESSMENT_CONFIG_INVALID'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'student_id',s.id,'name',s.name,'admno',s.admno,'row_index',x.rn,
      'page_index',floor((x.rn-1)::numeric/v_rows_per_page)::integer,
      'page_row',((x.rn-1)%v_rows_per_page)+1
    ) order by x.rn),'[]'::jsonb)
    into v_roster
    from (
      select s.*,row_number() over(order by lower(s.name),s.id)::integer rn
      from public.students s
      where s.class_key=trim(p_class_key) and coalesce(s.archived,false)=false
    ) x join public.students s on s.id=x.id;
  if jsonb_array_length(v_roster)=0 then return jsonb_build_object('ok',false,'code','SMART_SHEET_EMPTY_ROSTER'); end if;
  v_hash:=encode(digest(v_roster::text,'sha256'),'hex'); v_code:='WTS-SR1-'||v_id::text;
  if v_landscape then
    v_geometry:=jsonb_build_object('canonical_width',1754,'canonical_height',1240,'layout','landscape',
      'rows_per_page',v_rows_per_page,'table',jsonb_build_object('x',34,'y',130,'width',1686,'row_height',22),
      'student_column',jsonb_build_object('x',79,'width',335));
  else
    v_geometry:=jsonb_build_object('canonical_width',1240,'canonical_height',1754,'layout','portrait',
      'rows_per_page',v_rows_per_page,'table',jsonb_build_object('x',54,'y',292,'width',1132,'row_height',24),
      'student_column',jsonb_build_object('x',99,'width',611));
  end if;
  insert into public.result_smart_sheets
    (id,sheet_code,academic_session,term,class_key,subject_index,subject_name,
     assessment_config,roster,geometry,roster_hash,created_by_person_id)
  values(v_id,v_code,trim(p_academic_session),trim(p_term),trim(p_class_key),p_subject_index,v_subject,
    p_assessment_config,v_roster,v_geometry,v_hash,v_person_id);
  return jsonb_build_object('ok',true,'code','SMART_SHEET_CREATED','sheet',
    (select to_jsonb(s) from public.result_smart_sheets s where s.id=v_id));
exception when others then
  return jsonb_build_object('ok',false,'code','SMART_SHEET_CREATE_FAILED');
end;
$function$;

create or replace function public.school_result_smart_sheet_read(
  p_session_id uuid,p_session_secret text,p_sheet_id uuid default null,
  p_class_key text default null,p_subject_index integer default null,
  p_term text default null,p_academic_session text default null
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare v_sheet public.result_smart_sheets%rowtype; v_auth jsonb;
begin
  if p_sheet_id is not null then
    select * into v_sheet from public.result_smart_sheets where id=p_sheet_id and status='active';
  else
    select * into v_sheet from public.result_smart_sheets
      where class_key=trim(p_class_key) and subject_index=p_subject_index
        and term=trim(p_term) and academic_session=trim(p_academic_session) and status='active'
      order by created_at desc limit 1;
  end if;
  if v_sheet.id is null then return jsonb_build_object('ok',false,'code','SMART_SHEET_NOT_FOUND'); end if;
  v_auth:=public.school_result_authorize(p_session_id,p_session_secret,'results.view_assigned',
    v_sheet.class_key,v_sheet.subject_index,v_sheet.academic_session,v_sheet.term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  return jsonb_build_object('ok',true,'code','SMART_SHEET_FOUND','sheet',to_jsonb(v_sheet),
    'existing_scores',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select student_id,ca1,ca2,ca3,exam from public.scores
      where class_key=v_sheet.class_key and subject_index=v_sheet.subject_index
        and academic_session=v_sheet.academic_session and term=v_sheet.term
    ) x),'[]'::jsonb));
end;
$function$;

create or replace function public.school_result_smart_provider_key_read(
  p_session_id uuid,p_session_secret text,p_class_key text,p_subject_index integer,
  p_academic_session text,p_term text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare v_auth jsonb; v_config jsonb:='{}'::jsonb; v_key text:='';
begin
  v_auth:=public.school_result_authorize(p_session_id,p_session_secret,'results.view_assigned',
    p_class_key,p_subject_index,p_academic_session,p_term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  select value::jsonb into v_config from public.settings where key='app_config';
  if jsonb_typeof(v_config)='object' then v_key:=trim(coalesce(v_config->>'geminiKey','')); end if;
  if v_key='' then select trim(coalesce(value,'')) into v_key from public.settings where key='gemini_key'; end if;
  if v_key='' then return jsonb_build_object('ok',false,'code','SMART_RECORDING_PROVIDER_NOT_CONFIGURED'); end if;
  return jsonb_build_object('ok',true,'code','RESULT_PROVIDER_KEY_AVAILABLE','provider_key',v_key);
end;
$function$;

revoke all on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) from public;
revoke all on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) from public;
revoke all on function public.school_result_smart_provider_key_read(uuid,text,text,integer,text,text) from public;
grant execute on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) to anon, authenticated, service_role;
grant execute on function public.school_result_smart_provider_key_read(uuid,text,text,integer,text,text) to anon, authenticated, service_role;
