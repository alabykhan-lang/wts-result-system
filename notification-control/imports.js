"use strict";
(async function(){
  const cfg=await window.WTSNotificationConfigReady;
  const session=window.WTSNotificationSession;
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const requiredHeaders=["studentAdmissionNumber","studentName","guardianName","relationship","phone","whatsappNumber","email","preferredChannels","isPrimary","preferredLanguage","consentStatus","consentSource","notes"];
  const state={rows:[],filename:"",batches:[],currentBatch:null};
  const esc=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const badge=v=>`<span class="badge ${esc(String(v||"unknown").toLowerCase())}">${esc(String(v||"unknown").replaceAll("_"," "))}</span>`;
  function toast(message,type="default"){const n=document.createElement("div");n.className=`toast ${type}`;n.textContent=String(message||"Request failed.");$("#toastContainer").appendChild(n);setTimeout(()=>n.remove(),4500);}
  async function credentials(){const v=await session.get();if(!v)throw new Error("Administrator login required.");return v;}
  async function rpc(fn,action,payload={}){const auth=await credentials();const response=await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:cfg.publishableKey},body:JSON.stringify({p_client_code:auth.adminCode,p_client_secret:auth.adminSecret,p_action:action,p_payload:payload})});let data;try{data=await response.json();}catch{data={ok:false,code:"INVALID_SERVER_RESPONSE"};}if(!response.ok||data?.ok===false)throw new Error(data?.code||data?.error||"Guardian import request failed.");await session.refresh();return data;}
  const read=(action,payload={})=>rpc("school_guardian_import_admin_read_api",action,payload);
  const write=(action,payload={})=>rpc("school_guardian_import_admin_write_api",action,payload);

  function parseCsv(text){
    const rows=[];let row=[],cell="",quoted=false;
    const source=String(text||"").replace(/^\uFEFF/,"");
    for(let i=0;i<source.length;i++){
      const ch=source[i],next=source[i+1];
      if(ch==='"'){
        if(quoted&&next==='"'){cell+='"';i++;}
        else quoted=!quoted;
      }else if(ch===','&&!quoted){row.push(cell);cell="";}
      else if((ch==='\n'||ch==='\r')&&!quoted){
        if(ch==='\r'&&next==='\n')i++;
        row.push(cell);cell="";
        if(row.some(v=>String(v).trim()!==""))rows.push(row);
        row=[];
      }else cell+=ch;
    }
    if(cell!==""||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==""))rows.push(row);}
    if(quoted)throw new Error("CSV contains an unclosed quoted field.");
    return rows;
  }
  function asBoolean(value){return ["true","yes","1","y"].includes(String(value||"").trim().toLowerCase());}
  function normalizeRows(matrix){
    if(matrix.length<2)throw new Error("CSV must contain a header and at least one data row.");
    const headers=matrix[0].map(v=>String(v).trim());
    const missing=requiredHeaders.filter(h=>!headers.includes(h));
    const extra=headers.filter(h=>!requiredHeaders.includes(h));
    if(missing.length)throw new Error(`Missing required header(s): ${missing.join(", ")}`);
    if(extra.length)throw new Error(`Unexpected header(s): ${extra.join(", ")}`);
    const indexes=Object.fromEntries(headers.map((h,i)=>[h,i]));
    return matrix.slice(1).filter(r=>r.some(v=>String(v).trim()!=="")).map(r=>{
      const get=h=>String(r[indexes[h]]??"").trim();
      const channels=get("preferredChannels").split(/[|;,]/).map(v=>v.trim().toLowerCase()).filter(Boolean);
      return {
        studentAdmissionNumber:get("studentAdmissionNumber"),studentName:get("studentName"),guardianName:get("guardianName"),
        relationship:get("relationship"),phone:get("phone"),whatsappNumber:get("whatsappNumber"),email:get("email"),
        preferredChannels:channels.length?channels:["whatsapp"],isPrimary:asBoolean(get("isPrimary")),
        preferredLanguage:(get("preferredLanguage")||"english").toLowerCase(),
        consentStatus:(get("consentStatus")||"pending").toLowerCase(),consentSource:get("consentSource"),notes:get("notes")
      };
    });
  }
  async function loadFile(file){
    if(!file)return;
    if(!/\.csv$/i.test(file.name)&&file.type!=="text/csv")return toast("Choose a CSV file.","error");
    try{
      const text=await file.text(),matrix=parseCsv(text),rows=normalizeRows(matrix);
      if(rows.length>2000)throw new Error("Import files are limited to 2,000 rows.");
      state.rows=rows;state.filename=file.name;
      $("#fileSummary").classList.remove("hidden");$("#fileName").textContent=file.name;$("#parsedRows").textContent=rows.length;$("#headerStatus").textContent="Valid";$("#validateBatch").disabled=false;$("#previewNotice").textContent=`Showing ${Math.min(rows.length,100)} of ${rows.length}`;$("#batchName").value=$("#batchName").value||file.name.replace(/\.csv$/i,"");renderPreview();
    }catch(e){clearFile();$("#headerStatus").textContent="Invalid";toast(e.message,"error");}
  }
  function renderPreview(){
    const rows=state.rows.slice(0,100);$("#previewEmpty").classList.toggle("hidden",rows.length>0);
    $("#previewRows").innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.studentAdmissionNumber||"—")}</td><td>${esc(r.studentName||"—")}</td><td>${esc(r.guardianName||"—")}</td><td>${esc(r.relationship||"—")}</td><td>${esc(r.whatsappNumber||r.phone||"—")}</td><td>${esc(r.preferredLanguage)}</td><td>${badge(r.consentStatus)}</td></tr>`).join("");
  }
  function clearFile(){state.rows=[];state.filename="";$("#csvFile").value="";$("#fileSummary").classList.add("hidden");$("#validateBatch").disabled=true;$("#previewNotice").textContent="No file selected";$("#previewRows").innerHTML="";$("#previewEmpty").classList.remove("hidden");}
  async function validateBatch(){
    if(!state.rows.length)return toast("Choose a valid CSV file first.","error");
    const batchName=$("#batchName").value.trim();if(!batchName)return toast("Enter a batch name.","error");
    const button=$("#validateBatch");button.disabled=true;button.textContent="Validating…";
    try{const r=await write("validateBatch",{batchName,sourceFilename:state.filename,rows:state.rows});toast(`Validation complete: ${r.valid_rows} valid, ${r.invalid_rows} excluded.`,r.invalid_rows?"default":"success");clearFile();await Promise.all([loadSummary(),loadBatches()]);switchTab("batches");}
    catch(e){toast(e.message,"error");}
    finally{button.disabled=false;button.textContent="Validate batch";}
  }
  function switchTab(name){$$('.import-tab').forEach(t=>t.classList.toggle('active',t.id===`tab-${name}`));$$('.import-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));if(name==='batches')loadBatches();}
  async function renderSession(){const v=await session.get();$("#sessionStrip").classList.toggle("hidden",!v);$("#connectButton").textContent=v?"Manage session":"Administrator login";if(v)$("#sessionIdentity").textContent=`Signed in: ${String(v.adminCode).slice(0,5)}••••${String(v.adminCode).slice(-4)}`;}
  async function loadSummary(){try{const d=await read("summary");$("#batchCount").textContent=d.batches||0;$("#validatedCount").textContent=d.validated||0;$("#partialCount").textContent=d.partially_valid||0;$("#appliedCount").textContent=d.applied||0;$("#invalidRowCount").textContent=d.invalid_rows||0;}catch(e){toast(e.message,"error");}}
  async function loadRules(){try{const d=await read("template");$("#importRules").innerHTML=(d.rules||[]).map(r=>`<div class="rule">${esc(r)}</div>`).join("");}catch(e){$("#importRules").innerHTML="";}}
  async function loadBatches(){try{const d=await read("batches",{status:$("#batchStatus").value});state.batches=d.batches||[];renderBatches();}catch(e){toast(e.message,"error");}}
  function renderBatches(){
    const list=$("#batchList");$("#batchEmpty").classList.toggle("hidden",state.batches.length>0);
    list.innerHTML=state.batches.map(b=>`<article class="batch-card"><div class="batch-head"><div><strong>${esc(b.batch_name)}</strong><span>${esc(b.source_filename||"No filename")} • ${new Date(b.created_at).toLocaleString("en-NG")}</span></div>${badge(b.status)}</div><div class="batch-stats"><div><label>Total</label><b>${b.total_rows}</b></div><div><label>Valid</label><b>${b.valid_rows}</b></div><div><label>Invalid</label><b>${b.invalid_rows}</b></div><div><label>Applied</label><b>${b.applied_rows}</b></div></div>${b.notes?`<p>${esc(b.notes)}</p>`:""}<div class="row-actions"><button data-view-batch="${b.id}">Review rows</button>${["validated","partially_valid"].includes(b.status)?`<button data-apply-batch="${b.id}">Apply valid rows</button>`:""}${["validated","partially_valid","invalid"].includes(b.status)?`<button data-cancel-batch="${b.id}">Cancel</button>`:""}</div></article>`).join("");
    $$('[data-view-batch]').forEach(b=>b.onclick=()=>loadBatchRows(b.dataset.viewBatch));$$('[data-apply-batch]').forEach(b=>b.onclick=()=>applyBatch(b.dataset.applyBatch));$$('[data-cancel-batch]').forEach(b=>b.onclick=()=>cancelBatch(b.dataset.cancelBatch));
  }
  async function loadBatchRows(id){try{const d=await read("rows",{batchId:id});state.currentBatch=d.batch;$("#rowReviewTitle").textContent=d.batch?`${d.batch.batch_name} — ${d.batch.status}`:"Batch rows";$("#batchRowsEmpty").classList.toggle("hidden",(d.rows||[]).length>0);$("#batchRows").innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.row_number}</td><td><strong>${esc(r.student_name||"—")}</strong><span>${esc(r.student_admission_number||"")}</span></td><td>${esc(r.guardian_name)}<small>${esc(r.relationship||"")}</small></td><td>${esc(r.whatsapp_number||r.phone||r.email||"—")}</td><td>${esc(r.preferred_language)}</td><td>${badge(r.consent_status)}</td><td>${badge(r.match_status)}</td><td><span class="row-errors">${esc((r.validation_errors||[]).join(", ")||"—")}</span></td><td>${r.applied_guardian_id?"Yes":"No"}</td></tr>`).join("");switchTab("rows");}catch(e){toast(e.message,"error");}}
  async function applyBatch(id){const batch=state.batches.find(b=>b.id===id);if(!confirm(`Apply ${batch?.valid_rows||"the valid"} clean row(s) to the Central Registry? Invalid rows will remain excluded.`))return;try{const r=await write("applyBatch",{batchId:id});toast(`${r.applied_rows||0} guardian row(s) synchronized; ${r.failed_rows||0} apply failure(s).`,r.failed_rows?"default":"success");await Promise.all([loadSummary(),loadBatches()]);}catch(e){toast(e.message,"error");}}
  async function cancelBatch(id){if(!confirm("Cancel this unapplied import batch? The validation history will remain available."))return;try{await write("cancelBatch",{batchId:id});toast("Import batch cancelled.","success");await Promise.all([loadSummary(),loadBatches()]);}catch(e){toast(e.message,"error");}}
  async function openLogin(){const v=await session.get();$("#adminCode").value=v?.adminCode||"";$("#adminSecret").value=v?.adminSecret||"";$("#loginDialog").showModal();}
  async function loginSubmit(e){e.preventDefault();await session.set($("#adminCode").value.trim(),$("#adminSecret").value);try{await loadSummary();$("#loginDialog").close();await renderSession();toast("Guardian Import Center connected securely.","success");}catch(err){await session.clear(false);await renderSession();toast(err.message,"error");}}

  $$('.import-tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));$("#csvFile").onchange=e=>loadFile(e.target.files[0]);$("#clearFile").onclick=clearFile;$("#validateBatch").onclick=validateBatch;$("#refreshBatches").onclick=loadBatches;$("#batchStatus").onchange=loadBatches;$("#backToBatches").onclick=()=>switchTab("batches");$("#connectButton").onclick=openLogin;$("#loginForm").addEventListener("submit",loginSubmit);
  const zone=$("#dropZone");["dragenter","dragover"].forEach(n=>zone.addEventListener(n,e=>{e.preventDefault();zone.classList.add("dragover");}));["dragleave","drop"].forEach(n=>zone.addEventListener(n,e=>{e.preventDefault();zone.classList.remove("dragover");}));zone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
  window.addEventListener("wts-notification-session-expired",async()=>{await renderSession();toast("Administrator session expired. Sign in again.","error");});
  await renderSession();await loadRules();if(await session.get())Promise.all([loadSummary(),loadBatches()]).catch(e=>toast(e.message,"error"));
})();
