import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {AppError} from '../server/policy.mjs';
function service(env={},fetch=async()=>{throw Error('Unexpected network call');}){
 const source=ts.transpileModule(fs.readFileSync(new URL('../server/python-cleaning.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>n==='cloudflare:workers'?{env}:{AppError},URL,Request,Response,TextEncoder,TextDecoder,Uint8Array,AbortSignal,fetch});return module.exports;
}
const env={CLEANING_API_URL:'https://private-cleaning.example',CLEANING_API_TOKEN:'not-a-real-production-secret-1234567890'};
const data={model:{headers:['ID'],rows:[['001']],sourceRows:[2]},config:{types:['text']}};
const request=(body=data,headers={})=>new Request('https://app.example/api/cleaning/run',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
test('Python availability requires an HTTPS backend and server-only token; loopback is explicit local preview only',()=>{
 assert.equal(service().pythonCleaningReady(),false);assert.equal(service(env).pythonCleaningReady(),true);
 assert.equal(service({...env,CLEANING_API_URL:'http://example.com'}).pythonCleaningReady(),false);
 assert.equal(service({...env,CLEANING_API_URL:'http://127.0.0.1:8008'}).pythonCleaningReady(),false);
 assert.equal(service({...env,CLEANING_API_URL:'http://127.0.0.1:8008',CLEANING_LOCAL_DEV:'true'}).pythonCleaningReady(),true);
 assert.equal(service({...env,CLEANING_API_URL:'https://username:password@example.com'}).pythonCleaningReady(),false);
});
test('Python proxy sends only worksheet JSON and its service credential, streams a private response, and disallows redirects',async()=>{
 let called=0;const s=service(env,async(url,options)=>{called++;assert.equal(url.href,'https://private-cleaning.example/clean');assert.equal(options.headers.Authorization,'Bearer '+env.CLEANING_API_TOKEN);assert.equal(options.redirect,'manual');assert.deepEqual(JSON.parse(new TextDecoder().decode(options.body)),data);assert.equal(options.headers.Cookie,undefined);return Response.json({result:{tested:true}});});
 const response=await s.proxyPythonCleaning(request());assert.equal(called,1);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{result:{tested:true}});
});
test('Python proxy rejects unconfigured, malformed and oversized requests before backend execution',async()=>{
 await assert.rejects(service().proxyPythonCleaning(request()),e=>e.status===503);
 const s=service(env);
 await assert.rejects(s.proxyPythonCleaning(request('{not JSON')),e=>e.status===400);
 await assert.rejects(s.proxyPythonCleaning(request(data,{'Content-Length':String(7*1024*1024)})),e=>e.status===413);
 await assert.rejects(s.proxyPythonCleaning(request(data,{'Content-Type':'text/plain'})),e=>e.status===415);
 await assert.rejects(s.proxyPythonCleaning(request({model:{headers:['A'],rows:Array(50001).fill(['x'])},config:{}})),e=>e.status===400);
});
test('Python backend failures are sanitized rather than echoing exception text or spreadsheet contents',async()=>{
 const s=service(env,async()=>new Response('private-value-from-dataset',{status:500}));
 await assert.rejects(s.proxyPythonCleaning(request()),e=>e.status===503&&!e.message.includes('private-value'));
 const redirect=service(env,async()=>new Response(null,{status:302,headers:{Location:'https://other-service.example/clean'}}));
 await assert.rejects(redirect.proxyPythonCleaning(request()),e=>e.status===503);
 const busy=service(env,async()=>new Response('anything',{status:429}));
 await assert.rejects(busy.proxyPythonCleaning(request()),e=>e.status===429);
});
