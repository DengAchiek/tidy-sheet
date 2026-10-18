import {env} from 'cloudflare:workers';
import {all,first,run,database,subscriptionFor} from './store';
import {AppError,validReference,verifiedPayment,matchingSubscription,paidPeriod,safeProviderURL,verifyWebhook,digest,PREMIUM_PRICES,PLAN_CHOICES} from './policy.mjs';

type Plan={id:number,plan_code:string,name:string,amount:number,currency:string,interval:string,tier?:string};
const planCache=new Map<string,{expires:number,value:Plan}>();
export function billingReady(){return Boolean(env.PAYSTACK_SECRET_KEY&&(env.PAYSTACK_REGULAR_PLAN_CODE||env.PAYSTACK_MONTHLY_PLAN_CODE||env.PAYSTACK_ANNUAL_PLAN_CODE)&&env.APP_URL);}
export function billingMode(){return !env.PAYSTACK_SECRET_KEY?'unconfigured':env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';}
export function appOrigin(){let url;try{url=new URL(env.APP_URL||'');}catch{throw new AppError(503,'billing_not_ready','Subscription checkout is not available yet.');}if(url.protocol!=='https:'&&!(import.meta.env.DEV&&['localhost','127.0.0.1'].includes(url.hostname)))throw new AppError(503,'billing_not_ready','Subscription checkout is not available yet.');return url.origin;}
async function paystack(path:string,body?:unknown):Promise<any>{
  if(!env.PAYSTACK_SECRET_KEY)throw new AppError(503,'billing_not_ready','Subscription checkout is not available yet.');
  let response;try{response=await fetch('https://api.paystack.co'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.PAYSTACK_SECRET_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch{throw new AppError(502,'provider_unavailable','The payment provider is temporarily unavailable. Please try again shortly.');}
  const result:any=await response.json().catch(()=>null);
  if(!response.ok||!result?.status)throw new AppError(502,'provider_unavailable','The payment provider could not complete this request. Your access has not been changed.');
  return result.data;
}
export async function getPlan(cycle:string='monthly'):Promise<Plan|null>{
  if(!billingReady())return null;
  if(!PLAN_CHOICES.includes(cycle))throw new AppError(400,'invalid_cycle','Choose monthly or annual billing.');
  const code=cycle==='regular_monthly'?env.PAYSTACK_REGULAR_PLAN_CODE:cycle==='annually'?env.PAYSTACK_ANNUAL_PLAN_CODE:env.PAYSTACK_MONTHLY_PLAN_CODE,mode=billingMode();
  const interval=cycle==='regular_monthly'?'monthly':cycle;
  if(!code)return null;
  const cacheKey=mode+':'+cycle+':'+code,cached=planCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.value;
  const plan=await paystack('/plan/'+encodeURIComponent(code));
  if(plan.plan_code!==code||plan.interval!==interval||!Number.isInteger(plan.amount)||plan.amount!==PREMIUM_PRICES[cycle as keyof typeof PREMIUM_PRICES]||plan.currency!=='USD')throw new AppError(503,'plan_unavailable','This USD subscription plan is not available yet.');
  const value={id:plan.id,plan_code:code,name:plan.name,amount:plan.amount,currency:plan.currency,interval:plan.interval,tier:cycle==='regular_monthly'?'regular':'premium'};
  planCache.set(cacheKey,{expires:Date.now()+300000,value});return value;
}
export function displayPlan(plan:Plan|null,cycle='monthly'){return plan?{name:cycle==='regular_monthly'?'TidySheet Regular':'TidySheet Premium',amount:plan.amount,currency:plan.currency,interval:plan.interval==='annually'?'year':'month',cycle,mode:billingMode(),ready:true}:{name:cycle==='regular_monthly'?'TidySheet Regular':'TidySheet Premium',amount:PREMIUM_PRICES[cycle as keyof typeof PREMIUM_PRICES],currency:'USD',interval:cycle==='annually'?'year':'month',cycle,mode:null,ready:false};}
export async function getPlans(){return Promise.all([getPlan('regular_monthly'),getPlan('monthly'),getPlan('annually')]);}
async function planForCode(code:string){if(code===env.PAYSTACK_REGULAR_PLAN_CODE)return getPlan('regular_monthly');if(code===env.PAYSTACK_MONTHLY_PLAN_CODE)return getPlan('monthly');if(code===env.PAYSTACK_ANNUAL_PLAN_CODE)return getPlan('annually');return null;}
export async function initializeCheckout(account:any,cycle:string){
  const plan=await getPlan(cycle);if(!plan)throw new AppError(503,'billing_not_ready','Subscriptions are not open yet. You can try the sample while setup finishes.');
  const existingSub=await subscriptionFor(account.id);
  if(existingSub?.subscription_code&&existingSub.billing_mode===billingMode()&&!['cancelled','completed','none'].includes(existingSub.status))throw new AppError(409,'existing_subscription','You already have a subscription. Use Manage billing to update payment or cancel renewal.');
  const now=Date.now();
  let existing=await first("SELECT * FROM checkout_sessions WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",account.id);
  if(existing&&existing.billing_mode!==billingMode()){await run("UPDATE checkout_sessions SET status='expired' WHERE reference=?",existing.reference);throw new AppError(409,'checkout_expired','Billing mode changed. Please start checkout again.');}
  if(existing&&existing.created_at<now-30*60000){
    const timeout=await paystack('/integration/payment_session_timeout');
    if(Number(timeout.payment_session_timeout)>0&&now-existing.created_at>Number(timeout.payment_session_timeout)*1000+120000){
      const transaction=await paystack('/transaction/verify/'+encodeURIComponent(existing.reference));
      if(transaction.status==='success'){await verifyCheckout(existing.reference,account.id);throw new AppError(409,'existing_subscription','Payment was already received. Refresh your account to continue.');}
      if(['failed','abandoned','reversed'].includes(transaction.status)){await run("UPDATE checkout_sessions SET status='expired' WHERE reference=?",existing.reference);existing=null;}
    }
  }
  if(existing&&existing.plan_code!==plan.plan_code)throw new AppError(409,'pending_different_plan','You have a pending checkout for another billing cycle. Complete that checkout or wait for it to expire before changing plans.');
  if(existing?.checkout_url)return {url:existing.checkout_url};
  if(existing)throw new AppError(409,'checkout_pending','A checkout is being prepared. Wait a moment and try again.');
  const reference='tidy_'+crypto.randomUUID().replace(/-/g,'');
  try{await run("INSERT INTO checkout_sessions (reference,user_id,email,plan_code,amount,currency,billing_mode,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)",reference,account.id,account.email,plan.plan_code,plan.amount,plan.currency,billingMode(),now);}catch{throw new AppError(409,'checkout_pending','A checkout is already being prepared. Please try again shortly.');}
  try{
    const result=await paystack('/transaction/initialize',{email:account.email,amount:plan.amount,currency:plan.currency,plan:plan.plan_code,reference,callback_url:appOrigin()+'/account?checkout=return',channels:['card'],metadata:{tidysheet_user_id:account.id,custom_filters:{recurring:true}}});
    const url=safeProviderURL(result.authorization_url,['checkout.paystack.com']);
    await run('UPDATE checkout_sessions SET checkout_url=? WHERE reference=?',url,reference);return {url};
  }catch(error){await run("UPDATE checkout_sessions SET status='failed' WHERE reference=?",reference);throw error;}
}
async function recordPayment(transaction:any,subscription:any,userId:string,plan:Plan){
  const paidAt=Date.parse(transaction.paid_at||transaction.paidAt||'');
  const old=await subscriptionFor(userId);
  if(old?.billing_mode===billingMode()&&paidAt<old.last_paid_at)return;
  const periodEnd=paidPeriod(subscription,paidAt,plan.interval);
  if(old?.billing_mode===billingMode()&&paidAt<=old.revoked_at)throw new AppError(409,'payment_revoked','This payment has been refunded or disputed. Please contact billing support.');
  const now=Date.now();
  // Payment reference uniqueness and a monotonically increasing paid date make retries safe.
  await database().batch([
    database().prepare('INSERT INTO payment_receipts (reference,user_id,transaction_id,subscription_code,amount,currency,paid_at,billing_mode) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(reference) DO NOTHING').bind(transaction.reference,userId,String(transaction.id),subscription.subscription_code,transaction.amount,transaction.currency,paidAt,billingMode()),
    database().prepare(`INSERT INTO subscriptions (user_id,customer_code,subscription_code,plan_code,status,period_end,last_paid_at,revoked_at,amount,currency,verified_at,updated_at,billing_mode,tier) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET tier=excluded.tier,billing_mode=excluded.billing_mode,customer_code=excluded.customer_code,subscription_code=excluded.subscription_code,plan_code=excluded.plan_code,status=excluded.status,period_end=CASE WHEN subscriptions.billing_mode=excluded.billing_mode AND subscriptions.subscription_code=excluded.subscription_code THEN MAX(subscriptions.period_end,excluded.period_end) ELSE excluded.period_end END,last_paid_at=excluded.last_paid_at,amount=excluded.amount,currency=excluded.currency,verified_at=excluded.verified_at,updated_at=excluded.updated_at WHERE subscriptions.billing_mode<>excluded.billing_mode OR (excluded.last_paid_at>=subscriptions.last_paid_at AND excluded.last_paid_at>subscriptions.revoked_at)`).bind(userId,subscription.customer.customer_code,subscription.subscription_code,plan.plan_code,subscription.status,periodEnd,paidAt,transaction.amount,transaction.currency,now,now,billingMode(),plan.tier||'premium'),
    database().prepare("UPDATE checkout_sessions SET status='paid' WHERE reference=? AND user_id=?").bind(transaction.reference,userId),
  ]);
}
export async function verifyCheckout(reference:string,userId?:string){
  if(!validReference(reference))throw new AppError(400,'invalid_reference','This payment reference is invalid.');
  const checkout=await first('SELECT * FROM checkout_sessions WHERE reference=?'+(userId?' AND user_id=?':''),...userId?[reference,userId]:[reference]);
  if(checkout&&checkout.billing_mode!==billingMode())throw new AppError(409,'billing_mode_changed','This checkout belongs to a different billing mode. Start a new checkout.');
  if(!checkout)throw new AppError(404,'payment_not_found','This payment does not belong to your account.');
  const receipt=await first('SELECT reference FROM payment_receipts WHERE reference=? AND user_id=?',reference,checkout.user_id);
  if(receipt)return {confirmed:true};
  const plan=await planForCode(checkout.plan_code);if(!plan||plan.plan_code!==checkout.plan_code)throw new AppError(503,'plan_unavailable','This plan is temporarily unavailable.');
  const transaction=await paystack('/transaction/verify/'+encodeURIComponent(reference));
  const verified=verifiedPayment(transaction,checkout);
  if(!verified.customerCode||!Number.isInteger(verified.customerId))throw new AppError(502,'invalid_customer','The provider has not confirmed the billing account.');
  const subscriptions=await paystack('/subscription?customer='+verified.customerId+'&plan='+plan.id+'&perPage=100');
  const subscription=matchingSubscription(subscriptions,transaction,plan);
  if(!subscription)throw new AppError(409,'subscription_pending','Payment is received. Your subscription is still being confirmed; check again shortly.');
  await recordPayment(transaction,subscription,checkout.user_id,plan);return {confirmed:true};
}
export async function refreshSubscription(userId:string){
  const old=await subscriptionFor(userId);if(!old?.subscription_code||old.billing_mode!==billingMode()||!billingReady())return old;
  const remote=await paystack('/subscription/'+encodeURIComponent(old.subscription_code));
  if(remote.customer?.customer_code!==old.customer_code||remote.plan?.plan_code!==old.plan_code)throw new AppError(502,'subscription_mismatch','The provider could not verify this subscription.');
  // Status refresh never extends paid access. Only a verified payment can do that.
  await run("UPDATE subscriptions SET status=CASE WHEN status='revoked' THEN status ELSE ? END,verified_at=?,updated_at=? WHERE user_id=?",remote.status,Date.now(),Date.now(),userId);
  return subscriptionFor(userId);
}
export async function portal(userId:string){
  const subscription=await subscriptionFor(userId);if(!subscription?.subscription_code||subscription.billing_mode!==billingMode())throw new AppError(409,'no_subscription','There is no subscription to manage yet.');
  const result=await paystack('/subscription/'+encodeURIComponent(subscription.subscription_code)+'/manage/link');
  return {url:safeProviderURL(result.link,['paystack.com','paystack.co'])};
}
async function renew(reference:string,code?:string){
  if(!validReference(reference))return;
  const receipt=await first('SELECT reference FROM payment_receipts WHERE reference=?',reference);if(receipt)return;
  const checkout=await first('SELECT reference FROM checkout_sessions WHERE reference=?',reference);if(checkout){await verifyCheckout(reference);return;}
  const transaction=await paystack('/transaction/verify/'+encodeURIComponent(reference));
  const customer=transaction.customer?.customer_code;
  const old=code?await first('SELECT * FROM subscriptions WHERE subscription_code=?',code):await first('SELECT * FROM subscriptions WHERE customer_code=?',customer);
  if(!old||old.billing_mode!==billingMode()||old.customer_code!==customer)return;
  const plan=await planForCode(old.plan_code);if(!plan||plan.plan_code!==old.plan_code)return;
  const transactionPlan=transaction.plan_object?.plan_code||(typeof transaction.plan==='string'?transaction.plan:transaction.plan?.plan_code);
  if(transaction.status!=='success'||transactionPlan!==old.plan_code||transaction.amount!==old.amount||transaction.currency!==old.currency)throw new AppError(409,'renewal_mismatch','Subscription renewal could not be verified.');
  const remote=await paystack('/subscription/'+encodeURIComponent(old.subscription_code));
  if(remote.customer?.customer_code!==customer||remote.plan?.plan_code!==old.plan_code||remote.authorization?.authorization_code!==transaction.authorization?.authorization_code)throw new AppError(409,'renewal_mismatch','Subscription renewal does not match the billing account.');
  await recordPayment(transaction,remote,old.user_id,plan);
}
export async function processWebhook(request:Request){
  if(!env.PAYSTACK_SECRET_KEY)throw new AppError(503,'billing_not_ready','Billing is not configured.');
  if(Number(request.headers.get('content-length'))>262144)throw new AppError(413,'payload_too_large','Webhook too large.');
  const raw=await request.text();if(raw.length>262144)throw new AppError(413,'payload_too_large','Webhook too large.');
  if(!await verifyWebhook(raw,request.headers.get('x-paystack-signature'),env.PAYSTACK_SECRET_KEY))throw new AppError(401,'invalid_signature','Invalid webhook signature.');
  let event;try{event=JSON.parse(raw);}catch{throw new AppError(400,'invalid_json','Invalid webhook body.');}
  const eventId=await digest(raw);if(await first('SELECT id FROM webhook_events WHERE id=?',eventId))return {received:true};
  const data=event.data||{},code=data.subscription_code||data.subscription?.subscription_code;
  if(event.event==='charge.success')await renew(data.reference);
  else if(event.event==='invoice.update'&&data.paid&&data.transaction?.status==='success')await renew(data.transaction.reference,code);
  else if(event.event==='subscription.create'){
    const known=await first('SELECT user_id FROM subscriptions WHERE subscription_code=?',code||'');
    if(known)await refreshSubscription(known.user_id);
    else if(data.customer?.email&&[env.PAYSTACK_REGULAR_PLAN_CODE,env.PAYSTACK_MONTHLY_PLAN_CODE,env.PAYSTACK_ANNUAL_PLAN_CODE].includes(data.plan?.plan_code)){
      const pending=await first("SELECT reference FROM checkout_sessions WHERE lower(email)=lower(?) AND plan_code=? AND status='pending' ORDER BY created_at DESC LIMIT 1",data.customer.email,data.plan.plan_code);
      if(pending)await verifyCheckout(pending.reference);
    }
  }else if(['subscription.not_renew','subscription.disable','invoice.payment_failed'].includes(event.event)&&code){
    const known=await first('SELECT user_id FROM subscriptions WHERE subscription_code=?',code);if(known)await refreshSubscription(known.user_id);
  }else if(['refund.processed','charge.dispute.create'].includes(event.event)){
    const ref=data.transaction?.reference,transactionId=typeof data.transaction==='object'?data.transaction?.id:data.transaction;
    const receipt=ref?await first('SELECT * FROM payment_receipts WHERE reference=?',ref):await first('SELECT * FROM payment_receipts WHERE transaction_id=?',String(transactionId||''));
    if(receipt&&(event.event==='charge.dispute.create'||Number(data.amount)>=receipt.amount))await run("UPDATE subscriptions SET status='revoked',revoked_at=?,updated_at=? WHERE user_id=? AND subscription_code=?",Date.now(),Date.now(),receipt.user_id,receipt.subscription_code);
  }
  await run('INSERT INTO webhook_events (id,processed_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING',eventId,Date.now());
  return {received:true};
}
