/* Training-data preparation. All fitting uses the training partition only. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TidyML=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const TASKS={classification:'Classification',regression:'Regression',unsupervised:'Clustering / unsupervised',text:'Text / NLP',time_series:'Time series',annotations:'Image / audio annotations'};
  const LIMITS={cells:1000000,outputCells:2000000,features:500,categories:50};
  function numeric(value){const s=String(value).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)&&!/^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s))return null;const n=Number(s.replace(/,/g,''));return Number.isFinite(n)&&(!Number.isInteger(n)||Number.isSafeInteger(n))?n:null;}
  function missing(value,tokens){const s=String(value??'').trim();return !s||tokens.has(s.toLowerCase());}
  function tokensFor(config={}){return new Set((config.missingTokens||['NA','N/A','null','NaN']).map(x=>String(x).trim().toLowerCase()).filter(Boolean));}
  function profile(model,config={}){
    const tokens=tokensFor(config),{headers,rows}=model;
    return headers.map((name,index)=>{
      let blanks=0,numericCount=0,totalLength=0,min=Infinity,max=-Infinity,sum=0;const values=new Map();
      for(const row of rows){const raw=String(row[index]??''),s=raw.trim();if(missing(s,tokens)){blanks++;continue;}values.set(s,(values.get(s)||0)+1);totalLength+=s.length;const n=numeric(s);if(n!==null){numericCount++;sum+=n;min=Math.min(min,n);max=Math.max(max,n);}}
      const observed=rows.length-blanks,unique=values.size,examples=Array.from(values.keys()).slice(0,3);
      const idLike=/\b(id|uuid|guid|hash|index)\b/i.test(name.replace(/[_-]/g,' '))||/^(image|audio|file)[ _-]?(path|url|name)$/i.test(name);
      const suggested=idLike?'ignore':observed&&numericCount/observed>=.85?'numeric':unique>50||observed&&totalLength/observed>40?'text':'categorical';
      return {index,name,rows:rows.length,missing:blanks,missingPercent:rows.length?Math.round(blanks/rows.length*1000)/10:0,unique,numericCount,suggested,examples,min:numericCount?min:null,max:numericCount?max:null,mean:numericCount?sum/numericCount:null};
    });
  }
  function parseRecords(text,jsonl=false){
    let records;
    if(jsonl){records=[];text.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((line,i)=>{if(!line.trim())return;let value;try{value=JSON.parse(line);}catch{throw Error('Invalid JSON on line '+(i+1)+'.');}records.push(value);});}
    else {try{records=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('This is not valid JSON. Use an array of objects or a JSONL file.');}}
    if(!Array.isArray(records)||!records.length||records.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Use a JSON array of objects, or one object per JSONL line.');
    const headers=[],seen=new Set();for(const record of records)for(const key of Object.keys(record))if(!seen.has(key)){seen.add(key);headers.push(key);}
    if(headers.length>100||records.length>100000||headers.length*records.length>LIMITS.cells)throw Error('Use up to 100 columns, 100,000 rows, and 1 million cells.');
    const rows=records.map(r=>headers.map(h=>r[h]==null?'':typeof r[h]==='object'?JSON.stringify(r[h]):String(r[h])));
    return {matrix:[headers,...rows],nestedAsText:true};
  }
  function combine(models,union=false){
    if(!models.length)throw Error('Choose at least one dataset.');const headers=models[0].headers.slice(),rows=[],sources=[];
    for(const model of models){
      if(!union&&(model.headers.length!==headers.length||model.headers.some(h=>!headers.includes(h))))throw Error('The datasets have different columns. Choose “Union columns” to align all fields with blanks for missing values.');
      if(union)for(const h of model.headers)if(!headers.includes(h))headers.push(h);
    }
    if(headers.length>100)throw Error('The combined dataset has more than 100 columns.');
    for(const model of models){const positions=headers.map(h=>model.headers.indexOf(h));model.rows.forEach((row,i)=>{rows.push(positions.map(p=>p<0?'':String(row[p]??'')));sources.push({file:model.file||'dataset',row:model.sourceRows?.[i]??i+2});});}
    if(rows.length>100000||rows.length*headers.length>LIMITS.cells)throw Error('The combined dataset exceeds 100,000 rows or 1 million cells.');
    return {headers,rows,sourceRows:rows.map((_,i)=>i+2),sources};
  }
  function rng(seed){let state=seed>>>0;return ()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,random){const result=list.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
  function timestamp(value){const s=String(value).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const time=Date.parse(s+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===s?time:null;}if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)){const date=s.slice(0,10),calendar=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==date)return null;const n=Date.parse(s);return Number.isFinite(n)?n:null;}return null;}
  function partition(items,valFraction,testFraction){const tests=Math.floor(items.length*testFraction),validation=Math.floor(items.length*valFraction),train=items.length-tests-validation;return {train:items.slice(0,train),validation:items.slice(train,train+validation),test:items.slice(train+validation)};}
  function split(data,config,report){
    const random=rng(config.seed),method=config.splitMethod,parts={train:[],validation:[],test:[]};
    if(method==='stratified'){
      if(config.target<0)throw Error('Choose a target column before stratifying.');
      const groups=new Map();for(const row of data){const label=row.values[config.target];if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row);}
      for(const [label,group] of groups){const p=partition(shuffle(group,random),config.validation,config.test);for(const key of Object.keys(parts))parts[key].push(...p[key]);if(group.length<7&&report.warnings.length<50)report.warnings.push('Class '+JSON.stringify(label)+' has '+group.length+' rows; some evaluation partitions may not contain this class.');}
      for(const key of Object.keys(parts))parts[key]=shuffle(parts[key],random);return parts;
    }
    if(method==='chronological'){
      if(config.timeColumn<0)throw Error('Choose the date/time column for a chronological split.');
      for(const row of data){row.time=timestamp(row.values[config.timeColumn]);if(row.time===null)throw Error('Source row '+row.source.row+' in '+row.source.file+' has an invalid timestamp. Use ISO dates or timestamps with a timezone.');}
      return partition(data.slice().sort((a,b)=>a.time-b.time||a.index-b.index),config.validation,config.test);
    }
    if(method==='group'){
      if(config.groupColumn<0)throw Error('Choose a group column, such as customer or patient ID.');
      const groups=new Map();for(const row of data){const group=row.values[config.groupColumn];if(!group)throw Error('A group ID is missing at source row '+row.source.row+'. Fill group IDs before splitting.');if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);}
      const p=partition(shuffle(Array.from(groups.values()),random),config.validation,config.test);for(const key of Object.keys(parts))parts[key]=p[key].flat();report.warnings.push('Groups stay together. Split proportions are based on group counts, so row proportions may differ.');return parts;
    }
    return partition(shuffle(data,random),config.validation,config.test);
  }
  function prepare(model,input={}){
    const task=input.task||'classification';if(!TASKS[task])throw Error('Choose a supported dataset task.');
    const config={task,target:Number.isInteger(input.target)?input.target:-1,roles:input.roles||profile(model,input).map(c=>c.suggested),numericMissing:input.numericMissing||'median',categoricalMissing:input.categoricalMissing||'bucket',encoding:input.encoding||'onehot',scaling:input.scaling||'standard',splitMethod:input.splitMethod||(task==='classification'?'stratified':task==='time_series'?'chronological':'random'),validation:input.validation??.15,test:input.test??.15,seed:input.seed??42,timeColumn:input.timeColumn??-1,groupColumn:input.groupColumn??-1,removeDuplicates:input.removeDuplicates!==false,dropConstant:input.dropConstant!==false,trim:input.trim!==false};
    if(!['median','mean','zero','drop'].includes(config.numericMissing)||!['bucket','mode','drop'].includes(config.categoricalMissing)||!['onehot','ordinal','preserve'].includes(config.encoding)||!['standard','minmax','none'].includes(config.scaling)||!['random','stratified','chronological','group'].includes(config.splitMethod))throw Error('Choose valid preprocessing options.');
    if(config.roles.length!==model.headers.length||config.roles.some(r=>!['numeric','categorical','text','ignore'].includes(r)))throw Error('Set a valid role for every column.');
    if(!Number.isFinite(config.validation)||!Number.isFinite(config.test)||config.validation<0||config.test<0||config.validation+config.test>.8)throw Error('Validation and test fractions must be non-negative and total no more than 80%.');
    if(!Number.isInteger(config.seed)||config.seed<0||config.seed>4294967295)throw Error('Use a whole-number random seed from 0 to 4294967295.');
    const hasTarget=config.target>=0&&config.target<model.headers.length;
    if(['classification','regression','time_series'].includes(task)&&!hasTarget)throw Error('Choose the target column for this task.');
    if(config.target>=model.headers.length)throw Error('Choose a valid target column.');
    const featureIndices=model.headers.map((_,i)=>i).filter(i=>i!==config.target&&config.roles[i]!=='ignore'&&!(config.splitMethod==='group'&&i===config.groupColumn)&&!(config.splitMethod==='chronological'&&i===config.timeColumn));
    if(!featureIndices.length)throw Error('Include at least one feature column. The target and split/group columns are kept separate.');
    const tokens=tokensFor(input),report={inputRows:model.rows.length,outputRows:0,emptyRemoved:0,missingTargetsRemoved:0,invalidTargetsRemoved:0,duplicatesRemoved:0,missingFeatureRowsRemoved:0,invalidNumericCells:0,imputedCells:0,warnings:[],removed:[],droppedFeatures:[]},data=[],seen=new Set();
    for(let i=0;i<model.rows.length;i++){
      const source=model.sources?.[i]||{file:input.fileName||'dataset',row:model.sourceRows?.[i]??i+2};
      const values=model.rows[i].map(v=>{const s=String(v??'');return missing(s,tokens)?'':config.trim?s.trim():s;});
      function remove(reason){report.removed.push({...source,reason});}
      if([...featureIndices,...hasTarget?[config.target]:[]].every(j=>!values[j])){report.emptyRemoved++;remove('Empty record');continue;}
      if(hasTarget&&!values[config.target]){report.missingTargetsRemoved++;remove('Missing target');continue;}
      if(hasTarget&&['regression','time_series'].includes(task)){const n=numeric(values[config.target]);if(n===null){report.invalidTargetsRemoved++;remove('Invalid numeric target');continue;}values[config.target]=String(n);}
      let drop=false;
      for(const j of featureIndices){if(config.roles[j]==='numeric'){const n=values[j]?numeric(values[j]):null;if(values[j]&&n===null)report.invalidNumericCells++;if(n===null&&config.numericMissing==='drop')drop=true;values[j]=n===null?'':String(n);}else if(config.roles[j]==='categorical'&&!values[j]&&config.categoricalMissing==='drop')drop=true;}
      if(drop){report.missingFeatureRowsRemoved++;remove('Missing or invalid feature with drop-row policy');continue;}
      const keyColumns=[...featureIndices,...hasTarget?[config.target]:[],...config.splitMethod==='group'?[config.groupColumn]:[],...config.splitMethod==='chronological'?[config.timeColumn]:[]];
      const key=JSON.stringify(keyColumns.map(j=>values[j]));
      if(config.removeDuplicates&&seen.has(key)){report.duplicatesRemoved++;remove('Duplicate feature/target record');continue;}seen.add(key);
      data.push({index:i,values,source});
    }
    if(!data.length)throw Error('No rows remain. Review missing targets, column roles, and row-removal options.');
    if(task==='classification'&&new Set(data.map(r=>r.values[config.target])).size<2)report.warnings.push('The target has only one class; this dataset cannot evaluate multi-class discrimination.');
    const parts=split(data,config,report);
    if(!parts.train.length)throw Error('The training partition is empty. Adjust split fractions.');
    if(!parts.validation.length&&config.validation>0)report.warnings.push('The validation partition is empty. Add more data or adjust the split.');
    if(!parts.test.length&&config.test>0)report.warnings.push('The test partition is empty. Add more data or adjust the split.');
    const descriptors=[],transforms=[],used=new Set();
    function header(name){let value=name,n=2;while(used.has(value))value=name+'__'+n++;used.add(value);return value;}
    for(const j of featureIndices){
      const name=model.headers[j],role=config.roles[j],observed=parts.train.map(r=>r.values[j]).filter(v=>v!=='');
      if(role==='numeric'){
        const numbers=observed.map(Number),sorted=numbers.slice().sort((a,b)=>a-b);
        if(!numbers.length&&config.numericMissing!=='zero')throw Error('No observed training values for “'+name+'”. Ignore this column or choose zero imputation.');
        const mean=numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:0,median=numbers.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:0;
        const fill=config.numericMissing==='mean'?mean:config.numericMissing==='zero'?0:median;
        const fitted=parts.train.map(r=>r.values[j]===''?fill:Number(r.values[j]));
        let fittedMean=0,min=Infinity,max=-Infinity;for(const value of fitted){fittedMean+=value;min=Math.min(min,value);max=Math.max(max,value);}fittedMean/=fitted.length;
        const stdev=Math.sqrt(fitted.reduce((sum,n)=>sum+(n-fittedMean)**2,0)/fitted.length);
        if(config.dropConstant&&min===max){report.droppedFeatures.push({column:name,reason:'Constant in training partition'});continue;}
        const item={column:name,index:j,role,impute:fill,scaling:config.scaling,mean:fittedMean,standardDeviation:stdev,min,max,output:header(name)};transforms.push(item);descriptors.push(item.output);
      }else if(role==='categorical'){
        const counts=new Map();for(const value of observed)counts.set(value,(counts.get(value)||0)+1);
        const categories=Array.from(counts.keys()).sort();
        if(config.dropConstant&&categories.length<=1&&parts.train.every(r=>r.values[j]===parts.train[0].values[j])){report.droppedFeatures.push({column:name,reason:'Constant in training partition'});continue;}
        const mode=categories.slice().sort((a,b)=>(counts.get(b)-counts.get(a))||(a<b?-1:a>b?1:0))[0]??null;
        if(config.categoricalMissing==='mode'&&mode===null)throw Error('No observed training categories for “'+name+'”. Use a missing category or ignore the column.');
        if(config.encoding==='onehot'&&categories.length>LIMITS.categories)throw Error('“'+name+'” has '+categories.length+' training categories. Use ordinal/preserve encoding, Text, or Ignore instead of one-hot encoding.');
        const outputs=config.encoding==='onehot'?[...categories.map(v=>header(name+'='+v)),header(name+'=[MISSING]'),header(name+'=[UNKNOWN]')]:[header(name)];
        const item={column:name,index:j,role,encoding:config.encoding,categories,imputeMode:config.categoricalMissing==='mode'?mode:null,outputs};transforms.push(item);descriptors.push(...outputs);
      }else {
        if(config.dropConstant&&new Set(parts.train.map(r=>r.values[j])).size===1){report.droppedFeatures.push({column:name,reason:'Constant in training partition'});continue;}
        const item={column:name,index:j,role:'text',output:header(name)};transforms.push(item);descriptors.push(item.output);
      }
    }
    if(!descriptors.length)throw Error('No features remain after constant-column removal. Keep constant columns or review the selected roles.');
    if(descriptors.length>LIMITS.features||(descriptors.length+(hasTarget?1:0))*data.length>LIMITS.outputCells)throw Error('The encoded dataset is too wide. Use ordinal/preserve encoding or ignore high-cardinality columns. Limit: 500 output features and 2 million output cells.');
    const targetHeader=hasTarget?header(model.headers[config.target]):null,headers=[...descriptors,...targetHeader?[targetHeader]:[]],result={};
    for(const key of ['train','validation','test']){
      result[key]=parts[key].map(row=>{
        const values=[];
        for(const item of transforms){const raw=row.values[item.index];
          if(item.role==='numeric'){let n=raw===''?item.impute:Number(raw);if(raw==='')report.imputedCells++;if(item.scaling==='standard')n=(n-item.mean)/(item.standardDeviation||1);else if(item.scaling==='minmax')n=(n-item.min)/(item.max-item.min||1);values.push(Object.is(n,-0)?0:n);}
          else if(item.role==='categorical'){
            const value=raw===''&&item.imputeMode!==null?item.imputeMode:raw;if(raw==='')report.imputedCells++;
            const category=item.categories.indexOf(value);
            if(item.encoding==='onehot')values.push(...item.categories.map((_,i)=>category===i?1:0),value===''?1:0,value!==''&&category<0?1:0);
            else if(item.encoding==='ordinal')values.push(value===''?-2:category<0?-1:category);
            else values.push(value);
          }else values.push(raw);
        }
        if(hasTarget)values.push(['regression','time_series'].includes(task)?Number(row.values[config.target]):row.values[config.target]);return values;
      });
    }
    report.outputRows=data.length;
    if(transforms.some(t=>t.role==='text'))report.warnings.push('Text and annotation paths are preserved as text. Tokenization, model-specific vocabularies, image/audio processing, and augmentation happen in your training pipeline.');
    if(config.splitMethod!=='chronological'&&task==='time_series')report.warnings.push('Time-series data normally needs chronological splitting; a non-chronological split can leak future information.');
    if(report.warnings.length===50)report.warnings.push('Additional small-class warnings are omitted. Review target distributions before training.');
    const classes=hasTarget&&!['regression','time_series'].includes(task)?Array.from(new Set(parts.train.map(r=>r.values[config.target]))).sort():null;
    const manifest={version:1,purpose:'Dataset preparation only; no model is trained',task,fitPartition:'train',seed:config.seed,splitMethod:config.splitMethod,requestedFractions:{train:1-config.validation-config.test,validation:config.validation,test:config.test},actualRows:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.length])),sourceColumns:model.headers,outputColumns:headers,target:hasTarget?{source:model.headers[config.target],output:targetHeader,classes,transformed:false}:null,transforms,droppedFeatures:report.droppedFeatures,missingTokens:Array.from(tokens),notes:['Imputation, category vocabularies, constant detection, and scaling are fit on training rows only.','Targets are never imputed, encoded, or scaled.','Ordinal encoding uses -1 for unseen and -2 for missing categories.','Min-max scaled evaluation values may fall outside [0,1].']};
    const lineage=[];for(const key of Object.keys(parts))parts[key].forEach((r,index)=>lineage.push({split:key,outputRow:index+2,file:r.source.file,sourceRow:r.source.row}));
    return {headers,...result,profile:profile(model,input),report,manifest,lineage};
  }
  function toCSV(rows,safe=false){const protect=v=>{const s=String(v??'');return safe&&(/^[\s\x00-\x1f]*[=+@-]/.test(s)&&!/^\s*-\d+(?:\.\d+)?\s*$/.test(s)||/^[\t\r\n]/.test(s))?"'"+s:s;};return rows.map(row=>row.map(v=>{const s=protect(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n');}
  function toJSONL(headers,rows){return rows.map(row=>JSON.stringify(Object.fromEntries(headers.map((h,i)=>[h,row[i]])))).join('\n');}
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    const encoder=new TextEncoder(),locals=[],centrals=[];let offset=0,total=0;
    for(const [name,content] of Object.entries(files)){
      const path=encoder.encode(name),data=typeof content==='string'?encoder.encode(content):content,crc=crc32(data);total+=data.length;if(total>80*1024*1024)throw Error('This export exceeds 80 MB. Export individual splits instead.');
      const local=new Uint8Array(30+path.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);local.set(path,30);locals.push(local,data);
      const central=new Uint8Array(46+path.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);central.set(path,46);centrals.push(central);offset+=local.length+data.length;
    }
    const centralSize=centrals.reduce((n,a)=>n+a.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,centrals.length,true);view.setUint16(10,centrals.length,true);view.setUint32(12,centralSize,true);view.setUint32(16,offset,true);
    const output=new Uint8Array(offset+centralSize+end.length);let at=0;for(const part of [...locals,...centrals,end]){output.set(part,at);at+=part.length;}return output;
  }
  return {TASKS,LIMITS,numeric,profile,parseRecords,combine,prepare,toCSV,toJSONL,zip,crc32};
});
