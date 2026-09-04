(function(){
'use strict';

var S={image:'',canvas:null,sheet:null,page:0,cells:[],existing:{},fingerprint:'',corrections:0,history:[]};
var PARTS=['ca1','ca2','ca3','exam'];
var LABELS={ca1:'CA1',ca2:'CA2',ca3:'CA3',exam:'Exam'};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function clsLabel(key){return window.DEPTS&&DEPTS[key]?DEPTS[key].label:key;}
function classes(){return Object.keys(window.DEPTS||{}).sort(function(a,b){return clsLabel(a).localeCompare(clsLabel(b));});}
function subjectList(key){try{return configuredSubjects(key,getCfg())||[];}catch(e){return[];}}
function options(items,value,label){return items.map(function(x){var v=value?value(x):x;return'<option value="'+esc(v)+'">'+esc(label?label(x):x)+'</option>';}).join('');}
function api(action,payload){return resultDataRequest(action,payload||{});}
function root(){return document.getElementById('smart-recording-root');}

window.renderSmartRecording=function(){
  var el=root();if(!el)return;
  el.innerHTML='<div class="smart-shell">'
    +'<section class="smart-hero"><h2>Smart Recording</h2><p>Scan a generated WTS score sheet. The sheet identifies the class and subject automatically.</p></section>'
    +'<div id="smart-work">'+startMarkup()+'</div>'
    +'<section class="smart-card smart-history"><h3>Recent Smart Recording history</h3><div id="smart-history-list"><div class="smart-empty">Loading history…</div></div></section>'
    +'</div>';
  bindStart();loadHistory();
};

function startMarkup(){
  return '<div class="smart-actions">'
    +'<section class="smart-card"><h3>Scan score sheet</h3><p>Photograph the full page in good light. Keep all four corners visible.</p>'
    +'<input class="smart-hidden" id="smart-file" type="file" accept="image/*" capture="environment">'
    +'<button class="smart-scan-button" id="smart-scan"><span style="font-size:1.5rem">▣</span> SCAN SHEET</button>'
    +'<button class="smart-secondary" id="smart-upload">Choose an existing photo</button></section>'
    +'<section class="smart-card"><h3>Generate a Smart Score Sheet</h3><p>Print a controlled sheet with a unique QR identifier and fixed score boxes.</p>'
    +generatorMarkup()+'</section></div>';
}

function generatorMarkup(){
  var session=(window.getActiveSession?getActiveSession():'');var term=window.TERM||'1st Term';
  return '<div class="smart-form"><label>Class<select id="smart-gen-class"><option value="">Select class</option>'+options(classes(),null,clsLabel)+'</select></label>'
    +'<label>Subject<select id="smart-gen-subject"><option value="">Select class first</option></select></label>'
    +'<label>Session<input id="smart-gen-session" value="'+esc(session)+'" readonly></label>'
    +'<label>Term<select id="smart-gen-term">'+options(['1st Term','2nd Term','3rd Term'])+'</select></label>'
    +'<button class="smart-secondary smart-wide" id="smart-generate">GENERATE &amp; PRINT</button></div>';
}

function bindStart(){
  var file=document.getElementById('smart-file');
  document.getElementById('smart-scan').onclick=function(){file.setAttribute('capture','environment');file.click();};
  document.getElementById('smart-upload').onclick=function(){file.removeAttribute('capture');file.click();};
  file.onchange=function(){if(file.files&&file.files[0])prepareImage(file.files[0]);};
  var gc=document.getElementById('smart-gen-class');var gs=document.getElementById('smart-gen-subject');
  gc.onchange=function(){var list=subjectList(gc.value);gs.innerHTML='<option value="">Select subject</option>'+list.map(function(s,i){return'<option value="'+i+'">'+esc(s)+'</option>';}).join('');};
  var gt=document.getElementById('smart-gen-term');if(gt)gt.value=window.TERM||'1st Term';
  document.getElementById('smart-generate').onclick=generateSheet;
}

window.openSmartSheetGenerator=function(){
  navTo('smart',document.getElementById('ni-smart'));
  setTimeout(function(){var c=document.getElementById('smart-gen-class');if(c&&window.CLS){c.value=CLS;c.dispatchEvent(new Event('change'));}},0);
};

function prepareImage(file){
  if(!/^image\//.test(file.type||'')){showToast('Choose a photo of the score sheet.','error');return;}
  showLoad('Preparing sheet…');
  decodeImage(file).then(function(bitmap){
    var width=bitmap.naturalWidth||bitmap.width,height=bitmap.naturalHeight||bitmap.height;
    var scale=Math.min(1,1800/Math.max(width,height));
    var canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    var ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    S.canvas=canvas;S.image=canvas.toDataURL('image/jpeg',.82);hideLoad();
    return detectQr(canvas);
  }).then(function(identity){
    if(identity){S.page=identity.page;loadIdentifiedSheet(identity.id);}else showIdentification();
  }).catch(function(){hideLoad();showToast('This image could not be opened.','error');});
}

function decodeImage(file){
  if(typeof createImageBitmap==='function')return createImageBitmap(file);
  return new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=reject;reader.onload=function(){var img=new Image();img.onload=function(){resolve(img);};img.onerror=reject;img.src=reader.result;};reader.readAsDataURL(file);});
}

function detectQr(canvas){
  if('BarcodeDetector' in window)try{
    var detector=new BarcodeDetector({formats:['qr_code']});
    return detector.detect(canvas).then(function(codes){
      for(var i=0;i<codes.length;i++){var found=parseSheetCode(codes[i].rawValue);if(found)return found;}return detectQrPixels(canvas);
    }).catch(function(){return detectQrPixels(canvas);});
  }catch(e){}
  return Promise.resolve(detectQrPixels(canvas));
}
function detectQrPixels(canvas){try{if(typeof window.jsQR!=='function')return null;var ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height),code=window.jsQR(data.data,data.width,data.height,{inversionAttempts:'attemptBoth'});return code?parseSheetCode(code.data):null;}catch(e){return null;}}
function parseSheetCode(raw){
  var match=/WTS-SR1:([0-9a-f-]{36})(?::(\d+))?/i.exec(String(raw||''));
  if(!match)return null;return{id:match[1],page:Number(match[2]||0)};
}

