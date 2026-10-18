'use strict';
importScripts('core.js','ml-core.js');
let files=[],model=null,prepared=null;
function excel(){if(!self.XLSX)importScripts('vendor/xlsx.full.min.js');return self.XLSX;}
async function parse(file,selected){
  const C=TidyCore;let matrix,sheets=[],sheet=null;
  if(/\.(xlsx|xls)$/i.test(file.name)){
    const X=excel(),wb=X.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellFormula:false,dateNF:'yyyy-mm-dd'});sheets=wb.SheetNames;
    sheet=selected||sheets.find(n=>{const ws=wb.Sheets[n];return ws['!ref']&&X.utils.decode_range(ws['!ref']).e.r>0;})||sheets[0];
    const ws=wb.Sheets[sheet];if(!ws?.['!ref'])throw Error(file.name+': this worksheet is empty.');
    const range=X.utils.decode_range(ws['!ref']);if(range.e.r>=100001||range.e.c>=100||(range.e.r+1)*(range.e.c+1)>1000000)throw Error(file.name+': worksheet exceeds the supported size.');
    matrix=X.utils.sheet_to_json(ws,{header:1,range:{s:{r:0,c:0},e:range.e},raw:true,dateNF:'yyyy-mm-dd',defval:'',blankrows:true});
    for(const address of Object.keys(ws)){if(address.startsWith('!'))continue;const cell=ws[address];if(cell.t==='d'&&cell.v instanceof Date&&!isNaN(cell.v)){const p=X.utils.decode_cell(address);matrix[p.r][p.c]=cell.v.toISOString();}}
  }else{
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error(file.name+': save this text file as UTF-8.');}
    if(/\.(json|jsonl|ndjson)$/i.test(file.name))matrix=TidyML.parseRecords(text,!/\.json$/i.test(file.name)).matrix;
    else if(/\.(csv|tsv)$/i.test(file.name))matrix=C.parseCSV(text,/\.tsv$/i.test(file.name)?'\t':undefined).matrix;
    else throw Error('Choose CSV, TSV, Excel, JSON or JSONL datasets.');
  }
  const data=C.prepare(matrix,true);return {...data,file:file.name+(sheet?' / '+sheet:''),sheets,sheet};
}
self.onmessage=async({data})=>{
  const {id,action}=data;try{let result;
    if(action==='load'){
      prepared=null;const candidate=data.files||files;if(!candidate.length||candidate.length>5)throw Error('Choose between 1 and 5 datasets.');if(candidate.some(f=>f.size>20*1024*1024)||candidate.reduce((s,f)=>s+f.size,0)>40*1024*1024)throw Error('Use up to 20 MB per file and 40 MB total.');
      const models=[];for(let i=0;i<candidate.length;i++)models.push(await parse(candidate[i],data.sheets?.[i]));
      model=TidyML.combine(models,Boolean(data.union));files=candidate;
      result={headers:model.headers,rows:model.rows.length,profile:TidyML.profile(model),preview:model.rows.slice(0,10),files:models.map((m,i)=>({name:candidate[i].name,sheets:m.sheets,sheet:m.sheet})),warnings:models.flatMap(m=>m.warnings)};
    }else if(action==='prepare'){
      if(!model)throw Error('Choose a dataset first.');prepared=TidyML.prepare(model,data.config);const p=prepared;result={headers:p.headers,preview:p.train.slice(0,10),report:p.report,manifest:p.manifest,counts:{train:p.train.length,validation:p.validation.length,test:p.test.length}};
    }else if(action==='export'){
      if(!prepared)throw Error('Prepare your dataset first.');const p=prepared;
      if(data.format==='jsonl')result={content:TidyML.toJSONL(p.headers,p.train),mime:'application/x-ndjson',name:'train.jsonl'};
      else{
        const contents={};for(const split of ['train','validation','test']){contents[split+'.csv']=TidyML.toCSV([p.headers,...p[split]],Boolean(data.safeCSV));contents[split+'.jsonl']=TidyML.toJSONL(p.headers,p[split]);}
        contents['preprocessing.json']=JSON.stringify({...p.manifest,csvFormulaEscaping:Boolean(data.safeCSV)},null,2);contents['quality-report.json']=JSON.stringify(p.report,null,2);contents['column-profile.json']=JSON.stringify(p.profile,null,2);contents['source-rows.jsonl']=p.lineage.map(r=>JSON.stringify(r)).join('\n');
        contents['README.txt']='TidySheet dataset preparation\nNo model has been trained. All fitted preprocessing uses training rows only.\nJSONL retains exact values. CSV escaping: '+Boolean(data.safeCSV)+'.\nReview quality-report.json and preprocessing.json before training.\nSplits are record-based, except group/chronological splits when selected.\nText and media paths need downstream model-specific preprocessing.\nSource-row mapping and quality reports may contain original values or filenames. Handle this bundle like your source dataset.\n';
        const bytes=TidyML.zip(contents);result={content:bytes.buffer,mime:'application/zip',name:'tidysheet-training-data.zip'};
      }
    }else throw Error('Unknown operation.');
    if(result.content instanceof ArrayBuffer)postMessage({id,result},[result.content]);else postMessage({id,result});
  }catch(error){postMessage({id,error:error.message||'Dataset preparation failed.'});}
};
