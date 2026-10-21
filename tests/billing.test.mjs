import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHmac} from 'node:crypto';
import * as policy from '../server/policy.mjs';
const now=()=>Date.now();
function database(){
  const db=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const prepare=sql=>({args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async all(){return {results:db.prepare(sql).all(...this.args)};},async run(){return {success:true,meta:db.prepare(sql).run(...this.args)};}});
  return {sqlite:db,prepare,async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
function compile(file,imports,extras={}){
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8').replaceAll('import.meta.env.DEV','false');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};vm.runInNewContext(code,{exports:module.exports,module,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},console,URL,Request,Response,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,Date,...extras},{filename:file});return module.exports;
}
function harness(){
  const DB=database(),env={DB,TRIAL_DAYS:'0',PAYSTACK_REGULAR_PLAN_CODE:'PLN_regular',PAYSTACK_SECRET_KEY:'sk_test_fixture',PAYSTACK_MONTHLY_PLAN_CODE:'PLN_month',PAYSTACK_ANNUAL_PLAN_CODE:'PLN_year',APP_URL:'https://example.com'};
  const store=compile('../server/store.ts',{'cloudflare:workers':{env},'./policy.mjs':policy});
  const requests=[],plans={PLN_regular:{id:3,plan_code:'PLN_regular',name:'Regular',amount:1000,currency:'USD',interval:'monthly'},PLN_month:{id:1,plan_code:'PLN_month',name:'Monthly',amount:2000,currency:'USD',interval:'monthly'},PLN_year:{id:2,plan_code:'PLN_year',name:'Annual',amount:24000,currency:'USD',interval:'annually'}};
  let transaction=null,subscription=null;
  const fetch=async(url,options={})=>{
    const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;requests.push({path,body});let data;
    if(path.startsWith('/plan/'))data=plans[path.split('/').at(-1)];
    else if(path==='/transaction/initialize')data={authorization_url:'https://checkout.paystack.com/safe-fixture'};
    else if(path.startsWith('/transaction/verify/'))data=transaction;
    else if(path==='/subscription')data=subscription?[subscription]:[];
    else if(path.endsWith('/manage/link'))data={link:'https://paystack.com/manage/fixture'};
    else if(path.startsWith('/subscription/'))data=subscription;
    else throw Error('Unexpected provider path '+path);
    return Response.json({status:true,data});
  };
  const billing=compile('../server/billing.ts',{'cloudflare:workers':{env},'./store':store,'./policy.mjs':policy},{fetch});
  return {DB,env,store,billing,plans,requests,setPayment(ref,cycle='monthly'){
    const plan=plans[cycle==='regular_monthly'?'PLN_regular':cycle==='annually'?'PLN_year':'PLN_month'];
    transaction={id:101,reference:ref,status:'success',amount:plan.amount,currency:'USD',paid_at:new Date(now()-1000).toISOString(),metadata:{tidysheet_user_id:'user-a'},customer:{id:10,customer_code:'CUS_a',email:'alice@example.com'},authorization:{authorization_code:'AUTH_a'},plan:plan.plan_code,plan_object:plan};
    subscription={subscription_code:'SUB_a',status:'active',plan,amount:plan.amount,customer:transaction.customer,authorization:transaction.authorization,createdAt:new Date().toISOString(),next_payment_date:new Date(now()+(cycle==='annually'?365:30)*86400000).toISOString()};return {transaction,subscription};
  }};
}
async function user(h,id='user-a',email='alice@example.com'){return h.store.accountFor({userId:id,email,displayName:'Alice'});}
function signed(event,secret='sk_test_fixture'){const body=JSON.stringify(event),sig=createHmac('sha512',secret).update(body).digest('hex');return new Request('https://example.com/api/billing/webhook',{method:'POST',headers:{'x-paystack-signature':sig},body});}

test('Subscription access requires paid time, valid status and matching billing mode',()=>{
  const s={billing_mode:'live',last_paid_at:10,revoked_at:0,period_end:100,status:'active'};
  assert.equal(policy.subscriptionAccess({},s,50,'live').allowed,true);
  assert.equal(policy.subscriptionAccess({},s,100,'live').allowed,false);
  assert.equal(policy.subscriptionAccess({},s,50,'test').allowed,false);
  assert.equal(policy.subscriptionAccess({trial_ends:80},null,50).source,'trial');
  for(const status of ['cancelled','revoked','completed','none'])assert.equal(policy.subscriptionAccess({},{...s,status},50).allowed,false);
  assert.equal(policy.subscriptionAccess({},{...s,revoked_at:20},50).allowed,false);
});
test('Yearly and monthly access expire at the provider paid-through date',()=>{
  const p=Date.UTC(2026,0,1),monthly={next_payment_date:'2026-02-01T00:00:00Z'},annual={next_payment_date:'2027-01-01T00:00:00Z'};
  assert.equal(policy.paidPeriod(monthly,p,'monthly'),Date.UTC(2026,1,1));
  assert.equal(policy.paidPeriod(annual,p,'annually'),Date.UTC(2027,0,1));
  assert.throws(()=>policy.paidPeriod(annual,p,'monthly'));
  assert.throws(()=>policy.paidPeriod({next_payment_date:null},p));
});
test('Origin checks reject cross-site state changes and provider links reject lookalike hosts',()=>{
  for(const origin of [null,'https://evil.test','https://example.com.evil.test'])assert.throws(()=>policy.sameOrigin(new Request('https://example.com/api/x',{method:'POST',...(origin?{headers:{origin}}:{})})));
  policy.sameOrigin(new Request('https://example.com/api/x',{method:'POST',headers:{origin:'https://example.com'}}));
  for(const url of ['javascript:alert(1)','https://checkout.paystack.com.evil.test/','https://paystack.com@evil.test/','http://paystack.com/'])assert.throws(()=>policy.safeProviderURL(url,['paystack.com']));
});
test('Monthly checkout uses approved USD price, card subscriptions and an idempotent pending session',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');await h.billing.initializeCheckout(a,'monthly');
  const calls=h.requests.filter(r=>r.path==='/transaction/initialize');assert.equal(calls.length,1);assert.equal(calls[0].body.amount,2000);assert.equal(calls[0].body.currency,'USD');assert.deepEqual(calls[0].body.channels,['card']);assert.equal(calls[0].body.metadata.tidysheet_user_id,a.id);
});
test('Annual checkout uses the approved $240 USD annual plan',async()=>{
  const h=harness();await h.billing.initializeCheckout(await user(h),'annually');const call=h.requests.find(r=>r.path==='/transaction/initialize');assert.equal(call.body.amount,24000);assert.equal(call.body.plan,'PLN_year');
});
test('Misconfigured provider prices, currencies and intervals are rejected before checkout',async()=>{
  for(const patch of [{amount:2100},{currency:'KES'},{interval:'annually'}]){const h=harness();Object.assign(h.plans.PLN_month,patch);await assert.rejects(h.billing.initializeCheckout(await user(h),'monthly'));assert.equal(h.requests.some(r=>r.path==='/transaction/initialize'),false);}
});
test('Verified payment grants exactly one paid period, and replay cannot duplicate receipts',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const checkout=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(checkout.reference);
  await h.billing.verifyCheckout(checkout.reference,a.id);await h.billing.verifyCheckout(checkout.reference,a.id);
  const sub=await h.store.subscriptionFor(a.id);assert.equal(sub.status,'active');assert.equal(sub.billing_mode,'test');assert.equal(policy.subscriptionAccess(a,sub,now(),'test').allowed,true);assert.equal((await h.store.all('SELECT * FROM payment_receipts')).length,1);
});
test('Annual verified payment grants annual access, not a monthly period',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'annually');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference,'annually');await h.billing.verifyCheckout(c.reference,a.id);assert.ok((await h.store.subscriptionFor(a.id)).period_end>now()+360*86400000);
});
test('Payment references are bound to the signed-in account',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference);await assert.rejects(h.billing.verifyCheckout(c.reference,'other-user'),e=>e.status===404);assert.equal(await h.store.subscriptionFor(a.id),null);
});
test('Wrong amount, currency, customer, metadata, or payment status cannot grant access',async()=>{
  for(const patch of [{amount:1},{currency:'KES'},{customer:{id:10,email:'other@example.com',customer_code:'CUS_a'}},{metadata:{tidysheet_user_id:'other'}},{status:'failed'}]){
    const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');Object.assign(h.setPayment(c.reference).transaction,patch);await assert.rejects(h.billing.verifyCheckout(c.reference,a.id));assert.equal(await h.store.subscriptionFor(a.id),null);
  }
});
test('Invalid webhook signatures never change subscriptions',async()=>{
  const h=harness();await assert.rejects(h.billing.processWebhook(signed({event:'charge.success',data:{reference:'fake_ref'}},'wrong')),e=>e.status===401);assert.equal((await h.store.all('SELECT * FROM webhook_events')).length,0);
});
test('Webhook signature verifies exact raw bytes and rejects modified payloads',async()=>{
  const raw='{"event":"charge.success"}',sig=createHmac('sha512','secret').update(raw).digest('hex');assert.equal(await policy.verifyWebhook(raw,sig,'secret'),true);assert.equal(await policy.verifyWebhook(raw+' ',sig,'secret'),false);
});
test('Signed payment webhook activates subscription and duplicate deliveries are idempotent',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference);const event={event:'charge.success',data:{reference:c.reference}};
  await h.billing.processWebhook(signed(event));await h.billing.processWebhook(signed(event));assert.equal((await h.store.all('SELECT * FROM payment_receipts')).length,1);assert.equal((await h.store.all('SELECT * FROM webhook_events')).length,1);
});
test('Cancellation status refresh preserves paid-through date and never extends access',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');const p=h.setPayment(c.reference);await h.billing.verifyCheckout(c.reference,a.id);const before=await h.store.subscriptionFor(a.id);
  p.subscription.status='non-renewing';p.subscription.next_payment_date=new Date(now()+100*86400000).toISOString();await h.billing.processWebhook(signed({event:'subscription.not_renew',data:{subscription_code:'SUB_a'}}));const after=await h.store.subscriptionFor(a.id);assert.equal(after.period_end,before.period_end);assert.equal(after.status,'non-renewing');assert.equal(policy.subscriptionAccess(a,after,now(),'test').allowed,true);
});
test('Refunded payment is revoked and replay of original payment does not restore access',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference);await h.billing.verifyCheckout(c.reference,a.id);
  await h.billing.processWebhook(signed({event:'refund.processed',data:{transaction:{reference:c.reference},amount:2000}}));await h.billing.verifyCheckout(c.reference,a.id);const sub=await h.store.subscriptionFor(a.id);assert.equal(sub.status,'revoked');assert.equal(policy.subscriptionAccess(a,sub,now(),'test').allowed,false);
});
test('Existing subscription cannot create a second recurring checkout',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference);await h.billing.verifyCheckout(c.reference,a.id);await assert.rejects(h.billing.initializeCheckout(a,'annually'),e=>e.code==='existing_subscription');
});
test('An existing pending monthly checkout is never returned for an annual purchase',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'monthly');await assert.rejects(h.billing.initializeCheckout(a,'annually'),e=>e.code==='pending_different_plan');assert.equal(h.requests.filter(r=>r.path==='/transaction/initialize').length,1);
});
test('A free trial is created once and cannot be extended by repeated sign-in',async()=>{
  const h=harness();h.env.TRIAL_DAYS='7';const first=await user(h);const second=await user(h);assert.equal(first.trial_ends,second.trial_ends);assert.ok(first.trial_ends>now()+6*86400000);
});
test('Switching from test annual data to live monthly billing cannot carry over test paid time',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'annually');let checkout=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(checkout.reference,'annually');await h.billing.verifyCheckout(checkout.reference,a.id);assert.ok((await h.store.subscriptionFor(a.id)).period_end>now()+360*86400000);
  h.env.PAYSTACK_SECRET_KEY='sk_live_fixture';await h.billing.initializeCheckout(a,'monthly');checkout=await h.store.first("SELECT * FROM checkout_sessions WHERE status='pending'");h.setPayment(checkout.reference,'monthly');await h.billing.verifyCheckout(checkout.reference,a.id);const sub=await h.store.subscriptionFor(a.id);assert.equal(sub.billing_mode,'live');assert.ok(sub.period_end<now()+35*86400000);assert.equal(policy.subscriptionAccess(a,sub,now(),'live').allowed,true);
});

