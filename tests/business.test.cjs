const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/assets/core.js'),B=require('../public/assets/business-core.js');
function setup(matrix,kind='general'){const model=C.prepare(matrix),business=B.defaults(model.headers,kind);return {model,config:{business,types:business.fields.map(f=>f.type),keys:[],trim:true,nulls:true,titleCase:true,removeEmpty:true,removeDuplicates:false,dateOrder:'DMY'}};}
test('Required, optional, fill and explicit row-removal missing policies preserve zero',()=>{
  const {model,config}=setup([['ID','Amount','Region'],['a','0','Nai'],['','N/A','Nairobi'],['drop','0','']]);
  config.business.fields[0].missing='review';config.business.fields[1].missing='fill';config.business.fields[1].fill='25';config.business.fields[2].missing='drop';
  const r=B.clean(model,config);assert.equal(r.rows.length,2);assert.equal(r.rows[0][1],'0');assert.equal(r.rows[1][1],'25');assert.equal(r.stats.businessDropped,1);assert.equal(r.quality.requiredMissing,1);assert.ok(r.audit.some(a=>a.issue==='Filled with the chosen replacement'));assert.equal(model.rows[1][1],'N/A');
});
test('Category mappings, allowed values and numeric limits generate reviewable business issues',()=>{
  const {model,config}=setup([['Region','Stock'],['Nai','-1'],['Mombasa','20']],'inventory');
  config.business.fields[0].mapping=[{from:'Nai',to:'Nairobi'}];config.business.fields[0].allowed=['Nairobi'];config.business.fields[1].type='number';config.business.fields[1].min='0';
  const r=B.clean(model,config);assert.equal(r.rows[0][0],'Nairobi');assert.equal(r.issues.length,2);assert.ok(r.flags[0][1]);assert.ok(r.flags[1][0]);assert.equal(r.stats.output,2);
});
test('Date-order and invoice-total checks distinguish errors, warnings and uncheckable inputs',()=>{
  const {model,config}=setup([['Order Date','Delivery Date','Qty','Price','Amount'],['2026-01-02','2026-01-01','2','10','19'],['2026-01-01','2026-01-02','3','10','30'],['','2026-01-02','1','oops','10']]);
  config.business.crossRules=[{kind:'dateOrder',start:0,end:1,severity:'error'},{kind:'total',qty:2,price:3,total:4,tolerance:.01,severity:'warning'}];
  const r=B.clean(model,config);assert.equal(r.quality.consistencyChecked,4);assert.equal(r.quality.consistencyFailed,2);assert.equal(r.quality.warnings,2);assert.equal(r.stats.output,3);assert.ok(r.issues.some(i=>i.issue.includes('could not run')));
});
test('Fuzzy entity suggestions are scoped, bounded and never remove rows',()=>{
  const {model,config}=setup([['Company','Group'],['Nexalix Ltd','A'],['Nexalix Limited','A'],['Nexalix Limited','B'],['Other Name','A']]);
  config.business.fuzzy={enabled:true,column:0,scope:1,threshold:90};const r=B.clean(model,config);
  assert.equal(r.rows.length,4);assert.equal(r.duplicates.pairs.length,1);assert.equal(r.duplicates.pairs[0].keep,2);assert.equal(r.duplicates.pairs[0].drop,3);assert.equal(r.duplicates.pairs[0].score,100);
  const large={rows:Array.from({length:1000},()=>['Same Ltd']),sourceRows:Array.from({length:1000},(_,i)=>i+2)};const d=B.findSimilar(['Company'],large,{enabled:true,column:0,scope:-1,threshold:90});assert.ok(d.pairs.length<=200);assert.equal(d.truncated,true);
});
test('Business totals preserve decimal precision, separate currencies and count excluded or undated records',()=>{
  const {model,config}=setup([['ID','Date','Amount','Currency','Region'],['a','2026-01-01','0.1','KES','Nairobi'],['b','2026-01-02','0.2','KES','Nairobi'],['c','2026-02-01','99999999999999999999.99','USD','Mombasa'],['d','','-2','KES',''],['e','2026-01-01','USD 100','KES',''],['f','2026-01-01','1.1234567','KES','']]);
  config.business.insights={enabled:true,id:0,date:1,amount:2,currencyColumn:3,currency:'KES',category:4,unit:'Sales amount'};const r=B.clean(model,config),n=r.insights;
  assert.deepEqual(n.totals,[{currency:'KES',total:'-1.7'},{currency:'USD',total:'99999999999999999999.99'}]);assert.equal(n.included,4);assert.equal(n.excluded,2);assert.equal(n.undated,1);assert.equal(n.monthly.find(g=>g.month==='2026-01').total,'0.3');assert.match(r.quality.accuracy,/Not verified/);
});
test('Templates remap configuration by column names and reject incompatible schemas',()=>{
  const {model,config}=setup([['Name','Date','Amount'],['Alice','2026-01-01','10']]);config.business.fields[0].missing='review';config.business.insights={enabled:true,id:0,date:1,amount:2,currency:'KES',currencyColumn:-1,category:-1,unit:'Amount'};
  const recipe=B.recipeFor(model.headers,config,'Weekly'),c=B.applyRecipe(JSON.parse(JSON.stringify(recipe)),['Amount','Name','Date']);
  assert.equal(c.business.fields[1].missing,'review');assert.equal(c.business.insights.amount,0);assert.equal(c.business.insights.date,2);assert.throws(()=>B.applyRecipe(recipe,['Other']),/same named columns/);assert.equal(recipe.config.business.insights.amount,2);
});
test('Incomplete fill and invalid mapping definitions fail before any cleaning',()=>{
  const {model,config}=setup([['ID'],['x']]);config.business.fields[0].missing='fill';assert.throws(()=>B.clean(model,config),/replacement/);config.business.fields[0].missing='optional';config.business.fields[0].mapping=[{from:'x',to:'y'},{from:' X ',to:'z'}];assert.throws(()=>B.clean(model,config),/Duplicate category/);
});
test('Invoice and range checks preserve precision above the safe JavaScript integer boundary',()=>{
  const {model,config}=setup([['Qty','Price','Amount'],['1','99999999999999999999.99','99999999999999999999.99'],['1','99999999999999999999.98','99999999999999999999.99']]);config.business.crossRules=[{kind:'total',qty:0,price:1,total:2,tolerance:0,severity:'error'}];config.business.fields[2].max='99999999999999999999.98';const result=B.clean(model,config);assert.equal(result.quality.consistencyFailed,1);assert.equal(result.issues.filter(i=>i.issue.includes('numeric range')).length,2);
});
test('Sales template recognizes compatible cross-field checks and category chains are rejected',()=>{const b=B.defaults(['Order Date','Delivery Date','Qty','Unit Price','Amount'],'sales');assert.equal(b.crossRules.length,2);const c=setup([['Category'],['a']]);c.config.business.fields[0].mapping=[{from:'a',to:'b'},{from:'b',to:'c'}];assert.throws(()=>B.clean(c.model,c.config),/chained mappings/);});
test('Explicit fill values do not resurrect entirely empty rows when remove-empty is selected',()=>{const {model,config}=setup([['ID','Amount'],['',''],['a','N/A']]);config.business.fields[1].missing='fill';config.business.fields[1].fill='0';const r=B.clean(model,config);assert.equal(r.rows.length,1);assert.equal(r.rows[0][0],'a');assert.equal(r.stats.empty,1);assert.equal(r.rows[0][1],'0');});
