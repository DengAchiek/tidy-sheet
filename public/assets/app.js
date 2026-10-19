'use strict';
(() => {
  const $=id=>document.getElementById(id), C=window.TidyCore, PAGE_SIZE=50;
  const session=JSON.parse(document.getElementById('tidysheet-session')?.textContent||'{"sampleOnly":true}');
  const sampleOnly=session.sampleOnly===true;
  async function authorize(rows,columns){
    if(sampleOnly)return;
    const response=await fetch('/api/usage/clean',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),rows,columns})});
    const data=await response.json();if(!response.ok)throw Error(data.message||'Sign in and check your subscription to continue.');
  }
  async function authorizeDownload(){
    if(sampleOnly)return true;
    try{const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'}),s=await r.json();if(!r.ok||!s.access?.allowed)throw Error('Your access has ended. Open Account & billing to continue.');return true;}catch(e){message(e.message);return false;}
  }
  const SAMPLE=`Customer Name,Phone,Email,Signup Date,Amount,Customer ID\n  john   kamau ,0712345678,John.Kamau@Gmail.com,05/03/2024,"KES 12,500",00127\nJOHN KAMAU,+254 712 345 678,john.kamau@gmail.com,2024-03-05,12500,00127\nmary WANJIRU,0722-111-222,mary.w@@yahoo.com,12 Jan 2024,Ksh 3400,00128\n,,,,,\npeter otieno,254733987654,peter@otieno.co.ke,31/02/2024,N/A,00129\nAisha  mohamed,0110 123 456,aisha@mail,3 Feb 2024,"8,000",00130\nBrian O'neil,12345,brian@corp.com,15-07-2024,950.50,00131\nGrace Njeri,0799888777,grace@example.com,2024-06-20,"KES 4,250.00",00132`;
  let worker=null, workbookReady=false, sequence=0, pending=new Map(), busy=false, currentFile=null, matrix=[], sheets=[], model=null, original=null, result=null, types=[], keys=[], edits=[], view='original', page=0, activeIssue=null, searchTimer;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>n.toLocaleString();
  function message(text,kind='error'){$('message').textContent=text;$('message').className='notice global-notice '+kind;$('message').hidden=!text;}
  function ensureWorker(){
    if(worker)return worker;
    worker=new Worker('assets/worker.js');
    worker.onmessage=({data})=>{
      const job=pending.get(data.id);if(!job)return;
      if(data.progress!==undefined){$('busyText').textContent='Standardizing your spreadsheet… '+data.progress+'%';return;}
      pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);
    };
    worker.onerror=()=>{const error=Error('The cleaner could not start. Reload the page and try again.');for(const p of pending.values())p.reject(error);pending.clear();worker.terminate();worker=null;};
    return worker;
  }
  function request(action,payload={}){return new Promise((resolve,reject)=>{try{const id=++sequence;pending.set(id,{resolve,reject});ensureWorker().postMessage({id,action,...payload});}catch(e){pending.delete(sequence);reject(e);}});}
  function setBusy(value,label='Working…',canCancel=true){
    busy=value;$('busy').hidden=!value;$('busyText').textContent=label;$('cancel').hidden=!canCancel;
    document.querySelectorAll('#run,#sample,#browse,#newFile,#hasHeader,#sheetSelect,#downloadXlsx,#downloadCsv,#downloadLog,.type-select,.key-check,#dateOrder,#trim,#titleCase,#nulls,#removeEmpty,#removeDuplicates,#caseInsensitive,#dropInvalid').forEach(el=>el.disabled=value);
  }
  function invalidate(){
    if(!result)return;
    result=null;$('tabCleaned').disabled=true;$('tabIssues').disabled=true;$('issueCount').textContent='';$('exportPanel').hidden=true;$('exportNote').hidden=true;$('legend').hidden=true;$('reviewNotice').hidden=true;
    $('settingsHint').textContent='Settings changed. Clean again to update results.';
    $('resultSummary').textContent='Settings changed. Clean again to see fresh results.';view='original';page=0;renderStats();renderTable();
  }
  function config(){return {types:types.slice(),keys:keys.map((v,i)=>v?i:-1).filter(i=>i>=0),dateOrder:$('dateOrder').value,...Object.fromEntries(['trim','titleCase','nulls','removeEmpty','removeDuplicates','caseInsensitive','dropInvalid'].map(id=>[id,$(id).checked]))};}
  function refreshModel(){
    model=C.prepare(matrix,$('hasHeader').checked);original={...model,rows:model.rows.map(r=>r.slice())};
    types=model.headers.map(C.guess);keys=types.map(()=>false);edits=[];result=null;view='original';page=0;
    $('columns').innerHTML=model.headers.map((h,i)=>`<div class="column-config"><label class="field"><span title="${esc(h)}">${esc(h)}</span><select class="type-select" data-column="${i}" aria-label="Type for ${esc(h)}">${Object.entries(C.TYPES).map(([k,v])=>`<option value="${k}"${types[i]===k?' selected':''}>${esc(v)}</option>`).join('')}</select></label><span class="example" title="${esc(model.rows[0]?.[i])}">e.g. ${esc(model.rows[0]?.[i]||'—')}</span><label class="checkbox-label"><input class="key-check" data-column="${i}" type="checkbox">Use as duplicate key</label></div>`).join('');
    $('fileName').textContent=currentFile.name;$('fileExt').textContent=currentFile.name.split('.').at(-1).toUpperCase();
    $('fileMeta').textContent=fmt(model.rows.length)+' data rows · '+fmt(model.headers.length)+' columns · '+(currentFile.size/1024).toFixed(1)+' KB';
    $('importWarnings').textContent=model.warnings.join(' ');$('importWarnings').hidden=!model.warnings.length;
    $('workspace').hidden=false;$('uploadView').hidden=true;
    $('sheetField').hidden=sheets.length<1;
    $('tabCleaned').disabled=true;$('tabIssues').disabled=true;$('issueCount').textContent='';$('exportPanel').hidden=true;$('exportNote').hidden=true;$('legend').hidden=true;$('reviewNotice').hidden=true;
    $('settingsHint').textContent='Your original file stays untouched.';$('resultSummary').textContent='Confirm the column types, then clean your spreadsheet.';
    $('search').value='';$('rowFilter').value='all';updateKeys();renderStats();renderTable();
  }
  async function importFile(file,isSample=false){
    if(busy)return;
    if(sampleOnly&&!isSample){message('The free sample uses sample data only. Get Premium to clean your own files.');return;}
    if(!/\.(csv|tsv|xlsx|xls)$/i.test(file.name)){message('Choose a CSV, TSV, XLSX, or XLS file.');return;}
    if(file.size>C.LIMITS.bytes){message('This file is over 20 MB. Split it into smaller files.');return;}
    message('');setBusy(true,'Opening your spreadsheet…');workbookReady=false;
    try{
      const data=await request('import',{file});
      // Validate before replacing a working workspace.
      C.prepare(data.matrix,$('hasHeader').checked);
      currentFile=file;matrix=data.matrix;sheets=data.sheets;workbookReady=true;
      $('sheetSelect').innerHTML=sheets.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');$('sheetSelect').value=data.sheet;$('sheetSelect').dataset.loaded=data.sheet||'';
      refreshModel();
    }catch(e){if(e.message!=='Cancelled')message(e.message);}
    finally{setBusy(false);$('file').value='';}
  }
  function updateKeys(){const chosen=keys.map((v,i)=>v?model.headers[i]:null).filter(Boolean);$('keyHint').textContent=chosen.length?'Matching on: '+chosen.join(', ')+'. First matching row kept; blank or invalid keys are excluded.':'No keys selected: compare the whole row. The first matching row is kept.';}
  async function runClean(){
    if(busy||!model)return;message('');setBusy(true,'Standardizing your spreadsheet…');
    try{
      await authorize(model.rows.length,model.headers.length);
      result=await request('clean',{model,config:config()});result.audit.unshift(...edits);
      $('tabCleaned').disabled=false;$('tabIssues').disabled=false;$('issueCount').textContent=result.issues.length?'('+fmt(result.issues.length)+')':'';
      $('exportPanel').hidden=false;$('exportNote').hidden=false;$('settingsHint').textContent='All set. You can adjust the rules and clean again.';
      const s=result.stats;
      $('resultSummary').textContent=`${fmt(s.input)} input rows → ${fmt(s.output)} kept · ${fmt(s.duplicates)} duplicates, ${fmt(s.empty)} empty, ${fmt(s.dropped)} invalid rows removed. ${fmt(s.invalid)} invalid cells found across the input.`;
      $('reviewNotice').hidden=!s.review;$('reviewNotice').textContent=`${fmt(s.review)} retained ${s.review===1?'row needs':'rows need'} review. Open Issues to correct flagged values, then download your results.`;
      view='cleaned';page=0;$('rowFilter').value='all';$('search').value='';renderStats();renderTable();
      $('cleanSuccessSummary').textContent=`${fmt(s.output)} ${s.output===1?'row is':'rows are'} ready to review and download.${s.review?` ${fmt(s.review)} ${s.review===1?'row still needs':'rows still need'} review in Issues.`:''}`;
      $('cleanSuccessDialog').showModal();
    }catch(e){if(e.message!=='Cancelled')message(e.message);}
    finally{setBusy(false);}
  }
  function renderStats(){
    const s=result?.stats;
    const stats=s?[['Rows kept',s.output,fmt(s.input)+' rows imported',''],['Values standardized',s.changed,'Across all input rows','green'],['Duplicates removed',s.duplicates,'First matching record kept',''],['Rows to review',s.review,'Retained rows with invalid cells',s.review?'alert':'']]:[['Imported rows',model.rows.length,'Ready to clean',''],['Columns',model.headers.length,'Confirm each column type',''],['Duplicate matching',keys.filter(Boolean).length,keys.some(Boolean)?'Selected key columns':'Comparing the whole row',''],['Status','Ready','Choose rules, then clean','green']];
    $('stats').innerHTML=stats.map(([label,n,detail,cls])=>`<div class="stat ${cls}"><span class="stat-label">${esc(label)}</span><strong>${typeof n==='number'?fmt(n):n}</strong><span class="stat-detail">${esc(detail)}</span></div>`).join('');
  }
  function filteredRows(){
    const query=$('search').value.trim().toLowerCase(),filter=$('rowFilter').value;
    if(view==='issues')return result.issues.map((r,i)=>i).filter(i=>{const r=result.issues[i];return (!query||Object.values(r).some(v=>String(v).toLowerCase().includes(query)))&&(filter!=='invalid'||/review|invalid/i.test(r.action));});
    const data=view==='original'?original.rows:result.rows;
    const indices=[];for(let i=0;i<data.length;i++){
      if(query&&!data[i].some(v=>v.toLowerCase().includes(query)))continue;
      if(view==='cleaned'&&filter==='invalid'&&!result.flags[i].some(Boolean))continue;
      if(view==='cleaned'&&filter==='changed'&&!result.changed[i].some(Boolean))continue;
      indices.push(i);
    }return indices;
  }
  function renderTable(){
    if(!model)return;
    ['Original','Cleaned','Issues'].forEach(v=>$('tab'+v).setAttribute('aria-pressed',String(view===v.toLowerCase())));
    $('previewTitle').textContent=view==='issues'?'Issues to review':view==='cleaned'?'Cleaned data':'Preview';
    $('rowFilter').disabled=view==='original';$('rowFilter').querySelector('[value="changed"]').disabled=view==='issues';
    if(view==='issues'&&$('rowFilter').value==='changed')$('rowFilter').value='all';
    $('legend').hidden=view!=='cleaned';
    const indices=filteredRows(),count=indices.length,pages=Math.max(1,Math.ceil(count/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));
    const visible=indices.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
    const headers=view==='issues'?['Source row','Column','Original value','Detail','Action','']:['Source row',...model.headers];
    let html='<thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>';
    for(const i of visible){
      if(view==='issues'){
        const item=result.issues[i],editable=/review|invalid/i.test(item.action)&&model.headers.includes(item.column);
        html+=`<tr><td class="row-number">${item.row}</td><td>${esc(item.column)}</td><td class="issue-value" title="${esc(item.original)}">${esc(item.original||'—')}</td><td class="issue-detail">${esc(item.issue)}</td><td>${esc(item.action)}</td><td>${editable?`<button class="edit-btn" data-issue="${i}" type="button" aria-label="Edit source row ${item.row}, ${esc(item.column)}">Review ↗</button>`:''}</td></tr>`;
      }else{
        const data=view==='original'?original.rows:result.rows, source=view==='original'?original.sourceRows:result.sourceRows;
        html+='<tr><td class="row-number">'+source[i]+'</td>'+data[i].map((v,j)=>{const cls=view==='cleaned'?(result.flags[i][j]?'invalid':result.changed[i][j]?'changed':''):'';return `<td class="${cls}" title="${esc(v)}">${esc(v||'')}</td>`;}).join('')+'</tr>';
      }
    }
    $('table').innerHTML=html+'</tbody>';$('tableEmpty').hidden=count!==0;
    $('tableEmpty').textContent=view==='issues'&&!result.issues.length?'No issues found. Looking tidy!':view==='cleaned'&&!result.rows.length?'No rows remain after cleaning. Adjust your rules or download the change log.':'No matching rows.';
    $('tableCount').textContent=fmt(count)+(view==='issues'?' events':' rows');
    $('pageInfo').textContent=count?`${fmt(page*PAGE_SIZE+1)}–${fmt(Math.min((page+1)*PAGE_SIZE,count))} of ${fmt(count)} · source row numbers shown`:'0 results';
    $('pageNumber').textContent=(page+1)+' / '+pages;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
  }
  function download(blob,suffix){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=currentFile.name.replace(/\.[^.]+$/,'')+suffix;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function csvDownload(rows,suffix){download(new Blob([C.toCSV(rows)],{type:'text/csv;charset=utf-8'}),suffix);}
  $('browse').onclick=()=>$('file').click();$('file').onchange=e=>{if(e.target.files[0])importFile(e.target.files[0]);};
  $('sample').onclick=()=>importFile(new File([SAMPLE],'sample_customers.csv',{type:'text/csv'}),true);
  $('drop').ondragover=e=>{e.preventDefault();if(!busy)$('drop').classList.add('dragging');};
  $('drop').ondragleave=()=>$('drop').classList.remove('dragging');
  $('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('dragging');if(e.dataTransfer.files.length>1){message('Choose one file at a time.');return;}if(e.dataTransfer.files[0])importFile(e.dataTransfer.files[0]);};
  // Prevent a dropped file from navigating away from the workspace.
  window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
  window.addEventListener('drop',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
  $('columns').onchange=e=>{const i=Number(e.target.dataset.column);if(e.target.matches('.type-select'))types[i]=e.target.value;if(e.target.matches('.key-check'))keys[i]=e.target.checked;invalidate();updateKeys();renderStats();};
  ['dateOrder','trim','titleCase','nulls','removeEmpty','removeDuplicates','caseInsensitive','dropInvalid'].forEach(id=>$(id).onchange=invalidate);
  $('hasHeader').onchange=()=>{try{refreshModel();message('');}catch(e){$('hasHeader').checked=!$('hasHeader').checked;message(e.message);}};
  $('sheetSelect').onchange=async()=>{
    if(busy)return;message('');setBusy(true,'Opening worksheet…');
    const previous=$('sheetSelect').dataset.loaded;
    try{if(!workbookReady){await request('import',{file:currentFile});workbookReady=true;}const data=await request('sheet',{name:$('sheetSelect').value});C.prepare(data.matrix,$('hasHeader').checked);matrix=data.matrix;refreshModel();$('sheetSelect').dataset.loaded=data.sheet;}
    catch(e){if(previous)$('sheetSelect').value=previous;message(e.message);}
    finally{setBusy(false);}
  };
  $('run').onclick=runClean;
  ['original','cleaned','issues'].forEach(v=>$('tab'+v[0].toUpperCase()+v.slice(1)).onclick=()=>{view=v;page=0;renderTable();});
  $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;renderTable();},160);};
  $('rowFilter').onchange=()=>{page=0;renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
  $('downloadCsv').onclick=async()=>{if(result&&await authorizeDownload())csvDownload([model.headers,...result.rows],'_cleaned.csv');};
  $('downloadLog').onclick=async()=>{if(!result||!await authorizeDownload())return;const entries=result.audit.length?result.audit:[{row:'',column:'',original:'',cleaned:'',issue:'No changes or issues found',action:'No change'}];csvDownload([['Source row','Column','Original value','Cleaned value','Detail','Action'],...entries.map(i=>[i.row,i.column,i.original,i.cleaned,i.issue,i.action])],'_change_log.csv');};
  $('downloadXlsx').onclick=async()=>{
    if(!result||busy||!await authorizeDownload())return;message('');setBusy(true,'Preparing your Excel download…');
    try{const buffer=await request('xlsx',{headers:model.headers,result,types});download(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'_cleaned.xlsx');}
    catch(e){if(e.message!=='Cancelled')message(e.message);}
    finally{setBusy(false);}
  };
  $('table').onclick=e=>{
    const button=e.target.closest('[data-issue]');if(!button||busy)return;
    activeIssue=result.issues[Number(button.dataset.issue)];
    $('editContext').textContent='Source row '+activeIssue.row+' · '+activeIssue.column;$('editReason').textContent=activeIssue.issue;
    const ri=model.sourceRows.indexOf(activeIssue.row),ci=model.headers.indexOf(activeIssue.column);
    $('editValue').value=model.rows[ri][ci];$('editDialog').showModal();$('editValue').focus();
  };
  $('closeDialog').onclick=()=>$('editDialog').close();
  $('editForm').onsubmit=async e=>{
    e.preventDefault();if(!activeIssue)return;
    const ri=model.sourceRows.indexOf(activeIssue.row),ci=model.headers.indexOf(activeIssue.column),value=$('editValue').value;
    if(value!==model.rows[ri][ci]){edits.push({row:activeIssue.row,column:activeIssue.column,original:model.rows[ri][ci],cleaned:value,issue:'Manual correction in review',action:'Manually corrected'});model.rows[ri][ci]=value;}
    $('editDialog').close();activeIssue=null;await runClean();if(result){view='issues';renderTable();}
  };
  function restartWorker(){if(worker)worker.terminate();worker=null;workbookReady=false;for(const p of pending.values())p.reject(Error('Cancelled'));pending.clear();}
  $('cancel').onclick=()=>{
    restartWorker();message('Operation cancelled. Existing source data is still available.','');
  };
  $('newFile').onclick=()=>$('resetDialog').showModal();$('keepWorkspace').onclick=()=>$('resetDialog').close();
  $('clearWorkspace').onclick=()=>{
    restartWorker();clearTimeout(searchTimer);currentFile=null;matrix=[];sheets=[];model=null;original=null;result=null;types=[];keys=[];edits=[];activeIssue=null;
    $('workspace').hidden=true;$('uploadView').hidden=false;$('resetDialog').close();
    ['hasHeader','trim','titleCase','nulls','removeEmpty','removeDuplicates','caseInsensitive','dropInvalid'].forEach(id=>$(id).checked=$(id).defaultChecked);
    $('dateOrder').value='DMY';$('search').value='';$('editValue').value='';$('file').value='';
    ['columns','table','stats','sheetSelect','fileName','fileMeta','editContext','editReason'].forEach(id=>$(id).replaceChildren());
    message('');setBusy(false);
  };
  // No storage is used. Warn only when a tab contains manual corrections.
  window.addEventListener('beforeunload',e=>{if(edits.length){e.preventDefault();e.returnValue='';}});
  if(location.protocol==='file:')message('For local use, open this project with npm start and visit http://127.0.0.1:4173. Browser workers require an HTTP server.');
  else if(sampleOnly||new URLSearchParams(location.search).has('sample'))$('sample').click();
  if(sampleOnly){$('browse').hidden=true;$('newFile').onclick=()=>location.assign('/account');$('newFile').textContent='Use my own file ↗';}
})();