function showIdentification(){
  var w=document.getElementById('smart-work');
  w.innerHTML='<section class="smart-card"><h3>Sheet identification</h3><p>The QR could not be read. Select the sheet details and extraction will continue.</p>'
    +'<img class="smart-image" src="'+S.image+'" alt="Captured score sheet">'
    +'<div class="smart-identify"><div class="smart-form">'
    +'<label>Class<select id="smart-id-class"><option value="">Select class</option>'+options(classes(),null,clsLabel)+'</select></label>'
    +'<label>Subject<select id="smart-id-subject"><option value="">Select class first</option></select></label>'
    +'<label>Session<input id="smart-id-session" value="'+esc(getActiveSession())+'" readonly></label>'
    +'<label>Term<select id="smart-id-term">'+options(['1st Term','2nd Term','3rd Term'])+'</select></label>'
    +'<button class="smart-secondary smart-wide" id="smart-identify-button">CONTINUE</button></div></div></section>';
  var c=document.getElementById('smart-id-class'),s=document.getElementById('smart-id-subject');
  c.onchange=function(){s.innerHTML='<option value="">Select subject</option>'+subjectList(c.value).map(function(x,i){return'<option value="'+i+'">'+esc(x)+'</option>';}).join('');};
  document.getElementById('smart-id-term').value=window.TERM||'1st Term';
  document.getElementById('smart-identify-button').onclick=function(){
    if(!c.value||s.value===''){showToast('Select the class and subject.','error');return;}
    showLoad('Finding generated sheet…');
    api('context.set',{class_key:c.value,academic_session:document.getElementById('smart-id-session').value,term:document.getElementById('smart-id-term').value})
      .then(function(){return api('smart.sheet.read',{class_key:c.value,subject_index:Number(s.value),academic_session:document.getElementById('smart-id-session').value,term:document.getElementById('smart-id-term').value});})
      .then(function(data){hideLoad();S.page=0;beginExtraction(data.sheet);}).catch(function(e){hideLoad();showToast(e&&e.code==='SMART_SHEET_NOT_FOUND'?'Generate this Smart Score Sheet first.':'Sheet identification failed.','error');});
  };
}

