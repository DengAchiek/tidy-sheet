'use strict';
importScripts('core.js?v=4.8.0','business-core.js?v=4.8.0');
let workbook=null,sessionMatrix=null,baseModel=null,workingModel=null,sessionResult=null,sessionBefore=null,sessionEdits=[],mergeDecisions=[],lastConfig=null,pageCache=null,selectedHeader=true;
const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
function rebuild(){
  workingModel={...baseModel,rows:baseModel.rows.slice(),sourceRows:baseModel.sourceRows.slice()};
  const positions=new Map(workingModel.sourceRows.map((source,i)=>[source,i]));
  for(const edit of sessionEdits){const index=positions.get(edit.row);if(index===undefined)continue;workingModel.rows[index]=workingModel.rows[index].slice();workingModel.rows[index][edit.column]=edit.value;}
  for(const decision of mergeDecisions){const keep=workingModel.sourceRows.indexOf(decision.keep),drop=workingModel.sourceRows.indexOf(decision.drop);if(keep<0||drop<0)throw Error('A reviewed merge no longer matches the source rows. Undo the last merge.');workingModel.rows[keep]=decision.values.slice();workingModel.rows.splice(drop,1);workingModel.sourceRows.splice(drop,1);}
  sessionResult=null;pageCache=null;
}
function selectModel(matrix,hasHeader=true){const candidate=TidyCore.prepare(matrix,hasHeader),before=TidyCore.analyzeNulls(candidate);sessionMatrix=matrix;selectedHeader=hasHeader;baseModel=candidate;sessionBefore=before;sessionEdits=[];mergeDecisions=[];rebuild();return metadata();}
function metadata(){return {headers:baseModel.headers,hasHeader:selectedHeader,rowCount:baseModel.rows.length,warnings:baseModel.warnings,nullAnalysis:sessionBefore,examples:baseModel.headers.map((_,i)=>String(baseModel.rows[0]?.[i]||'').slice(0,160))};}
function summary(){const r=sessionResult;return {stats:r.stats,outputHeaders:r.outputHeaders,outputColumnIndices:r.outputColumnIndices,removedColumns:r.removedColumns,nullAnalysis:r.nullAnalysis,quality:r.quality,insights:r.insights,duplicates:{...r.duplicates,pairs:r.duplicates.pairs.map(p=>({...p,left:p.left.map(v=>v.slice(0,300)),right:p.right.map(v=>v.slice(0,300))}))},issueCount:r.issues.length,mergeCount:mergeDecisions.length};}
async function streamCSV(file,delimiter,id){
  const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let record='',quoted=false,skipLF=false,read=0,cells=0,nonempty=false;const matrix=[];
  function finish(){const parsed=record.trim()?TidyCore.parseCSV(record,delimiter):{matrix:[delimiter?record.split(delimiter):[record]]};if(!delimiter)delimiter=parsed.delimiter;const row=parsed.matrix[0];if(row.length>TidyCore.LIMITS.columns)throw Error('This file has more than 100 columns. Split it into smaller files.');cells+=row.length;if(cells>TidyCore.LIMITS.cells+TidyCore.LIMITS.columns||matrix.length>TidyCore.LIMITS.rows)throw Error('This file exceeds the row or cell limit. Split it into smaller files.');matrix.push(row);record='';}
  function feed(text){for(const char of text){if(skipLF){skipLF=false;if(char==='\n')continue;}if(char==='"')quoted=!quoted;if((char==='\n'||char==='\r')&&!quoted){finish();skipLF=char==='\r';}else record+=char;if(char.trim())nonempty=true;}}
  try{while(true){const part=await reader.read();if(part.done)break;read+=part.value.byteLength;feed(decoder.decode(part.value,{stream:true}));postMessage({id,progress:Math.round(read/file.size*85),label:'Reading CSV in chunks'});}feed(decoder.decode());if(record)finish();if(!nonempty)throw Error('This file is empty.');if(quoted)throw Error('CSV contains an unclosed quoted field. Fix the file before importing.');return {matrix,delimiter};}finally{reader.releaseLock();}
}
function sessionPage(data){
  if(!baseModel)throw Error('Import a file first.');const view=data.view||'original',r=sessionResult;if(view!=='original'&&!r)throw Error('Clean again to refresh the results.');
  const columns=view==='cleaned'?r.outputColumnIndices:baseModel.headers.map((_,i)=>i);
  const query=String(data.query||'').trim().toLowerCase(),filter=data.filter||'all',key=JSON.stringify([view,query,filter]);let indices;
  if(pageCache?.key===key)indices=pageCache.indices;else{
    const rows=view==='issues'?r.issues:view==='original'?baseModel.rows:r.rows;indices=[];
    for(let i=0;i<rows.length;i++){const row=rows[i];if(query&&!(view==='issues'?Object.values(row):row).some(v=>String(v).toLowerCase().includes(query)))continue;if(filter==='missing'&&view!=='issues'&&!columns.some(ci=>TidyBusiness.missing(row[ci])))continue;if(view==='cleaned'&&filter==='invalid'&&!r.flags[i].some(Boolean))continue;if(view==='cleaned'&&filter==='changed'&&!r.changed[i].some(Boolean))continue;if(view==='issues'&&filter==='warnings'&&row.severity!=='warning')continue;if(view==='issues'&&filter==='errors'&&(row.severity==='warning'||row.severity==='info'||/Removed|Dropped/.test(row.action)))continue;if(view==='issues'&&filter==='invalid'&&/Removed|Dropped/.test(row.action))continue;indices.push(i);}pageCache={key,indices};
  }
  const pages=Math.max(1,Math.ceil(indices.length/50)),page=Math.max(0,Math.min(Number(data.page)||0,pages-1));
  return {headers:columns.map(i=>baseModel.headers[i]),count:indices.length,pages,page,items:indices.slice(page*50,(page+1)*50).map(i=>view==='issues'?{index:i,...r.issues[i],original:String(r.issues[i].original).slice(0,500)}:{source:(view==='original'?baseModel.sourceRows:r.sourceRows)[i],values:columns.map(ci=>(view==='original'?baseModel.rows:r.rows)[i][ci].slice(0,500)),flags:view==='cleaned'?columns.map(ci=>r.flags[i][ci]):[],changed:view==='cleaned'?columns.map(ci=>r.changed[i][ci]):[]})};
}
function excel(){if(!self.XLSX)importScripts('vendor/xlsx.full.min.js');return self.XLSX;}
function sheetMatrix(name){
  const X=excel(),ws=workbook.Sheets[name];if(!ws||!ws['!ref'])return [];
  const range=X.utils.decode_range(ws['!ref']);
  if(range.e.r>=TidyCore.LIMITS.rows+1||range.e.c>=TidyCore.LIMITS.columns||(range.e.r+1)*(range.e.c+1)>TidyCore.LIMITS.cells)throw Error('This sheet exceeds the 100,000-row, 100-column, or 1,000,000-cell limit. Reduce the used range in Excel and try again.');
  const matrix=X.utils.sheet_to_json(ws,{header:1,range:{s:{r:0,c:0},e:range.e},raw:false,dateNF:'yyyy-mm-dd',defval:'',blankrows:true});
  // Date cells may have a custom workbook format with a two-digit year.
  // Convert actual typed Excel dates, independently of their display format.
  for(const address of Object.keys(ws)){
    if(address.startsWith('!'))continue;
    const cell=ws[address];
    if(cell.t==='d'&&cell.v instanceof Date&&!isNaN(cell.v)){
      const pos=X.utils.decode_cell(address),date=cell.v;
      matrix[pos.r][pos.c]=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }
  }
  return matrix;
}
self.onmessage=async({data})=>{
  const {id,action}=data;const priorWorkbook=workbook;
  try{
    let result;
    if(action==='import'){
      const file=data.file;
      if(file.size>TidyCore.LIMITS.bytes)throw Error('This file is over 20 MB. Split it into smaller files.');
      if(/\.(csv|tsv)$/i.test(file.name)){
        let text;
        try{if(data.session&&file.stream){const parsed=await streamCSV(file,/\.tsv$/i.test(file.name)?'\t':undefined,id);result={...parsed,sheets:[],sheet:null};}else text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
        catch(error){if(error.name==='TypeError')throw Error('This file is not valid UTF-8 text. Save it as CSV UTF-8 in your spreadsheet app and try again.');throw error;}
        if(!result){const parsed=TidyCore.parseCSV(text,/\.tsv$/i.test(file.name)?'\t':undefined);result={...parsed,sheets:[],sheet:null};}workbook=null;
      }
      else if(/\.(xlsx|xls)$/i.test(file.name)){
        const X=excel();workbook=X.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellFormula:false,dateNF:'yyyy-mm-dd'});
        if(!workbook.SheetNames.length)throw Error('This workbook has no worksheets.');
        let selected=workbook.SheetNames[0],matrix=[];
        for(const name of workbook.SheetNames){
          try{const candidate=sheetMatrix(name);if(candidate.length>1){selected=name;matrix=candidate;break;}}catch(error){if(workbook.SheetNames.length===1)throw error;}
        }
        if(!matrix.length)matrix=sheetMatrix(selected);
        result={matrix,sheets:workbook.SheetNames,sheet:selected};
      }else throw Error('Choose a CSV, TSV, XLSX, or XLS file.');
    if(data.session){const sheets=result.sheets,sheet=result.sheet;result={...selectModel(result.matrix,data.hasHeader!==false),sheets,sheet};}
    }else if(action==='sheet'){const matrix=sheetMatrix(data.name);result=data.session?{...selectModel(matrix,data.hasHeader!==false),sheet:data.name}: {matrix,sheet:data.name};}
    else if(action==='reconfigure')result=selectModel(sessionMatrix,data.hasHeader!==false);
    else if(action==='page')result=sessionPage(data);
    else if(action==='getIssue'){if(!sessionResult||!Number.isInteger(data.index)||!sessionResult.issues[data.index])throw Error('Choose a current issue.');const item=sessionResult.issues[data.index];if(/Removed|Dropped/.test(item.action)||!baseModel.headers.includes(item.column))throw Error('This issue is informational.');if(String(item.original).length>10000)throw Error('This value exceeds the 10,000-character editor limit. Correct it in your source file.');result=item;}
    else if(action==='editSession'){if(!baseModel.sourceRows.includes(data.row)||!Number.isInteger(data.column)||data.column<0||data.column>=baseModel.headers.length||typeof data.value!=='string'||data.value.length>10000)throw Error('Choose a valid source cell and up to 10,000 characters.');sessionEdits.push({row:data.row,column:data.column,value:data.value});rebuild();result={edited:true};}
    else if(action==='keepBoth'){if(!sessionResult?.duplicates.pairs.some(p=>p.keep===data.keep&&p.drop===data.drop))throw Error('Choose a current duplicate suggestion.');sessionResult.audit.push({row:data.drop,column:'Entire row',original:'',cleaned:'',issue:'Reviewed possible duplicate against source row '+data.keep+'; kept both records.',action:'Reviewed distinct',severity:'info'});result={kept:true};}
    else if(action==='mergeSession'){if(!sessionResult)throw Error('Clean before reviewing a merge.');const pair=sessionResult.duplicates.pairs.find(p=>p.keep===data.keep&&p.drop===data.drop);if(!pair||!Array.isArray(data.choices)||data.choices.length!==baseModel.headers.length||data.choices.some(v=>v!=='left'&&v!=='right'))throw Error('Review a current duplicate suggestion first.');mergeDecisions.push({keep:pair.keep,drop:pair.drop,values:data.choices.map((choice,i)=>choice==='right'?pair.right[i]:pair.left[i])});rebuild();result={merged:true,decision:mergeDecisions.at(-1)};}
    else if(action==='restoreSession'){if(!Array.isArray(data.edits)||!Array.isArray(data.merges)||data.edits.length>10000||data.merges.length>10000)throw Error('Invalid recovery state.');const sources=new Set(baseModel.sourceRows);if(data.edits.some(e=>!sources.has(e.row)||!Number.isInteger(e.column)||e.column<0||e.column>=baseModel.headers.length||typeof e.value!=='string'||e.value.length>10000)||data.merges.some(m=>!sources.has(m.keep)||!sources.has(m.drop)||m.keep===m.drop||!Array.isArray(m.values)||m.values.length!==baseModel.headers.length||m.values.some(v=>typeof v!=='string')))throw Error('Recovery decisions do not match the source file.');const priorEdits=sessionEdits,priorMerges=mergeDecisions;try{sessionEdits=data.edits;mergeDecisions=data.merges;rebuild();}catch(error){sessionEdits=priorEdits;mergeDecisions=priorMerges;rebuild();throw error;}result={restored:true};}
    else if(action==='undoMerge'){mergeDecisions.pop();rebuild();result={mergeCount:mergeDecisions.length};}
    else if(action==='cleanSession'){if(!workingModel)throw Error('Import a file first.');const start=clock();lastConfig=data.config;sessionResult=TidyBusiness.clean(workingModel,lastConfig,(progress,label)=>postMessage({id,progress,label}));sessionResult.audit.unshift(...sessionEdits.map(e=>({row:e.row,column:baseModel.headers[e.column],original:baseModel.rows[baseModel.sourceRows.indexOf(e.row)][e.column],cleaned:e.value,issue:'Manual correction',action:'Manually corrected'})),...mergeDecisions.map(m=>({row:m.drop,column:'Entire row',original:JSON.stringify(baseModel.rows[baseModel.sourceRows.indexOf(m.drop)]),cleaned:JSON.stringify(m.values),issue:'User reviewed values and merged into source row '+m.keep,action:'Reviewed merge'})));sessionResult.stats.input=baseModel.rows.length;sessionResult.stats.merged=mergeDecisions.length;pageCache=null;result={...summary(),durationMs:Math.round(clock()-start)};}
    else if(action==='sessionCSV'){
      const r=sessionResult;if(!baseModel||data.kind!=='null'&&!r)throw Error('Clean the data before exporting.');let rows;
      if(data.kind==='null')rows=TidyCore.nullReportRows(sessionBefore,r?.nullAnalysis);
      else if(data.kind==='quality')rows=TidyBusiness.qualityRows(r);
      else if(data.kind==='log')rows=[['Source row','Column','Original value','Cleaned value','Detail','Action','Severity'],...r.audit.map(i=>[i.row,i.column,i.original,i.cleaned,i.issue,i.action,i.severity||''])];
      else if(data.kind==='insights'){if(!r.insights.enabled)throw Error('Confirm business summary mappings first.');rows=[['Currency','Month',r.insights.unit,'Rows'],...r.insights.monthly.map(g=>[g.currency,g.month,g.total,g.rows])];}
      else rows=[r.outputHeaders,...r.rows.map(row=>r.outputColumnIndices.map(i=>row[i]))];
      const buffers=[],encoder=new TextEncoder();for(let offset=0;offset<rows.length;offset+=512){const text=(offset?'\r\n':'')+TidyCore.toCSV(rows.slice(offset,offset+512)).slice(offset?1:0);buffers.push(encoder.encode(text).buffer);postMessage({id,progress:Math.round(Math.min(rows.length,offset+512)/rows.length*100),label:'Preparing CSV export'});}postMessage({id,result:{buffers}},buffers);return;
    }
    else if(action==='clean')result=TidyCore.clean(data.model,data.config,progress=>postMessage({id,progress}));
    else if(action==='xlsx'){
      if(data.session){if(!sessionResult)throw Error('Clean before exporting.');data={...data,headers:sessionResult.outputHeaders,result:{...sessionResult,rows:sessionResult.rows.map(row=>sessionResult.outputColumnIndices.map(i=>row[i]))},types:sessionResult.outputColumnIndices.map(i=>lastConfig.types[i]),nullBefore:sessionBefore};}
      if(!data.session&&data.result.outputColumnIndices){const indices=data.result.outputColumnIndices;data={...data,headers:indices.map(i=>data.headers[i]),types:indices.map(i=>data.types[i]),result:{...data.result,rows:data.result.rows.map(row=>indices.map(i=>row[i]))}};}
      const X=excel(),wb=X.utils.book_new();
      const rows=data.result.rows.map(row=>row.map((v,i)=>data.types[i]==='number'&&v!==''&&/^-?\d+(?:\.\d+)?$/.test(v)&&v.replace(/[^\d]/g,'').length<=15?Number(v):String(v)));
      const ws=X.utils.aoa_to_sheet([data.headers,...rows],{dense:true});
      ws['!cols']=data.headers.map((h,i)=>({wch:Math.min(42,Math.max(14,h.length+2,...rows.slice(0,50).map(r=>String(r[i]).length+2)))}));
      ws['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:data.headers.length-1}})};
      X.utils.book_append_sheet(wb,ws,'Cleaned');
      const issueRows=[['Source row','Column','Original value','Cleaned value','Detail','Action'],...data.result.issues.map(i=>[i.row,i.column,i.original,i.cleaned,i.issue,i.action])];
      X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(issueRows),'Issues');
      X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Metric','Value'],...Object.entries(data.result.stats)]),'Summary');
      if(data.nullBefore&&data.result.nullAnalysis)X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(TidyCore.nullReportRows(data.nullBefore,data.result.nullAnalysis)),'Null analysis');
      if(data.result.quality)X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(TidyBusiness.qualityRows(data.result)),'Quality report');
      if(data.result.insights?.enabled)X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Currency','Month',data.result.insights.unit,'Rows'],...data.result.insights.monthly.map(g=>[g.currency,g.month,g.total,g.rows])]),'Business summary');
      const buffer=X.write(wb,{type:'array',bookType:'xlsx',compression:true});postMessage({id,result:buffer},[buffer]);return;
    }else throw Error('Unknown operation.');
    postMessage({id,result});
  }catch(error){if(action==='import')workbook=priorWorkbook;postMessage({id,error:error.message||'Something went wrong. Try another file.'});}
};
