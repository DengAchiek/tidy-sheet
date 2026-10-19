import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import * as nodeCrypto from 'node:crypto';
import * as policy from '../server/policy.mjs';
function compile(file,imports){const source=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:n=>{if(!(n in imports))throw Error('Unexpected '+n);return imports[n];},console,URL,Request,Response,TextEncoder,TextDecoder,Buffer,crypto:nodeCrypto.webcrypto,Date});return module.exports;}
function harness(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return {meta:sql.prepare(query).run(...this.args)};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const store=compile('../server/store.ts',{'cloudflare:workers':{env:{DB,TRIAL_DAYS:'0'}},'./policy.mjs':policy});let native=null;
 const env={};const auth=compile('../server/auth.ts',{'cloudflare:workers':{env},'node:crypto':nodeCrypto,'../app/chatgpt-auth':{getChatGPTUser:async()=>native},'./store':store,'./policy.mjs':policy});
 const analytics=compile('../server/analytics.ts',{'./store':store,'./auth':auth,'./policy.mjs':policy});
 const billing={billingMode:()=> 'live',getPlans:async()=>[null,null,null],billingReady:()=>false};
 const templates=Object.fromEntries(['landing','cleaner','privacy','training'].map(n=>['./templates/'+n+'.html?raw',fs.readFileSync(new URL('../server/templates/'+n+'.html',import.meta.url),'utf8')]));
 const render=compile('../server/render.ts',{...templates,'cloudflare:workers':{env:{TIDYSHEET_IDENTITY_MODE:'disabled'}},'./billing':billing});
 const router=compile('../server/router.ts',{'./auth':auth,'./analytics':analytics,'./store':store,'./policy.mjs':policy,'./billing':billing,'./render':render});
 return {sql,env,store,auth,analytics,render,route:router.handleRequest,setNative:u=>native=u};
}
const fixture={name:'Sample User',email:'sample@example.com',password:'local test account phrase 9284'};
const req=(path='/api/auth/register',body,token='')=>new Request('https://example.com'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://example.com','Content-Type':'application/json',...(token?{cookie:token}:{} )},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function signup(h,extra={}){const response=await h.route(req('/api/auth/register',{...fixture,...extra}));assert.equal(response.status,200,await response.clone().text());return {body:await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};}
const event=(extra={})=>({id:nodeCrypto.randomUUID(),kind:'page_view',path:'/sheet-cleaner.html',sample:false,outcome:'success',...extra});
test('Registration hashes credentials, starts an HttpOnly session, normalizes email, and grants no admin role',async()=>{
 const h=harness(),{body,cookie}=await signup(h,{email:' SAMPLE@example.com '});assert.equal(body.user.email,'sample@example.com');assert.equal(body.recoveryCode.length,40);
 const stored=await h.store.first('SELECT * FROM auth_credentials');assert.match(stored.password_hash,/^scrypt:16384:8:5:/);assert.ok(!stored.password_hash.includes(fixture.password));assert.notEqual(stored.recovery_hash,body.recoveryCode);
 const session=await (await h.route(req('/api/session',undefined,cookie))).json();assert.equal(session.user.email,fixture.email);assert.equal(session.admin,false);assert.equal(session.access.business,true);assert.equal(session.access.training,false);
 const tokens=await h.store.all('SELECT * FROM auth_sessions');assert.notEqual(tokens[0].token_hash,cookie.split('=')[1]);
 assert.equal((await h.route(req('/api/admin/overview',undefined,cookie))).status,403);
});
test('Passwords support long phrases, reject weak lengths, and login rejects wrong or unknown credentials',async()=>{
 const h=harness();assert.equal((await h.route(req('/api/auth/register',{...fixture,password:'short'}))).status,400);
 const {cookie}=await signup(h);const duplicate=await h.route(req('/api/auth/register',fixture));assert.equal(duplicate.status,409);assert.equal((await h.store.all('SELECT * FROM accounts')).length,1);
 for(const body of [{email:fixture.email,password:'wrong password'},{email:'unknown@example.com',password:fixture.password}]){const response=await h.route(req('/api/auth/login',body));assert.equal(response.status,401);assert.equal((await response.json()).error,'invalid_credentials');}
 const login=await h.route(req('/api/auth/login',fixture,cookie));assert.equal(login.status,200);const header=login.headers.get('set-cookie');assert.match(header,/^__Host-tidysheet=/);assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Lax/);
 assert.equal((await (await h.route(req('/api/session',undefined,cookie))).json()).user,null,'login replaces the previous session');
});
test('Logout and expiry revoke access, cross-origin auth writes fail, forged cookies cannot authenticate',async()=>{
 const h=harness(),{cookie}=await signup(h);
 const cross=new Request('https://example.com/api/auth/logout',{method:'POST',headers:{origin:'https://evil.example',cookie},body:'{}'});assert.equal((await h.route(cross)).status,403);
 assert.equal((await h.route(req('/api/auth/logout',{},cookie))).status,200);assert.equal((await (await h.route(req('/api/session',undefined,cookie))).json()).user,null);
 const fresh=await h.route(req('/api/auth/login',fixture));const token=fresh.headers.get('set-cookie').split(';')[0];await h.store.run('UPDATE auth_sessions SET expires_at=0');assert.equal((await (await h.route(req('/api/session',undefined,token))).json()).user,null);
 assert.equal((await (await h.route(req('/api/session',undefined,'__Host-tidysheet='+'a'.repeat(64)))).json()).user,null);
 assert.equal((await h.route(req('/api/admin/overview'))).status,401);
});
test('Recovery codes are single-use, replace the password, and revoke every existing session',async()=>{
 const h=harness(),{cookie,body}=await signup(h);const password='a completely new testing phrase';
 assert.equal((await h.route(req('/api/auth/recover',{email:fixture.email,password,recoveryCode:'0'.repeat(40)}))).status,401);
 const reset=await h.route(req('/api/auth/recover',{email:fixture.email,password,recoveryCode:body.recoveryCode}));assert.equal(reset.status,200);assert.notEqual((await reset.json()).recoveryCode,body.recoveryCode);
 assert.equal((await h.store.all('SELECT * FROM auth_sessions')).length,0);
 assert.equal((await h.route(req('/api/auth/recover',{email:fixture.email,password,recoveryCode:body.recoveryCode}))).status,401);
 assert.equal((await h.route(req('/api/auth/login',fixture))).status,401);assert.equal((await h.route(req('/api/auth/login',{email:fixture.email,password}))).status,200);
 assert.equal((await (await h.route(req('/api/session',undefined,cookie))).json()).user,null);
});
test('Authentication throttles attempts and accepts neither null bodies nor email-only privilege claims',async()=>{
 const h=harness();for(let i=0;i<10;i++)assert.equal((await h.route(req('/api/auth/login',{email:fixture.email,password:'bad'}))).status,401);
 assert.equal((await h.route(req('/api/auth/login',fixture))).status,429);assert.equal((await h.route(req('/api/auth/register',null))).status,400);
 h.setNative({userId:'trusted-native-id',email:fixture.email,displayName:'Native',fullName:'Native'});assert.equal(await h.auth.isAdmin(await h.auth.currentUser(req())),false);
});
test('Admin authorization uses an explicit server-side membership and is rechecked on every request',async()=>{
 const h=harness(),{cookie}=await signup(h),user=await h.auth.currentUser(req('/',undefined,cookie));await h.store.run('INSERT INTO administrators (user_id,created_at) VALUES (?,?)',user.userId,Date.now());
 assert.equal((await h.route(req('/api/admin/overview?days=7',undefined,cookie))).status,200);assert.equal((await h.route(req('/admin',undefined,cookie))).status,200);
 await h.store.run('DELETE FROM administrators');assert.equal((await h.route(req('/api/admin/overview',undefined,cookie))).status,403);
 assert.equal((await h.route(req('/admin'))).headers.get('location'),'/login?returnTo=%2Fadmin');
});
test('Visitor analytics deduplicates event IDs and visitors; own-file events require login and reject private contents',async()=>{
 const h=harness(),first=event(),response=await h.route(req('/api/telemetry',first));assert.equal(response.status,200);const visitor=response.headers.get('set-cookie').split(';')[0];
 await h.route(req('/api/telemetry',first,visitor));await h.route(req('/api/telemetry',event({path:'/'}),visitor));
 const invalid=await h.route(req('/api/telemetry',event({filename:'private.csv'}),visitor));assert.equal(invalid.status,400);
 const real=event({kind:'clean',durationMs:125,rows:10,columns:3});assert.equal((await h.route(req('/api/telemetry',real,visitor))).status,401);
 assert.equal((await h.route(req('/api/telemetry',{...real,id:nodeCrypto.randomUUID(),sample:true},visitor))).status,200);
 const d=await h.analytics.dashboard(7);assert.equal(d.traffic.visitors,1);assert.equal(d.traffic.pageViews,2);assert.equal(d.operations[0].sample,1);assert.equal(d.trends.length,7);assert.equal(d.trends.reduce((n,r)=>n+r.cleanings,0),0);
 assert.equal((await h.route(req('/api/telemetry',event({path:'/?email=private@example.com'}),visitor))).status,400);
});
test('Dashboard applies UTC windows, separates samples and real outcomes, and shows zero days accurately',async()=>{
 const h=harness(),{cookie}=await signup(h),visitor='tidysheet-visitor='+nodeCrypto.randomUUID(),combined=cookie+'; '+visitor;
 for(const extra of [{kind:'import',durationMs:200,rows:10,columns:3},{kind:'clean',durationMs:100,rows:10,columns:3},{kind:'clean',durationMs:90,rows:10,columns:3,outcome:'failure'},{kind:'export',durationMs:50,rows:10,columns:3},{kind:'clean',durationMs:150,rows:8,columns:2,sample:true}])assert.equal((await h.route(req('/api/telemetry',event(extra),combined))).status,200);
 const old=Date.now()-35*86400000;await h.store.run("INSERT INTO site_events (id,visitor_id,kind,path,sample,outcome,created_at) VALUES (?,?,?,'/',0,'success',?)",nodeCrypto.randomUUID(),nodeCrypto.randomUUID(),'page_view',old);
 const d=await h.analytics.dashboard(30);assert.equal(d.operations.reduce((n,r)=>n+r.count,0),5);assert.equal(d.trends.reduce((n,r)=>n+r.cleanings,0),1);assert.equal(d.trends[0].pageViews,0);assert.equal(d.accounts.newAccounts,1);assert.equal(d.traffic.activeAccounts,1);assert.equal(d.traffic.pageViews,0);assert.equal(d.recent.length,6);
 const wide=await h.analytics.dashboard(90);assert.equal(wide.traffic.pageViews,1);await assert.rejects(h.analytics.dashboard(365),e=>e.status===400);
});
test('Login return targets are confined to application pages and native sign-in is hidden on standalone Workers',()=>{
 const h=harness(),page=h.render.authPage('login','//evil.example/steal');assert.match(page,/data-auth-return="\/sheet-cleaner.html"/);assert.doesNotMatch(page,/href="\/signin-with-chatgpt/);
});

test('A private admin invitation requires the intended email and code, is consumed once, and cannot restore revoked access',async()=>{
 const h=harness(),{cookie}=await signup(h),code='1'.repeat(40);h.env.ADMIN_INVITE_EMAIL=fixture.email;h.env.ADMIN_INVITE_HASH=h.auth.digest(code);
 assert.equal((await h.route(req('/api/admin/claim',{code:'2'.repeat(40)},cookie))).status,403);
 const other=await signup(h,{email:'other@example.com'});assert.equal((await h.route(req('/api/admin/claim',{code},other.cookie))).status,403);
 assert.equal((await h.route(req('/api/admin/claim',{code},cookie))).status,200);assert.equal((await h.route(req('/api/admin/overview',undefined,cookie))).status,200);
 await h.store.run('DELETE FROM administrators');assert.equal((await h.route(req('/api/admin/claim',{code},cookie))).status,409);assert.equal((await h.route(req('/api/admin/overview',undefined,cookie))).status,403);
});
async function issue(h){const code='3'.repeat(40);h.env.ADMIN_INVITE_EMAIL=fixture.email;h.env.ADMIN_INVITE_HASH=h.auth.digest(code);const response=await h.route(req('/api/admin/invitations/create',{code}));assert.equal(response.status,200,await response.clone().text());return {code,...await response.json()};}
test('Private admin links use an opaque hashed secret, expire in 24 hours, and inspection never consumes them',async()=>{
 const h=harness();assert.equal((await h.route(req('/api/admin/invitations/create',{code:'wrong'}))).status,403);
 const invitation=await issue(h);assert.match(invitation.token,/^[a-f0-9]{64}$/);assert.ok(Math.abs(invitation.expiresAt-Date.now()-24*3600000)<3000);
 const stored=await h.store.first('SELECT * FROM admin_invitations');assert.equal(stored.token_hash,h.auth.digest(invitation.token));assert.notEqual(stored.token_hash,invitation.token);
 for(let i=0;i<2;i++){const response=await h.route(req('/api/admin/invitations/inspect',{token:invitation.token}));assert.equal(response.status,200);assert.equal((await response.json()).email,fixture.email);}
 assert.equal((await h.store.first('SELECT used_at FROM admin_invitations')).used_at,null);
 const page=await h.route(req('/admin/register'));assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');const html=await page.text();assert.match(html,/data-admin-registration/);assert.ok(!html.includes(invitation.token));assert.ok(!html.includes(fixture.email));
 assert.equal((await h.route(req('/api/admin/invitations/create',{code:invitation.code}))).status,409);
});
test('Registration with a valid admin link atomically creates the account and admin membership, and cannot be replayed',async()=>{
 const h=harness(),invitation=await issue(h),result=await signup(h,{adminInvitation:invitation.token});const data=await (await h.route(req('/api/session',undefined,result.cookie))).json();assert.equal(data.admin,true);
 const stored=await h.store.first('SELECT * FROM admin_invitations');assert.equal(stored.used_by,data.user.id);assert.ok(stored.used_at>0);
 assert.equal((await h.route(req('/api/admin/invitations/inspect',{token:invitation.token}))).status,410);
 await h.store.run('DELETE FROM administrators');assert.equal((await h.route(req('/api/auth/login',{...fixture,adminInvitation:invitation.token}))).status,410);assert.equal((await h.store.all('SELECT * FROM administrators')).length,0);
 assert.equal((await h.route(req('/api/admin/claim',{code:invitation.code},result.cookie))).status,409);
});
test('Admin links reject wrong recipients, expiry and invalid tokens without creating accounts or consuming the link',async()=>{
 const h=harness(),invitation=await issue(h);
 assert.equal((await h.route(req('/api/auth/register',{...fixture,email:'not-invited@example.com',adminInvitation:invitation.token}))).status,403);
 assert.equal((await h.route(req('/api/auth/register',{...fixture,adminInvitation:'4'.repeat(64)}))).status,403);
 assert.equal((await h.store.all('SELECT * FROM accounts')).length,0);assert.equal((await h.store.first('SELECT used_at FROM admin_invitations')).used_at,null);
 await h.store.run('UPDATE admin_invitations SET expires_at=?',Date.now()-1);
 assert.equal((await h.route(req('/api/admin/invitations/inspect',{token:invitation.token}))).status,410);
 assert.equal((await h.route(req('/api/auth/register',{...fixture,adminInvitation:invitation.token}))).status,410);assert.equal((await h.store.all('SELECT * FROM accounts')).length,0);
});
test('Existing accounts activate through the same link only after password verification',async()=>{
 const h=harness(),invitation=await issue(h),{cookie}=await signup(h);
 assert.equal((await h.route(req('/api/auth/register',{...fixture,adminInvitation:invitation.token}))).status,409);assert.equal((await h.store.first('SELECT used_at FROM admin_invitations')).used_at,null);
 assert.equal((await h.route(req('/api/auth/login',{...fixture,password:'incorrect',adminInvitation:invitation.token}))).status,401);assert.equal((await h.store.first('SELECT used_at FROM admin_invitations')).used_at,null);
 const response=await h.route(req('/api/auth/login',{...fixture,adminInvitation:invitation.token}));assert.equal(response.status,200);const token=response.headers.get('set-cookie').split(';')[0];assert.equal((await (await h.route(req('/api/session',undefined,token))).json()).admin,true);
 assert.equal((await (await h.route(req('/api/session',undefined,cookie))).json()).user,null);
});
test('Creating a secret link disables its old setup code and a consumed bootstrap cannot issue a link',async()=>{
 const h=harness(),invitation=await issue(h),{cookie}=await signup(h);assert.equal((await h.route(req('/api/admin/claim',{code:invitation.code},cookie))).status,409);assert.equal((await h.store.all('SELECT * FROM administrators')).length,0);
 const other=harness(),registered=await signup(other),code='5'.repeat(40);other.env.ADMIN_INVITE_EMAIL=fixture.email;other.env.ADMIN_INVITE_HASH=other.auth.digest(code);assert.equal((await other.route(req('/api/admin/claim',{code},registered.cookie))).status,200);
 assert.equal((await other.route(req('/api/admin/invitations/create',{code}))).status,409);
});