function loadIdentifiedSheet(id){
  showLoad('Identifying sheet…');
  api('smart.sheet.read',{sheet_id:id}).then(function(data){hideLoad();beginExtraction(data.sheet);}).catch(function(){hideLoad();showIdentification();});
}

function beginExtraction(sheet){
  S.sheet=sheet;showLoad('Reading handwritten scores…');
  fetch('/api/smart-recording',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({action:'extract',sheet_id:sheet.id,page_index:S.page,image_data_url:S.image})})
    .then(function(res){return res.json().then(function(data){if(!res.ok||!data.ok)throw data;return data;});})
    .then(function(data){hideLoad();S.sheet=data.sheet;S.cells=data.extraction.cells;S.fingerprint=data.image_fingerprint;S.corrections=0;indexExisting(data.existing_scores||[]);renderReview();})
    .catch(function(e){hideLoad();var msg=e&&e.code==='SMART_RECORDING_PROVIDER_NOT_CONFIGURED'?'Smart Recording extraction is not configured on the server yet.':'Scores could not be extracted from this photo. Try a clearer full-page photo.';showToast(msg,'error');showIdentification();});
}

function indexExisting(rows){S.existing={};rows.forEach(function(r){S.existing[r.student_id]=r;});}
function studentCells(id){return S.cells.filter(function(c){return c.student_id===id;});}
function conflict(cell){var row=S.existing[cell.student_id];if(!row||row[cell.component]===null||row[cell.component]===undefined||cell.value===null)return false;return Number(row[cell.component])!==Number(cell.value);}
function unresolved(){return S.cells.filter(function(c){return ['needs_review','out_of_range','extraction_failure'].indexOf(c.status)>-1;}).length;}
function unresolvedConflicts(){return S.cells.filter(function(c){return c.status==='confirmed'&&conflict(c)&&!c.decision;}).length;}
function counts(){return S.cells.reduce(function(a,c){if(c.status==='confirmed')a.ready++;else if(c.status==='blank')a.blank++;else a.review++;return a;},{ready:0,review:0,blank:0});}

function renderReview(){
  var roster=(S.sheet.roster||[]).filter(function(r){return Number(r.page_index||0)===Number(S.page);});var n=counts();
  var html='<section class="smart-stage"><div class="smart-stage-head"><div><h3>'+esc(clsLabel(S.sheet.class_key))+' · '+esc(S.sheet.subject_name)+'</h3><div style="font-size:.75rem;opacity:.8;margin-top:4px">'+esc(S.sheet.term)+' · '+esc(S.sheet.academic_session)+' · '+roster.length+' students</div></div>'
    +'<div class="smart-summary"><span class="smart-pill">'+n.ready+' scores ready</span><span class="smart-pill review">'+n.review+' need review</span><span class="smart-pill blank">'+n.blank+' blank</span></div></div>'
    +'<div class="smart-table-wrap"><table class="smart-table"><thead><tr><th>#</th><th>Student</th>'+PARTS.map(function(p){return'<th>'+LABELS[p]+'<br><small>MAX '+S.sheet.assessment_config[p]+'</small></th>';}).join('')+'</tr></thead><tbody>';
  roster.forEach(function(st){html+='<tr><td>'+st.row_index+'</td><td class="smart-student">'+esc(st.name)+'</td>';PARTS.forEach(function(p){var cell=S.cells.find(function(c){return c.student_id===st.student_id&&c.component===p;});html+='<td>'+cellButton(cell)+'</td>';});html+='</tr>';});
  html+='</tbody></table></div><div class="smart-footer"><button class="smart-secondary" style="width:auto;margin:0" onclick="renderSmartRecording()">Start again</button><button class="smart-save" id="smart-save" '+((unresolved()||unresolvedConflicts())?'disabled':'')+'>SAVE SCORES</button></div></section>';
  document.getElementById('smart-work').innerHTML=html;
  document.querySelectorAll('[data-smart-cell]').forEach(function(btn){btn.onclick=function(){openCell(btn.getAttribute('data-smart-cell'));};});
  document.getElementById('smart-save').onclick=saveScores;
}
function cellButton(cell){
  if(!cell)return'<button class="smart-cell extraction_failure">Review</button>';
  var value=cell.status==='blank'?'—':cell.value===null?'Review':cell.value;var extra=conflict(cell)?' conflict':'';
  return'<button class="smart-cell '+cell.status+extra+'" data-smart-cell="'+cell.student_id+'|'+cell.component+'" title="'+esc(cell.reason)+'">'+esc(value)+(conflict(cell)?'<small style="display:block">saved '+esc(S.existing[cell.student_id][cell.component])+'</small>':'')+'</button>';
}

