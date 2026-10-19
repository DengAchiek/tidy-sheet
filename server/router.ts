import {getChatGPTUser} from '../app/chatgpt-auth';
import {accountFor,subscriptionFor,first,all,run} from './store';
import {AppError,sameOrigin,subscriptionAccess,publicSubscription,PLAN_CHOICES} from './policy.mjs';
import {getPlans,displayPlan,billingMode,billingReady,initializeCheckout,portal,verifyCheckout,refreshSubscription,processWebhook} from './billing';
import {landingPage,cleanerPage,privacyPage,signInPage,accountPage,choosePage,trainingPage,esc} from './render';
const secureHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'SAMEORIGIN'};
const json=(value:any,status=200)=>Response.json(value,{status,headers:secureHeaders});
const html=(body:string,status=200)=>new Response(body,{status,headers:{...secureHeaders,'Content-Type':'text/html; charset=utf-8'}});
const redirect=(path:string)=>new Response(null,{status:303,headers:{...secureHeaders,Location:path}});
async function readJSON(request:Request){if(Number(request.headers.get('content-length'))>4096)throw new AppError(413,'payload_too_large','Request too large.');const raw=await request.text();if(raw.length>4096)throw new AppError(413,'payload_too_large','Request too large.');try{return JSON.parse(raw);}catch{throw new AppError(400,'invalid_request','Please reload the page and try again.');}}
async function userAccount(){const user=await getChatGPTUser();if(!user)throw new AppError(401,'sign_in_required','Sign in to continue.');return {user,account:await accountFor(user)};}
async function safePlans(){try{return {plans:await getPlans(),notice:''};}catch{return {plans:[null,null,null],notice:'Subscription checkout is temporarily unavailable. Please try again later.'};}}
export async function handleRequest(request:Request):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/billing/webhook'&&request.method==='POST')return json(await processWebhook(request));
    if(request.method==='POST')sameOrigin(request);
    if(request.method==='GET'&&['/','/index.html'].includes(path))return html(landingPage(await getChatGPTUser(),[]));
    if(request.method==='GET'&&path==='/choose')return html(choosePage(await getChatGPTUser()));
    if(request.method==='GET'&&path==='/training'){
      const user=await getChatGPTUser();if(!user)return redirect('/account');const account=await accountFor(user),sub=await subscriptionFor(user.userId),access=subscriptionAccess(account,sub,Date.now(),billingMode());
      if(!access.training)return redirect('/account?access=training');return html(trainingPage(user,access));
    }
    if(request.method==='GET'&&path==='/privacy.html')return html(privacyPage(await getChatGPTUser()));
    if(request.method==='GET'&&['/cleaner','/sheet-cleaner.html'].includes(path)){
      return html(cleanerPage(await getChatGPTUser(),{allowed:true,business:true,training:false,source:'public'},false));
    }
    if(request.method==='GET'&&path==='/account'){
      const user=await getChatGPTUser(),{plans,notice:planNotice}=await safePlans();
      if(!user)return html(signInPage(plans));
      const account=await accountFor(user);let subscription=await subscriptionFor(user.userId),notice=planNotice;
      if(subscription?.billing_mode!==billingMode())subscription=null;
      if(subscription?.subscription_code&&billingReady())try{subscription=await refreshSubscription(user.userId);}catch{notice='Billing status could not be refreshed. Your recorded paid access is unchanged.';}
      if(url.searchParams.get('access')==='training')notice='Training dataset preparation requires Premium or an active free trial. Regular includes business cleaning.';
      const access=subscriptionAccess(account,subscription,Date.now(),billingMode()),now=new Date(),start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
      const usage=await first('SELECT count(*) AS runs,coalesce(sum(row_count),0) AS rows FROM usage_events WHERE user_id=? AND created_at>=?',user.userId,start);
      const recent=await all('SELECT row_count,column_count,created_at,mode FROM usage_events WHERE user_id=? ORDER BY created_at DESC LIMIT 8',user.userId);
      const processing=await first("SELECT count(*) AS attempts,sum(CASE WHEN operation='export' AND outcome='success' THEN 1 ELSE 0 END) AS exports,sum(CASE WHEN outcome='failure' THEN 1 ELSE 0 END) AS failures,avg(CASE WHEN operation='clean' AND outcome='success' THEN duration_ms END) AS clean_ms,avg(time_to_export_ms) AS first_export_ms,count(DISTINCT CASE WHEN outcome='success' AND operation IN ('clean','export') THEN strftime('%Y-%W',created_at/1000,'unixepoch') END) AS active_weeks FROM processing_events WHERE user_id=? AND created_at>=?",user.userId,Date.now()-56*86400000);
      return html(accountPage(user,account,subscription,access,usage,plans,recent,notice,processing));
    }
    if(request.method==='GET'&&path==='/api/session'){
      const user=await getChatGPTUser();if(!user)return json({user:null,access:{allowed:false,source:'none'}});
      const account=await accountFor(user),sub=await subscriptionFor(user.userId);
      return json({user:{name:user.displayName,email:user.email},access:subscriptionAccess(account,sub,Date.now(),billingMode()),subscription:publicSubscription(sub)});
    }
    if(request.method==='GET'&&path==='/api/plans'){const plans=await getPlans();return json({plans:plans.map((p,i)=>displayPlan(p,PLAN_CHOICES[i]))});}
    if(request.method==='POST'&&path==='/api/billing/checkout'){const {account}=await userAccount(),body=await readJSON(request);if(!PLAN_CHOICES.includes(body.cycle))throw new AppError(400,'invalid_cycle','Choose monthly or annual billing.');return json(await initializeCheckout(account,body.cycle));}
    if(request.method==='POST'&&path==='/api/trial'){const {user}=await userAccount();await run('UPDATE accounts SET trial_ends=? WHERE id=? AND trial_ends=0',Date.now()+7*86400000,user.userId);return json({started:true});}
    if(request.method==='POST'&&path==='/api/billing/portal'){const {user}=await userAccount();return json(await portal(user.userId));}
    if(request.method==='POST'&&path==='/api/billing/verify'){const {user}=await userAccount(),body=await readJSON(request);return json(await verifyCheckout(body.reference,user.userId));}
    if(request.method==='POST'&&path==='/api/billing/refresh'){const {user}=await userAccount();await refreshSubscription(user.userId);return json({refreshed:true});}
    if(request.method==='POST'&&path==='/api/activity'){
      const {user,account}=await userAccount(),body=await readJSON(request),access=subscriptionAccess(account,await subscriptionFor(user.userId),Date.now(),billingMode()),mode=body.mode||'business';
      if(!(mode==='training'?access.training:mode==='business'&&access.business))throw new AppError(402,'subscription_required','An active workspace is required.');
      const permitted=['id','mode','operation','outcome','durationMs','rows','columns','timeToExportMs'];
      if(Object.keys(body).some(key=>!permitted.includes(key))||typeof body.id!=='string'||!/^[a-f\d-]{36}$/i.test(body.id)||!['import','clean','export'].includes(body.operation)||!['success','failure','cancelled'].includes(body.outcome)||!Number.isInteger(body.durationMs)||body.durationMs<0||body.durationMs>86400000||!Number.isInteger(body.rows)||body.rows<0||body.rows>100000||!Number.isInteger(body.columns)||body.columns<1||body.columns>100||body.rows*body.columns>1000000||!(body.timeToExportMs==null||(body.operation==='export'&&body.outcome==='success'&&Number.isInteger(body.timeToExportMs)&&body.timeToExportMs>=0&&body.timeToExportMs<=86400000)))throw new AppError(400,'invalid_metrics','Only bounded processing counts and timings are accepted.');
      const existing=await first('SELECT user_id FROM processing_events WHERE id=?',body.id);if(existing&&existing.user_id!==user.userId)throw new AppError(409,'request_conflict','Please retry.');
      await run('INSERT INTO processing_events (id,user_id,mode,operation,outcome,duration_ms,row_count,column_count,time_to_export_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',body.id,user.userId,mode,body.operation,body.outcome,body.durationMs,body.rows,body.columns,body.timeToExportMs??null,Date.now());return json({recorded:true});
    }
    if(request.method==='POST'&&path==='/api/usage/clean'){
      const {user,account}=await userAccount(),sub=await subscriptionFor(user.userId),body=await readJSON(request),mode=body.mode||'business';
      if(!['business','training'].includes(mode))throw new AppError(400,'invalid_mode','Choose a valid workspace.');
      const access=subscriptionAccess(account,sub,Date.now(),billingMode());
      if(!(mode==='training'?access.training:access.business))throw new AppError(402,'subscription_required',mode==='training'?'Training preparation requires Premium or an active trial.':'Your access has ended. Choose a plan to continue.');
      const rows=body.rows,columns=body.columns;
      if(!Number.isInteger(rows)||rows<1||rows>100000||!Number.isInteger(columns)||columns<1||columns>100||rows*columns>1000000)throw new AppError(400,'invalid_dimensions','This file exceeds the supported size.');
      if(typeof body.id!=='string'||!/^[a-f\d-]{36}$/i.test(body.id))throw new AppError(400,'invalid_request','Please retry cleaning your file.');
      const existing=await first('SELECT user_id FROM usage_events WHERE id=?',body.id);if(existing&&existing.user_id!==user.userId)throw new AppError(409,'request_conflict','Please retry.');
      await run('INSERT INTO usage_events (id,user_id,row_count,column_count,created_at,mode) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',body.id,user.userId,rows,columns,Date.now(),mode);
      return json({authorized:true});
    }
    return json({error:'not_found',message:'Page not found.'},404);
  }catch(error){
    const known=error instanceof AppError,status=known?error.status:500,message=known?error.message:'This service is temporarily unavailable. Please try again shortly.';
    if(!known)console.error('TidySheet request failed:',error instanceof Error?error.message:'Unknown error');
    if(!path.startsWith('/api/'))return html(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TidySheet</title><link rel="stylesheet" href="/assets/styles.css?v=2.0.0"><main class="container privacy-content"><h1>Please try again shortly.</h1><p>${esc(message)}</p><a href="/">Back to TidySheet</a></main></html>`,status);
    return json({error:known?error.code:'service_unavailable',message},status);
  }
}
