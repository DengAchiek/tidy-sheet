export const PREMIUM_PRICES={regular_monthly:1000,monthly:2000,annually:24000};
export const PLAN_CHOICES=['regular_monthly','monthly','annually'];
export class AppError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export function subscriptionAccess(account,subscription,now=Date.now(),mode='live'){
  const trial=Number(account?.trial_ends||0)>now;
  const paid=subscription?.billing_mode===mode&&Number(subscription?.last_paid_at||0)>Number(subscription?.revoked_at||0)&&Number(subscription?.period_end||0)>now&&['active','non-renewing','attention'].includes(subscription?.status);
  const tier=paid?(subscription.tier||'premium'):trial?'trial':'none';
  return {allowed:trial||paid,tier,business:trial||paid,training:trial||(paid&&tier==='premium'),source:paid?'subscription':trial?'trial':'none',expiresAt:paid?subscription.period_end:trial?account.trial_ends:null};
}
export function sameOrigin(request){
  const origin=request.headers.get('origin');
  if(!origin||origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'origin_rejected','Please reload this page and try again.');
}
export function safeProviderURL(value,hosts){
  let url;try{url=new URL(value);}catch{throw new AppError(502,'invalid_provider_url','The billing provider returned an invalid link.');}
  if(url.protocol!=='https:'||url.username||url.password||!hosts.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw new AppError(502,'invalid_provider_url','The billing provider returned an untrusted link.');
  return url.href;
}
export function validReference(value){return typeof value==='string'&&/^[A-Za-z0-9_.-]{8,120}$/.test(value);}
export function verifiedPayment(transaction,expected){
  let metadata=transaction?.metadata;if(typeof metadata==='string'){try{metadata=JSON.parse(metadata);}catch{metadata=null;}}
  if(transaction?.status!=='success')throw new AppError(409,'payment_pending','Payment is not confirmed yet. You can check again in a moment.');
  if(transaction.reference!==expected.reference||transaction.amount!==expected.amount||transaction.currency!==expected.currency||transaction.customer?.email?.toLowerCase()!==expected.email.toLowerCase()||metadata?.tidysheet_user_id!==expected.user_id)throw new AppError(409,'payment_mismatch','This payment does not match your subscription. Please contact billing support.');
  const paidAt=Date.parse(transaction.paid_at||transaction.paidAt||'');
  if(!Number.isFinite(paidAt))throw new AppError(502,'invalid_payment','The payment provider has not confirmed a payment date.');
  return {paidAt,customerCode:transaction.customer?.customer_code,customerId:transaction.customer?.id};
}
export function matchingSubscription(list,transaction,plan){
  return list.filter(s=>s.plan?.plan_code===plan.plan_code&&s.customer?.customer_code===transaction.customer?.customer_code&&s.authorization?.authorization_code===transaction.authorization?.authorization_code&&['active','non-renewing','attention'].includes(s.status)).sort((a,b)=>Date.parse(b.createdAt||b.created_at||0)-Date.parse(a.createdAt||a.created_at||0))[0]||null;
}
export function paidPeriod(subscription,paidAt,interval='monthly'){
  const end=Date.parse(subscription.next_payment_date||'');
  // An active subscription must have a plausible, explicit provider renewal date.
  if(!Number.isFinite(end)||end<=paidAt||end>paidAt+(interval==='annually'?370:35)*86400000)throw new AppError(409,'subscription_pending','Payment is received. The provider is still confirming your subscription; check again shortly.');
  return end;
}
export async function verifyWebhook(raw,signature,secret){
  if(!secret||!signature||!/^[a-f\d]{128}$/i.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-512'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),h=>parseInt(h,16));
  return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw));
}
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
export function publicSubscription(s){return s?{status:s.status,tier:s.tier||'premium',periodEnd:s.period_end,lastPaidAt:s.last_paid_at,amount:s.amount,currency:s.currency,canManage:Boolean(s.subscription_code),cancelAtPeriodEnd:s.status==='non-renewing'}:null;}