function cropFor(cell){
  if(!S.canvas||!S.sheet)return'';var g=S.sheet.geometry||{},t=g.table||{},col=(g.columns||{})[cell.component]||{};
  var cw=Number(g.canonical_width)||1240,ch=Number(g.canonical_height)||1754;
  var x=(Number(col.x)||0)/cw*S.canvas.width,y=((Number(t.y)||0)+(cell.page_row||1)*(Number(t.row_height)||33))/ch*S.canvas.height;
  var w=(Number(col.width)||100)/cw*S.canvas.width,h=(Number(t.row_height)||33)/ch*S.canvas.height;
  var out=document.createElement('canvas');out.width=420;out.height=150;var ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(S.canvas,Math.max(0,x-w*.15),Math.max(0,y-h*.25),w*1.3,h*1.5,0,0,out.width,out.height);return out.toDataURL('image/jpeg',.9);
}
function openCell(key){
  var bits=key.split('|'),cell=S.cells.find(function(c){return c.student_id===bits[0]&&c.component===bits[1];});if(!cell)return;
  var saved=S.existing[cell.student_id]&&S.existing[cell.student_id][cell.component];var hasConflict=conflict(cell);
  var box=document.createElement('div');box.className='smart-review-backdrop';box.id='smart-cell-review';
  box.innerHTML='<div class="smart-review-panel"><h3>'+esc(cell.student_name)+' · '+LABELS[cell.component]+'</h3><p style="font-size:.78rem;color:#4a5568;margin-top:5px">Maximum score: '+cell.maximum+'</p>'
    +'<img class="smart-crop" src="'+cropFor(cell)+'" alt="Original score cell">'
    +'<label style="font-size:.75rem;font-weight:700">Detected / corrected value</label><input class="smart-value" id="smart-correct-value" type="number" min="0" max="'+cell.maximum+'" value="'+(cell.value==null?'':cell.value)+'">'
    +(hasConflict?'<div style="margin-top:13px;padding:11px;background:#fff3f3;border-radius:9px;font-size:.78rem">This student already has a saved '+LABELS[cell.component]+' score of <strong>'+esc(saved)+'</strong>. Scanned value: <strong>'+esc(cell.value)+'</strong>.</div><div class="smart-choice"><button data-choice="keep_existing">KEEP EXISTING</button><button data-choice="use_scanned">USE SCANNED VALUE</button></div>':'')
    +'<div style="display:flex;gap:9px;margin-top:14px"><button class="smart-secondary" id="smart-cancel-review">Cancel</button><button class="smart-save" style="flex:1" id="smart-confirm-review">Confirm</button></div></div>';
  document.body.appendChild(box);
  if(hasConflict){box.querySelectorAll('[data-choice]').forEach(function(b){if(cell.decision===b.dataset.choice)b.classList.add('selected');b.onclick=function(){box.querySelectorAll('[data-choice]').forEach(function(x){x.classList.remove('selected');});b.classList.add('selected');cell._pendingDecision=b.dataset.choice;};});}
  document.getElementById('smart-cancel-review').onclick=function(){box.remove();};
  document.getElementById('smart-confirm-review').onclick=function(){var input=document.getElementById('smart-correct-value'),value=input.value===''?null:Number(input.value);if(value===null){cell.value=null;cell.status='blank';cell.decision=null;}else if(!isFinite(value)||value<0||value>cell.maximum){showToast('Enter a score from 0 to '+cell.maximum+'.','error');return;}else{if(value!==cell.detected_value)S.corrections++;cell.value=value;cell.status='confirmed';cell.reason='Reviewed and ready';if(conflict(cell))cell.decision=cell._pendingDecision||cell.decision;else cell.decision=null;}box.remove();renderReview();};
}

