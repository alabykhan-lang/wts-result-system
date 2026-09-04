-- Smart Recording for the existing WTS Result Portal.
-- Browser access remains RPC-only; both tables are deny-by-default under RLS.

create table if not exists public.result_smart_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_code text not null unique,
  template_version integer not null default 1 check (template_version > 0),
  academic_session text not null,
  term text not null check (term in ('1st Term','2nd Term','3rd Term')),
  class_key text not null,
  subject_index integer not null check (subject_index >= 0),
  subject_name text not null,
  assessment_config jsonb not null,
  roster jsonb not null,
  geometry jsonb not null,
  roster_hash text not null,
  created_by_person_id uuid not null references public.school_people(id),
  created_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','retired'))
);

create index if not exists result_smart_sheets_context_idx
  on public.result_smart_sheets (academic_session, term, class_key, subject_index, created_at desc);

create table if not exists public.result_smart_recordings (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.result_smart_sheets(id),
  submitted_by_person_id uuid not null references public.school_people(id),
  scanned_at timestamptz not null default now(),
  saved_at timestamptz,
  save_status text not null check (save_status in ('reviewed','saved','failed')),
  scores_extracted integer not null default 0,
  scores_saved integer not null default 0,
  corrections_made integer not null default 0,
  conflicts_resolved integer not null default 0,
  image_fingerprint text,
  extraction_summary jsonb not null default '{}'::jsonb,
  save_result jsonb not null default '{}'::jsonb
);

create index if not exists result_smart_recordings_sheet_idx
  on public.result_smart_recordings (sheet_id, scanned_at desc);
create index if not exists result_smart_recordings_actor_idx
  on public.result_smart_recordings (submitted_by_person_id, scanned_at desc);

alter table public.result_smart_sheets enable row level security;
alter table public.result_smart_recordings enable row level security;
revoke all on table public.result_smart_sheets from anon, authenticated;
revoke all on table public.result_smart_recordings from anon, authenticated;

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
  v_auth jsonb;
  v_id uuid := gen_random_uuid();
  v_person_id uuid;
  v_subject text;
  v_roster jsonb;
  v_geometry jsonb;
  v_hash text;
  v_code text;
begin
  v_auth := public.school_result_authorize(p_session_id,p_session_secret,'scores.enter',p_class_key,p_subject_index,p_academic_session,p_term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  v_person_id := (v_auth->>'person_id')::uuid;

  select r.subject_name into v_subject from public.result_subject_catalog r
   where r.class_key=trim(p_class_key) and r.subject_index=p_subject_index and r.active=true;
  if v_subject is null then return jsonb_build_object('ok',false,'code','RESULT_SUBJECT_NOT_ASSIGNED'); end if;

  if jsonb_typeof(p_assessment_config) <> 'object'
     or exists (select 1 from jsonb_each_text(p_assessment_config) x where x.key not in ('ca1','ca2','ca3','exam') or x.value::numeric <= 0 or x.value::numeric > 100)
  then return jsonb_build_object('ok',false,'code','SMART_ASSESSMENT_CONFIG_INVALID'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',s.id,'name',s.name,'admno',s.admno,'row_index',x.rn,
    'page_index',((x.rn-1)/40),'page_row',((x.rn-1)%40)+1
  ) order by x.rn),'[]'::jsonb)
  into v_roster
  from (
    select s.*, row_number() over(order by lower(s.name),s.id)::integer rn
    from public.students s where s.class_key=trim(p_class_key) and coalesce(s.archived,false)=false
  ) x join public.students s on s.id=x.id;

  if jsonb_array_length(v_roster)=0 then return jsonb_build_object('ok',false,'code','SMART_SHEET_EMPTY_ROSTER'); end if;
  v_hash := encode(digest(v_roster::text,'sha256'),'hex');
  v_code := 'WTS-SR1-'||v_id::text;
  v_geometry := jsonb_build_object(
    'canonical_width',1240,'canonical_height',1754,'rows_per_page',40,
    'table',jsonb_build_object('x',54,'y',292,'width',1132,'row_height',33),
    'columns',jsonb_build_object(
      'ca1',jsonb_build_object('x',710,'width',105),
      'ca2',jsonb_build_object('x',815,'width',105),
      'ca3',jsonb_build_object('x',920,'width',105),
      'exam',jsonb_build_object('x',1025,'width',161)
    ),
    'alignment_marks',jsonb_build_array(
      jsonb_build_object('x',35,'y',35),jsonb_build_object('x',1205,'y',35),
      jsonb_build_object('x',35,'y',1719),jsonb_build_object('x',1205,'y',1719)
    )
  );

  insert into public.result_smart_sheets(id,sheet_code,academic_session,term,class_key,subject_index,subject_name,
    assessment_config,roster,geometry,roster_hash,created_by_person_id)
  values(v_id,v_code,trim(p_academic_session),trim(p_term),trim(p_class_key),p_subject_index,v_subject,
    p_assessment_config,v_roster,v_geometry,v_hash,v_person_id);

  return jsonb_build_object('ok',true,'code','SMART_SHEET_CREATED','sheet',(
    select to_jsonb(s) from public.result_smart_sheets s where s.id=v_id
  ));
