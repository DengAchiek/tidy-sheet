import {env} from 'cloudflare:workers';
import {AppError} from './policy.mjs';

export const PYTHON_LIMITS={rows:50000,cells:100000,requestBytes:6*1024*1024};
export function pythonCleaningReady(){
  if(!env.CLEANING_API_URL||!env.CLEANING_API_TOKEN||env.CLEANING_API_TOKEN.length<32)return false;
  try{const url=new URL(env.CLEANING_API_URL);return !url.username&&!url.password&&(url.protocol==='https:'||(env.CLEANING_LOCAL_DEV==='true'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)));}catch{return false;}
}
export async function proxyPythonCleaning(request:Request){
  if(!pythonCleaningReady())throw new AppError(503,'python_unavailable','Python cleaning is being configured. Choose on-device cleaning for now.');
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new AppError(415,'invalid_content_type','Send JSON worksheet data.');
  const length=request.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>PYTHON_LIMITS.requestBytes))throw new AppError(413,'dataset_too_large','Server cleaning accepts up to 6 MB of worksheet values and rules.');
  if(!request.body)throw new AppError(400,'missing_data','Import a dataset first.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>PYTHON_LIMITS.requestBytes){await reader.cancel();throw new AppError(413,'dataset_too_large','Server cleaning accepts up to 6 MB of worksheet values and rules.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  // Validate dimensions here, before invoking the more expensive Python service.
  let body:any;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'invalid_dataset','Provide valid JSON worksheet data.');}
  const model=body?.model,config=body?.config;
  if(!model||!config||typeof config!=='object'||Array.isArray(config)||!Array.isArray(model.headers)||model.headers.length<1||model.headers.length>100||!Array.isArray(model.rows)||model.rows.length>PYTHON_LIMITS.rows||model.rows.length*model.headers.length>PYTHON_LIMITS.cells)throw new AppError(400,'invalid_dataset','Server cleaning supports up to 50,000 rows, 100 columns and 100,000 cells.');
  const url=new URL('/clean',env.CLEANING_API_URL);
  let upstream:Response;
  try{upstream=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.CLEANING_API_TOKEN},body:bytes,signal:AbortSignal.timeout(90000),redirect:'manual'});}catch{throw new AppError(503,'python_unavailable','The Python cleaning service is unavailable. Try again or choose on-device cleaning.');}
  if(!upstream.ok){
    const allowed=[400,413,415,429];
    if(!allowed.includes(upstream.status))throw new AppError(503,'python_unavailable','The Python cleaning service is unavailable. Try again or choose on-device cleaning.');
    const messages:Record<number,string>={400:'Check your dataset and rules. Server cleaning supports 50,000 rows, 100,000 cells and a 6 MB request.',413:'The server result or request is too large. Split your file or use on-device cleaning.',415:'Send JSON worksheet data.',429:'The Python service is busy. Try again shortly.'};
    throw new AppError(upstream.status,'python_request_failed',messages[upstream.status]);
  }
  // Stream the result; do not persist datasets in D1/R2 or copy them into logs.
  return new Response(upstream.body,{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