test('Regular charges $10 monthly and grants business access only',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'regular_monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');assert.equal(c.amount,1000);h.setPayment(c.reference,'regular_monthly');await h.billing.verifyCheckout(c.reference,a.id);const sub=await h.store.subscriptionFor(a.id),access=policy.subscriptionAccess(a,sub,now(),'test');assert.equal(sub.tier,'regular');assert.equal(access.business,true);assert.equal(access.training,false);
});
test('Trial includes training and expires without granting paid time',()=>{const access=policy.subscriptionAccess({trial_ends:100},null,50);assert.equal(access.training,true);assert.equal(access.business,true);assert.equal(policy.subscriptionAccess({trial_ends:100},null,100).allowed,false);});
function routes(h,identity){
  return compile('../server/router.ts',{'./reviews':{},'./auth':{currentUser:async()=>identity,isAdmin:async()=>false},'./analytics':{},'./store':h.store,'./policy.mjs':policy,'./billing':h.billing,'./render':{esc:String,landingPage:()=>'<h1>Landing</h1>',privacyPage:()=>'',choosePage:()=>'<h1>Choose</h1>',trainingPage:()=>'<h1>Training</h1>',cleanerPage:()=>'<h1>Business</h1>',signInPage:()=>'<h1>Sign in</h1>',accountPage:()=>'<h1>Account</h1>'}}).handleRequest;
}
test('Workspaces require sign-in while training entitlements and cross-origin mutations remain protected',async()=>{
  const h=harness(),route=routes(h,null);assert.equal((await route(new Request('https://example.com/training'))).status,303);assert.equal((await route(new Request('https://example.com/sheet-cleaner.html'))).status,303);assert.equal((await route(new Request('https://example.com/choose'))).status,303);assert.equal((await route(new Request('https://example.com/api/trial',{method:'POST',headers:{origin:'https://evil.test'}}))).status,403);
});
test('Regular cannot enter or record training work while business access works',async()=>{
  const h=harness(),a=await user(h);await h.billing.initializeCheckout(a,'regular_monthly');const c=await h.store.first('SELECT * FROM checkout_sessions');h.setPayment(c.reference,'regular_monthly');await h.billing.verifyCheckout(c.reference,a.id);
  const route=routes(h,{userId:a.id,email:a.email,displayName:'Alice'});assert.equal((await route(new Request('https://example.com/training?purpose=training'))).headers.get('Location'),'/account?access=training');assert.equal((await route(new Request('https://example.com/sheet-cleaner.html'))).status,303);
  const request=mode=>new Request('https://example.com/api/usage/clean',{method:'POST',headers:{origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({id:webcrypto.randomUUID(),rows:10,columns:3,mode})});assert.equal((await route(request('training'))).status,402);assert.equal((await route(request('business'))).status,200);assert.equal((await h.store.all('SELECT * FROM usage_events')).length,1);
});
test('Native identity trial grants training once and recorded usage is scoped to that account',async()=>{
  const h=harness();h.env.TRIAL_DAYS='7';const route=routes(h,{userId:'trial-user',email:'trial@example.com',displayName:'Trial'});assert.equal((await route(new Request('https://example.com/training?purpose=training'))).status,200);const before=await h.store.first("SELECT trial_ends FROM accounts WHERE id='trial-user'");await route(new Request('https://example.com/api/trial',{method:'POST',headers:{origin:'https://example.com'}}));assert.equal((await h.store.first("SELECT trial_ends FROM accounts WHERE id='trial-user'")).trial_ends,before.trial_ends);
  const id=webcrypto.randomUUID(),post=()=>route(new Request('https://example.com/api/usage/clean',{method:'POST',headers:{origin:'https://example.com'},body:JSON.stringify({id,rows:12,columns:3,mode:'training',user_id:'other-user'})}));assert.equal((await post()).status,200);assert.equal((await post()).status,200);const rows=await h.store.all('SELECT * FROM usage_events');assert.equal(rows.length,1);assert.equal(rows[0].user_id,'trial-user');assert.equal(rows[0].mode,'training');
});

test('Reusing a configured provider code cannot bypass the selected tier price check through cache',async()=>{const h=harness();h.env.PAYSTACK_REGULAR_PLAN_CODE=h.env.PAYSTACK_MONTHLY_PLAN_CODE;await h.billing.getPlan('monthly');await assert.rejects(h.billing.getPlan('regular_monthly'),e=>e.code==='plan_unavailable');});

test('Processing events accept only counts/timings and are authenticated, tenant scoped and idempotent',async()=>{
  const h=harness();h.env.TRIAL_DAYS='7';const route=routes(h,{userId:'metrics-user',email:'metrics@example.com',displayName:'Metrics'}),id=webcrypto.randomUUID();
  const payload={id,operation:'export',outcome:'success',durationMs:100,rows:20,columns:3,timeToExportMs:1000};
  const request=(body=payload,origin='https://example.com')=>new Request('https://example.com/api/activity',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await route(request())).status,200);assert.equal((await route(request())).status,200);
  const rows=await h.store.all('SELECT * FROM processing_events');assert.equal(rows.length,1);assert.equal(rows[0].user_id,'metrics-user');assert.equal(rows[0].time_to_export_ms,1000);
  assert.equal((await route(request({...payload,id:webcrypto.randomUUID(),filename:'private.csv'}))).status,400);
  assert.equal((await route(request({...payload,id:webcrypto.randomUUID(),durationMs:-1}))).status,400);
  assert.equal((await route(request(payload,'https://evil.test'))).status,403);
  assert.equal((await routes(h,null)(request())).status,401);
  const other=routes(h,{userId:'other-metrics',email:'other@example.com',displayName:'Other'});assert.equal((await other(request())).status,409);
  assert.equal((await route(new Request('https://example.com/account'))).status,200);
});
