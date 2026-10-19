const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const X=require('../public/assets/vendor/xlsx.full.min.js');
function harness(){
  let resolve,reject;
  const ctx=vm.createContext({console,File,Blob,TextEncoder,TextDecoder,Date,ArrayBuffer,Uint8Array,Uint16Array,Int32Array,setTimeout,clearTimeout});
  ctx.self=ctx;ctx.postMessage=message=>{if(message.progress!==undefined)return;message.error?reject(Error(message.error)):resolve(message.result);};
  ctx.importScripts=(...scripts)=>scripts.forEach(s=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets',s.split('?')[0]),'utf8'),ctx));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets/worker.js'),'utf8'),ctx);
  return (action,payload)=>new Promise((res,rej)=>{resolve=res;reject=rej;ctx.onmessage({data:{id:1,action,...payload}});});
}
function book(){
  const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([]),'Empty cover');
  const ws=X.utils.aoa_to_sheet([['Name','Phone','Email','Date','Amount','ID'],[' alice   WANGARI ','0712345678','ALICE@example.com',new Date(2024,0,12),12500,'00123'],['ALICE WANGARI','+254712345678','alice@example.com',new Date(2024,0,12),12500,'00123']]);
  ws.D2.z='dd/mm/yy';ws.D3.z='d-mmm-yy';X.utils.book_append_sheet(wb,ws,'Customers');
  X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Order','Amount'],['O-001',42]]),'Orders');return wb;
}
fs.writeFileSync(path.join(__dirname,'fixtures/multi-sheet.xlsx'),X.write(book(),{type:'buffer',bookType:'xlsx'}));
fs.writeFileSync(path.join(__dirname,'fixtures/legacy.xls'),X.write(book(),{type:'buffer',bookType:'biff8'}));
fs.writeFileSync(path.join(__dirname,'fixtures/malformed.csv'),'Name,Note\nAlice,"unclosed');
fs.writeFileSync(path.join(__dirname,'fixtures/headerless.tsv'),'001\tMary\n002\tJohn');
fs.writeFileSync(path.join(__dirname,'fixtures/pagination.csv'),'ID,Name\n'+Array.from({length:125},(_,i)=>String(i+1).padStart(4,'0')+',Person '+(i+1)).join('\n'));
test('Actual worker imports XLSX with empty cover, custom dates and multiple sheets',async()=>{
  const request=harness();const parsed=await request('import',{file:new File([fs.readFileSync(path.join(__dirname,'fixtures/multi-sheet.xlsx'))],'multi-sheet.xlsx')});
  assert.equal(parsed.sheet,'Customers');assert.equal(parsed.matrix[1][3],'2024-01-12');assert.equal(parsed.matrix[2][3],'2024-01-12');assert.equal(parsed.matrix[1][5],'00123');
  const orders=await request('sheet',{name:'Orders'});assert.equal(orders.matrix[1][0],'O-001');
});
test('Actual worker imports legacy XLS',async()=>{
  const parsed=await harness()('import',{file:new File([fs.readFileSync(path.join(__dirname,'fixtures/legacy.xls'))],'legacy.xls')});assert.equal(parsed.sheet,'Customers');assert.equal(parsed.matrix[1][5],'00123');
});
test('Actual worker cleans and exports a workbook with a real summary and review sheet',async()=>{
  const request=harness();const parsed=await request('import',{file:new File([fs.readFileSync(path.join(__dirname,'fixtures/multi-sheet.xlsx'))],'multi-sheet.xlsx')});
  const C=require('../public/assets/core.js'),model=C.prepare(parsed.matrix),types=model.headers.map(C.guess);
  const result=await request('clean',{model,config:{types,keys:[],trim:true,titleCase:true,nulls:true,removeEmpty:true,removeDuplicates:true,caseInsensitive:true,dateOrder:'DMY'}});
  assert.equal(result.stats.output,1);assert.equal(result.stats.duplicates,1);
  const buffer=await request('xlsx',{headers:model.headers,result,types});const wb=X.read(buffer,{type:'array'});
  assert.deepEqual(wb.SheetNames,['Cleaned','Issues','Summary']);assert.equal(wb.Sheets.Cleaned.F2.v,'00123');assert.equal(wb.Sheets.Cleaned.B2.t,'s');assert.equal(wb.Sheets.Cleaned.E2.t,'n');
});
test('Source row numbers remain correct for an Excel range beginning below row one',async()=>{
  const wb=X.utils.book_new(),ws={A1:{t:'s',v:'ID'},A5:{t:'s',v:'001'},'!ref':'A1:A5'};X.utils.book_append_sheet(wb,ws,'Data');
  const parsed=await harness()('import',{file:new File([X.write(wb,{type:'array',bookType:'xlsx'})],'offset.xlsx')});
  const C=require('../public/assets/core.js'),model=C.prepare(parsed.matrix);assert.equal(model.sourceRows[3],5);assert.equal(model.rows[3][0],'001');
});
test('Malformed CSV errors propagate out of the processing worker',async()=>{
  await assert.rejects(harness()('import',{file:new File(['A\n"unclosed'],'bad.csv')}),/unclosed/);
});
test('Non-UTF-8 text is rejected instead of silently corrupting names',async()=>{
  await assert.rejects(harness()('import',{file:new File([new Uint8Array([65,10,0xe9])],'latin1.csv')}),/UTF-8/);
});
test('Actual worker exports a null-analysis worksheet with original and cleaned missing-value counts',async()=>{
  const request=harness(),C=require('../public/assets/core.js');
  const model=C.prepare([['ID','Amount'],['a','N/A'],['a','null'],['',''],['b','0']]),types=model.headers.map(C.guess);
  const result=await request('clean',{model,config:{types,trim:true,nulls:true,removeEmpty:true,removeDuplicates:true}});
  assert.equal(result.nullAnalysis.missing,1);
  const buffer=await request('xlsx',{headers:model.headers,result,types,nullBefore:C.analyzeNulls(model)}),wb=X.read(buffer,{type:'array'});
  assert.deepEqual(wb.SheetNames,['Cleaned','Issues','Summary','Null analysis']);
  const report=X.utils.sheet_to_json(wb.Sheets['Null analysis'],{header:1});
  assert.deepEqual(report[2],['Amount',4,1,2,3,75,2,1,0,1,50]);
});