function saveScores(){
  if(unresolved()||unresolvedConflicts()){showToast('Review the highlighted scores and saved-score conflicts first.','error');return;}
  var grouped={};S.cells.forEach(function(c){if(c.status!=='confirmed'||c.value===null)return;var row=grouped[c.student_id]||(grouped[c.student_id]={student_id:c.student_id,scores:{},existing:{},decisions:{}});row.scores[c.component]=c.value;var old=S.existing[c.student_id];if(old&&Object.prototype.hasOwnProperty.call(old,c.component))row.existing[c.component]=old[c.component];if(c.decision)row.decisions[c.component]=c.decision;});
  var rows=Object.keys(grouped).map(function(k){return grouped[k];});if(!rows.length){showToast('There are no recognised scores to save.','error');return;}
  showLoad('Saving scores to Result Portal…');
  api('smart.scores.commit',{sheet_id:S.sheet.id,rows:rows,image_fingerprint:S.fingerprint,summary:{scores_extracted:S.cells.filter(function(c){return c.value!==null;}).length,corrections_made:S.corrections,page_index:S.page}})
    .then(function(data){hideLoad();applyLocal(rows);showToast(data.score_fields_saved+' scores saved');document.getElementById('smart-work').innerHTML='<section class="smart-card" style="text-align:center;padding:30px"><div style="font-size:2.4rem;color:#15956b">✓</div><h3>Scores saved</h3><p>'+data.score_fields_saved+' score fields are now in the normal Result Portal records.</p><button class="smart-scan-button" onclick="renderSmartRecording()">SCAN ANOTHER SHEET</button></section>';loadHistory();})
    .catch(function(e){hideLoad();showToast(e&&e.code==='SMART_EXISTING_SCORE_CHANGED'?'A saved score changed during review. Re-scan before overwriting.':'Scores were not saved: '+esc(e&&e.code||'request failed'),'error');});
}
function applyLocal(rows){if(!window.DB_SCORES)return;rows.forEach(function(r){var old=S.existing[r.student_id]||{};var final={ca1:old.ca1==null?'':old.ca1,ca2:old.ca2==null?'':old.ca2,ca3:old.ca3==null?'':old.ca3,exam:old.exam==null?'':old.exam};PARTS.forEach(function(p){if(Object.prototype.hasOwnProperty.call(r.scores,p)&&r.decisions[p]!=='keep_existing')final[p]=r.scores[p];});if(!DB_SCORES[r.student_id])DB_SCORES[r.student_id]={};DB_SCORES[r.student_id][S.sheet.subject_index]=final;});}

function generateSheet(){
  var c=document.getElementById('smart-gen-class'),s=document.getElementById('smart-gen-subject'),term=document.getElementById('smart-gen-term'),session=document.getElementById('smart-gen-session');
  if(!c.value||s.value===''){showToast('Select a class and subject.','error');return;}showLoad('Generating identified score sheet…');
  api('context.set',{class_key:c.value,term:term.value,academic_session:session.value})
    .then(function(){return api('smart.sheet.create',{class_key:c.value,subject_index:Number(s.value),term:term.value,academic_session:session.value,assessment_config:{ca1:10,ca2:10,ca3:10,exam:70}});})
    .then(function(data){hideLoad();printSheet(data.sheet);loadHistory();}).catch(function(e){hideLoad();showToast('Sheet was not generated: '+esc(e&&e.code||'request failed'),'error');});
}

