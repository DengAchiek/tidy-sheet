import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../server/policy.mjs';
function compile(file, imports) {
  const code=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},URL,Request,Response,console});return module.exports;
}
const identity={userId:'signed-in-account',email:'account@example.test',displayName:'Account'};
function app(user=null) {
  const unavailable=()=>{throw Error('Public entry pages and business cleaning must not depend on billing');};
  const billing={billingMode:()=> 'live',getPlans:unavailable};
  const templates=Object.fromEntries(['landing','cleaner','training','privacy'].map(name=>['./templates/'+name+'.html?raw',fs.readFileSync(new URL('../server/templates/'+name+'.html',import.meta.url),'utf8')]));
  const render=compile('../server/render.ts',{...templates,'cloudflare:workers':{env:{}},'./billing':billing,'./recovery-email':{recoveryEmailReady:()=>false}});
  const route=compile('../server/router.ts',{'./reviews':{},'./auth':{currentUser:async()=>user},'./analytics':{},'./store':{accountFor:unavailable,subscriptionFor:unavailable,first:unavailable,all:unavailable,run:unavailable},'./policy.mjs':policy,'./billing':billing,'./render':render}).handleRequest;
  return {route,render};
}
const get=(route,path)=>route(new Request('https://example.com'+path));
test('Public entry buttons require sign-in and signed-in buttons lead to the purpose chooser',async()=>{
  for(const user of [null,identity]){const {route}=app(user),response=await get(route,'/');assert.equal(response.status,200);const html=await response.text();assert.match(html,user?/href="\/choose">Clean a spreadsheet/:/href="\/login\?returnTo=%2Fchoose">Clean a spreadsheet/);assert.doesNotMatch(html,/href="\/?sheet-cleaner.html(?:\?|"|#)/);assert.match(html,/Sign in to use your own file/);assert.doesNotMatch(html,/sample freely|sample without signing in/);}
});
test('Anonymous direct workspace URLs, selected-purpose URLs and samples all require authentication',async()=>{
  const {route}=app();for(const path of ['/choose','/cleaner','/sheet-cleaner.html','/sheet-cleaner.html?sample=1','/sheet-cleaner.html?purpose=business','/training','/training?purpose=training']){const response=await get(route,path);assert.equal(response.status,303,path);assert.equal(response.headers.get('location'),'/login?returnTo=%2Fchoose',path);assert.doesNotMatch(await response.text(),/id="(?:file|mlFiles)"/);}
});
test('The authenticated chooser shows both purposes before rendering any file input',async()=>{
  const {route}=app(identity),response=await get(route,'/choose'),html=await response.text();assert.equal(response.status,200);assert.match(html,/Clean data for <br>business use/);assert.match(html,/Prepare data for <br>training models/);assert.match(html,/href="\/sheet-cleaner.html\?purpose=business"/);assert.match(html,/href="\/training\?purpose=training"/);assert.doesNotMatch(html,/<input[^>]+type="file"/);assert.match(html,/aria-current="step"/);
});
test('Signed-in direct workspace links return to the chooser until a purpose is selected',async()=>{
  const {route}=app(identity);for(const path of ['/cleaner','/sheet-cleaner.html','/training','/sheet-cleaner.html?purpose=training','/training?purpose=business']){const response=await get(route,path);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/choose');}
});
test('Choosing business opens a signed-in free uploader without requiring a subscription or an upload login modal',async()=>{
  const {route}=app(identity);for(const path of ['/cleaner?purpose=business','/sheet-cleaner.html?purpose=business','/sheet-cleaner.html?purpose=business&sample=1']){const response=await get(route,path);assert.equal(response.status,200);const html=await response.text(),session=JSON.parse(html.match(/id="tidysheet-session" type="application\/json">([^<]+)</)[1]);assert.equal(session.publicCleaner,false);assert.equal(session.access.business,true);assert.equal(session.access.training,false);assert.equal(session.user.id,identity.userId);assert.match(html,/id="browse"/);assert.match(html,/Change purpose/);assert.doesNotMatch(html,/uploadAuthDialog/);}
});
test('Login return targets for all workspaces and unsafe URLs go through the chooser; account and admin destinations remain valid',()=>{
  const {render}=app();for(const path of ['/sheet-cleaner.html?purpose=business','/training?purpose=training','/cleaner','//evil.example','https://evil.example','/missing'])assert.match(render.authPage('login',path),/data-auth-return="\/choose"/);assert.match(render.authPage('login','/choose?sample=1'),/data-auth-return="\/choose\?sample=1"/);for(const path of ['/admin','/admin/reviews','/reviews','/account/security'])assert.ok(render.authPage('login',path).includes('data-auth-return="'+path+'"'));assert.match(render.authPage('login'),/return_to=%2Fchoose/);
});
test('Selecting a sample preserves the intent on the chooser without bypassing sign-in or purpose selection',async()=>{
  const anon=await get(app().route,'/choose?sample=1');assert.equal(anon.headers.get('location'),'/login?returnTo=%2Fchoose%3Fsample%3D1');const signed=app(identity);assert.equal((await get(signed.route,'/sheet-cleaner.html?sample=1')).headers.get('location'),'/choose?sample=1');assert.match(await (await get(signed.route,'/choose?sample=1')).text(),/purpose=business&amp;sample=1/);
});
test('Anonymous requests cannot use billing, trials, or stored cleaning APIs',async()=>{
  const {route}=app();for(const path of ['/api/trial','/api/billing/checkout','/api/activity','/api/usage/clean']){const response=await route(new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://example.com','Content-Type':'application/json'},body:'{}'}));assert.equal(response.status,401,path);}
});
