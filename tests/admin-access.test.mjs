import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/assets/admin-access.js',import.meta.url),'utf8');
function browser(initial={admin:true,user:{id:'admin-a'}}){
  const events=new EventTarget(),visibility=new EventTarget(),channel=new EventTarget(),classes=new Set(['admin-body','admin-session-pending']);
  const state={layout:'private report',modal:'private details',open:true,redirect:null,reloads:0,clearedInterval:false};let next=initial;
  const document={hidden:false,body:{classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)}},querySelector:()=>({content:'admin-a'}),querySelectorAll:selector=>selector==='dialog[open]'?(state.open?[{close:()=>state.open=false}]:[]):[{replaceChildren:()=>state.layout=''}, {replaceChildren:()=>state.modal=''}],addEventListener:(...a)=>visibility.addEventListener(...a)};
  const window={addEventListener:(...a)=>events.addEventListener(...a),dispatchEvent:e=>events.dispatchEvent(e),TidyAuthChannel:channel};
  vm.runInNewContext(source,{window,document,location:{pathname:'/admin',replace:p=>state.redirect=p,reload:()=>state.reloads++},Event,AbortController,setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>state.clearedInterval=true,fetch:async()=>{if(next instanceof Error)throw next;return Response.json(next);}});
  return {window,document,state,classes,events,channel,setSession:v=>next=v};
}
test('Admin browser data stays hidden until the same administrator is authorized',async()=>{
  const b=browser();assert.equal(b.classes.has('admin-session-pending'),true);assert.equal(await b.window.TidyAdminAccess.ready,true);assert.equal(b.classes.has('admin-session-pending'),false);
  b.setSession({admin:true,user:{id:'different-admin'}});assert.equal(await b.window.TidyAdminAccess.verify(),false);assert.equal(b.state.layout,'');assert.equal(b.state.modal,'');assert.equal(b.state.open,false);assert.equal(b.state.redirect,'/login?returnTo=%2Fadmin');
});
test('Sample, regular, signed-out and failed session checks erase prior reports',async()=>{
  for(const session of [{admin:false,user:{id:'admin-a',sampleOnly:true}},{admin:false,user:{id:'client'}},{user:null},Error('offline')]){
    const b=browser();await b.window.TidyAdminAccess.ready;b.setSession(session);assert.equal(await b.window.TidyAdminAccess.verify(),false);assert.equal(b.state.layout,'');assert.equal(b.state.modal,'');assert.equal(b.classes.has('admin-session-pending'),true);
  }
});
test('Leaving, restoring from history and changing accounts in another tab clear private data',async()=>{
  const b=browser();await b.window.TidyAdminAccess.ready;b.events.dispatchEvent(new Event('pagehide'));assert.equal(b.state.layout,'');assert.equal(b.state.clearedInterval,true);
  const restored=new Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});b.events.dispatchEvent(restored);assert.equal(b.state.reloads,1);
  const c=browser();await c.window.TidyAdminAccess.ready;c.channel.dispatchEvent(new MessageEvent('message',{data:'changed'}));assert.equal(c.state.layout,'');assert.equal(c.state.modal,'');assert.equal(c.state.reloads,1);
});