function qrData(textValue){return new Promise(function(resolve,reject){try{if(typeof window.qrcode!=='function')throw new Error('QR library unavailable');var qr=window.qrcode(0,'M');qr.addData(textValue);qr.make();resolve(qr.createDataURL(5,2));}catch(e){reject(e);}});}
function printSheet(sheet){
  var pages=Math.ceil((sheet.roster||[]).length/40),jobs=[];for(var p=0;p<pages;p++)jobs.push(qrData('WTS-SR1:'+sheet.id+':'+p));
  Promise.all(jobs).then(function(qrs){var body='';for(var p=0;p<pages;p++){var rows=sheet.roster.filter(function(r){return Number(r.page_index)===p;});body+='<section class="smart-print-page"><i class="smart-mark tl"></i><i class="smart-mark tr"></i><i class="smart-mark bl"></i><i class="smart-mark br"></i><header class="smart-print-header"><div class="smart-print-title"><h1>'+esc((getSchool()||{}).name||'Way to Success Standard Schools')+'</h1><h2>SMART SCORE SHEET · '+esc(sheet.subject_name)+'</h2><p>'+esc(clsLabel(sheet.class_key))+' · '+esc(sheet.term)+' · '+esc(sheet.academic_session)+' · Page '+(p+1)+' of '+pages+'</p><p>Write one score clearly inside each box. Leave missing scores blank.</p></div><div><img class="smart-print-qr" src="'+qrs[p]+'"><div class="smart-print-code">'+esc(sheet.sheet_code)+' · '+(p+1)+'</div></div></header><table class="smart-print-table"><thead><tr><th class="num">#</th><th class="name">STUDENT</th><th class="adm">ADM. NO.</th><th class="score">CA1 / '+sheet.assessment_config.ca1+'</th><th class="score">CA2 / '+sheet.assessment_config.ca2+'</th><th class="score">CA3 / '+sheet.assessment_config.ca3+'</th><th class="score">EXAM / '+sheet.assessment_config.exam+'</th></tr></thead><tbody>'+rows.map(function(r){return'<tr><td class="num">'+r.row_index+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.admno||'')+'</td><td></td><td></td><td></td><td></td></tr>';}).join('')+'</tbody></table></section>';}
    var win=window.open('','_blank');if(!win){showToast('Allow pop-ups to print the Smart Score Sheet.','error');return;}win.document.write('<!doctype html><html><head><title>'+esc(sheet.subject_name)+' Smart Score Sheet</title><link rel="stylesheet" href="'+location.origin+'/smart-recording.css"></head><body>'+body+'<script>onload=function(){setTimeout(function(){print()},400)}<\/script></body></html>');win.document.close();
  }).catch(function(){showToast('The QR could not be generated. Check the connection and try again.','error');});
}

function loadHistory(){var el=document.getElementById('smart-history-list');if(!el)return;api('smart.history.read',{limit:30}).then(function(data){S.history=data.rows||[];if(!S.history.length){el.innerHTML='<div class="smart-empty">No Smart Recording saves yet.</div>';return;}el.innerHTML=S.history.map(function(r){return'<div class="smart-history-row"><strong>'+esc(clsLabel(r.class_key))+' · '+esc(r.subject_name)+'</strong><span>'+esc(r.term)+' · '+esc(r.academic_session)+'</span><span>'+new Date(r.scanned_at).toLocaleString()+'</span><span class="smart-pill">'+r.scores_saved+' saved</span></div>';}).join('');}).catch(function(){el.innerHTML='<div class="smart-empty">History is unavailable.</div>';});}

})();
