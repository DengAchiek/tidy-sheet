import {scrypt,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {database,first,run} from './store';
import {AppError} from './policy.mjs';
import {env} from 'cloudflare:workers';

export type User={userId:string,email:string,displayName:string,fullName:string|null,authSource?:'password'|'chatgpt'};
const AGE=7*86400000;
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function cookie(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
function sessionName(request:Request){return new URL(request.url).protocol==='https:'?'__Host-tidysheet':'tidysheet-dev';}
export function sessionCookie(request:Request,token:string,age=AGE/1000){return sessionName(request)+'='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(new URL(request.url).protocol==='https:'?'; Secure':'');}
export async function currentUser(request:Request):Promise<User|null>{
  const token=cookie(request,sessionName(request));
  if(/^[a-f0-9]{64}$/.test(token)){
    const row=await first('SELECT a.id,a.email,a.name FROM auth_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',digest(token),Date.now());
    if(row)return {userId:row.id,email:row.email,displayName:row.name,fullName:row.name,authSource:'password'};
  }
  const native=await getChatGPTUser();return native?{...native,authSource:'chatgpt'}:null;
}
// Email is a login identifier, not proof of ownership. It never grants an admin role.
export async function isAdmin(user:User|null){return !!user&&!!await first('SELECT user_id FROM administrators WHERE user_id=?',user.userId);}
export async function requireAdmin(request:Request){const user=await currentUser(request);if(!user)throw new AppError(401,'sign_in_required','Sign in to continue.');if(!await isAdmin(user))throw new AppError(403,'admin_required','Administrator access is required.');return user;}
export async function claimAdmin(request:Request,body:any){
  const user=await currentUser(request);if(!user)throw new AppError(401,'sign_in_required','Sign in before activating administrator access.');
  await rateLimit(request,'admin-claim',user.userId,5);
  const code=typeof body.code==='string'?body.code.trim():'';
  if(!env.ADMIN_INVITE_EMAIL||!env.ADMIN_INVITE_HASH||user.email.toLowerCase()!==env.ADMIN_INVITE_EMAIL.toLowerCase()||! /^[a-f0-9]{40}$/.test(code)||! /^[a-f0-9]{64}$/.test(env.ADMIN_INVITE_HASH)||!timingSafeEqual(Buffer.from(digest(code),'hex'),Buffer.from(env.ADMIN_INVITE_HASH,'hex')))throw new AppError(403,'invalid_invitation','The setup code is invalid or this account was not invited.');
  if(await first('SELECT invite_hash FROM admin_invite_claims WHERE invite_hash=?',env.ADMIN_INVITE_HASH))throw new AppError(409,'invitation_used','This setup code has already been used.');
  if(await first('SELECT token_hash FROM admin_invitations WHERE source_hash=?',env.ADMIN_INVITE_HASH))throw new AppError(409,'invitation_replaced','Use the private registration link. It replaces the old setup code.');
  const db=database(),now=Date.now(),results=await db.batch([db.prepare('INSERT INTO admin_invite_claims (invite_hash,user_id,created_at) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM admin_invitations WHERE source_hash=?)').bind(env.ADMIN_INVITE_HASH,user.userId,now,env.ADMIN_INVITE_HASH),db.prepare('INSERT INTO administrators (user_id,created_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_invite_claims WHERE invite_hash=? AND user_id=?) ON CONFLICT(user_id) DO NOTHING').bind(user.userId,now,env.ADMIN_INVITE_HASH,user.userId)]);
  if(!results[0].meta.changes)throw new AppError(409,'invitation_replaced','Use the private registration link.');
  return {activated:true};
}
export async function issueAdminInvitation(request:Request,body:any){
  const code=typeof body.code==='string'?body.code.trim():'';await rateLimit(request,'admin-invite-create',code,5);
  if(!env.ADMIN_INVITE_EMAIL||!env.ADMIN_INVITE_HASH||! /^[a-f0-9]{40}$/.test(code)||! /^[a-f0-9]{64}$/.test(env.ADMIN_INVITE_HASH)||!timingSafeEqual(Buffer.from(digest(code),'hex'),Buffer.from(env.ADMIN_INVITE_HASH,'hex')))throw new AppError(403,'invalid_invitation','Invalid administrator setup code.');
  const token=randomBytes(32).toString('hex'),now=Date.now(),expiresAt=now+24*3600000;
  const created=await first('INSERT INTO admin_invitations (token_hash,source_hash,email,expires_at,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM admin_invite_claims WHERE invite_hash=?) AND NOT EXISTS (SELECT 1 FROM admin_invitations WHERE source_hash=?) RETURNING token_hash',digest(token),env.ADMIN_INVITE_HASH,env.ADMIN_INVITE_EMAIL.trim().toLowerCase(),expiresAt,now,env.ADMIN_INVITE_HASH,env.ADMIN_INVITE_HASH);
  if(!created)throw new AppError(409,'invitation_unavailable','This setup invitation has already been used or replaced.');
  return {token,email:env.ADMIN_INVITE_EMAIL.trim().toLowerCase(),expiresAt};
}
async function invitationFor(token:unknown,email?:string){
  if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw new AppError(403,'invalid_invitation','This private registration link is invalid.');
  const row=await first('SELECT * FROM admin_invitations WHERE token_hash=?',digest(token));
  if(!row||row.source_hash!==env.ADMIN_INVITE_HASH||row.email!==env.ADMIN_INVITE_EMAIL?.trim().toLowerCase()||(email&&row.email!==email))throw new AppError(403,'invalid_invitation','This link is invalid or the email address does not match the invitation.');
  if(row.used_at!==null)throw new AppError(410,'invitation_used','This link has already been used. Sign in to your administrator account.');
  if(row.expires_at<=Date.now())throw new AppError(410,'invitation_expired','This private registration link has expired.');
  return row;
}
export async function inspectAdminInvitation(request:Request,body:any){await rateLimit(request,'admin-invite-view',typeof body.token==='string'?body.token:'',30);const row=await invitationFor(body.token);return {email:row.email,expiresAt:row.expires_at};}
async function activateInvitation(userId:string,email:string,token:unknown){
  const invite=await invitationFor(token,email),now=Date.now(),db=database();
  const results=await db.batch([db.prepare('UPDATE admin_invitations SET used_at=?,used_by=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,userId,invite.token_hash,now),db.prepare('INSERT INTO administrators (user_id,created_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_invitations WHERE token_hash=? AND used_by=? AND used_at=?) ON CONFLICT(user_id) DO NOTHING').bind(userId,now,invite.token_hash,userId,now),db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM admin_invitations WHERE token_hash=? AND used_by=? AND used_at=?)').bind(userId,invite.token_hash,userId,now)]);
  if(!results[0].meta.changes)throw new AppError(410,'invitation_used','This registration link has expired or already been used.');
}
function normalizeEmail(value:unknown){if(typeof value!=='string')throw new AppError(400,'invalid_email','Enter a valid email address.');const email=value.trim().toLowerCase();if(email.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw new AppError(400,'invalid_email','Enter a valid email address.');return email;}
function password(value:unknown){if(typeof value!=='string'||value.length<15||value.length>128)throw new AppError(400,'invalid_password','Use a password between 15 and 128 characters. A phrase works well.');return value;}
function derive(value:string,salt:string):Promise<Buffer>{return new Promise((resolve,reject)=>scrypt(value,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024},(e,key)=>e?reject(e):resolve(key)));}
export async function hashPassword(value:string){const salt=randomBytes(16).toString('hex');return 'scrypt:16384:8:5:'+salt+':'+(await derive(value,salt)).toString('hex');}
export async function verifyPassword(value:string,encoded:string){const parts=encoded.split(':');if(parts.length!==6||parts.slice(0,4).join(':')!=='scrypt:16384:8:5'||! /^[a-f0-9]{32}$/.test(parts[4])||! /^[a-f0-9]{64}$/.test(parts[5]))return false;return timingSafeEqual(await derive(value,parts[4]),Buffer.from(parts[5],'hex'));}
export async function rateLimit(request:Request,scope:string,identifier:string,max=10){
  const now=Date.now(),window=Math.floor(now/900000),ip=request.headers.get('cf-connecting-ip');
  const keys=[scope+':identity:'+digest(identifier)+':'+window];if(ip)keys.push(scope+':network:'+digest(window+':'+ip)+':'+window);
  for(const key of keys){const result=await first('INSERT INTO auth_rate_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts',key,(window+1)*900000);if(result.attempts>(key.includes(':network:')?max*5:max))throw new AppError(429,'too_many_attempts','Too many attempts. Please try again in 15 minutes.');}
  await run('DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at<? LIMIT 100)',now);
}
async function newSession(request:Request,userId:string){
  const token=randomBytes(32).toString('hex'),now=Date.now();
  await run('DELETE FROM auth_sessions WHERE expires_at<?',now);
  const previous=cookie(request,sessionName(request));if(previous)await run('DELETE FROM auth_sessions WHERE token_hash=?',digest(previous));
  await run('INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',digest(token),userId,now+AGE,now);
  return sessionCookie(request,token);
}
export async function register(request:Request,body:any){
  const email=normalizeEmail(body.email),secret=password(body.password),name=typeof body.name==='string'?body.name.trim():'';
  if(body.confirmPassword!==undefined&&body.confirmPassword!==secret)throw new AppError(400,'password_mismatch','Passwords do not match.');
  if(name.length<2||name.length>80)throw new AppError(400,'invalid_name','Enter your name, between 2 and 80 characters.');
  await rateLimit(request,'register',email,5);
  const invite=body.adminInvitation===undefined?null:await invitationFor(body.adminInvitation,email);
  const encoded=await hashPassword(secret);
  if(await first('SELECT user_id FROM auth_credentials WHERE email=?',email))throw new AppError(409,'account_unavailable','Unable to register this email. Try signing in or use your recovery code.');
  const userId='local:'+crypto.randomUUID(),now=Date.now(),recovery=randomBytes(20).toString('hex'),db=database();
  if(invite){
    const results=await db.batch([
      db.prepare('INSERT INTO accounts (id,email,name,created_at,trial_ends) SELECT ?,?,?,?,0 WHERE EXISTS (SELECT 1 FROM admin_invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?)').bind(userId,email,name,now,invite.token_hash,now),
      db.prepare('INSERT INTO auth_credentials (user_id,email,password_hash,recovery_hash) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM accounts WHERE id=?)').bind(userId,email,encoded,digest(recovery),userId),
      db.prepare('UPDATE admin_invitations SET used_at=?,used_by=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM accounts WHERE id=?)').bind(now,userId,invite.token_hash,now,userId),
      db.prepare('INSERT INTO administrators (user_id,created_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_invitations WHERE token_hash=? AND used_by=?)').bind(userId,now,invite.token_hash,userId),
    ]);
    if(!results[0].meta.changes)throw new AppError(410,'invitation_used','This registration link has expired or already been used.');
  }else await db.batch([
    db.prepare('INSERT INTO accounts (id,email,name,created_at,trial_ends) VALUES (?,?,?,?,0)').bind(userId,email,name,now),
    db.prepare('INSERT INTO auth_credentials (user_id,email,password_hash,recovery_hash) VALUES (?,?,?,?)').bind(userId,email,encoded,digest(recovery)),
  ]);
  return {user:{userId,email,displayName:name,fullName:name,authSource:'password' as const},setCookie:await newSession(request,userId),recoveryCode:recovery};
}
export async function login(request:Request,body:any){
  const email=normalizeEmail(body.email),secret=typeof body.password==='string'&&body.password.length<=128?body.password:'';
  await rateLimit(request,'login',email);
  const row=await first('SELECT c.*,a.name FROM auth_credentials c JOIN accounts a ON a.id=c.user_id WHERE c.email=?',email);
  // Same expensive derivation for unknown accounts to avoid an email timing oracle.
  const encoded=row?.password_hash||'scrypt:16384:8:5:00000000000000000000000000000000:'+'0'.repeat(64);
  if(!await verifyPassword(secret,encoded)||!row)throw new AppError(401,'invalid_credentials','Email or password is incorrect.');
  if(body.adminInvitation!==undefined)await activateInvitation(row.user_id,email,body.adminInvitation);
  return {user:{userId:row.user_id,email,displayName:row.name,fullName:row.name,authSource:'password' as const},setCookie:await newSession(request,row.user_id)};
}
export async function recover(request:Request,body:any){
  const email=normalizeEmail(body.email),secret=password(body.password);await rateLimit(request,'recover',email,5);
  if(body.confirmPassword!==undefined&&body.confirmPassword!==secret)throw new AppError(400,'password_mismatch','New passwords do not match.');
  const row=await first('SELECT * FROM auth_credentials WHERE email=?',email),code=typeof body.recoveryCode==='string'?body.recoveryCode.trim():'';
  if(!row||! /^[a-f0-9]{40}$/.test(code)||!timingSafeEqual(Buffer.from(digest(code),'hex'),Buffer.from(row.recovery_hash,'hex')))throw new AppError(401,'invalid_recovery','Email or recovery code is incorrect.');
  const next=randomBytes(20).toString('hex'),encoded=await hashPassword(secret),db=database();
  const results=await db.batch([db.prepare('UPDATE auth_credentials SET password_hash=?,recovery_hash=? WHERE user_id=? AND recovery_hash=?').bind(encoded,digest(next),row.user_id,row.recovery_hash),db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_credentials WHERE user_id=? AND recovery_hash=?)').bind(row.user_id,row.user_id,digest(next))]);
  if(!results[0].meta.changes)throw new AppError(401,'invalid_recovery','Email or recovery code is incorrect.');
  return {setCookie:sessionCookie(request,'',0),recoveryCode:next};
}
export async function changePassword(request:Request,body:any){
  const user=await currentUser(request);if(!user)throw new AppError(401,'sign_in_required','Sign in to change your password.');
  if(user.authSource!=='password')throw new AppError(403,'external_identity','Manage your password through the account you used to sign in.');
  await rateLimit(request,'password-change',user.userId,5);
  const secret=password(body.password),current=typeof body.currentPassword==='string'&&body.currentPassword.length<=128?body.currentPassword:'';
  if(body.confirmPassword!==secret)throw new AppError(400,'password_mismatch','New passwords do not match.');
  const row=await first('SELECT * FROM auth_credentials WHERE user_id=?',user.userId);
  if(!row||!await verifyPassword(current,row.password_hash))throw new AppError(401,'incorrect_password','Your current password is incorrect. Use Forgot password if you cannot remember it.');
  if(current===secret)throw new AppError(400,'password_unchanged','Choose a different password.');
  const encoded=await hashPassword(secret),recovery=randomBytes(20).toString('hex'),token=randomBytes(32).toString('hex'),now=Date.now(),db=database();
  const results=await db.batch([
    db.prepare('UPDATE auth_credentials SET password_hash=?,recovery_hash=? WHERE user_id=? AND password_hash=?').bind(encoded,digest(recovery),user.userId,row.password_hash),
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_credentials WHERE user_id=? AND password_hash=?)').bind(user.userId,user.userId,encoded),
    db.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM auth_credentials WHERE user_id=? AND password_hash=?)').bind(digest(token),user.userId,now+AGE,now,user.userId,encoded),
  ]);
  if(!results[0].meta.changes)throw new AppError(409,'credentials_changed','Your password has changed. Sign in again before retrying.');
  return {setCookie:sessionCookie(request,token),recoveryCode:recovery};
}
export async function logout(request:Request){const token=cookie(request,sessionName(request));if(token)await run('DELETE FROM auth_sessions WHERE token_hash=?',digest(token));return sessionCookie(request,'',0);}
