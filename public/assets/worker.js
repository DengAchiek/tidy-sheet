'use strict';
importScripts('core.js?v=2.2.0');
let workbook=null;
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
  const {id,action}=data;
  try{
    let result;
    if(action==='import'){
      const file=data.file;
      if(file.size>TidyCore.LIMITS.bytes)throw Error('This file is over 20 MB. Split it into smaller files.');
      if(/\.(csv|tsv)$/i.test(file.name)){
        let text;
        try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
        catch(error){throw Error('This file is not valid UTF-8 text. Save it as CSV UTF-8 in your spreadsheet app and try again.');}
        const parsed=TidyCore.parseCSV(text,/\.tsv$/i.test(file.name)?'\t':undefined);workbook=null;result={...parsed,sheets:[],sheet:null};
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
    }else if(action==='sheet')result={matrix:sheetMatrix(data.name),sheet:data.name};
    else if(action==='clean')result=TidyCore.clean(data.model,data.config,progress=>postMessage({id,progress}));
    else if(action==='xlsx'){
      const X=excel(),wb=X.utils.book_new();
      const rows=data.result.rows.map(row=>row.map((v,i)=>data.types[i]==='number'&&v!==''&&/^-?\d+(?:\.\d+)?$/.test(v)&&v.replace(/[^\d]/g,'').length<=15?Number(v):String(v)));
      const ws=X.utils.aoa_to_sheet([data.headers,...rows]);
      ws['!cols']=data.headers.map((h,i)=>({wch:Math.min(42,Math.max(14,h.length+2,...rows.slice(0,50).map(r=>String(r[i]).length+2)))}));
      ws['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:data.headers.length-1}})};
      X.utils.book_append_sheet(wb,ws,'Cleaned');
      const issueRows=[['Source row','Column','Original value','Cleaned value','Detail','Action'],...data.result.issues.map(i=>[i.row,i.column,i.original,i.cleaned,i.issue,i.action])];
      X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(issueRows),'Issues');
      X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Metric','Value'],...Object.entries(data.result.stats)]),'Summary');
      if(data.nullBefore&&data.result.nullAnalysis)X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(TidyCore.nullReportRows(data.nullBefore,data.result.nullAnalysis)),'Null analysis');
      const buffer=X.write(wb,{type:'array',bookType:'xlsx'});postMessage({id,result:buffer},[buffer]);return;
    }else throw Error('Unknown operation.');
    postMessage({id,result});
  }catch(error){postMessage({id,error:error.message||'Something went wrong. Try another file.'});}
};
