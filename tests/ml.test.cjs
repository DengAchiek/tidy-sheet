const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ML=require('../public/assets/ml-core.js');
const C=require('../public/assets/core.js');
const X=require('../public/assets/vendor/xlsx.full.min.js');
const model=rows=>C.prepare(rows);
const base={task:'regression',target:2,roles:['numeric','categorical','ignore'],splitMethod:'chronological',timeColumn:3,validation:.2,test:.2,dropConstant:false};
function fixture(){return model([['value','kind','target','date'],...Array.from({length:10},(_,i)=>[i<6?String(i+1):String(1000+i),i<6?'known':'unseen',String(50+i),'2026-01-'+String(i+1).padStart(2,'0')])]);}
function config(){return {...base,roles:['numeric','categorical','ignore','ignore']};}
test('Preprocessing fits on training rows only and preserves the target',()=>{
  const m=fixture(),before=JSON.stringify(m),r=ML.prepare(m,config());assert.equal(JSON.stringify(m),before);assert.equal(r.train.length,6);assert.equal(r.validation.length,2);assert.equal(r.test.length,2);
  const num=r.manifest.transforms[0],cat=r.manifest.transforms[1];assert.equal(num.mean,3.5);assert.deepEqual(cat.categories,['known']);assert.equal(r.train[0].at(-1),50);assert.equal(r.test[0].at(-1),58);assert.ok(r.test[0][0]>100);assert.equal(r.test[0][r.headers.indexOf('kind=[UNKNOWN]')],1);
});
test('Training-only mean imputation never learns an extreme held-out value',()=>{
  const m=fixture();m.rows[1][0]='';const r=ML.prepare(m,{...config(),numericMissing:'mean'});assert.equal(r.manifest.transforms[0].impute,3.8);assert.ok(Math.abs(r.train[1][0])<1e-12);
});
test('Seeded splits reproduce identical records and group IDs never cross splits',()=>{
  const m=model([['group','value','label'],...Array.from({length:60},(_,i)=>['g'+Math.floor(i/3),String(i),i%2?'a':'b'])]),opts={task:'classification',target:2,roles:['ignore','numeric','ignore'],splitMethod:'group',groupColumn:0,seed:7,validation:.2,test:.2,removeDuplicates:false};
  const a=ML.prepare(m,opts),b=ML.prepare(m,opts);assert.deepEqual(a,b);const groups=new Map();for(const row of a.lineage){const group=m.rows[row.sourceRow-2][0];if(groups.has(group))assert.equal(groups.get(group),row.split);groups.set(group,row.split);}assert.equal(groups.size,20);
});
test('Stratified classification keeps both classes in each sufficiently large split',()=>{
  const m=model([['feature','label'],...Array.from({length:100},(_,i)=>[String(i),i%5?'major':'minor'])]);const r=ML.prepare(m,{task:'classification',target:1,roles:['numeric','ignore'],validation:.2,test:.2});for(const split of ['train','validation','test'])assert.equal(new Set(r[split].map(row=>row.at(-1))).size,2);
});
test('Missing targets, invalid targets, empty rows and duplicates are separately audited',()=>{
  const m=model([['x','y'],['1','2'],['1','2'],['',''],['3',''],['4','bad'],['5','8']]);const r=ML.prepare(m,{task:'regression',target:1,roles:['numeric','ignore'],validation:0,test:0});assert.equal(r.report.duplicatesRemoved,1);assert.equal(r.report.emptyRemoved,1);assert.equal(r.report.missingTargetsRemoved,1);assert.equal(r.report.invalidTargetsRemoved,1);assert.equal(r.report.outputRows,2);assert.deepEqual(r.report.removed.map(r=>r.row),[3,4,5,6]);
});
test('Ordinal evaluation categories use unknown/missing sentinels without fitting on evaluation',()=>{
  const m=fixture();m.rows[8][1]='';const r=ML.prepare(m,{...config(),encoding:'ordinal'});assert.equal(r.test[0][1],-2);assert.equal(r.test[1][1],-1);
});
test('One-hot high cardinality, empty training numerics and invalid split settings fail clearly',()=>{
  const m=model([['category'],...Array.from({length:60},(_,i)=>['c'+i])]);assert.throws(()=>ML.prepare(m,{task:'unsupervised',roles:['categorical'],validation:0,test:0}),/training categories/);
  assert.throws(()=>ML.prepare(model([['x'],[''],['NA']]),{task:'unsupervised',roles:['numeric']}),/No observed|No rows/);
  assert.throws(()=>ML.prepare(fixture(),{...config(),validation:.5,test:.4}),/80%/);
  assert.throws(()=>ML.prepare(fixture(),{...config(),seed:-1}),/seed/);
});
test('Chronological splitting rejects invalid dates and missing group IDs',()=>{
  const m=fixture();m.rows[0][3]='2026-02-30';assert.throws(()=>ML.prepare(m,config()),/invalid timestamp/);
  m.rows[0][3]='';assert.throws(()=>ML.prepare(m,{...config(),splitMethod:'group',groupColumn:3}),/group ID is missing/);
});
test('JSON and JSONL align objects, retain nested text and reject invalid record shapes',()=>{
  const p=ML.parseRecords('[{"a":1,"nested":{"tag":"x"}},{"b":false,"a":2}]');assert.deepEqual(p.matrix,[['a','nested','b'],['1','{"tag":"x"}',''],['2','','false']]);
  assert.equal(ML.parseRecords('{"x":1}\n\n{"x":2}',true).matrix.length,3);assert.throws(()=>ML.parseRecords('[1,2]'),/array of objects/);assert.throws(()=>ML.parseRecords('{"x":1}\nbad',true),/line 2/);
});
test('Combining files aligns exact columns and union mode explicitly fills missing fields',()=>{
  const a={...model([['a','b'],['1','2']]),file:'a.csv'},b={...model([['b','a'],['4','3']]),file:'b.csv'},c={...model([['a','c'],['5','6']]),file:'c.csv'};assert.deepEqual(ML.combine([a,b]).rows,[['1','2'],['3','4']]);assert.throws(()=>ML.combine([a,c]),/different columns/);const r=ML.combine([a,c],true);assert.deepEqual(r.headers,['a','b','c']);assert.deepEqual(r.rows,[['1','2',''],['5','','6']]);assert.deepEqual(r.sources[1],{file:'c.csv',row:2});
});
test('Text and annotation paths stay exact; JSONL preserves numbers and CSV escaping is explicit',()=>{
  const m=model([['path','text','label'],['images/a.png','=HYPERLINK("x")','cat'],['audio/b.wav',' Hello world ','dog']]);const r=ML.prepare(m,{task:'annotations',target:2,roles:['text','text','ignore'],validation:0,test:0,trim:false,scaling:'none',encoding:'preserve'});assert.ok(r.train.some(row=>row[1]===' Hello world '));const rows=[['path','value'],['=bad',3]];assert.equal(JSON.parse(ML.toJSONL(rows[0],rows.slice(1))).value,3);assert.ok(!ML.toCSV(rows).includes("'=bad"));assert.ok(ML.toCSV(rows,true).includes("'=bad"));
});
function worker(){let resolve,reject;const ctx=vm.createContext({console,File,Blob,TextEncoder,TextDecoder,Date,ArrayBuffer,Uint8Array,Uint16Array,Int32Array,setTimeout,clearTimeout});ctx.self=ctx;ctx.postMessage=m=>m.error?reject(Error(m.error)):resolve(m.result);ctx.importScripts=(...scripts)=>scripts.forEach(s=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets',s),'utf8'),ctx));vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets/ml-worker.js'),'utf8'),ctx);return(action,args={})=>new Promise((a,b)=>{resolve=a;reject=b;ctx.onmessage({data:{id:1,action,...args}});});}
test('Actual ML worker loads JSONL, prepares datasets, and writes a readable ZIP with correct CRCs',async()=>{
  const request=worker(),records=Array.from({length:30},(_,i)=>JSON.stringify({feature:i,label:i%2?'a':'b'})).join('\n');const loaded=await request('load',{files:[new File([records],'fixture.jsonl')]});assert.equal(loaded.rows,30);
  const r=await request('prepare',{config:{task:'classification',target:1,roles:['numeric','ignore'],validation:.2,test:.2}});assert.equal(r.counts.train,18);const out=await request('export',{format:'zip'}),bytes=new Uint8Array(out.content),view=new DataView(bytes.buffer);let at=0;const files={};while(view.getUint32(at,true)===0x04034b50){const crc=view.getUint32(at+14,true),size=view.getUint32(at+18,true),len=view.getUint16(at+26,true),extra=view.getUint16(at+28,true),name=new TextDecoder().decode(bytes.slice(at+30,at+30+len)),start=at+30+len+extra,content=bytes.slice(start,start+size);assert.equal(ML.crc32(content),crc);files[name]=new TextDecoder().decode(content);at=start+size;}assert.equal(view.getUint32(at,true),0x02014b50);assert.ok(files['train.csv']);assert.equal(JSON.parse(files['preprocessing.json']).fitPartition,'train');assert.equal(files['train.jsonl'].split('\n').length,18);assert.equal(Object.keys(files).length,11);
});
test('Actual ML worker imports multiple Excel sheets and rejects schema mismatch',async()=>{
  const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['a','label'],[1,'x'],[2,'y']]),'First');X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['b','label'],[3,'z']]),'Second');const file=new File([X.write(wb,{type:'buffer',bookType:'xlsx'})],'data.xlsx'),request=worker();assert.equal((await request('load',{files:[file]})).files[0].sheet,'First');assert.equal((await request('load',{sheets:['Second']})).headers[0],'b');await assert.rejects(request('load',{files:[file,new File(['other\n1'],'other.csv')]}),/different columns/);
});

test('Deduplication preserves identical observations in different times or groups',()=>{
  const m=model([['value','target','group','date'],['1','2','a','2026-01-01'],['1','2','b','2026-01-02'],['2','3','c','2026-01-03']]);const opts={task:'regression',target:1,roles:['numeric','ignore','ignore','ignore'],validation:0,test:0,dropConstant:false};for(const extra of [{splitMethod:'group',groupColumn:2},{splitMethod:'chronological',timeColumn:3}])assert.equal(ML.prepare(m,{...opts,...extra}).report.duplicatesRemoved,0);
});
test('ML Excel import uses underlying numeric values rather than formatted currency text',async()=>{
  const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet([['amount','target'],[1234.5,1],[2345.6,2]]);ws.A2.z='"$"#,##0.00';X.utils.book_append_sheet(wb,ws,'Data');const loaded=await worker()('load',{files:[new File([X.write(wb,{type:'buffer',bookType:'xlsx'})],'amounts.xlsx')]});assert.equal(loaded.preview[0][0],'1234.5');assert.equal(loaded.profile[0].suggested,'numeric');
});
