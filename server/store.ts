import {env} from 'cloudflare:workers';
import {AppError} from './policy.mjs';
export function database(){if(!env.DB)throw new AppError(503,'database_unavailable','Accounts are temporarily unavailable. Please try again shortly.');return env.DB;}
export async function first<T=any>(sql:string,...args:any[]):Promise<T|null>{return database().prepare(sql).bind(...args).first<T>();}
export async function all<T=any>(sql:string,...args:any[]):Promise<T[]>{const r=await database().prepare(sql).bind(...args).all<T>();return r.results;}
export async function run(sql:string,...args:any[]){return database().prepare(sql).bind(...args).run();}
export async function accountFor(user:{userId:string,email:string,displayName:string}){
  const now=Date.now();const days=Math.min(30,Math.max(0,Number(env.TRIAL_DAYS??7)||0));
  await run('INSERT INTO accounts (id,email,name,created_at,trial_ends) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name',user.userId,user.email,user.displayName,now,days?now+days*86400000:0);
  return (await first('SELECT * FROM accounts WHERE id=?',user.userId))!;
}
export async function subscriptionFor(userId:string){return first('SELECT * FROM subscriptions WHERE user_id=?',userId);}