exception when others then
  return jsonb_build_object('ok',false,'code','SMART_SHEET_CREATE_FAILED');
end;
$function$;

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
declare v_sheet public.result_smart_sheets%rowtype; v_auth jsonb;
begin
  if p_sheet_id is not null then
    select * into v_sheet from public.result_smart_sheets where id=p_sheet_id and status='active';
  else
    select * into v_sheet from public.result_smart_sheets
     where class_key=trim(p_class_key) and subject_index=p_subject_index and term=trim(p_term)
       and academic_session=trim(p_academic_session) and status='active'
     order by created_at desc limit 1;
  end if;
  if v_sheet.id is null then return jsonb_build_object('ok',false,'code','SMART_SHEET_NOT_FOUND'); end if;
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

create or replace function public.school_result_smart_history_read(
  p_session_id uuid, p_session_secret text, p_limit integer default 30
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare v_session jsonb; v_person uuid; v_rows jsonb;
begin
  v_session:=public.school_identity_session_validate(p_session_id,p_session_secret,'results');
  if coalesce((v_session->>'ok')::boolean,false) is not true then return v_session; end if;
  v_person:=(v_session->>'person_id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.scanned_at desc),'[]'::jsonb) into v_rows from (
    select r.id,r.scanned_at,r.saved_at,r.save_status,r.scores_extracted,r.scores_saved,
      r.corrections_made,r.conflicts_resolved,s.id sheet_id,s.sheet_code,s.class_key,s.subject_index,
      s.subject_name,s.academic_session,s.term
    from public.result_smart_recordings r join public.result_smart_sheets s on s.id=r.sheet_id
    where r.submitted_by_person_id=v_person
       or public.school_result_permission_allowed(coalesce(array(select jsonb_array_elements_text(v_session->'permissions')),array[]::text[]),'results.manage')
    order by r.scanned_at desc limit greatest(1,least(coalesce(p_limit,30),100))
  ) x;
  return jsonb_build_object('ok',true,'code','SMART_HISTORY_READ','rows',v_rows);
end;
$function$;

create or replace function public.school_result_smart_recording_commit(
  p_session_id uuid,
  p_session_secret text,
  p_sheet_id uuid,
  p_rows jsonb,
  p_summary jsonb default '{}'::jsonb,
  p_image_fingerprint text default null
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','extensions','public'
as $function$
declare
  v_sheet public.result_smart_sheets%rowtype; v_auth jsonb; v_row jsonb; v_current public.scores%rowtype;
  v_component text; v_scanned numeric; v_expected numeric; v_decision text; v_max numeric; v_old numeric;
  v_ca1 numeric; v_ca2 numeric; v_ca3 numeric; v_exam numeric; v_result jsonb;
  v_saved integer:=0; v_fields integer:=0; v_conflicts integer:=0; v_recording uuid:=gen_random_uuid();
begin
  select * into v_sheet from public.result_smart_sheets where id=p_sheet_id and status='active';
  if v_sheet.id is null then return jsonb_build_object('ok',false,'code','SMART_SHEET_NOT_FOUND'); end if;
  v_auth:=public.school_result_authorize(p_session_id,p_session_secret,'scores.enter',v_sheet.class_key,v_sheet.subject_index,v_sheet.academic_session,v_sheet.term);
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return v_auth; end if;
  if jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('ok',false,'code','SMART_ROWS_INVALID'); end if;

  -- Validate the complete batch and all overwrite choices before the first write.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from jsonb_array_elements(v_sheet.roster) r where r->>'student_id'=v_row->>'student_id') then
      return jsonb_build_object('ok',false,'code','SMART_STUDENT_MAPPING_INVALID');
    end if;
    select * into v_current from public.scores where student_id=(v_row->>'student_id')::uuid
      and class_key=v_sheet.class_key and subject_index=v_sheet.subject_index
      and academic_session=v_sheet.academic_session and term=v_sheet.term;
    foreach v_component in array array['ca1','ca2','ca3','exam'] loop
      if coalesce(v_row->'scores','{}'::jsonb) ? v_component then
        v_scanned:=nullif(v_row->'scores'->>v_component,'')::numeric;
        v_max:=(v_sheet.assessment_config->>v_component)::numeric;
        v_old:=case v_component when 'ca1' then v_current.ca1 when 'ca2' then v_current.ca2 when 'ca3' then v_current.ca3 else v_current.exam end;
        if v_scanned is null or v_scanned<0 or v_scanned>v_max then
          return jsonb_build_object('ok',false,'code','SMART_SCORE_RANGE_INVALID','student_id',v_row->>'student_id','component',v_component);
        end if;
        if coalesce(v_row->'existing','{}'::jsonb) ? v_component then
          v_expected:=nullif(v_row->'existing'->>v_component,'')::numeric;
          if v_expected is distinct from v_old then
            return jsonb_build_object('ok',false,'code','SMART_EXISTING_SCORE_CHANGED','student_id',v_row->>'student_id','component',v_component);
          end if;
        end if;
        if v_old is not null and v_old is distinct from v_scanned then
          v_decision:=v_row->'decisions'->>v_component;
          if coalesce(v_decision,'') not in ('keep_existing','use_scanned') then
            return jsonb_build_object('ok',false,'code','SMART_CONFLICT_DECISION_REQUIRED','student_id',v_row->>'student_id','component',v_component);
          end if;
        end if;
      end if;
    end loop;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    select * into v_current from public.scores where student_id=(v_row->>'student_id')::uuid
      and class_key=v_sheet.class_key and subject_index=v_sheet.subject_index
      and academic_session=v_sheet.academic_session and term=v_sheet.term;
    v_ca1:=v_current.ca1; v_ca2:=v_current.ca2; v_ca3:=v_current.ca3; v_exam:=v_current.exam;
    foreach v_component in array array['ca1','ca2','ca3','exam'] loop
      if coalesce(v_row->'scores','{}'::jsonb) ? v_component then
        v_scanned:=(v_row->'scores'->>v_component)::numeric;
        v_decision:=coalesce(v_row->'decisions'->>v_component,'use_scanned');
        if v_decision='use_scanned' then
          if v_component='ca1' then v_ca1:=v_scanned; elsif v_component='ca2' then v_ca2:=v_scanned;
          elsif v_component='ca3' then v_ca3:=v_scanned; else v_exam:=v_scanned; end if;
          v_fields:=v_fields+1;
        else v_conflicts:=v_conflicts+1; end if;
      end if;
    end loop;
    v_result:=public.school_result_score_update(p_session_id,p_session_secret,(v_row->>'student_id')::uuid,
      v_sheet.class_key,v_sheet.subject_index,v_sheet.term,v_sheet.academic_session,v_ca1,v_ca2,v_ca3,v_exam);
    if coalesce((v_result->>'ok')::boolean,false) is not true then
      return v_result||jsonb_build_object('code','SMART_SCORE_SAVE_FAILED','saved_before_failure',v_saved);
    end if;
    v_saved:=v_saved+1;
  end loop;

  insert into public.result_smart_recordings(id,sheet_id,submitted_by_person_id,saved_at,save_status,
    scores_extracted,scores_saved,corrections_made,conflicts_resolved,image_fingerprint,extraction_summary,save_result)
  values(v_recording,v_sheet.id,(v_auth->>'person_id')::uuid,now(),'saved',coalesce((p_summary->>'scores_extracted')::integer,v_fields),
    v_fields,coalesce((p_summary->>'corrections_made')::integer,0),v_conflicts,left(p_image_fingerprint,128),coalesce(p_summary,'{}'::jsonb),
    jsonb_build_object('students_saved',v_saved,'score_fields_saved',v_fields));
  return jsonb_build_object('ok',true,'code','SMART_SCORES_SAVED','recording_id',v_recording,'students_saved',v_saved,'score_fields_saved',v_fields,'conflicts_kept',v_conflicts);
end;
$function$;

revoke all on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) from public;
revoke all on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) from public;
revoke all on function public.school_result_smart_history_read(uuid,text,integer) from public;
revoke all on function public.school_result_smart_recording_commit(uuid,text,uuid,jsonb,jsonb,text) from public;
grant execute on function public.school_result_smart_sheet_create(uuid,text,text,integer,text,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.school_result_smart_sheet_read(uuid,text,uuid,text,integer,text,text) to anon, authenticated, service_role;
grant execute on function public.school_result_smart_history_read(uuid,text,integer) to anon, authenticated, service_role;
grant execute on function public.school_result_smart_recording_commit(uuid,text,uuid,jsonb,jsonb,text) to anon, authenticated, service_role;
