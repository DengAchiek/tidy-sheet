import {env} from 'cloudflare:workers';
import {AppError} from './policy.mjs';

export function recoveryEmailReady(){
  const from=env.RECOVERY_EMAIL_FROM?.trim();
  return !!env.RESEND_API_KEY&&!!from&&from.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from);
}
export function requireRecoveryEmail(){
  if(!recoveryEmailReady())throw new AppError(503,'email_recovery_unavailable','Password reset emails are being set up. Please contact the site owner for help.');
}
export async function sendRecoveryEmail(email:string,token:string,request:Request){
  requireRecoveryEmail();
  const origin=new URL(env.APP_URL||new URL(request.url).origin);
  if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)))throw Error('Password reset origin must use HTTPS.');
  if(origin.username||origin.password)throw Error('Password reset origin cannot include credentials.');
  const link=new URL('/reset-password',origin.origin);link.hash='token='+token;
  const text=`Reset your TidySheet password\n\nOpen this private link to choose a new password:\n${link.href}\n\nThis link expires in 10 minutes and works once. If you requested more than one email, use the newest link.\n\nYour password has not changed. If you did not request this email, ignore it. Never share this link with anyone. This reset does not grant administrator access.`;
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',signal:AbortSignal.timeout(10000),redirect:'error',
    headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'tidysheet-password-reset-'+crypto.randomUUID()},
    body:JSON.stringify({from:'TidySheet <'+env.RECOVERY_EMAIL_FROM!.trim()+'>',to:[email],subject:'Reset your TidySheet password',text}),
  });
  // Never log provider bodies, recipient addresses, or reset tokens.
  if(!response.ok)throw Error('Password reset email provider rejected the request.');
  const result=await response.json() as {id?:string};
  if(typeof result.id!=='string'||!result.id)throw Error('Password reset email provider did not accept the message.');
}
