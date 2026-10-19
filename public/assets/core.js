/* TidySheet cleaning engine. No network, DOM, or file-system access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TidyCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const LIMITS = { bytes: 20 * 1024 * 1024, rows: 100000, columns: 100, cells: 1000000 };
  const TYPES = { text: 'Text / ID', name: 'Person name', email: 'Email', phone: 'Kenyan mobile', date: 'Date', number: 'Number / amount' };
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const NULL_MARKER = /^(?:n\/a|na|null|none|nil|-+|undefined)$/i;
  function analyzeNulls({headers,rows}) {
    const columns=headers.map(name=>({name,blank:0,markers:0,missing:0,percentage:0}));
    let rowsWithMissing=0;
    for(const row of rows){
      let hasMissing=false;
      for(let i=0;i<headers.length;i++){
        const value=String(row[i]??'').trim(),column=columns[i];
        if(!value){column.blank++;hasMissing=true;}
        else if(NULL_MARKER.test(value)){column.markers++;hasMissing=true;}
      }
      if(hasMissing)rowsWithMissing++;
    }
    let blank=0,markers=0;
    for(const column of columns){
      column.missing=column.blank+column.markers;
      column.percentage=rows.length?column.missing/rows.length*100:0;
      blank+=column.blank;markers+=column.markers;
    }
    const missing=blank+markers,cellCount=rows.length*headers.length;
    return {rowCount:rows.length,cellCount,blank,markers,missing,percentage:cellCount?missing/cellCount*100:0,rowsWithMissing,completeRows:rows.length-rowsWithMissing,columns};
  }
  function nullReportRows(before,after) {
    return [
      ['Column','Rows before','Blank before','Null markers before','Missing before','Missing % before','Rows after','Blank after','Null markers after','Missing after','Missing % after'],
      ...before.columns.map((column,i)=>{
        const cleaned=after?.columns[i];
        return [column.name,before.rowCount,column.blank,column.markers,column.missing,column.percentage,...(cleaned?[after.rowCount,cleaned.blank,cleaned.markers,cleaned.missing,cleaned.percentage]:['','','','',''])];
      })
    ];
  }
  function guess(header) {
    const h = header.toLowerCase().replace(/[_-]/g, ' ');
    if (/email|e mail/.test(h)) return 'email';
    if (/phone|mobile|telephone|msisdn|contact (no|number)/.test(h)) return 'phone';
    if (/date|\bdob\b|birth|signup|created/.test(h)) return 'date';
    if (/amount|price|total|cost|salary|\bqty\b|quantity|balance|fee/.test(h)) return 'number';
    if (/\b(first|last|full|customer|client|contact|person|employee) name\b|^name$/.test(h)) return 'name';
    return 'text';
  }
  function parseCSV(input, delimiter) {
    const text = input.replace(/^\uFEFF/, '');
    if (!text.trim()) throw Error('This file is empty. Choose a file with a header and at least one data row.');
    if (text.includes('\0')) throw Error('This does not look like a UTF-8 CSV file. Save it as CSV UTF-8 in your spreadsheet app.');
    if (!delimiter) {
      const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 }; let quoted = false;
      for (let i=0;i<text.length;i++) { const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted){if(c==='\n'||c==='\r')break;if(c in counts)counts[c]++;} }
      delimiter = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    }
    const rows=[]; let row=[], value='', quoted=false, closed=false, endedRow=false, cells=0;
    function cell(){row.push(value);value='';closed=false;if(++cells>LIMITS.cells+LIMITS.columns)throw Error('This file has more than 1,000,000 cells. Split it into smaller files.');if(row.length>LIMITS.columns)throw Error('This file has more than 100 columns. Split it into smaller files.');}
    function record(){cell();rows.push(row);row=[];if(rows.length>LIMITS.rows+1)throw Error('This file has more than 100,000 rows. Split it into smaller files.');}
    for(let i=0;i<text.length;i++) {
      const c=text[i];endedRow=false;
      if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
      if(c===delimiter){cell();continue;}
      if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;record();endedRow=true;continue;}
      if(c==='"'){if(value||closed)throw Error('CSV has an unexpected quote near record '+(rows.length+1)+'. Check the file before importing.');quoted=true;continue;}
      if(closed){if(c===' '||c==='\t')continue;throw Error('CSV has text after a closing quote near record '+(rows.length+1)+'.');}
      value+=c;
    }
    if(quoted)throw Error('CSV contains an unclosed quoted field. Fix the file before importing.');
    if(!endedRow)record();
    return { matrix: rows, delimiter };
  }
  function prepare(matrix, hasHeader=true) {
    if(!matrix.length)throw Error('This sheet is empty. Choose another sheet or file.');
    const width = matrix.reduce((n,r)=>Math.max(n,r.length),0);
    if(!width||width>LIMITS.columns)throw Error('Use a sheet with between 1 and 100 columns.');
    const data=hasHeader?matrix.slice(1):matrix.slice();
    if(!data.length)throw Error('There are no data rows in this sheet. Turn off “First row is a header” if your file has no header.');
    if(data.length>LIMITS.rows||data.length*width>LIMITS.cells)throw Error('This sheet is too large. Use up to 100,000 rows and 1,000,000 cells.');
    const warnings=[],used=new Set();
    const headers=Array.from({length:width},(_,i)=>{
      let h=hasHeader?String(matrix[0][i]??'').trim():'';
      if(!h){h='Column '+(i+1);if(hasHeader)warnings.push('A blank or missing header was named “'+h+'”.');}
      const base=h;let suffix=2;
      while(used.has(h.toLowerCase()))h=base+' ('+(suffix++)+')';
      if(h!==base)warnings.push('A duplicate header was renamed “'+h+'”.');
      used.add(h.toLowerCase());return h;
    });
    return {headers,rows:data.map(r=>Array.from({length:width},(_,i)=>String(r[i]??''))),sourceRows:data.map((_,i)=>i+(hasHeader?2:1)),warnings};
  }
  function phone(s) {
    if(!/^\+?[\d\s().-]+$/.test(s))return {value:s,issue:'Use a Kenyan mobile number such as 0712345678 or +254712345678.'};
    let d=s.replace(/[\s().-]/g,'').replace(/^\+/, '');
    if(d.startsWith('00254'))d=d.slice(2);
    if(/^0[17]\d{8}$/.test(d))d='254'+d.slice(1);
    else if(/^[17]\d{8}$/.test(d))d='254'+d;
    return /^254[17]\d{8}$/.test(d)?{value:'+'+d}:{value:s,issue:'Expected a Kenyan mobile number with 9 digits after +254.'};
  }
  function email(s) {
    const v=s.toLowerCase();
    const parts=v.split('@'), local=parts[0], domain=parts[1]||'';
    const ok=parts.length===2&&v.length<=254&&local.length<=64&&/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local)&&!/^\.|\.$|\.\./.test(local)&&domain.length<=253&&domain.split('.').length>=2&&domain.split('.').every(p=>p.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(p))&&/^[a-z]{2,63}$/i.test(domain.split('.').at(-1));
    return ok?{value:v}:{value:s,issue:'Check the email format. Spaces, repeated @ signs, or an incomplete domain need review.'};
  }
  function date(s,order='DMY') {
    let y,m,d,match;
    if((match=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))){[,y,m,d]=match;}
    else if((match=/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))){y=match[3];[d,m]=order==='DMY'?[match[1],match[2]]:[match[2],match[1]];}
    else if((match=/^(\d{1,2})[\s-]+([a-z]+)[\s,-]+(\d{4})$/i.exec(s))){d=match[1];m=month(match[2]);y=match[3];}
    else if((match=/^([a-z]+)[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/i.exec(s))){m=month(match[1]);d=match[2];y=match[3];}
    else return {value:s,issue:'Use a full date with a four-digit year. Numeric dates follow your selected date order.'};
    y=+y;m=+m;d=+d;
    const leap=y%4===0&&(y%100!==0||y%400===0);
    const max=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1]||0;
    if(y<1000||y>9999||d<1||d>max)return {value:s,issue:'This calendar date does not exist. Check the day, month, and year.'};
    return {value:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
  }
  function month(s){const n=s.toLowerCase();return MONTHS.findIndex(m=>m===n||m.slice(0,3)===n)+1;}
  function number(s) {
    let v=s.replace(/^(?:KES|KSHS?\.?|USD|EUR|GBP|[$€£])\s*/i,'').replace(/\s*(?:KES|KSHS?\.?|USD|EUR|GBP)$/i,'');
    let negative=false;if(/^\(.*\)$/.test(v)){negative=true;v=v.slice(1,-1);}
    if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v))return {value:s,issue:'Use digits with an optional decimal point and valid thousands separators, e.g. KES 12,500.50.'};
    if(negative&&/^[+-]/.test(v))return {value:s,issue:'Use either parentheses or a minus sign for a negative amount.'};
    v=v.replace(/,/g,'');let sign='';if(/^[+-]/.test(v)){sign=v[0]==='-'?'-':'';v=v.slice(1);}if(negative)sign='-';
    let [whole,fraction='']=v.split('.');whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
    const zero=!/[1-9]/.test(whole+fraction);
    return {value:(zero?'':sign)+whole+(fraction?'.'+fraction:'')};
  }
  function clean(model,config,onProgress) {
    const {headers,rows,sourceRows}=model;
    const types=config.types||headers.map(guess), keys=config.keys?.length?config.keys:headers.map((_,i)=>i);
    const output=[],flags=[],changed=[],origins=[],issues=[],audit=[],seen=new Map();
    const stats={input:rows.length,output:0,changed:0,duplicates:0,empty:0,invalid:0,dropped:0,review:0};
    for(let ri=0;ri<rows.length;ri++){
      const row=rows[ri],source=sourceRows[ri],values=[],rowFlags=[],rowChanged=[],rowIssues=[],rowAudit=[];
      for(let ci=0;ci<headers.length;ci++){
        const raw=row[ci];let s=config.trim===false?raw:raw.replace(/\s+/gu,' ').trim();
        if(config.nulls&&NULL_MARKER.test(s))s='';
        let result={value:s};
        if(s){switch(types[ci]){
          case 'name':if(config.titleCase)result.value=s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase());break;
          case 'phone':result=phone(s);break;
          case 'email':result=email(s);break;
          case 'date':result=date(s,config.dateOrder);break;
          case 'number':result=number(s);break;
        }}
        // Keep invalid input intact so review never loses source data.
        if(result.issue){result.value=raw;rowIssues.push({row:source,column:headers[ci],original:raw,cleaned:raw,issue:result.issue,action:'Review'});stats.invalid++;}
        const didChange=result.value!==raw;
        if(didChange){stats.changed++;rowAudit.push({row:source,column:headers[ci],original:raw,cleaned:result.value,issue:'Standardized '+TYPES[types[ci]],action:'Changed'});}
        values.push(result.value);rowFlags.push(Boolean(result.issue));rowChanged.push(didChange);
      }
      if(config.removeEmpty&&values.every(v=>!v.trim())){stats.empty++;audit.push({row:source,column:'Entire row',original:JSON.stringify(row),cleaned:'',issue:'Empty after normalization',action:'Removed empty'});continue;}
      if(config.dropInvalid&&rowIssues.length){stats.dropped++;issues.push(...rowIssues.map(i=>({...i,action:'Dropped invalid row'})));audit.push(...rowAudit,...rowIssues.map(i=>({...i,action:'Dropped invalid row'})));continue;}
      const keyValues=keys.map(i=>values[i]);
      // Blank and invalid selected keys never identify a person or record.
      const hasKeys=Boolean(config.keys?.length), eligible=!hasKeys||(keyValues.every(v=>v.trim())&&keys.every(i=>!rowFlags[i]));
      const key=JSON.stringify(keyValues.map(v=>config.caseInsensitive===false?v:v.toLowerCase()));
      if(config.removeDuplicates&&eligible&&seen.has(key)){
        stats.duplicates++;const item={row:source,column:'Entire row',original:JSON.stringify(row),cleaned:'',issue:'Duplicate of source row '+seen.get(key)+'; first record kept.',action:'Removed duplicate'};
        issues.push(...rowIssues.map(i=>({...i,action:'Removed duplicate row'})),item);audit.push(...rowAudit,...rowIssues,item);continue;
      }
      if(config.removeDuplicates&&eligible)seen.set(key,source);
      issues.push(...rowIssues);audit.push(...rowAudit,...rowIssues);
      if(rowIssues.length)stats.review++;
      output.push(values);flags.push(rowFlags);changed.push(rowChanged);origins.push(source);
      if(onProgress&&ri%2000===0)onProgress(Math.round((ri+1)/rows.length*100));
    }
    stats.output=output.length;
    return {rows:output,flags,changed,sourceRows:origins,issues,audit,stats,nullAnalysis:analyzeNulls({headers,rows:output})};
  }
  function safeCSVValue(value) {
    const s=String(value??'');
    // Numeric negatives are literal numbers; formula-like text is neutralized.
    return /^[\s\u0000-\u001f]*[=+@-]/.test(s)&&!/^\s*-\d+(?:\.\d+)?\s*$/.test(s)||/^[\t\r\n]/.test(s)?"'"+s:s;
  }
  function toCSV(rows,safe=true){return '\uFEFF'+rows.map(row=>row.map(v=>{const s=safe?safeCSVValue(v):String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n');}
  return {LIMITS,TYPES,guess,parseCSV,prepare,phone,email,date,number,clean,analyzeNulls,nullReportRows,toCSV,safeCSVValue};
});
