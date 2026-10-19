/* Declarative business rules. Dataset values never leave the processing worker. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./core.js'):root.TidyCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.TidyBusiness=api;})(typeof self!=='undefined'?self:globalThis,function(C){
  'use strict';
  const missing=v=>!String(v??'').trim()||/^(?:n\/a|na|null|none|nil|undefined|-+)$/i.test(String(v).trim());
  function decimal(value,precision=6){const text=String(value);if(text.length>120||!new RegExp('^-?\\d+(?:\\.\\d{1,'+precision+'})?$').test(text))return null;const [whole,fraction='']=text.replace(/^-/,'').split('.');return (BigInt(whole)*10n**BigInt(precision)+BigInt(fraction.padEnd(precision,'0')))*(text.startsWith('-')?-1n:1n);}
  function compareNumbers(a,b){a=C.number(a).value;b=C.number(b).value;const precision=Math.max(a.split('.')[1]?.length||0,b.split('.')[1]?.length||0,1),x=decimal(a,precision),y=decimal(b,precision);return x<y?-1:x>y?1:0;}
  const templates={general:'General spreadsheet',customers:'Customer list',sales:'Sales / invoices',inventory:'Inventory',suppliers:'Supplier list'};
  function defaults(headers,kind='general'){
    const find=re=>headers.findIndex(h=>re.test(h));
    const fields=headers.map(name=>({name,type:C.guess(name),key:false,missing:'optional',fill:'',min:'',max:'',allowed:[],mapping:[]}));
    const id=find(kind==='sales'?/^(invoice|order|transaction)[ _-]?(id|number|no)$/i:kind==='inventory'?/^(sku|product[ _-]?(id|code))$/i:kind==='suppliers'?/^supplier[ _-]?(id|code)$/i:/^customer[ _-]?(id|code)$/i);
    if(kind!=='general'&&id>=0)fields[id].missing='review';
    if(kind==='inventory')fields.forEach(f=>{if(/^(stock|quantity|qty|reorder[ _-]?level)$/i.test(f.name)){f.type='number';f.min='0';}});
    const crossRules=[];if(kind==='sales'){const start=find(/^order[ _-]?date$/i),end=find(/^(delivery|shipped)[ _-]?date$/i),qty=find(/^(qty|quantity)$/i),price=find(/^(unit[ _-]?)?price$/i),total=find(/^(amount|total|line[ _-]?total)$/i);if(start>=0&&end>=0&&start!==end)crossRules.push({kind:'dateOrder',start,end,severity:'error'});if([qty,price,total].every(i=>i>=0)&&new Set([qty,price,total]).size===3)crossRules.push({kind:'total',qty,price,total,tolerance:.01,severity:'warning'});}
    return {version:1,kind,fields,removeDuplicates:kind==='general',crossRules,fuzzy:{enabled:false,column:find(/^(company|supplier|customer)([ _-]?name)?$|^name$/i),scope:-1,threshold:90},insights:{enabled:false,id,date:find(/date/i),amount:find(/amount|total|revenue|value/i),category:find(/category|segment|county|region/i),currencyColumn:find(/^currency$/i),currency:'KES',unit:kind==='sales'?'Sales amount':kind==='inventory'?'Stock value':'Amount'}};
  }
  function validateConfig(headers,b={}){
    if(!Array.isArray(b.fields)||b.fields.length!==headers.length)throw Error('Business rules do not match these columns. Reapply your template.');
    for(let i=0;i<b.fields.length;i++){
      const f=b.fields[i];if(!Object.hasOwn(C.TYPES,f.type)||typeof f.key!=='boolean')throw Error('Check the column types and duplicate keys.');if(f.name!==headers[i]||!['optional','review','drop','fill'].includes(f.missing))throw Error('Check the missing-value rules for '+headers[i]+'.');
      if(f.missing==='fill'&&(missing(f.fill)||String(f.fill).length>1000))throw Error('Enter a non-missing replacement for '+headers[i]+'.');
      for(const key of ['min','max'])if(f[key]!==''&&f[key]!=null&&(String(f[key]).length>120||C.number(String(f[key])).issue))throw Error('Use a finite numeric '+key+' for '+headers[i]+'.');
      if(f.min!==''&&f.max!==''&&compareNumbers(String(f.min),String(f.max))>0)throw Error('Minimum exceeds maximum for '+headers[i]+'.');
      if(!Array.isArray(f.mapping)||f.mapping.length>200||!Array.isArray(f.allowed)||f.allowed.length>200)throw Error('Use up to 200 category mappings or allowed values per column.');
      if(f.allowed.some(v=>typeof v!=='string'||v.length>1000))throw Error('Allowed categories must be text up to 1,000 characters.');
      const keys=new Set();for(const entry of f.mapping){if(!entry||typeof entry.from!=='string'||typeof entry.to!=='string'||missing(entry.from)||missing(entry.to)||entry.from.length>1000||entry.to.length>1000)throw Error('Category mappings need non-empty source and destination values.');const key=entry.from.trim().toLowerCase();if(keys.has(key))throw Error('Duplicate category mapping in '+headers[i]+'.');keys.add(key);}
      const mappings=new Map(f.mapping.map(e=>[e.from.trim().toLowerCase(),e.to.trim().toLowerCase()]));for(const destination of mappings.values())if(mappings.has(destination)&&mappings.get(destination)!==destination)throw Error('Map aliases directly to a final category; chained mappings are not supported.');
    }
    const col=i=>Number.isInteger(i)&&i>=0&&i<headers.length;
    if(!Array.isArray(b.crossRules)||b.crossRules.length>30)throw Error('Use up to 30 business checks.');
    for(const r of b.crossRules){if(!['dateOrder','total'].includes(r.kind)||!['error','warning'].includes(r.severity)||!(r.kind==='dateOrder'?[r.start,r.end]:[r.qty,r.price,r.total]).every(col))throw Error('Choose every column and severity for your business check.');if(r.kind==='total'&&(!Number.isFinite(r.tolerance)||r.tolerance<0||decimal(r.tolerance)===null))throw Error('Enter a non-negative tolerance.');}
    if(b.fuzzy?.enabled&&(!col(b.fuzzy.column)||!(b.fuzzy.scope===-1||col(b.fuzzy.scope))||!Number.isFinite(b.fuzzy.threshold)||b.fuzzy.threshold<80||b.fuzzy.threshold>100))throw Error('Choose a duplicate-review column and similarity of 80–100%.');
    if(b.insights?.enabled&&(!col(b.insights.amount)||!col(b.insights.date)||!(/^[A-Z]{3}$/).test(b.insights.currency)||![b.insights.category,b.insights.id,b.insights.currencyColumn].every(i=>i===-1||col(i))||!['Amount','Sales amount','Invoice value','Stock value'].includes(b.insights.unit)))throw Error('Confirm amount, date, currency, and units before generating business summaries.');
    return b;
  }
  function clean(model,config,onProgress){
    const b=validateConfig(model.headers,config.business||defaults(model.headers)),rows=[],sources=[],changes=[],removed=[],empty=[];
    const maps=b.fields.map(f=>new Map(f.mapping.map(e=>[e.from.trim().toLowerCase(),e.to])));
    model.rows.forEach((row,ri)=>{
      if(onProgress&&ri%1024===0)onProgress(Math.round(ri/model.rows.length*20),'Applying business policies');
      if(config.removeEmpty&&row.every(v=>!String(v).trim()||(config.nulls&&missing(v)&&(config.trim!==false||String(v).trim()===String(v))))){empty.push({row:model.sourceRows[ri],column:'Entire row',original:JSON.stringify(row),cleaned:'',issue:'Entire row empty before applying fill policies',action:'Removed empty',severity:'info'});return;}
      if(b.fields.some((f,i)=>f.missing==='drop'&&missing(row[i]))){removed.push({row:model.sourceRows[ri],column:'Entire row',original:JSON.stringify(row),cleaned:'',issue:'Missing value in a column with the explicit remove-row policy',action:'Removed by missing policy',severity:'info'});return;}
      let next=row;
      b.fields.forEach((f,i)=>{const value=missing(row[i])&&f.missing==='fill'?String(f.fill):maps[i].get(String(row[i]).trim().toLowerCase());if(value!==undefined&&value!==row[i]){if(next===row)next=row.slice();next[i]=value;changes.push({row:model.sourceRows[ri],column:model.headers[i],original:row[i],cleaned:value,issue:missing(row[i])?'Filled with the chosen replacement':'Applied category mapping',action:'Changed by business policy',severity:'info'});}});
      rows.push(next);sources.push(model.sourceRows[ri]);
    });
    const result=C.clean({...model,rows,sourceRows:sources},config,p=>onProgress?.(20+Math.round(p*.55),'Standardizing values'));
    result.stats.input=model.rows.length;result.stats.businessDropped=removed.length;result.stats.empty+=empty.length;const coreChanges=new Set(result.audit.filter(e=>e.action==='Changed').map(e=>JSON.stringify([e.row,e.column])));result.stats.changed+=changes.filter(e=>!coreChanges.has(JSON.stringify([e.row,e.column]))).length;result.audit.unshift(...empty,...removed,...changes);
    const changedBySource=new Map();for(const change of changes){if(!changedBySource.has(change.row))changedBySource.set(change.row,new Set());changedBySource.get(change.row).add(model.headers.indexOf(change.column));}
    const businessIssues=[];let consistencyChecked=0,consistencyFailed=0;
    result.rows.forEach((row,ri)=>{
      const add=(ci,text,severity='error')=>{const item={row:result.sourceRows[ri],column:model.headers[ci],original:row[ci],cleaned:row[ci],issue:text,action:'Business review',severity};businessIssues.push(item);result.flags[ri][ci]=true;};
      b.fields.forEach((f,ci)=>{
        if(changedBySource.get(result.sourceRows[ri])?.has(ci))result.changed[ri][ci]=true;
        if(missing(row[ci])){if(f.missing==='review')add(ci,'Required business value is missing.');return;}
        if(f.allowed.length&&!f.allowed.some(v=>String(v).trim().toLowerCase()===row[ci].trim().toLowerCase()))add(ci,'Value is outside the approved categories.');
        if(f.min!==''||f.max!==''){const n=C.number(row[ci]);if(!n.issue){if(n.value.length>120)add(ci,'Numeric range check supports up to 120 characters.');else if((f.min!==''&&compareNumbers(n.value,String(f.min))<0)||(f.max!==''&&compareNumbers(n.value,String(f.max))>0))add(ci,'Value is outside the configured numeric range.');}}
      });
      for(const rule of b.crossRules){
        const indices=rule.kind==='dateOrder'?[rule.start,rule.end]:[rule.qty,rule.price,rule.total];
        if(indices.some(i=>missing(row[i]))){add(indices.at(-1),'Business check could not run because an input is missing.',rule.severity);continue;}
        if(rule.kind==='dateOrder'){
          const start=C.date(row[rule.start],config.dateOrder),end=C.date(row[rule.end],config.dateOrder);
          if(start.issue||end.issue){add(rule.end,'Date-order check needs two valid dates.',rule.severity);continue;}
          consistencyChecked++;if(end.value<start.value){consistencyFailed++;add(rule.end,'Date must be on or after '+model.headers[rule.start]+'.',rule.severity);}
        }else{
          const values=indices.map(i=>C.number(row[i])),exact=values.map(v=>v.issue?null:decimal(v.value));
          if(exact.some(v=>v===null)){add(rule.total,'Total check needs valid numbers up to 120 characters and six decimal places.',rule.severity);continue;}
          consistencyChecked++;const [qty,price,total]=exact,difference=qty*price-total*1000000n;if((difference<0n?-difference:difference)>decimal(rule.tolerance)*1000000n){consistencyFailed++;add(rule.total,'Total differs from quantity × unit price beyond the chosen tolerance.',rule.severity);}
        }
      }
    });
    result.issues.push(...businessIssues);result.audit.push(...businessIssues);result.stats.review=result.flags.filter(row=>row.some(Boolean)).length;
    const required=b.fields.map((f,i)=>f.missing==='review'?i:-1).filter(i=>i>=0),requiredMissing=result.rows.reduce((n,row)=>n+required.filter(i=>missing(row[i])).length,0);
    result.quality={requiredCells:required.length*result.rows.length,requiredMissing,missing:result.nullAnalysis.missing,cells:result.nullAnalysis.cellCount,flaggedCells:result.flags.reduce((n,r)=>n+r.filter(Boolean).length,0),consistencyChecked,consistencyFailed,errors:result.issues.filter(i=>i.action!=='Removed duplicate'&&!/Dropped|Removed/.test(i.action)&&i.severity!=='warning').length,warnings:businessIssues.filter(i=>i.severity==='warning').length,accuracy:'Not verified against authoritative records',timeliness:'Use the mapped date range; freshness requirements depend on your business.'};
    onProgress?.(80,'Reviewing possible duplicates');result.duplicates=findSimilar(model.headers,result,b.fuzzy);onProgress?.(95,'Building business summaries');result.insights=insights(model,result,b.insights,config.dateOrder);return result;
  }
  function normalizeName(value){return String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+(?:ltd|limited|inc|incorporated|llc|plc|co|company)$/,'').replace(/\s+/g,' ');}
  function similarity(a,b){if(a===b)return 100;const x=a.slice(0,120),y=b.slice(0,120);if(!x||!y)return 0;let prev=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const next=[i];for(let j=1;j<=y.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=next;}return Math.round((1-prev[y.length]/Math.max(x.length,y.length))*100);}
  function findSimilar(headers,result,options={}){
    if(!options.enabled)return {pairs:[],compared:0,truncated:false,note:'Enable possible-duplicate review for customer or supplier entity lists.'};
    const buckets=new Map(),pairs=[];let compared=0,truncated=false;
    for(let i=0;i<result.rows.length;i++){
      const row=result.rows[i],raw=row[options.column];if(missing(raw)||String(raw).length>120)continue;const name=normalizeName(raw);if(name.length<3)continue;
      const scope=options.scope>=0?String(row[options.scope]).trim().toLowerCase():'';if(options.scope>=0&&missing(scope))continue;
      const bucket=JSON.stringify([scope,name.slice(0,2)]),prior=buckets.get(bucket)||[];
      for(const j of prior){if(++compared>200000||pairs.length>=200){truncated=true;break;}const score=similarity(name,normalizeName(result.rows[j][options.column]));if(score>=options.threshold)pairs.push({keep:result.sourceRows[j],drop:result.sourceRows[i],score,left:result.rows[j],right:row});}
      if(truncated)break;if(prior.length<64)prior.push(i);else truncated=true;buckets.set(bucket,prior);
    }
    return {pairs,compared,truncated,note:'Suggestions compare names with the same first two normalized characters (up to 64 candidates per group, 200,000 comparisons and 200 suggestions). This is a heuristic, not proof of identity. Repeated purchases may be valid.'};
  }
  function insights(model,result,options={},dateOrder='DMY'){
    if(!options.enabled)return {enabled:false,note:'Confirm the business column mappings, currency and amount meaning to generate summaries.'};
    const source=new Map(model.sourceRows.map((s,i)=>[s,model.rows[i]])),groups=new Map(),categories=new Map(),scale=1000000n;let included=0,excluded=0,undated=0,contactRows=0,missingIds=0,earliest='',latest='';
    const decimal=v=>{if(!/^-?\d+(?:\.\d{1,6})?$/.test(v))return null;const negative=v.startsWith('-'),[whole,fraction='']=v.replace(/^-/,'').split('.');return (BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0')))*(negative?-1n:1n);};
    const format=n=>{const sign=n<0n?'-':'';n=n<0n?-n:n;const fraction=String(n%scale).padStart(6,'0').replace(/0+$/,'');return sign+String(n/scale)+(fraction?'.'+fraction:'');};
    const emails=model.headers.map((h,i)=>/email/i.test(h)?i:-1).filter(i=>i>=0),phones=model.headers.map((h,i)=>/phone|mobile/i.test(h)?i:-1).filter(i=>i>=0);
    for(let ri=0;ri<result.rows.length;ri++){
      const row=result.rows[ri];if(emails.some(i=>!missing(row[i])&&!C.email(row[i]).issue)||phones.some(i=>!missing(row[i])&&!C.phone(row[i]).issue))contactRows++;
      if(options.id>=0&&missing(row[options.id]))missingIds++;
      if(options.category>=0){const category=missing(row[options.category])?'(Missing)':row[options.category];categories.set(category,(categories.get(category)||0)+1);}
      const amount=C.number(row[options.amount]),value=amount.issue?null:decimal(amount.value),currency=options.currencyColumn>=0?String(row[options.currencyColumn]).trim().toUpperCase():options.currency;
      const raw=source.get(result.sourceRows[ri])?.[options.amount]||'',embedded=/^\s*(KES|KSHS?\.?|USD|EUR|GBP|\$|€|£)/i.exec(raw)?.[1]?.toUpperCase(),embeddedCode=embedded?(embedded.startsWith('KSH')?'KES':({'$':'USD','€':'EUR','£':'GBP'}[embedded]||embedded)):'';
      if(value===null||!(/^[A-Z]{3}$/).test(currency)||(embeddedCode&&embeddedCode!==currency)){excluded++;continue;}
      const parsed=C.date(row[options.date],dateOrder),month=parsed.issue?'Undated':parsed.value.slice(0,7);if(parsed.issue)undated++;else{if(!earliest||parsed.value<earliest)earliest=parsed.value;if(!latest||parsed.value>latest)latest=parsed.value;}
      const key=JSON.stringify([currency,month]),group=groups.get(key)||{currency,month,total:0n,rows:0};group.total+=value;group.rows++;groups.set(key,group);included++;
    }
    const totals=new Map();for(const g of groups.values())totals.set(g.currency,(totals.get(g.currency)||0n)+g.total);
    return {enabled:true,unit:options.unit,included,excluded,undated,contactRows,missingIds,earliest,latest,totals:[...totals].map(([currency,total])=>({currency,total:format(total)})),monthly:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.month.localeCompare(b.month)).map(g=>({...g,total:format(g.total)})),categories:[...categories].sort((a,b)=>b[1]-a[1]).slice(0,100),note:'Amounts are summed exactly up to 6 decimal places, separately by currency. Invalid values, currency conflicts and extra decimal precision are excluded and counted. No exchange-rate conversion. Contact coverage checks format only.'};
  }
  function qualityRows(result){const q=result.quality;return [['Measure','Value','Meaning'],['Missing cells',q.missing,'Blank or recognized null markers'],['Required values missing',q.requiredMissing,'Out of '+q.requiredCells+' required cells'],['Cells needing review',q.flaggedCells,'Out of '+q.cells+' retained cells'],['Business checks run',q.consistencyChecked,'Comparisons with usable inputs'],['Business checks failed',q.consistencyFailed,'Failed date-order or total checks'],['Errors',q.errors,'Retained format or business errors'],['Warnings',q.warnings,'Business warnings'],['Accuracy',q.accuracy,'Requires trusted reference data'],['Timeliness',q.timeliness,'Mapped date range is descriptive']];}
  function recipeFor(headers,config,name){return {application:'TidySheet',version:1,name:String(name).trim().slice(0,80),headers,config};}
  function applyRecipe(recipe,headers){if(recipe?.application!=='TidySheet'||recipe.version!==1||!Array.isArray(recipe.headers)||!recipe.config?.business)throw Error('Choose a TidySheet template JSON file.');const old=recipe.headers;if(old.length!==headers.length||headers.some(h=>!old.includes(h)))throw Error('This template needs the same named columns. Review the file headers first.');const indices=headers.map(h=>old.indexOf(h)),map=i=>i<0?-1:headers.indexOf(old[i]),c=recipe.config;const business={...c.business,fields:indices.map(i=>({...c.business.fields[i]})),crossRules:c.business.crossRules.map(r=>r.kind==='dateOrder'?{...r,start:map(r.start),end:map(r.end)}:{...r,qty:map(r.qty),price:map(r.price),total:map(r.total)}),fuzzy:{...c.business.fuzzy,column:map(c.business.fuzzy.column),scope:map(c.business.fuzzy.scope)},insights:{...c.business.insights,id:map(c.business.insights.id),date:map(c.business.insights.date),amount:map(c.business.insights.amount),category:map(c.business.insights.category),currencyColumn:map(c.business.insights.currencyColumn)}};validateConfig(headers,business);return {...c,types:business.fields.map(f=>f.type),keys:business.fields.flatMap((f,i)=>f.key?[i]:[]),business};}
  return {missing,templates,defaults,validateConfig,clean,normalizeName,similarity,findSimilar,insights,qualityRows,recipeFor,applyRecipe};
});
