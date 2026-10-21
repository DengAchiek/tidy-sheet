const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/assets/core.js');
const X=require('../public/assets/vendor/xlsx.full.min.js');
const defaults={trim:true,nulls:true,titleCase:true,removeEmpty:true,removeDuplicates:true,caseInsensitive:true,dateOrder:'DMY',dropInvalid:false};
const run=(matrix,extra={})=>{const model=C.prepare(matrix);return C.clean(model,{...defaults,types:model.headers.map(C.guess),...extra});};
test('CSV: escaped quotes, embedded newline, BOM, CRLF and final newline',()=>{
  const r=C.parseCSV('\uFEFFName,Notes\r\n"Mary, Jane","Said ""hello""\nNext line"\r\n').matrix;
  assert.deepEqual(r,[['Name','Notes'],['Mary, Jane','Said "hello"\nNext line']]);
});
test('CSV detects semicolon and tab delimiters without counting quoted characters',()=>{
  assert.deepEqual(C.parseCSV('Name;Email\nMary;mary@example.com').matrix,[['Name','Email'],['Mary','mary@example.com']]);
  assert.equal(C.parseCSV('Name\tPhone\nMary\t0712345678').delimiter,'\t');
  assert.equal(C.parseCSV('"A;B;C",Value\nx,1').delimiter,',');
});
test('CSV rejects malformed, binary and empty inputs',()=>{
  for(const s of ['','\uFEFF\n','A,B\nx,"unclosed','A\n"x"oops','A\nx"oops','A\n\0'])assert.throws(()=>C.parseCSV(s));
});
test('Ragged rows and duplicate/blank headers retain all values',()=>{
  const model=C.prepare([['Name','name',''],['Alice','ALICE','001', 'extra']]);
  assert.deepEqual(model.headers,['Name','name (2)','Column 3','Column 4']);
  assert.deepEqual(model.rows,[['Alice','ALICE','001','extra']]);assert.equal(model.warnings.length,3);
});
test('Headerless files retain first data row with correct source numbering',()=>{
  const model=C.prepare([['001','Mary'],['002','Peter']],false);
  assert.deepEqual(model.sourceRows,[1,2]);assert.deepEqual(model.headers,['Column 1','Column 2']);
});
test('Kenyan mobiles normalize supported variants and reject letters/extensions',()=>{
  for(const s of ['0712345678','712345678','254712345678','+254 712-345-678','00254712345678'])assert.equal(C.phone(s).value,'+254712345678');
  assert.equal(C.phone('0110 123 456').value,'+254110123456');
  for(const s of ['call 0712345678','0712345678 ext 5','+254212345678','12345','+254+712345678'])assert.ok(C.phone(s).issue);
});
test('Dates use explicit date order and strict full date matching',()=>{
  assert.equal(C.date('05/03/2024','DMY').value,'2024-03-05');
  assert.equal(C.date('05/03/2024','MDY').value,'2024-05-03');
  assert.equal(C.date('29 February 2024').value,'2024-02-29');
  assert.equal(C.date('Jan 12, 2024').value,'2024-01-12');
  for(const s of ['31/02/2024','29/02/2023','2024-02-30','2024-02-12oops','12/01/24','12 Janblah 2024','2024-01-01T10:00'])assert.ok(C.date(s).issue,s);
});
test('Email format checks preserve invalid inputs',()=>{
  assert.equal(C.email('John.Kamau@Gmail.com').value,'john.kamau@gmail.com');
  for(const s of ['mary@@yahoo.com','aisha@mail','john doe@example.com','x@-mail.com','a..b@example.com','x@ex..com']){assert.ok(C.email(s).issue);assert.equal(C.email(s).value,s);}
});
test('Amounts keep precision and validate grouping/currency',()=>{
  assert.equal(C.number('KES 12,500.00').value,'12500');
  assert.equal(C.number('Kshs 3,400.50').value,'3400.5');
  assert.equal(C.number('(1,250.50)').value,'-1250.5');
  assert.equal(C.number('99999999999999999999.99').value,'99999999999999999999.99');
  assert.equal(C.number('-0.00').value,'0');
  for(const s of ['1,25','12,34,567','USD','Kshabc','1 23','1.234,56','(---1)'])assert.ok(C.number(s).issue,s);
});
test('End-to-end standardizes, deduplicates after normalization and removes null-only row',()=>{
  const r=run([['Name','Phone','Email','Date','Amount','ID'],[' john   KAMAU ','0712345678','J@Gmail.com','05/03/2024','KES 12,500','001'],['JOHN KAMAU','+254 712 345 678','j@gmail.com','2024-03-05','12500','001'],['N/A','null','','-','none','']]);
  assert.deepEqual(r.rows,[['John Kamau','+254712345678','j@gmail.com','2024-03-05','12500','001']]);
  assert.equal(r.stats.duplicates,1);assert.equal(r.stats.empty,1);assert.equal(r.stats.input,r.stats.output+r.stats.duplicates+r.stats.empty+r.stats.dropped);
  assert.ok(r.audit.some(e=>e.action==='Removed empty'));assert.ok(r.issues.some(e=>e.action==='Removed duplicate'));
});
test('Invalid original values survive unchanged; dropped rows are counted and logged',()=>{
  const m=[['Name','Phone'],['mary','  bad number  '],['john','0712345678']];
  const r=run(m);assert.equal(r.rows[0][1],'  bad number  ');assert.equal(r.stats.review,1);assert.deepEqual(r.sourceRows,[2,3]);
  const d=run(m,{dropInvalid:true});assert.equal(d.stats.dropped,1);assert.equal(d.stats.output,1);assert.equal(d.stats.invalid,1);assert.ok(d.issues[0].action.includes('Dropped'));
});
test('Blank or invalid selected keys do not remove distinct records',()=>{
  const r=run([['Name','Email'],['a',''],['b',''],['c','not email'],['d','not email']],{keys:[1]});
  assert.equal(r.stats.output,4);assert.equal(r.stats.duplicates,0);
});
test('Chosen duplicate keys keep first matching row and source row audit',()=>{
  const r=run([['Name','Phone','Amount'],['A','0712345678','10'],['B','+254712345678','20']],{keys:[1]});
  assert.equal(r.rows.length,1);assert.equal(r.rows[0][2],'10');assert.match(r.issues[0].issue,/source row 2/);
});
test('Duplicate keys cannot collide through embedded separator characters',()=>{
  const r=run([['A','B'],['x\u0001y','z'],['x','y\u0001z']],{trim:false});assert.equal(r.rows.length,2);
});
test('Case-sensitive deduplication and disabled rules are honored',()=>{
  const r=run([['Company'],['ABC'],['abc']],{caseInsensitive:false});assert.equal(r.rows.length,2);
  const x=run([['Name'],['aLICE'],['aLICE'],['']],{titleCase:false,removeDuplicates:false,removeEmpty:false});assert.deepEqual(x.rows,[['aLICE'],['aLICE'],['']]);
});
test('Company and ID headers stay text; accented person names are supported',()=>{
  assert.equal(C.guess('Company Name'),'text');assert.equal(C.guess('Customer ID'),'text');
  const r=run([['Name','Company Name','ID'],["élodie o’NEIL",'NEXALIX Ltd','0000123']]);
  assert.deepEqual(r.rows[0],["Élodie O’Neil",'NEXALIX Ltd','0000123']);
});
test('CSV exports escape formula-like text and quote commas/quotes/newlines',()=>{
  const s=C.toCSV([['Name','Phone','Note'],['Mary','+254712345678','=HYPERLINK("https://evil")'],['Alice','-12.5','a,b\nx']]);
  const parsed=C.parseCSV(s).matrix;assert.equal(parsed[1][1],"'+254712345678");assert.ok(parsed[1][2].startsWith("'="));assert.equal(parsed[2][1],'-12.5');assert.equal(parsed[2][2],'a,b\nx');
  for(const v of ['=1+1','@SUM(A1)',' -cmd','\tdata','\rdata'])assert.ok(C.safeCSVValue(v).startsWith("'"));
});
test('XLSX round-trip preserves IDs/phone strings and never turns strings into formulas',()=>{
  const ws=X.utils.aoa_to_sheet([['ID','Phone','Note'],['00123','+254712345678','=1+1']]);const wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,'One');X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Other'],['value']]),'Two');
  const decoded=X.read(X.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  assert.deepEqual(decoded.SheetNames,['One','Two']);assert.equal(decoded.Sheets.One.A2.v,'00123');assert.equal(decoded.Sheets.One.B2.t,'s');assert.equal(decoded.Sheets.One.C2.f,undefined);
});
test('Row and cell limits fail clearly',()=>{
  assert.throws(()=>C.prepare([Array(101).fill('Header'),['x']]),/100 columns/);
  assert.throws(()=>C.prepare([['A'],...Array(100001).fill(['x'])]),/too large/);
});
test('Null analysis separates blanks and exact null markers without treating zero or false as missing',()=>{
  const markers=['N/A',' NA ','null','NONE','nil','undefined','---'];
  const model={headers:['A','B'],rows:[...markers.map(value=>[value,'present']),[' \t\n',''],[0,false],['nullify','banana']]};
  const original=JSON.stringify(model),analysis=C.analyzeNulls(model);
  assert.equal(analysis.rowCount,10);assert.equal(analysis.cellCount,20);
  assert.equal(analysis.blank,2);assert.equal(analysis.markers,7);assert.equal(analysis.missing,9);
  assert.equal(analysis.percentage,45);assert.equal(analysis.rowsWithMissing,8);assert.equal(analysis.completeRows,2);
  assert.equal(analysis.columns[0].missing,8);assert.equal(analysis.columns[0].percentage,80);
  assert.equal(analysis.columns[1].missing,1);assert.equal(JSON.stringify(model),original);
});
test('Null analysis handles empty output and missing trailing cells without invalid percentages',()=>{
  const empty=C.analyzeNulls({headers:['A','B'],rows:[]});
  assert.equal(empty.percentage,0);assert.equal(empty.completeRows,0);assert.equal(empty.columns[0].percentage,0);
  const ragged=C.analyzeNulls({headers:['A','B'],rows:[[null],['value',undefined]]});
  assert.equal(ragged.blank,3);assert.equal(ragged.markers,0);assert.equal(ragged.rowsWithMissing,2);
});
test('Before and after null analysis use their own row counts after deduplication and empty-row removal',()=>{
  const model=C.prepare([['ID','Amount'],['a','N/A'],['a','null'],['',''],['b','0']]);
  const before=C.analyzeNulls(model),result=C.clean(model,defaults),after=result.nullAnalysis;
  assert.equal(before.missing,4);assert.equal(before.cellCount,8);assert.equal(before.rowsWithMissing,3);
  assert.deepEqual(result.rows,[['a',''],['b','0']]);
  assert.equal(after.rowCount,2);assert.equal(after.cellCount,4);assert.equal(after.missing,1);
  assert.equal(after.blank,1);assert.equal(after.markers,0);assert.equal(after.percentage,25);
  assert.equal(after.columns[1].percentage,50);assert.equal(after.rowsWithMissing,1);
  assert.equal(before.columns[1].percentage,75);assert.equal(model.rows[0][1],'N/A');
});
test('Null analysis still counts preserved markers when their conversion and trimming are disabled',()=>{
  const result=run([['ID','Note'],['a',' null '],['b','N/A'],['c','0']],{nulls:false,trim:false});
  assert.equal(result.rows[0][1],' null ');assert.equal(result.rows[1][1],'N/A');
  assert.equal(result.nullAnalysis.markers,2);assert.equal(result.nullAnalysis.blank,0);
  assert.equal(result.nullAnalysis.rowsWithMissing,2);
});
test('Null report keeps before and after denominators and leaves unrun results empty',()=>{
  const before=C.analyzeNulls({headers:['Name','Amount'],rows:[['Alice','N/A'],['Bob','0']]}),after=C.analyzeNulls({headers:['Name','Amount'],rows:[['Bob','0']]});
  assert.deepEqual(C.nullReportRows(before,after)[2],['Amount',2,0,1,1,50,1,0,0,0,0,'Kept']);
  assert.deepEqual(C.nullReportRows(before)[2],['Amount',2,0,1,1,50,'','','','','','Not cleaned yet']);
});
test('Null analysis remains defined when every row is removed by cleaning',()=>{
  const result=run([['Name','Email'],['','null'],['Alice','bad email']],{dropInvalid:true});
  assert.equal(result.rows.length,0);assert.equal(result.nullAnalysis.missing,0);
  assert.equal(result.nullAnalysis.rowCount,0);assert.equal(result.nullAnalysis.percentage,0);
});
