(function(){
'use strict';

var ROWS_PER_PAGE=58;
var PRIMARY_ROWS_PER_PAGE=50;
function rowsPerPageForClass(classKey){return isPrimary(classKey)?PRIMARY_ROWS_PER_PAGE:ROWS_PER_PAGE;}

var PARTS=['ca1','ca2','ca3','exam'];
var LABELS={ca1:'CA1',ca2:'CA2',ca3:'CA3',exam:'Exam'};
var S={image:'',canvas:null,sheet:null,sheets:[],page:0,cells:[],existing:{},fingerprint:'',corrections:0,generic:false,stream:null,timer:null,stable:0,bounds:null,batch:[]};

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function clsLabel(k){return window.DEPTS&&DEPTS[k]?DEPTS[k].label:k;}
function classes(){return Object.keys(window.DEPTS||{}).sort(function(a,b){return clsLabel(a).localeCompare(clsLabel(b));});}
function subjects(k){try{return configuredSubjects(k,getCfg())||[];}catch(e){return[];}}
function isPrimary(k){return /^(creche|kg1|kg2|nursery1|nursery2|primary[1-5])$/.test(String(k||''));}
function isSeniorDepartment(k){return /^ss[23]-/.test(String(k||''));}
function opts(a){return a.map(function(x){return'<option value="'+esc(x)+'">'+esc(x)+'</option>';}).join('');}
function api(a,p){return resultDataRequest(a,p||{});}
function root(){return document.getElementById('smart-recording-root');}
function clearCurrent(){S.image='';S.canvas=null;S.sheet=null;S.sheets=[];S.page=0;S.cells=[];S.existing={};S.fingerprint='';S.corrections=0;S.generic=false;}
function resetRun(){clearCurrent();S.batch=[];}
function currentEntry(){return{image:S.image,canvas:S.canvas,sheet:S.sheet,sheets:S.sheets,page:S.page,cells:S.cells,existing:S.existing,fingerprint:S.fingerprint,corrections:S.corrections,generic:S.generic};}
function queueCurrent(){if(!S.sheet&&!S.generic)return;S.batch.push(currentEntry());}

window.renderSmartRecording=function(area){stopScanner();resetRun();var el=root();if(!el)return;el.innerHTML='<div class="smart-shell"><section class="smart-hero"><button class="smart-hero-back" id="smart-back" style="display:none">← Menu</button><h2>Smart Recording</h2><p>Scan, review and save generated score sheets.</p></section><div id="smart-work"></div></div>';openArea(area||'menu');};
function openArea(area){var w=document.getElementById('smart-work'),back=document.getElementById('smart-back');if(!w)return;back.style.display=area==='menu'?'none':'inline-flex';back.onclick=function(){stopScanner();openArea('menu');};if(area==='scan')return renderScan();if(area==='generate')return renderGenerator();if(area==='history')return renderHistory();w.innerHTML='<div class="smart-menu">'+menu('scan','▣','Smart Record','Scan a completed score sheet, review and save.')+menu('generate','▤','Generate / Print Broadsheets','Create identified sheets for teachers to complete.')+menu('history','◷','Recording History','View previously saved recordings.')+'</div>';w.querySelectorAll('[data-area]').forEach(function(b){b.onclick=function(){openArea(b.dataset.area);};});}
function menu(a,i,t,c){return'<button class="smart-menu-card" data-area="'+a+'"><span class="smart-menu-icon">'+i+'</span><span><strong>'+t+'</strong><small>'+c+'</small></span><b>→</b></button>';}
window.openSmartSheetGenerator=function(){navTo('smart',document.getElementById('ni-smart'));setTimeout(function(){openArea('generate');},0);};

function renderScan(){stopScanner();clearCurrent();document.getElementById('smart-work').innerHTML='<section class="smart-card smart-scan-start"><h3>Smart Record</h3><p>Scan a completed sheet. The document scanner finds the paper and captures it automatically when it is steady.</p>'+(S.batch.length?'<div class="smart-batch-note">'+S.batch.length+' sheet'+(S.batch.length===1?'':'s')+' ready in this batch. Scan the next page or sheet.</div>':'')+'<button class="smart-scan-button" id="smart-scan">OPEN DOCUMENT SCANNER</button><input class="smart-hidden" id="smart-file" type="file" accept="image/*" capture="environment"><button class="smart-secondary" id="smart-upload">Use an existing scan or photo</button></section>';document.getElementById('smart-scan').onclick=openScanner;var f=document.getElementById('smart-file');document.getElementById('smart-upload').onclick=function(){f.click();};f.onchange=function(){if(f.files&&f.files[0])prepareImage(f.files[0]);};}
function scanClamp(v,min,max){return Math.max(min,Math.min(max,v));}
function scanCross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function scanHull(points){
  var sorted=points.slice().sort(function(a,b){return a.x-b.x||a.y-b.y;}),lower=[],upper=[],i;
  for(i=0;i<sorted.length;i++){while(lower.length>1&&scanCross(lower[lower.length-2],lower[lower.length-1],sorted[i])<=0)lower.pop();lower.push(sorted[i]);}
  for(i=sorted.length-1;i>=0;i--){while(upper.length>1&&scanCross(upper[upper.length-2],upper[upper.length-1],sorted[i])<=0)upper.pop();upper.push(sorted[i]);}
  upper.pop();lower.pop();return lower.concat(upper);
}
function scanQuadArea(points){var area=0,i,next;for(i=0;i<points.length;i++){next=points[(i+1)%points.length];area+=points[i].x*next.y-next.x*points[i].y;}return Math.abs(area)/2;}
function scanOrderQuad(hull){
  if(!hull||hull.length<4)return null;
  var pick=function(score,used){var best=null,value=score(hull[0]);hull.forEach(function(point,index){if(used[index])return;var next=score(point);if(next<value){value=next;best={point:point,index:index};}});return best||{point:hull[0],index:0};};
  var used={},tl=pick(function(p){return p.x+p.y;},used);used[tl.index]=true;
  var br=pick(function(p){return-(p.x+p.y);},used);used[br.index]=true;
  var tr=pick(function(p){return-p.x+p.y;},used);used[tr.index]=true;
  var bl=pick(function(p){return p.x-p.y;},used);
  var result=[tl.point,tr.point,br.point,bl.point];
  if(scanQuadArea(result)<.08)return null;
  return result;
}
function scanQuadClose(a,b){
  if(!a||!b||!a.points||!b.points)return false;
  var total=0;for(var i=0;i<4;i++){var dx=a.points[i].x-b.points[i].x,dy=a.points[i].y-b.points[i].y;total+=Math.sqrt(dx*dx+dy*dy);}
  return total/4<.075;
}
function scanBlend(a,b){return{points:a.points.map(function(point,index){return{x:a.points[index].x*.65+b.points[index].x*.35,y:a.points[index].y*.65+b.points[index].y*.35};}),area:b.area};}
function scanOverlayPoint(point,video,box){
  var vw=video.videoWidth||1,vh=video.videoHeight||1,scale=Math.max(box.width/vw,box.height/vh),drawWidth=vw*scale,drawHeight=vh*scale;
  return{x:((point.x*vw*scale)+(box.width-drawWidth)/2)/box.width*100,y:((point.y*vh*scale)+(box.height-drawHeight)/2)/box.height*100};
}
function renderScanQuad(q){
  var svg=document.getElementById('smart-scan-quad'),video=document.getElementById('smart-camera');if(!svg||!video)return;
  if(!q||!q.points){svg.classList.remove('is-found');return;}
  var box=svg.getBoundingClientRect(),points=q.points.map(function(point){return scanOverlayPoint(point,video,box);}),poly=svg.querySelector('polygon');
  if(poly)poly.setAttribute('points',points.map(function(point){return point.x.toFixed(2)+','+point.y.toFixed(2);}).join(' '));
  svg.querySelectorAll('circle').forEach(function(circle,index){if(points[index]){circle.setAttribute('cx',points[index].x);circle.setAttribute('cy',points[index].y);}});
  svg.classList.add('is-found');
}
function openScanner(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){showToast('Live document scanning is unavailable. Use an existing scan instead.','error');return;}
  var b=document.createElement('div');b.id='smart-scanner';b.className='smart-scanner';
  b.innerHTML='<video id="smart-camera" autoplay playsinline muted></video><button class="smart-scan-close" id="smart-close" aria-label="Close scanner">×</button><div class="smart-scan-topline" id="smart-scan-status">Move over the score sheet</div><svg class="smart-scan-quad" id="smart-scan-quad" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 100,0 100,100 0,100"></polygon><circle></circle><circle></circle><circle></circle><circle></circle></svg><div class="smart-scanner-bottom"><div class="smart-scanner-controls"><button class="smart-shutter" id="smart-capture" aria-label="Capture sheet"><span></span></button><div class="smart-scan-thumb" id="smart-scan-thumb"><span>1</span></div></div><div class="smart-scan-mode"><button id="smart-manual">Manual</button><button class="selected" id="smart-auto">Auto capture</button></div><p>WTS Smart Recording will use only the score-sheet images you capture.</p></div>';
  document.body.appendChild(b);S.autoCapture=true;S.capturing=false;
  var status=document.getElementById('smart-scan-status'),manual=document.getElementById('smart-manual'),auto=document.getElementById('smart-auto');
  document.getElementById('smart-close').onclick=stopScanner;
  document.getElementById('smart-capture').onclick=function(){S.capturing=true;capture(S.bounds);};
  manual.onclick=function(){S.autoCapture=false;manual.classList.add('selected');auto.classList.remove('selected');if(status)status.textContent='Manual mode — tap the shutter when the whole sheet is clear';};
  auto.onclick=function(){S.autoCapture=true;auto.classList.add('selected');manual.classList.remove('selected');if(status)status.textContent=S.bounds?'Hold steady…':'Move over the score sheet';};
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false}).then(function(stream){S.stream=stream;var v=document.getElementById('smart-camera');if(!v)return;v.srcObject=stream;v.onloadedmetadata=function(){v.play();S.timer=setInterval(analyse,260);};}).catch(function(){stopScanner();showToast('Camera access was not available. Use an existing scan instead.','error');});
}
function stopScanner(){if(S.timer){clearInterval(S.timer);S.timer=null;}if(S.stream){S.stream.getTracks().forEach(function(t){t.stop();});S.stream=null;}var b=document.getElementById('smart-scanner');if(b)b.remove();S.stable=0;S.bounds=null;S.capturing=false;}
function analyse(){
  var v=document.getElementById('smart-camera'),status=document.getElementById('smart-scan-status');if(!v||v.readyState<2||!v.videoWidth)return;
  var c=document.createElement('canvas'),sc=360/v.videoWidth;c.width=360;c.height=Math.max(220,Math.round(v.videoHeight*sc));var x=c.getContext('2d',{willReadFrequently:true});x.drawImage(v,0,0,c.width,c.height);
  var d=x.getImageData(0,0,c.width,c.height).data,points=[],sum=0,count=0,i;
  for(i=0;i<d.length;i+=4)sum+=(d[i]+d[i+1]+d[i+2])/3;
  var avg=sum/(d.length/4),threshold=Math.max(142,Math.min(214,avg+18));
  for(var y=4;y<c.height-4;y+=4)for(var z=4;z<c.width-4;z+=4){var p=(y*c.width+z)*4,l=(d[p]+d[p+1]+d[p+2])/3,hi=Math.max(d[p],d[p+1],d[p+2]),lo=Math.min(d[p],d[p+1],d[p+2]);if(l>threshold&&hi-lo<78){points.push({x:z,y:y});count++;}}
  var hull=count>100?scanHull(points):[],quad=scanOrderQuad(hull),q=quad?{points:quad.map(function(point){return{x:point.x/c.width,y:point.y/c.height};}),area:scanQuadArea(quad)/(c.width*c.height)}:null;
  if(!q||q.area<.18){S.stable=0;S.bounds=null;renderScanQuad(null);if(status)status.textContent='Move over the sheet — fit all four edges in view';return;}
  q.points=q.points.map(function(point){return{x:scanClamp(point.x,.015,.985),y:scanClamp(point.y,.015,.985)};});
  var same=scanQuadClose(S.bounds,q);S.stable=same?S.stable+1:1;S.bounds=S.bounds&&same?scanBlend(S.bounds,q):q;renderScanQuad(S.bounds);
  if(status)status.textContent=S.stable>1?'Scanning… hold steady':'Sheet found — hold steady';
  if(S.autoCapture&&!S.capturing&&S.stable>=4){S.capturing=true;capture(S.bounds);}
}
function scanSolve(matrix,values){
  var a=matrix.map(function(row,index){return row.slice().concat(values[index]);});
  for(var col=0;col<8;col++){var pivot=col;for(var row=col+1;row<8;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;if(Math.abs(a[pivot][col])<1e-9)return null;var swap=a[col];a[col]=a[pivot];a[pivot]=swap;var divisor=a[col][col];for(var j=col;j<=8;j++)a[col][j]/=divisor;for(row=0;row<8;row++)if(row!==col){var factor=a[row][col];if(!factor)continue;for(j=col;j<=8;j++)a[row][j]-=factor*a[col][j];}}
  return a.map(function(row){return row[8];});
}
function perspectiveCanvas(video,points){
  var sw=video.videoWidth,sh=video.videoHeight,source=document.createElement('canvas');source.width=sw;source.height=sh;var sourceCtx=source.getContext('2d');sourceCtx.drawImage(video,0,0,sw,sh);
  var width=Math.max(Math.hypot((points[1].x-points[0].x)*sw,(points[1].y-points[0].y)*sh),Math.hypot((points[2].x-points[3].x)*sw,(points[2].y-points[3].y)*sh));
  var height=Math.max(Math.hypot((points[3].x-points[0].x)*sw,(points[3].y-points[0].y)*sh),Math.hypot((points[2].x-points[1].x)*sw,(points[2].y-points[1].y)*sh)),scale=Math.min(1,1900/Math.max(width,height)),dw=Math.max(1,Math.round(width*scale)),dh=Math.max(1,Math.round(height*scale));
  var src=sourceCtx.getImageData(0,0,sw,sh).data,out=document.createElement('canvas');out.width=dw;out.height=dh;var output=out.getContext('2d'),image=output.createImageData(dw,dh),dst=image.data;
  var uvs=[[0,0],[dw,0],[dw,dh],[0,dh]],matrix=[],values=[];uvs.forEach(function(uv,index){var u=uv[0],v=uv[1],px=points[index].x*sw,py=points[index].y*sh;matrix.push([u,v,1,0,0,0,-u*px,-v*px]);values.push(px);matrix.push([0,0,0,u,v,1,-u*py,-v*py]);values.push(py);});var h=scanSolve(matrix,values);if(!h)throw new Error('perspective transform unavailable');
  for(var y=0;y<dh;y++)for(var x=0;x<dw;x++){var den=h[6]*x+h[7]*y+1,sx=(h[0]*x+h[1]*y+h[2])/den,sy=(h[3]*x+h[4]*y+h[5])/den;if(sx<0||sy<0||sx>=sw||sy>=sh)continue;var ix=Math.floor(sx),iy=Math.floor(sy),si=(iy*sw+ix)*4,di=(y*dw+x)*4;dst[di]=src[si];dst[di+1]=src[si+1];dst[di+2]=src[si+2];dst[di+3]=255;}
  output.putImageData(image,0,0);return out;
}
function capture(q){
  var v=document.getElementById('smart-camera');if(!v||v.readyState<2)return;
  var points=q&&q.points?q.points:[{x:.05,y:.05},{x:.95,y:.05},{x:.95,y:.95},{x:.05,y:.95}],c;
  try{c=perspectiveCanvas(v,points);}catch(e){var sx=Math.max(0,Math.min.apply(null,points.map(function(p){return p.x;}))*v.videoWidth),sy=Math.max(0,Math.min.apply(null,points.map(function(p){return p.y;}))*v.videoHeight),ex=Math.min(v.videoWidth,Math.max.apply(null,points.map(function(p){return p.x;}))*v.videoWidth),ey=Math.min(v.videoHeight,Math.max.apply(null,points.map(function(p){return p.y;}))*v.videoHeight),sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy),scale=Math.min(1,1900/Math.max(sw,sh));c=document.createElement('canvas');c.width=Math.round(sw*scale);c.height=Math.round(sh*scale);c.getContext('2d').drawImage(v,sx,sy,sw,sh,0,0,c.width,c.height);}
  stopScanner();processCanvas(c);
}
function prepareImage(file){if(!/^image\//.test(file.type||'')){showToast('Choose an image of the score sheet.','error');return;}showLoad('Preparing sheet…');decode(file).then(function(img){var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,sc=Math.min(1,1900/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*sc);c.height=Math.round(h*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);processCanvas(c);}).catch(function(){hideLoad();showToast('This image could not be opened.','error');});}
function decode(f){if(typeof createImageBitmap==='function')return createImageBitmap(f);return new Promise(function(ok,no){var r=new FileReader();r.onerror=no;r.onload=function(){var i=new Image();i.onload=function(){ok(i);};i.onerror=no;i.src=r.result;};r.readAsDataURL(f);});}
function processCanvas(c){S.canvas=c;S.image=c.toDataURL('image/jpeg',.88);hideLoad();renderCaptureReview();}
function renderCaptureReview(){var w=document.getElementById('smart-work');if(!w)return;w.innerHTML='<section class="smart-card smart-capture-review"><h3>Review scanned sheet</h3><p>Check that the whole page is visible and the names, admission numbers and score cells are clear.</p><img class="smart-image smart-capture-image" src="'+S.image+'" alt="Captured score sheet"><div class="smart-review-actions smart-capture-actions"><button class="smart-secondary" id="smart-rescan">RESCAN</button><button class="smart-scan-button" id="smart-identify">CONTINUE TO READ SCORES</button></div></section>';document.getElementById('smart-rescan').onclick=renderScan;document.getElementById('smart-identify').onclick=identifyCaptured;}
function identifyCaptured(){if(!S.canvas){renderScan();return;}showLoad('Identifying score sheet…');detectQr(S.canvas).then(function(id){hideLoad();if(id)beginExtraction(id.ids,id.page);else showIdentification();}).catch(function(){hideLoad();showIdentification();});}
function detectQr(c){if('BarcodeDetector' in window)try{return new BarcodeDetector({formats:['qr_code']}).detect(c).then(function(codes){for(var i=0;i<codes.length;i++){var q=parseCode(codes[i].rawValue);if(q)return q;}return qrPixels(c);}).catch(function(){return qrPixels(c);});}catch(e){}return Promise.resolve(qrPixels(c));}
function qrPixels(c){try{if(typeof window.jsQR!=='function')return null;var x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height),q=window.jsQR(d.data,d.width,d.height,{inversionAttempts:'attemptBoth'});return q?parseCode(q.data):null;}catch(e){return null;}}
function parseCode(raw){var m=/WTS-SR1:([0-9a-f-]{36})(?::(\d+))?/i.exec(String(raw||''));if(m)return{ids:[m[1]],page:Number(m[2]||0)};m=/WTS-SRM1:([A-Za-z0-9_-]+):(\d+)/.exec(String(raw||''));if(!m)return null;try{var b=m[1].replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';var ids=JSON.parse(atob(b));return Array.isArray(ids)&&ids.length?{ids:ids,page:Number(m[2]||0)}:null;}catch(e){return null;}}
function responseJson(r){return r.text().then(function(raw){var d={};try{d=raw?JSON.parse(raw):{};}catch(e){d={};}if(!r.ok||d.ok===false){d.http_status=r.status;throw d;}return d;});}
function extractionMessage(e){
  if(e&&e.code==='SMART_RECORDING_PROVIDER_NOT_CONFIGURED')return'Add a Gemini API key in Settings first.';
  if(e&&e.code==='SMART_EXTRACTION_PROVIDER_UNAVAILABLE')return'The handwriting service could not be reached. Check the connection and try again.';
  if(e&&e.code==='SMART_EXTRACTION_PROVIDER_KEY_INVALID')return'The Gemini API key was rejected. Save a current key in Settings.';
  if(e&&e.code==='SMART_EXTRACTION_PROVIDER_FAILED'){
    if(Number(e.provider_status)===401||Number(e.provider_status)===403)return'The Gemini API key was rejected. Save a current key in Settings.';
    if(Number(e.provider_status)===404)return'The configured handwriting model is unavailable. Try again after saving a current key in Settings.';
    if(Number(e.provider_status)===429)return'The handwriting service is busy. Try this scan again in a moment.';
    return'The handwriting service could not read this scan. Try a clearer page image.';
  }
  if(e&&e.code==='SMART_SHEET_NOT_FOUND')return'That generated sheet is no longer available. Select its details below.';
  return'Scores could not be extracted. Check the image and try again.';
}
function beginExtraction(ids,page){S.page=Number(page||0);showLoad('Reading handwritten scores…');fetch('/api/smart-recording',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({action:'extract',sheet_ids:ids,page_index:S.page,image_data_url:S.image})}).then(responseJson).then(function(d){hideLoad();S.sheet=d.sheet;S.sheets=d.sheet.group_sheets||[d.sheet];S.cells=d.extraction.cells||[];S.fingerprint=d.image_fingerprint;S.corrections=0;indexExisting(d.existing_scores||[]);renderReview();}).catch(function(e){hideLoad();showToast(extractionMessage(e),'error');if(e&&e.code==='SMART_SHEET_NOT_FOUND')showIdentification();else renderCaptureReview();});}

function normalizeSubject(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function canonicalSubject(v){var key=normalizeSubject(v);if(key==='livestock'||key==='livestockfarming')return'livestock';if(key==='civiceducation'||key==='citizenshipciviceducation'||key==='citizenshipheritagestudies'||key==='citizenshipeducation')return'citizenshipciviceducation';return key;}
function subjectTargets(classKey,index){var base=String(classKey||''),list=subjects(base),name=list[Number(index)],out=[];if(name===undefined)return out;out.push({class_key:base,subject_index:Number(index),subject_name:name});if(!isSeniorDepartment(base))return out;var level=base.split('-')[0],canonical=canonicalSubject(name);classes().forEach(function(other){if(other===base||String(other).split('-')[0]!==level)return;var otherSubjects=subjects(other),idx=otherSubjects.findIndex(function(s){return canonicalSubject(s)===canonical;});if(idx<0)return;var exists=out.some(function(x){return x.class_key===other&&x.subject_index===idx;});if(!exists)out.push({class_key:other,subject_index:idx,subject_name:otherSubjects[idx]});});return out;}
function selectedTargets(classKey,ids){var out=[],seen={};ids.forEach(function(index){subjectTargets(classKey,index).forEach(function(target){var key=target.class_key+'|'+target.subject_index;if(!seen[key]){seen[key]=true;out.push(target);}});});return out;}
function sharedTargetGroups(classKey,ids){return ids.map(function(index){return subjectTargets(classKey,index);}).filter(function(group){return group.length>1;});}
function sharedHint(id,classKey,ids){var note=document.getElementById(id);if(!note)return;var groups=sharedTargetGroups(classKey,ids);if(!groups.length){note.style.display='none';note.textContent='';return;}var names=groups[0].map(function(x){return clsLabel(x.class_key);});note.textContent='This subject is configured in '+names.join(', ')+'. One merged broadsheet will include all of them.';note.style.display='block';}

function chooser(id,key,multi){var list=subjects(key);if(multi)return'<div class="smart-subject-checks" id="'+id+'">'+list.map(function(s,i){return'<label><input type="checkbox" value="'+i+'"><span>'+esc(s)+'</span></label>';}).join('')+'</div>';return'<select id="'+id+'"><option value="">Select subject</option>'+list.map(function(s,i){return'<option value="'+i+'">'+esc(s)+'</option>';}).join('')+'</select>';}
function selected(id){var b=document.getElementById(id);if(!b)return[];if(b.tagName==='SELECT')return b.value===''?[]:[Number(b.value)];return Array.from(b.querySelectorAll('input:checked')).map(function(x){return Number(x.value);});}
function showIdentification(){var w=document.getElementById('smart-work');w.innerHTML='<section class="smart-card"><h3>Sheet identification</h3><p>The sheet code was not clear. Select the class and subject; Smart Recording will use the generated template and continue.</p><img class="smart-image" src="'+S.image+'" alt="Scanned score sheet"><div class="smart-form"><label>Class<select id="sid-class"><option value="">Select class</option>'+classes().map(function(k){return'<option value="'+k+'">'+esc(clsLabel(k))+'</option>';}).join('')+'</select></label><div class="smart-wide" id="sid-wrap"></div><label>Session<input id="sid-session" value="'+esc(getActiveSession())+'" readonly></label><label>Term<select id="sid-term">'+opts(['1st Term','2nd Term','3rd Term'])+'</select></label><button class="smart-secondary smart-wide" id="sid-go">CONTINUE</button></div></section>';var c=document.getElementById('sid-class'),wrap=document.getElementById('sid-wrap');c.onchange=function(){var multi=isPrimary(c.value);wrap.innerHTML='<label>'+(multi?'Subjects (choose up to four)':'Subject')+chooser('sid-subject',c.value,multi)+'<div class="smart-identify smart-hidden" id="sid-shared-note"></div></label>';wrap.onchange=function(){sharedHint('sid-shared-note',c.value,selected('sid-subject'));};};document.getElementById('sid-term').value=window.TERM||'1st Term';document.getElementById('sid-go').onclick=function(){var ids=selected('sid-subject');if(!c.value||!ids.length||ids.length>4){showToast('Select a class and up to four subjects.','error');return;}var pairs=selectedTargets(c.value,ids);if(!pairs.length){showToast('No configured subject was found for that class.','error');return;}var session=document.getElementById('sid-session').value,term=document.getElementById('sid-term').value;showLoad('Finding generated sheet…');api('context.set',{class_key:c.value,academic_session:session,term:term}).then(function(){return Promise.all(pairs.map(function(pair){return api('smart.sheet.read',{class_key:pair.class_key,subject_index:pair.subject_index,academic_session:session,term:term});}));}).then(function(a){hideLoad();beginExtraction(a.map(function(x){return x.sheet.id;}),0);}).catch(function(e){hideLoad();showToast(e&&e.code==='RESULT_PERMISSION_DENIED'?'This account cannot read one of the selected departments.':'Generate this Smart Score Sheet first.','error');});};}

function renderGenerator(){document.getElementById('smart-work').innerHTML='<section class="smart-card smart-generator"><h3>Generate / Print Smart Broadsheets</h3><p>Early Years and Primary use readable landscape multi-subject sheets. Secondary classes use one individual subject per sheet. Shared SS2/SS3 subjects automatically merge every configured department.</p><div class="smart-form"><label>Class<select id="sg-class"><option value="">Select class</option>'+classes().map(function(k){return'<option value="'+k+'">'+esc(clsLabel(k))+'</option>';}).join('')+'</select></label><label>Session<input id="sg-session\" value=\"'+esc(getActiveSession())+'\" readonly></label><label>Term<select id=\"sg-term\">'+opts(['1st Term','2nd Term','3rd Term'])+'</select></label><div class=\"smart-wide\" id=\"sg-wrap\"></div><button class=\"smart-scan-button smart-wide\" id=\"sg-go\">GENERATE &amp; PRINT</button></div></section>';var c=document.getElementById('sg-class'),wrap=document.getElementById('sg-wrap');c.onchange=function(){var multi=isPrimary(c.value);wrap.innerHTML='<label>'+(multi?'Choose 1–4 subjects for the landscape sheet':'Choose the subject')+chooser('sg-subject',c.value,multi)+'<div class=\"smart-identify smart-hidden\" id=\"sg-shared-note\"></div></label>';wrap.onchange=function(){sharedHint('sg-shared-note',c.value,selected('sg-subject'));};};document.getElementById('sg-term').value=window.TERM||'1st Term';if(window.CLS&&classes().indexOf(CLS)>-1){c.value=CLS;c.dispatchEvent(new Event('change'));}document.getElementById('sg-go').onclick=generate;}
function generate(){
  var c=document.getElementById('sg-class'),term=document.getElementById('sg-term'),session=document.getElementById('sg-session'),ids=selected('sg-subject');
  if(!c.value||!ids.length||ids.length>4){showToast('Select a class and up to four subjects.','error');return;}
  var pairs=selectedTargets(c.value,ids);if(!pairs.length){showToast('No configured subject was found for that class.','error');return;}
  showLoad('Generating identified score sheets…');
  pairs.reduce(function(chain,pair){return chain.then(function(created){
    return api('context.set',{class_key:pair.class_key,term:term.value,academic_session:session.value}).then(function(){
      return api('smart.sheet.create',{class_key:pair.class_key,subject_index:pair.subject_index,term:term.value,academic_session:session.value,assessment_config:{ca1:10,ca2:10,ca3:10,exam:70}});
    }).then(function(result){created.push(result.sheet);return created;});
  });},Promise.resolve([])).then(function(sheets){hideLoad();printSheets(sheets);}).catch(function(e){hideLoad();showToast('Sheet was not generated: '+(e&&e.code||'request failed'),'error');});
}

function qrData(v){return new Promise(function(ok,no){try{var q=window.qrcode(0,'M');q.addData(v);q.make();ok(q.createDataURL(4,2));}catch(e){no(e);}});}
function groupCode(a,p){var b=btoa(JSON.stringify(a.map(function(s){return s.id;}))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');return'WTS-SRM1:'+b+':'+p;}
function uniqueClassKeys(a){var seen={},out=[];a.forEach(function(s){if(!seen[s.class_key]){seen[s.class_key]=true;out.push(s.class_key);}});return out;}
function printColumns(a){return uniqueClassKeys(a).length>1?[a[0]]:a;}
function buildPrintRoster(a){var keys=uniqueClassKeys(a);if(keys.length<=1)return(a[0].roster||[]).map(function(r){return Object.assign({},r);});var seen={},rows=[];a.forEach(function(sheet){(sheet.roster||[]).forEach(function(r){var id=String(r.student_id||'');if(!id||seen[id])return;seen[id]=true;rows.push(Object.assign({},r,{source_sheet_id:sheet.id,source_class_key:sheet.class_key}));});});rows.sort(function(x,y){return String(x.name||'').localeCompare(String(y.name||''))||String(x.student_id||'').localeCompare(String(y.student_id||''));});var rowsPerPage=rowsPerPageForClass(a[0].class_key);return rows.map(function(r,i){return Object.assign({},r,{row_index:i+1,page_index:Math.floor(i/rowsPerPage),page_row:(i%rowsPerPage)+1});});}
function printTitle(a){var keys=uniqueClassKeys(a),first=a[0];if(keys.length>1)return String(first.class_key||'').split('-')[0].toUpperCase()+' · '+first.subject_name+' · All Departments';return clsLabel(first.class_key);}
function departmentName(k){var text=String(k||'');return text.indexOf('-')>-1?text.split('-').slice(1).join(' ').replace(/\b\w/g,function(c){return c.toUpperCase();}):'';}
function printSheets(a){if(!a||!a.length){showToast('No generated sheet was returned.','error');return;}var first=a[0],roster=buildPrintRoster(a),multi=isPrimary(first.class_key),pages=Math.max(1,Math.max.apply(null,roster.map(function(r){return Number(r.page_index||0);}))+1),jobs=[];for(var p=0;p<pages;p++)jobs.push(qrData(a.length>1?groupCode(a,p):'WTS-SR1:'+first.id+':'+p));Promise.all(jobs).then(function(qrs){var body='',columns=printColumns(a);for(var p=0;p<pages;p++){var rows=roster.filter(function(r){return Number(r.page_index||0)===p;});body+='<section class=\"smart-print-page '+(multi?'landscape':'portrait')+'\"><header class=\"smart-print-header\"><div class=\"smart-print-title\"><h1>'+esc((getSchool()||{}).name||'Way to Success Standard Schools')+'</h1><h2>SMART SCORE SHEET</h2><p>'+esc(printTitle(a))+' · '+esc(first.term)+' · '+esc(first.academic_session)+' · Page '+(p+1)+' of '+pages+'</p></div><div><img class=\"smart-print-qr\" src=\"'+qrs[p]+'\" alt=\"Sheet code\"><div class=\"smart-print-code\">'+esc(first.sheet_code)+(a.length>1?' · merged':'')+' · '+(p+1)+'</div></div></header>'+printTable(columns,rows,multi,uniqueClassKeys(a).length>1)+'</section>';}var win=window.open('','_blank');if(!win){showToast('Allow pop-ups to print the Smart Score Sheet.','error');return;}win.document.write('<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Smart Score Sheet</title><link rel=\"stylesheet\" href=\"'+location.origin+'/smart-recording.css\"></head><body>'+body+'<script>onload=function(){setTimeout(function(){print()},400)}<\\/script></body></html>');win.document.close();}).catch(function(){showToast('The QR could not be generated.','error');});}
function printTable(a,rows,multi,merged){var top='<tr><th rowspan=\"2\" class=\"num\">#</th><th rowspan=\"2\" class=\"student-id\">STUDENT · ADMISSION NO.</th>'+a.map(function(s){return'<th colspan=\"4\" class=\"subject-head\">'+esc(s.subject_name)+'</th>';}).join('')+'</tr><tr>'+a.map(function(s){return PARTS.map(function(p){return'<th class=\"score\">'+LABELS[p]+' / '+esc(s.assessment_config[p])+'</th>';}).join('');}).join('')+'</tr>';return'<table class=\"smart-print-table '+(multi?'multi':'single')+(merged?' merged':'')+'\"><thead>'+top+'</thead><tbody>'+rows.map(function(r){return'<tr><td class=\"num\">'+r.row_index+'</td><td class=\"student-id\"><strong>'+esc(r.name)+'</strong><small>'+esc(r.admno||'')+'</small>'+(merged?'<span class=\"smart-print-dept\">'+esc(departmentName(r.source_class_key))+'</span>':'')+'</td>'+a.map(function(){return'<td></td><td></td><td></td><td></td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';}

function indexExisting(a){S.existing={};a.forEach(function(r){if(r&&r.student_id&&r.sheet_id)S.existing[r.student_id+'|'+r.sheet_id]=r;});}
function old(c){return S.existing[c.student_id+'|'+c.sheet_id];}
function conflict(c){var r=old(c);return!!(r&&r[c.component]!==null&&r[c.component]!==undefined&&c.value!==null&&Number(r[c.component])!==Number(c.value));}
function unresolved(){return S.cells.filter(function(c){return['needs_review','out_of_range','extraction_failure'].indexOf(c.status)>-1;}).length;}
function unresolvedConflicts(){return S.cells.filter(function(c){return c.status==='confirmed'&&conflict(c)&&!c.decision;}).length;}
function findCell(st,sheetId,p){return S.cells.find(function(c){return String(c.student_id)===String(st)&&String(c.sheet_id)===String(sheetId)&&c.component===p;});}
function reviewSheets(){if(S.sheet&&S.sheet.grouped_across_classes)return S.sheets.length?[S.sheets[0]]:[];return S.sheets;}
function cellFor(student,sheet,part){var id=S.sheet&&S.sheet.grouped_across_classes?student.source_sheet_id:sheet.id;return findCell(student.student_id,id,part);}
function reviewTitle(){var first=S.sheets[0]||S.sheet;if(S.sheet&&S.sheet.grouped_across_classes)return String(S.sheet.class_key||'').split('-')[0].toUpperCase()+' · '+esc(first&&first.subject_name||'')+' · All Departments';return clsLabel(S.sheet.class_key);}
function renderReview(){var roster=(S.sheet.roster||[]).filter(function(r){return Number(r.page_index||0)===S.page;}),columns=reviewSheets(),counts=S.cells.reduce(function(n,c){n[c.status==='confirmed'?'ready':c.status==='blank'?'blank':'review']++;return n;},{ready:0,review:0,blank:0}),html='<section class=\"smart-stage\"><div class=\"smart-stage-head\"><div><h3>'+reviewTitle()+'</h3><small>'+esc(S.sheet.term)+' · '+esc(S.sheet.academic_session)+' · '+roster.length+' students</small></div><div class=\"smart-summary\"><span class=\"smart-pill\">'+counts.ready+' ready</span><span class=\"smart-pill review\">'+counts.review+' need review</span><span class=\"smart-pill blank\">'+counts.blank+' blank</span></div></div><div class=\"smart-table-wrap\"><table class=\"smart-table smart-review-table\"><thead><tr><th>#</th><th>Student</th>'+columns.map(function(s){return'<th colspan=\"4\">'+esc(s.subject_name)+'</th>';}).join('')+'</tr><tr><th></th><th></th>'+columns.map(function(s){return PARTS.map(function(p){return'<th>'+LABELS[p]+'<br><small>MAX '+esc(s.assessment_config[p])+'</small></th>';}).join('');}).join('')+'</tr></thead><tbody>';roster.forEach(function(st){html+='<tr><td>'+st.row_index+'</td><td class=\"smart-student\">'+esc(st.name)+'<small>'+esc(st.admno||'')+'</small>'+(S.sheet.grouped_across_classes?'<small class=\"smart-student-dept\">'+esc(departmentName(st.source_class_key))+'</small>':'')+'</td>';columns.forEach(function(s){PARTS.forEach(function(p){html+='<td>'+cellButton(cellFor(st,s,p))+'</td>';});});html+='</tr>';});html+='</tbody></table></div><div class=\"smart-footer\"><button class=\"smart-secondary\" id=\"smart-new\">RESCAN</button><button class=\"smart-save\" id=\"smart-save\" '+((unresolved()||unresolvedConflicts())?'disabled':'')+'>SAVE SCORES</button></div></section>';document.getElementById('smart-work').innerHTML=html;document.querySelectorAll('[data-cell]').forEach(function(b){b.onclick=function(){openCell(b.dataset.cell);};});document.getElementById('smart-new').onclick=renderScan;document.getElementById('smart-save').onclick=save;}
function cellButton(c){if(!c)return'<span class=\"smart-cell-missing\">—</span>';var r=old(c),v=c.status==='blank'?'—':c.value===null?'Review':c.value,key=c.student_id+'|'+c.sheet_id+'|'+c.component;return'<button title=\"'+esc(c.reason||'')+'\" class=\"smart-cell '+c.status+(conflict(c)?' conflict':'')+'\" data-cell=\"'+esc(key)+'\">'+esc(v)+(conflict(c)?'<small>saved '+esc(r[c.component])+'</small>':'')+'</button>';}
function crop(c){if(!S.canvas)return'';var columns=reviewSheets(),n=Math.max(1,columns.length),si=Math.max(0,columns.findIndex(function(s){return String(s.id)===String(c.sheet_id);})),pi=PARTS.indexOf(c.component),land=n>1,left=land ? .28 : .55,use=land ? .70 : .42,rowsPerPage=rowsPerPageForClass(S.sheet&&S.sheet.class_key),x=(left+(si*4+pi)*(use/(n*4)))*S.canvas.width,y=(.18+(Math.max(0,c.page_row-1))*(.78/rowsPerPage))*S.canvas.height,w=(use/(n*4))*S.canvas.width,h=(.78/rowsPerPage)*S.canvas.height,o=document.createElement('canvas');o.width=420;o.height=150;o.getContext('2d').drawImage(S.canvas,Math.max(0,x-w*.15),Math.max(0,y-h*.3),w*1.3,h*1.6,0,0,420,150);return o.toDataURL('image/jpeg',.9);}
function openCell(k){var b=k.split('|'),c=findCell(b[0],b[1],b[2]);if(!c)return;var r=old(c),saved=r&&r[c.component],has=conflict(c),box=document.createElement('div');box.className='smart-review-backdrop';box.innerHTML='<div class=\"smart-review-panel\"><h3>'+esc(c.student_name)+' · '+esc(c.subject_name)+' · '+LABELS[c.component]+'</h3><p>Maximum score: '+c.maximum+'</p><img class=\"smart-crop\" src=\"'+crop(c)+'\" alt=\"Original score cell\"><input class=\"smart-value\" id=\"smart-value\" type=\"number\" min=\"0\" max=\"'+c.maximum+'\" value=\"'+(c.value==null?'':c.value)+'\">'+(has?'<div class=\"smart-conflict-copy\">Already saved: <strong>'+esc(saved)+'</strong> · Scanned: <strong>'+esc(c.value)+'</strong></div><div class=\"smart-choice\"><button data-choice=\"keep_existing\">KEEP EXISTING</button><button data-choice=\"use_scanned\">USE SCANNED VALUE</button></div>':'')+'<div class=\"smart-review-actions\"><button class=\"smart-secondary\" id=\"smart-cancel\">Cancel</button><button class=\"smart-save\" id=\"smart-confirm\">Confirm</button></div></div>';document.body.appendChild(box);box.querySelectorAll('[data-choice]').forEach(function(x){x.onclick=function(){box.querySelectorAll('[data-choice]').forEach(function(y){y.classList.remove('selected');});x.classList.add('selected');c.pending=x.dataset.choice;};});box.querySelector('#smart-cancel').onclick=function(){box.remove();};box.querySelector('#smart-confirm').onclick=function(){var raw=box.querySelector('#smart-value').value,v=raw===''?null:Number(raw);if(v!==null&&(!isFinite(v)||v<0||v>c.maximum)){showToast('Enter a score from 0 to '+c.maximum+'.','error');return;}if(v===null){c.value=null;c.status='blank';c.decision=null;}else{if(v!==c.detected_value)S.corrections++;c.value=v;c.status='confirmed';c.decision=conflict(c)?c.pending||c.decision:null;}box.remove();renderReview();};}
function save(){if(unresolved()||unresolvedConflicts()){showToast('Review the highlighted scores and conflicts first.','error');return;}showLoad('Saving scores…');var jobs=S.sheets.map(function(sheet){var cells=S.cells.filter(function(c){return c.sheet_id===sheet.id&&c.status==='confirmed'&&c.value!==null;}),g={};cells.forEach(function(c){var row=g[c.student_id]||(g[c.student_id]={student_id:c.student_id,scores:{},existing:{},decisions:{}});row.scores[c.component]=c.value;var r=old(c);if(r&&Object.prototype.hasOwnProperty.call(r,c.component))row.existing[c.component]=r[c.component];if(c.decision)row.decisions[c.component]=c.decision;});var rows=Object.keys(g).map(function(k){return g[k];});if(!rows.length)return Promise.resolve({score_fields_saved:0});return api('smart.scores.commit',{sheet_id:sheet.id,rows:rows,image_fingerprint:S.fingerprint,summary:{scores_extracted:cells.length,corrections_made:S.corrections,page_index:S.page}}).then(function(d){applyLocal(rows,sheet);return d;});});Promise.all(jobs).then(function(a){hideLoad();var total=a.reduce(function(n,x){return n+Number(x.score_fields_saved||0);},0);document.getElementById('smart-work').innerHTML='<section class=\"smart-card smart-success\"><div>✓</div><h3>Scores saved</h3><p>'+total+' score fields are now in the Result Portal.</p><button class=\"smart-scan-button\" id=\"smart-again\">SCAN ANOTHER SHEET</button></section>';document.getElementById('smart-again').onclick=renderScan;}).catch(function(e){hideLoad();showToast(e&&e.code==='SMART_CONFLICT_DECISION_REQUIRED'?'Choose how to handle each saved-score conflict first.':'Scores were not saved. Review and try again.','error');renderReview();});}
function applyLocal(rows,sheet){if(!window.DB_SCORES)return;rows.forEach(function(row){var r=S.existing[row.student_id+'|'+sheet.id]||{},idx=Number(sheet.subject_index),f={ca1:r.ca1==null?'':r.ca1,ca2:r.ca2==null?'':r.ca2,ca3:r.ca3==null?'':r.ca3,exam:r.exam==null?'':r.exam};PARTS.forEach(function(p){if(Object.prototype.hasOwnProperty.call(row.scores,p)&&row.decisions[p]!=='keep_existing')f[p]=row.scores[p];});if(!DB_SCORES[row.student_id])DB_SCORES[row.student_id]={};DB_SCORES[row.student_id][idx]=f;});}
function renderHistory(){document.getElementById('smart-work').innerHTML='<section class=\"smart-card\"><div class=\"smart-history-head\"><h3>Recording History</h3><button class=\"smart-secondary\" id=\"smart-refresh\">Refresh</button></div><div id=\"smart-history-list\"><div class=\"smart-empty\">Loading history…</div></div></section>';document.getElementById('smart-refresh').onclick=loadHistory;loadHistory();}
function loadHistory(){var el=document.getElementById('smart-history-list');if(!el)return;api('smart.history.read',{limit:50}).then(function(d){var a=d.rows||[];if(!a.length){el.innerHTML='<div class=\"smart-empty\">No Smart Recording saves yet.</div>';return;}el.innerHTML=a.map(function(r){return'<div class=\"smart-history-row\"><strong>'+esc(clsLabel(r.class_key))+' · '+esc(r.subject_name)+'</strong><span>'+esc(r.term)+' · '+esc(r.academic_session)+'</span><span>'+new Date(r.scanned_at).toLocaleString()+'</span><span class=\"smart-pill\">'+r.scores_saved+' saved</span></div>';}).join('');}).catch(function(){el.innerHTML='<div class=\"smart-empty\">History is unavailable.</div>';});}
function genericSubjectSpecs(classKey,ids){return ids.map(function(index){var name=subjects(classKey)[Number(index)];return{subject_index:Number(index),subject_name:name,assessment_config:{ca1:10,ca2:10,ca3:10,exam:70}};}).filter(function(s){return s.subject_name!==undefined;});}
function genericTargets(classKey,ids){var out=[],seen={};ids.forEach(function(index){subjectTargets(classKey,index).forEach(function(target){var key=target.class_key+'|'+target.subject_index;if(!seen[key]){seen[key]=true;out.push(target);}});});return out;}
function loadGenericContext(targets,session,term){
  var seen={},unique=targets.filter(function(target){var key=target.class_key+'|'+target.subject_index;if(seen[key])return false;seen[key]=true;return true;});
  return unique.reduce(function(chain,target){
    return chain.then(function(parts){
      return api('context.set',{class_key:target.class_key,academic_session:session,term:term}).then(function(){
        return Promise.all([
          api('read.students',{class_key:target.class_key,academic_session:session,term:term}),
          api('read.scores',{class_key:target.class_key,subject_index:target.subject_index,academic_session:session,term:term})
        ]);
      }).then(function(result){parts.push({target:target,students:result[0].rows||[],scores:result[1].rows||[]});return parts;});
    });
  },Promise.resolve([])).then(function(parts){
    var roster=[],seenStudents={};
    parts.forEach(function(part){(part.students||[]).forEach(function(student){
      var id=String(student.id||'');if(!id||seenStudents[id])return;seenStudents[id]=true;
      roster.push({student_id:id,name:student.name||'',admno:student.admno||'',source_class_key:part.target.class_key,source_sheet_id:part.target.class_key+'|'+part.target.subject_index});
    });});
    roster.sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''))||String(a.student_id).localeCompare(String(b.student_id));});
    roster=roster.map(function(student,index){return Object.assign({},student,{row_index:index+1,page_index:0,page_row:index+1});});
    var existing={};
    parts.forEach(function(part){var key=part.target.class_key+'|'+part.target.subject_index;(part.scores||[]).forEach(function(score){existing[String(score.student_id)+'|'+key]=Object.assign({},score,{sheet_id:key,class_key:part.target.class_key,subject_index:part.target.subject_index});});});
    api('context.set',{class_key:targets[0].class_key,academic_session:session,term:term});
    return{roster:roster,existing:existing};
  });
}
function requestGenericExtraction(body){return fetch('/api/smart-recording',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)}).then(responseJson);}
function genericDescriptor(raw){
  if(raw&&typeof raw==='object')return{value:raw.value===undefined?null:(raw.value===''?null:Number(raw.value)),confidence:Number(raw.confidence)||0,state:String(raw.state||'').toLowerCase()};
  if(raw===undefined)return{value:null,confidence:0,state:'failure'};
  if(raw===null||raw==='')return{value:null,confidence:1,state:'blank'};
  return{value:Number(raw),confidence:.7,state:'uncertain'};
}
function genericCells(rows,context,specs,targets,grouped){
  rows=Array.isArray(rows)?rows:[];var byRow={};rows.forEach(function(row,index){byRow[Number(row.row_index)||index+1]=row;});var cells=[];
  context.roster.forEach(function(student,studentPosition){
    var detected=byRow[student.row_index]||byRow[student.page_row]||rows[studentPosition]||{};
    var detectedSubjects=detected.subjects&&typeof detected.subjects==='object'?detected.subjects:{};
    var rowTargets=grouped?targets.filter(function(target){return target.class_key===student.source_class_key;}):specs.map(function(spec,index){return Object.assign({},spec,{id:'generic-'+index,class_key:student.source_class_key,subject_index:spec.subject_index});});
    if(grouped)rowTargets=rowTargets.length?rowTargets:[targets[0]];
    rowTargets.forEach(function(subject,subjectPosition){
      var key=String(grouped?specs[0].subject_index:(subject.subject_index===undefined?subjectPosition:subject.subject_index)),bag=detectedSubjects[key]||detectedSubjects[String(subjectPosition)]||((subjectPosition===0||specs.length===1)&&detected.scores)||detected;
      PARTS.forEach(function(component){
        var raw=genericDescriptor(bag&&bag[component]),maximum=Number((subject.assessment_config||{ca1:10,ca2:10,ca3:10,exam:70})[component]||0),status='extraction_failure',reason='The score could not be read';
        if(raw.state==='blank'){status='blank';reason='Empty score cell';}
        else if(raw.value!==null&&(!isFinite(raw.value)||raw.value<0||raw.value>maximum)){status='out_of_range';reason='Value must be between 0 and '+maximum;}
        else if(raw.value!==null&&raw.confidence>=.82&&raw.state!=='uncertain'&&raw.state!=='failure'){status='confirmed';reason='Ready to save';}
        else if(raw.value!==null){status='needs_review';reason='Please check this handwriting';}
        else if(raw.state==='uncertain'){status='needs_review';reason='Please enter the score';}
        cells.push({sheet_id:String(subject.id||('generic-'+subjectPosition)),subject_index:Number(subject.subject_index),subject_name:subject.subject_name,student_id:student.student_id,student_name:student.name,source_class_key:student.source_class_key,row_index:student.row_index,page_row:student.page_row,component:component,maximum:maximum,value:raw.value,detected_value:raw.value,confidence:raw.confidence,status:status,reason:reason});
      });
    });
  });
  return cells;
}
function beginGenericExtraction(meta,rows,fingerprint){
  var targets=meta.targets,specs=meta.specs,grouped=targets.length>1&&specs.length===1&&new Set(targets.map(function(target){return target.class_key;})).size>1;
  var sheets=grouped?targets.map(function(target){return{id:target.class_key+'|'+target.subject_index,class_key:target.class_key,subject_index:target.subject_index,subject_name:target.subject_name,assessment_config:{ca1:10,ca2:10,ca3:10,exam:70},term:meta.term,academic_session:meta.session};}):specs.map(function(spec,index){return{id:'generic-'+index,class_key:meta.classKey,subject_index:spec.subject_index,subject_name:spec.subject_name,assessment_config:spec.assessment_config,term:meta.term,academic_session:meta.session};});
  S.generic=true;S.page=0;S.fingerprint=fingerprint||'';S.sheets=sheets;S.existing={};
  Object.keys(meta.existing||{}).forEach(function(key){var r=meta.existing[key],parts=key.split('|'),studentId=parts.shift(),sheetKey=parts.join('|');var sheet=sheets.find(function(item){return item.class_key+'|'+item.subject_index===sheetKey||item.id===sheetKey;});if(sheet)S.existing[studentId+'|'+sheet.id]=Object.assign({},r,{sheet_id:sheet.id});});
  S.sheet={id:'generic-run-'+Date.now(),class_key:meta.classKey,subject_index:specs[0].subject_index,subject_name:specs[0].subject_name,term:meta.term,academic_session:meta.session,assessment_config:specs[0].assessment_config,roster:meta.roster,group_sheets:sheets,grouped_across_classes:grouped};
  S.cells=genericCells(rows,{roster:meta.roster},specs,sheets,grouped);S.corrections=0;renderReview();
}
function showIdentification(){
  var w=document.getElementById('smart-work');
  w.innerHTML='<section class="smart-card"><h3>Sheet identification</h3><p>The code was not clear. Select the class and subject to continue. A generated Smart Score Sheet is optional.</p><img class="smart-image" src="'+S.image+'" alt="Scanned score sheet"><div class="smart-form"><label>Class<select id="sid-class"><option value="">Select class</option>'+classes().map(function(k){return'<option value="'+k+'">'+esc(clsLabel(k))+'</option>';}).join('')+'</select></label><div class="smart-wide" id="sid-wrap"></div><label>Session<input id="sid-session" value="'+esc(getActiveSession())+'" readonly></label><label>Term<select id="sid-term">'+opts(['1st Term','2nd Term','3rd Term'])+'</select></label><button class="smart-secondary smart-wide" id="sid-go">READ SCORES</button></div></section>';
  var c=document.getElementById('sid-class'),wrap=document.getElementById('sid-wrap');
  c.onchange=function(){var multi=isPrimary(c.value);wrap.innerHTML='<label>'+(multi?'Subjects (choose up to four)':'Subject')+chooser('sid-subject',c.value,multi)+'<div class="smart-identify smart-hidden" id="sid-shared-note"></div></label>';wrap.onchange=function(){sharedHint('sid-shared-note',c.value,selected('sid-subject'));};};
  document.getElementById('sid-term').value=window.TERM||'1st Term';
  document.getElementById('sid-go').onclick=function(){
    var ids=selected('sid-subject');if(!c.value||!ids.length||ids.length>4){showToast('Select a class and up to four subjects.','error');return;}
    var specs=genericSubjectSpecs(c.value,ids),targets=genericTargets(c.value,ids);if(!specs.length||!targets.length){showToast('No configured subject was found for that class.','error');return;}
    var session=document.getElementById('sid-session').value,term=document.getElementById('sid-term').value;showLoad('Preparing score rows…');
    api('context.set',{class_key:c.value,academic_session:session,term:term}).then(function(){return loadGenericContext(targets,session,term);}).then(function(context){return requestGenericExtraction({action:'generic_extract',class_key:c.value,subject_index:specs[0].subject_index,subject_specs:specs,academic_session:session,term:term,roster:context.roster,image_data_url:S.image}).then(function(result){return{context:context,result:result};});}).then(function(all){hideLoad();beginGenericExtraction({classKey:c.value,session:session,term:term,targets:targets,specs:specs,roster:all.context.roster,existing:all.context.existing},all.result.rows,all.result.image_fingerprint);}).catch(function(e){hideLoad();showToast(extractionMessage(e),'error');});
  };
}
function entryOld(entry,cell){return entry.existing&&entry.existing[cell.student_id+'|'+cell.sheet_id];}
function entryRows(entry,sheet){
  var cells=(entry.cells||[]).filter(function(cell){return String(cell.sheet_id)===String(sheet.id)&&cell.status==='confirmed'&&cell.value!==null;}),groups={};
  cells.forEach(function(cell){var row=groups[cell.student_id]||(groups[cell.student_id]={student_id:cell.student_id,subject_index:Number(cell.subject_index),class_key:cell.source_class_key,scores:{},existing:{},decisions:{}});row.scores[cell.component]=cell.value;var saved=entryOld(entry,cell);if(saved&&Object.prototype.hasOwnProperty.call(saved,cell.component))row.existing[cell.component]=saved[cell.component];if(cell.decision)row.decisions[cell.component]=cell.decision;});
  return{cells:cells,rows:Object.keys(groups).map(function(key){return groups[key];})};
}
function applyEntryLocal(entry,rows,sheetId){
  if(!window.DB_SCORES)return;
  rows.forEach(function(row){var saved=entry.existing&&entry.existing[row.student_id+'|'+sheetId]||{};var idx=Number(row.subject_index);if(!DB_SCORES[row.student_id])DB_SCORES[row.student_id]={};var current=DB_SCORES[row.student_id][idx]||{ca1:'',ca2:'',ca3:'',exam:''};PARTS.forEach(function(part){if(Object.prototype.hasOwnProperty.call(row.scores,part)&&row.decisions[part]!=='keep_existing')current[part]=row.scores[part];else if(saved&&saved[part]!==undefined)current[part]=saved[part];});DB_SCORES[row.student_id][idx]=current;});
}
function commitTemplateEntry(entry){
  var total=0;
  return (entry.sheets||[]).reduce(function(chain,sheet){return chain.then(function(){var packed=entryRows(entry,sheet);if(!packed.rows.length)return true;return api('context.set',{class_key:sheet.class_key,academic_session:sheet.academic_session,term:sheet.term}).then(function(){return api('smart.scores.commit',{sheet_id:sheet.id,rows:packed.rows,image_fingerprint:entry.fingerprint,summary:{scores_extracted:packed.cells.length,corrections_made:entry.corrections||0,page_index:entry.page}});}).then(function(result){total+=Number(result.score_fields_saved||0);applyEntryLocal(entry,packed.rows,sheet.id);return true;});});},Promise.resolve()).then(function(){return total;});
}
function genericEntryRows(entry,sheet){
  var cells=(entry.cells||[]).filter(function(cell){return String(cell.sheet_id)===String(sheet.id)&&cell.status==='confirmed'&&cell.value!==null;}),groups={};
  cells.forEach(function(cell){var row=groups[cell.student_id]||(groups[cell.student_id]={student_id:cell.student_id,subject_index:Number(cell.subject_index),class_key:cell.source_class_key,scores:{ca1:null,ca2:null,ca3:null,exam:null},existing:{},decisions:{},fields:0});var saved=entryOld(entry,cell)||{};PARTS.forEach(function(part){if(saved[part]!==undefined&&saved[part]!==null)row.scores[part]=saved[part];});if(cell.decision!=='keep_existing'){row.scores[cell.component]=cell.value;row.fields++;}if(saved&&Object.prototype.hasOwnProperty.call(saved,cell.component))row.existing[cell.component]=saved[cell.component];if(cell.decision)row.decisions[cell.component]=cell.decision;});
  return Object.keys(groups).map(function(key){return groups[key];});
}
function commitGenericEntry(entry){
  var total=0;
  return (entry.sheets||[]).reduce(function(chain,sheet){return chain.then(function(){var rows=genericEntryRows(entry,sheet);if(!rows.length)return true;return api('context.set',{class_key:sheet.class_key,academic_session:sheet.academic_session,term:sheet.term}).then(function(){return rows.reduce(function(next,row){return next.then(function(){if(!row.fields)return true;return api('scores.enter',{student_id:row.student_id,class_key:sheet.class_key,subject_index:sheet.subject_index,term:sheet.term,academic_session:sheet.academic_session,ca1:row.scores.ca1,ca2:row.scores.ca2,ca3:row.scores.ca3,exam:row.scores.exam}).then(function(){total+=row.fields;});});},Promise.resolve());}).then(function(){applyEntryLocal(entry,rows,sheet.id);return true;});});},Promise.resolve()).then(function(){return total;});
}
function saveCompletedEntries(entries){
  showLoad('Saving scores…');var hasGeneric=entries.some(function(entry){return entry.generic;}),hasTemplate=entries.some(function(entry){return!entry.generic;});
  if(hasGeneric&&hasTemplate){hideLoad();showToast('Save the scanned sheets separately.','error');return;}
  var saveOne=hasGeneric?commitGenericEntry:commitTemplateEntry;
  entries.reduce(function(chain,entry){return chain.then(function(total){return saveOne(entry).then(function(count){return total+Number(count||0);});});},Promise.resolve(0)).then(function(total){hideLoad();S.batch=[];document.getElementById('smart-work').innerHTML='<section class="smart-card smart-success"><div>✓</div><h3>Scores saved</h3><p>'+total+' score fields are now in the Result Portal.</p><button class="smart-scan-button" id="smart-again">SCAN ANOTHER SHEET</button></section>';document.getElementById('smart-again').onclick=renderScan;}).catch(function(e){hideLoad();showToast(e&&e.code==='SMART_CONFLICT_DECISION_REQUIRED'?'Choose how to handle each saved-score conflict first.':'Scores were not saved. Review and try again.','error');renderReview();});
}
function save(){
  if(window.canWriteResults&&window.canWriteResults()===false){showToast('Score entry is currently read-only. Management must enable this staff account first.','error');return;}
  if(unresolved()||unresolvedConflicts()){showToast('Review the highlighted scores and conflicts first.','error');return;}
  var entries=S.batch.slice();entries.push(currentEntry());saveCompletedEntries(entries);
}
function queueNextSheet(){if(unresolved()||unresolvedConflicts()){showToast('Review the highlighted scores and conflicts before scanning the next sheet.','error');return;}queueCurrent();renderScan();}
function renderReview(){
  var roster=(S.generic?S.sheet.roster:(S.sheet.roster||[]).filter(function(r){return Number(r.page_index||0)===S.page;})),columns=reviewSheets(),counts=S.cells.reduce(function(n,c){n[c.status==='confirmed'?'ready':c.status==='blank'?'blank':'review']++;return n;},{ready:0,review:0,blank:0}),title=reviewTitle(),batchNote=S.batch.length?'<small class="smart-batch-note">'+S.batch.length+' sheet'+(S.batch.length===1?'':'s')+' queued</small>':'';
  var html='<section class="smart-stage"><div class="smart-stage-head"><div><h3>'+title+'</h3><small>'+esc(S.sheet.term)+' · '+esc(S.sheet.academic_session)+' · '+roster.length+' students</small>'+batchNote+'</div><div class="smart-summary"><span class="smart-pill">'+counts.ready+' ready</span><span class="smart-pill review">'+counts.review+' need review</span><span class="smart-pill blank">'+counts.blank+' blank</span></div></div><div class="smart-table-wrap"><table class="smart-table smart-review-table"><thead><tr><th>#</th><th>Student</th>'+columns.map(function(s){return'<th colspan="4">'+esc(s.subject_name)+'</th>';}).join('')+'</tr><tr><th></th><th></th>'+columns.map(function(s){return PARTS.map(function(p){return'<th>'+LABELS[p]+'<br><small>MAX '+esc(s.assessment_config[p])+'</small></th>';}).join('');}).join('')+'</tr></thead><tbody>';
  roster.forEach(function(student){html+='<tr><td>'+student.row_index+'</td><td class="smart-student">'+esc(student.name)+'<small>'+esc(student.admno||'')+'</small>'+(S.sheet.grouped_across_classes?'<small class="smart-student-dept">'+esc(departmentName(student.source_class_key))+'</small>':'')+'</td>';columns.forEach(function(sheet){PARTS.forEach(function(part){html+='<td>'+cellButton(cellFor(student,sheet,part))+'</td>';});});html+='</tr>';});
  html+='</tbody></table></div><div class="smart-footer"><button class="smart-secondary" id="smart-discard">START OVER</button><button class="smart-secondary" id="smart-next">SCAN NEXT SHEET</button><button class="smart-save" id="smart-save" '+((unresolved()||unresolvedConflicts())?'disabled':'')+'>SAVE '+(S.batch.length?'ALL ':'')+'SCORES</button></div></section>';
  document.getElementById('smart-work').innerHTML=html;document.querySelectorAll('[data-cell]').forEach(function(button){button.onclick=function(){openCell(button.dataset.cell);};});document.getElementById('smart-discard').onclick=function(){resetRun();renderScan();};document.getElementById('smart-next').onclick=queueNextSheet;document.getElementById('smart-save').onclick=save;
}
function printSheets(a){
  if(!a||!a.length){showToast('No generated sheet was returned.','error');return;}
  var first=a[0],roster=buildPrintRoster(a),multi=isPrimary(first.class_key),pages=Math.max(1,Math.max.apply(null,roster.map(function(r){return Number(r.page_index||0);}))+1),jobs=[];
  for(var p=0;p<pages;p++)jobs.push(qrData(a.length>1?groupCode(a,p):'WTS-SR1:'+first.id+':'+p));
  Promise.all(jobs).then(function(qrs){
    var body='',columns=printColumns(a);
    for(var p=0;p<pages;p++){
      var rows=roster.filter(function(r){return Number(r.page_index||0)===p;});
      body+='<section class="smart-print-page '+(multi?'landscape':'portrait')+'"><header class="smart-print-header"><div class="smart-print-title"><h1>'+esc((getSchool()||{}).name||'Way to Success Standard Schools')+'</h1><h2>SMART SCORE SHEET</h2><p>'+esc(printTitle(a))+' · '+esc(first.term)+' · '+esc(first.academic_session)+' · Page '+(p+1)+' of '+pages+'</p></div><div><img class="smart-print-qr" src="'+qrs[p]+'" alt="Sheet code"><div class="smart-print-code">'+esc(first.sheet_code)+(a.length>1?' · merged':'')+' · '+(p+1)+'</div></div></header>'+printTable(columns,rows,multi,uniqueClassKeys(a).length>1)+'</section>';
    }
    var win=window.open('','_blank');if(!win){showToast('Allow pop-ups to download or print the Smart Score Sheet.','error');return;}
    var toolbar='<div class="smart-print-toolbar"><strong>Smart Score Sheet · A4</strong><span>All '+pages+' page'+(pages===1?'':'s')+' included</span><button onclick="window.print()">DOWNLOAD / SAVE AS PDF</button><button onclick="window.close()">CLOSE</button></div>';
    var script='<script>(function(){function ready(){var imgs=Array.prototype.slice.call(document.images);Promise.all(imgs.map(function(img){return img.complete?Promise.resolve():new Promise(function(ok){img.onload=img.onerror=ok;});})).then(function(){setTimeout(function(){},250);});}window.addEventListener("load",ready);})();<\\/script>';
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Smart Score Sheet · A4</title><link rel="stylesheet" href="'+location.origin+'/smart-recording.css"></head><body>'+toolbar+body+script+'</body></html>');
    win.document.close();
  }).catch(function(){showToast('The QR could not be generated.','error');});
}
})();
