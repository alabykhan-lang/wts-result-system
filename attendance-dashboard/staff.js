"use strict";

const SUPABASE_URL="https://wuftzyeajmsxdrbwaawl.supabase.co";
const PUBLISHABLE_KEY="sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ";
const READ_URL=`${SUPABASE_URL}/rest/v1/rpc/staff_attendance_admin_read_api`;
const WRITE_URL=`${SUPABASE_URL}/rest/v1/rpc/staff_attendance_admin_write_api`;
const STORAGE_KEY="wts_attendance_admin_connection";
const STAFF_PRINT_KEY="wts_staff_qr_print_payload";

const state={live:false,context:null,snapshot:{expected:24,present:0,late:0,absent:0,on_site:0,checked_out:0,waiting:24,latest_events:[],category_summary:[]},staff:[],credentials:{},rules:[],history:[]};
let selectedStaffId=null;

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const initials=n=>String(n||"ST").split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("").toUpperCase();
const categoryLabel=v=>String(v||"staff").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

function toast(message,type="default"){
  const node=document.createElement("div");node.className=`toast ${type}`;node.textContent=message;$("#toastContainer").appendChild(node);setTimeout(()=>node.remove(),4800);
}

function connection(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")}catch{return null}}

async function rpc(url,action,payload={}){
  const auth=connection();
  if(!auth?.adminCode||!auth?.adminSecret)throw new Error("Administrator connection is not configured.");
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",apikey:PUBLISHABLE_KEY},body:JSON.stringify({p_client_code:auth.adminCode,p_client_secret:auth.adminSecret,p_action:action,p_payload:payload})});
  let data;try{data=await response.json()}catch{throw new Error("Staff attendance service returned an invalid response.")}
  if(!response.ok||data?.ok===false)throw new Error(data?.code||"Staff attendance request failed.");
  return data;
}
const read=(action,payload={})=>rpc(READ_URL,action,payload);
const write=(action,payload={})=>rpc(WRITE_URL,action,payload);

function setTab(name){
  $$(".staff-tab").forEach(tab=>tab.classList.toggle("active",tab.id===`staff-tab-${name}`));
  $$(".staff-tabs button").forEach(button=>button.classList.toggle("active",button.dataset.tab===name));
  if(name==="history"&&selectedStaffId)loadHistory();
}

function renderMetrics(){
  const s=state.snapshot;
  $("#staffExpected").textContent=s.expected??0;$("#staffPresent").textContent=s.present??0;$("#staffLate").textContent=s.late??0;$("#staffOnSite").textContent=s.on_site??0;$("#staffCheckedOut").textContent=s.checked_out??0;$("#staffAbsent").textContent=s.absent??0;
  $("#staffPresentPercent").textContent=`${s.expected?Math.round((s.present/s.expected)*100):0}% recorded`;
}

function renderEvents(){
  const items=state.snapshot.latest_events||[],list=$("#staffEventsList"),empty=$("#staffEventsEmpty");list.innerHTML="";empty.hidden=items.length>0;
  items.forEach(item=>{const row=document.createElement("div");const status=item.attendance_status==="late"||item.attendance_status==="early_departure"?"late":"present";row.className="arrival-item";row.innerHTML=`<div class="avatar">${esc(initials(item.name))}</div><div><strong>${esc(item.name)}</strong><small>${esc(item.designation||categoryLabel(item.category))} • ${esc(item.event_type?.replaceAll("_"," ")||"movement")} • ${new Date(item.event_time).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"})}</small></div><span class="status-chip ${status}">${esc(item.attendance_status||"recorded")}</span>`;list.appendChild(row)});
}

function renderCategories(){
  const container=$("#staffCategorySummary"),items=state.snapshot.category_summary||[];container.innerHTML="";
  if(!items.length){container.innerHTML='<div class="empty-state"><h4>No category totals yet</h4><p>Category figures will appear after live data loads.</p></div>';return}
  items.forEach(item=>{const pct=item.expected?Math.round((item.present/item.expected)*100):0;const row=document.createElement("div");row.className="class-progress-row";row.innerHTML=`<strong>${esc(categoryLabel(item.category))}</strong><div class="progress-track"><i style="width:${pct}%"></i></div><span>${item.present}/${item.expected}</span>`;container.appendChild(row)});
}

function renderStaffList(target="#staffList"){
  const list=$(target);list.innerHTML="";
  if(target==="#staffList")$("#staffCountLabel").textContent=`${state.staff.length} record${state.staff.length===1?"":"s"} loaded`;
  if(!state.staff.length){list.innerHTML='<div class="empty-state"><h4>No staff found</h4><p>Adjust the search or category filter.</p></div>';return}
  state.staff.forEach(person=>{const button=document.createElement("button");button.type="button";button.className=`student-row${selectedStaffId===person.id?" active":""}`;button.innerHTML=`<div class="avatar">${esc(initials(person.full_name))}</div><div><strong>${esc(person.full_name)}</strong><small>${esc(person.designation||categoryLabel(person.staff_category))}${person.staff_number?` • ${esc(person.staff_number)}`:""}</small></div>`;button.addEventListener("click",()=>target==="#staffList"?selectProfile(person.id):selectCredentialHolder(person.id));list.appendChild(button)});
}

function selectedStaff(){return state.staff.find(item=>item.id===selectedStaffId)}

function applyAvatar(node,person){node.innerHTML="";if(person.photo){const img=document.createElement("img");img.src=person.photo;img.className="staff-profile-image";img.alt=person.full_name;img.onerror=()=>{node.textContent=initials(person.full_name)};node.appendChild(img)}else node.textContent=initials(person.full_name)}

function selectProfile(id){
  selectedStaffId=id;const person=selectedStaff();if(!person)return;
  $("#staffProfileEmpty").classList.add("hidden");$("#staffProfileForm").classList.remove("hidden");applyAvatar($("#staffAvatar"),person);$("#staffCategoryLabel").textContent=categoryLabel(person.staff_category);$("#staffName").textContent=person.full_name;$("#staffEmail").textContent=person.email||"Email not supplied";$("#staffNumberInput").value=person.staff_number||"";$("#staffCategoryInput").value=person.staff_category;$("#staffDepartmentInput").value=person.department||"";$("#staffDesignationInput").value=person.designation||"";$("#staffStatusInput").value=person.employment_status;$("#staffAttendanceRequired").checked=person.attendance_required!==false;renderStaffList();
}

function selectCredentialHolder(id){
  selectedStaffId=id;const person=selectedStaff();if(!person)return;
  $("#staffCredentialEmpty").classList.add("hidden");$("#staffCredentialDetail").classList.remove("hidden");applyAvatar($("#credentialStaffAvatar"),person);$("#credentialStaffCategory").textContent=categoryLabel(person.staff_category);$("#credentialStaffName").textContent=person.full_name;$("#credentialStaffNumber").textContent=person.staff_number||person.designation||"Staff number not supplied";renderStaffList("#credentialStaffList");loadCredentials(id);
}

async function searchStaff(mode="directory"){
  try{
    const search=mode==="credentials"?$("#credentialStaffSearch").value.trim():$("#staffSearch").value.trim();
    const category=mode==="credentials"?"":$("#staffCategoryFilter").value;
    const data=await read("staff",{search,category});state.staff=data.staff||[];selectedStaffId=null;
    if(mode==="credentials"){renderStaffList("#credentialStaffList");$("#staffCredentialEmpty").classList.remove("hidden");$("#staffCredentialDetail").classList.add("hidden")}else{renderStaffList();$("#staffProfileEmpty").classList.remove("hidden");$("#staffProfileForm").classList.add("hidden")}
  }catch(error){toast(error.message,"error")}
}

async function saveProfile(event){
  event.preventDefault();if(!selectedStaffId)return toast("Select a staff member first.","error");
  try{await write("updateProfile",{staffId:selectedStaffId,staffNumber:$("#staffNumberInput").value.trim(),category:$("#staffCategoryInput").value,department:$("#staffDepartmentInput").value.trim(),designation:$("#staffDesignationInput").value.trim(),employmentStatus:$("#staffStatusInput").value,attendanceRequired:$("#staffAttendanceRequired").checked});toast("Staff attendance profile updated.","success");await searchStaff()}catch(error){toast(error.message,"error")}
}

async function loadCredentials(id){
  try{const data=await read("credentials",{staffId:id});state.credentials[id]=data.credentials||[];renderCredentials(id)}catch(error){toast(error.message,"error")}
}

function renderCredentials(id){
  const container=$("#staffCredentialList"),items=state.credentials[id]||[];container.innerHTML="";
  if(!items.length){container.innerHTML='<div class="empty-state"><h4>No credentials issued</h4><p>Issue a QR, NFC, RFID or hybrid credential.</p></div>';return}
  items.forEach(item=>{const card=document.createElement("div");card.className="credential-card";card.innerHTML=`<div><h4>${esc(String(item.credential_type||"credential").toUpperCase())}</h4><p>${esc(item.credential_label||"Staff attendance credential")} • ending ${esc(item.token_last4||"----")}</p></div><div><span class="status-chip ${item.status==="active"?"present":"inactive"}">${esc(item.status)}</span>${item.status==="active"?`<button class="text-button">Suspend</button>`:""}</div>`;const suspend=card.querySelector("button");if(suspend)suspend.addEventListener("click",()=>suspendCredential(item.credential_id));container.appendChild(card)});
}

function showSecret(title,secret,onPrint){
  const dialog=document.createElement("dialog");dialog.innerHTML=`<div class="dialog-card"><div class="dialog-header"><div><p class="eyebrow">DISPLAYED ONCE</p><h2>${esc(title)}</h2></div><button class="icon-button close">×</button></div><p class="dialog-note">Store or program this credential now. The database retains only its secure hash.</p><pre class="staff-secret">${esc(secret)}</pre><div class="dialog-actions"><button class="secondary-button copy">Copy</button>${onPrint?'<button class="primary-button print">Prepare staff QR card</button>':""}<button class="primary-button close">Done</button></div></div>`;document.body.appendChild(dialog);dialog.querySelectorAll(".close").forEach(b=>b.addEventListener("click",()=>dialog.close()));dialog.querySelector(".copy").addEventListener("click",async()=>{await navigator.clipboard.writeText(secret);toast("Credential copied.","success")});const print=dialog.querySelector(".print");if(print)print.addEventListener("click",onPrint);dialog.addEventListener("close",()=>dialog.remove());dialog.showModal();
}

async function issueCredential(type){
  const person=selectedStaff();if(!person)return toast("Select a staff member first.","error");
  const active=(state.credentials[person.id]||[]).find(c=>c.credential_type===type&&c.status==="active");if(active&&!confirm(`This staff member already has an active ${type.toUpperCase()} credential. Replace it?`))return;
  const label=prompt("Credential label",`Staff attendance ${type.toUpperCase()} credential`);if(label===null)return;
  try{const result=await write("issueCredential",{staffId:person.id,credentialType:type,label:label.trim()});await loadCredentials(person.id);const token=result.credential?.raw_token;if(!token)throw new Error("Credential issued but one-time token was not returned.");showSecret(`${type.toUpperCase()} credential for ${person.full_name}`,token,type==="qr"?()=>{sessionStorage.setItem(STAFF_PRINT_KEY,JSON.stringify([{name:person.full_name,staff_number:person.staff_number||"",category:person.staff_category,designation:person.designation||"",department:person.department||"",photo:person.photo||"",session:"2026/2027",credential_token:token}]));window.open("./staff-qr-print.html","_blank","noopener")}:null);toast(`${type.toUpperCase()} staff credential issued.`,"success")}catch(error){toast(error.message,"error")}
}

async function suspendCredential(id){
  const reason=prompt("Reason for suspension","Lost, damaged or compromised staff credential");if(!reason?.trim())return;if(!confirm("Suspend this staff credential immediately?"))return;
  try{await write("suspendCredential",{credentialId:id,reason:reason.trim()});await loadCredentials(selectedStaffId);toast("Staff credential suspended.","success")}catch(error){toast(error.message,"error")}
}

function renderRule(){
  const rule=state.rules.find(r=>r.is_active)||state.rules[0]||null;$("#staffRuleBanner").hidden=Boolean(rule?.is_active);const status=$("#staffRuleStatus");status.textContent=rule?.is_active?"Active":"Not configured";status.className=`status-chip ${rule?.is_active?"present":"inactive"}`;
  if(!rule)return;
  $("#staffRuleId").value=rule.id||"";$("#staffRuleName").value=rule.name||"Staff Standard Workday";$("#staffCheckInOpens").value=(rule.check_in_opens||"").slice(0,5);$("#staffOnTimeUntil").value=(rule.on_time_until||"").slice(0,5);$("#staffAbsenceCutoff").value=(rule.absence_cutoff||"").slice(0,5);$("#staffEarliestCheckout").value=(rule.earliest_checkout||"").slice(0,5);$("#staffExpectedEnd").value=(rule.expected_end||"").slice(0,5);$("#staffRuleActive").checked=rule.is_active===true;const days=new Set(rule.work_days||[]);$$("#staffWeekdays input").forEach(box=>box.checked=days.has(Number(box.value)));
}

async function saveRule(event){
  event.preventDefault();const required=[$("#staffCheckInOpens").value,$("#staffOnTimeUntil").value,$("#staffAbsenceCutoff").value,$("#staffExpectedEnd").value];if($("#staffRuleActive").checked&&required.some(v=>!v))return toast("Check-in, on-time deadline, absence cutoff and expected closing time are required before activation.","error");
  const workDays=$$("#staffWeekdays input:checked").map(box=>Number(box.value));if(!workDays.length)return toast("Select at least one working day.","error");
  try{await write("saveRule",{ruleId:$("#staffRuleId").value||null,name:$("#staffRuleName").value.trim(),timezone:"Africa/Lagos",workDays,checkInOpens:$("#staffCheckInOpens").value,onTimeUntil:$("#staffOnTimeUntil").value,absenceCutoff:$("#staffAbsenceCutoff").value,earliestCheckout:$("#staffEarliestCheckout").value,expectedEnd:$("#staffExpectedEnd").value,categories:["teaching","non_teaching","management","contract","casual"],modalities:["qr","nfc","rfid","usb_hid","usb_ccid","standalone_terminal"],academicSession:"2026/2027",termScope:"All Terms",isActive:$("#staffRuleActive").checked});toast("Staff working-hour rule saved.","success");await loadRules();await loadOverview()}catch(error){toast(error.message,"error")}
}

async function loadRules(){const data=await read("rules");state.rules=data.rules||[];renderRule()}

async function loadHistory(){
  if(!selectedStaffId)return toast("Select a staff member from the directory or credential list first.","error");
  try{const data=await read("history",{staffId:selectedStaffId,from:$("#staffHistoryFrom").value,to:$("#staffHistoryTo").value});state.history=data.history||[];renderHistory()}catch(error){toast(error.message,"error")}
}

function mins(value){const n=Number(value||0);return `${Math.floor(n/60)}h ${n%60}m`}
function time(value){return value?new Date(value).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"}):"—"}
function renderHistory(){
  const person=selectedStaff();$("#historyTitle").textContent=person?`${person.full_name} — digital time book`:"Digital attendance history";$("#staffHistoryEmpty").hidden=state.history.length>0;$("#staffHistoryTableWrap").classList.toggle("hidden",!state.history.length);$("#staffHistoryBody").innerHTML=state.history.map(row=>`<tr><td>${esc(row.attendance_date)}</td><td>${time(row.first_check_in)}</td><td>${time(row.last_check_out)}</td><td>${esc(row.daily_status)}</td><td>${row.late_minutes||0} min</td><td>${row.early_departure_minutes||0} min</td><td>${mins(row.worked_minutes)}</td><td>${row.overtime_minutes||0} min</td></tr>`).join("");
}

function exportHistory(){
  if(!state.history.length)return toast("Load a staff attendance history first.","error");const person=selectedStaff();const rows=[["Date","Check-in","Check-out","Status","Late minutes","Early departure minutes","Worked minutes","Overtime minutes"],...state.history.map(r=>[r.attendance_date,r.first_check_in||"",r.last_check_out||"",r.daily_status,r.late_minutes,r.early_departure_minutes,r.worked_minutes,r.overtime_minutes])];const csv=rows.map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${(person?.full_name||"staff").replaceAll(/\s+/g,"_")}_attendance.csv`;a.click();URL.revokeObjectURL(url);
}

async function loadOverview(){const [context,snapshot]=await Promise.all([read("context"),read("snapshot")]);state.context=context;state.snapshot=snapshot;renderMetrics();renderEvents();renderCategories();$("#staffSessionPill").textContent=`${snapshot.academic_session||"2026/2027"} • 1st Term`;$("#staffRuleBanner").hidden=Boolean(context.active_rule)}

async function connectLive(){
  try{await loadOverview();const [staff,rules]=await Promise.all([read("staff",{}),read("rules")]);state.staff=staff.staff||[];state.rules=rules.rules||[];state.live=true;renderStaffList();renderStaffList("#credentialStaffList");renderRule();$("#staffConnectButton").textContent="Connected";toast("Live staff attendance connected.","success")}catch(error){state.live=false;toast(`Connection failed: ${error.message}`,"error")}
}

function initDates(){const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),first=`${local.slice(0,8)}01`;$("#staffHistoryFrom").value=first;$("#staffHistoryTo").value=local}
function bind(){
  $$(".staff-tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
  $("#staffConnectButton").addEventListener("click",()=>{const auth=connection();$("#staffAdminCode").value=auth?.adminCode||"";$("#staffAdminSecret").value=auth?.adminSecret||"";$("#staffConnectionDialog").showModal()});
  $("#staffConnectionForm").addEventListener("submit",event=>{event.preventDefault();const adminCode=$("#staffAdminCode").value.trim(),adminSecret=$("#staffAdminSecret").value.trim();if(!adminCode||!adminSecret)return toast("Administrator code and secret are required.","error");localStorage.setItem(STORAGE_KEY,JSON.stringify({adminCode,adminSecret}));$("#staffConnectionDialog").close();connectLive()});
  $("#staffSearchButton").addEventListener("click",()=>searchStaff("directory"));$("#staffCategoryFilter").addEventListener("change",()=>searchStaff("directory"));$("#staffProfileForm").addEventListener("submit",saveProfile);
  $("#credentialStaffSearchButton").addEventListener("click",()=>searchStaff("credentials"));$$('[data-staff-credential]').forEach(b=>b.addEventListener("click",()=>issueCredential(b.dataset.staffCredential)));
  $("#staffRuleForm").addEventListener("submit",saveRule);$("#staffHistoryButton").addEventListener("click",loadHistory);$("#exportStaffHistoryButton").addEventListener("click",exportHistory);
  $("#historyStaffSearch").addEventListener("change",()=>{const text=$("#historyStaffSearch").value.trim().toLowerCase();const match=state.staff.find(s=>s.full_name.toLowerCase().includes(text)||String(s.staff_number||"").toLowerCase()===text);if(match){selectedStaffId=match.id;toast(`${match.full_name} selected.`,"success")}});
}

initDates();bind();renderMetrics();renderEvents();renderCategories();renderStaffList();renderStaffList("#credentialStaffList");
if(connection())connectLive();
