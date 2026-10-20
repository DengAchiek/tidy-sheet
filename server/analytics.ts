import {first,all,run,accountFor} from './store';
import {cookie,rateLimit,User} from './auth';
import {AppError} from './policy.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PATHS=['/','/index.html','/sheet-cleaner.html','/cleaner','/choose','/training','/account','/account/security','/forgot-password','/reset-password','/login','/register','/admin','/admin/register','/admin/setup','/privacy.html','/reviews','/admin/reviews'];
function visitorCookie(id:string,request:Request){return 'tidysheet-visitor='+id+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'+(new URL(request.url).protocol==='https:'?'; Secure':'');}
export async function telemetry(request:Request,body:any,user:User|null){
  const keys=['id','kind','path','sample','outcome','durationMs','rows','columns'];
  if(!body||Object.keys(body).some(k=>!keys.includes(k))||!UUID.test(body.id)||!['page_view','import','clean','export'].includes(body.kind)||!PATHS.includes(body.path)||typeof body.sample!=='boolean'||!['success','failure','cancelled'].includes(body.outcome))throw new AppError(400,'invalid_event','Invalid activity event.');
  if(body.kind!=='page_view'&&!body.sample&&!user)throw new AppError(401,'sign_in_required','Sign in before using your own file.');
  if(body.kind!=='page_view'&&(!Number.isInteger(body.durationMs)||body.durationMs<0||body.durationMs>86400000||!Number.isInteger(body.rows)||body.rows<0||body.rows>100000||!Number.isInteger(body.columns)||body.columns<0||body.columns>100||body.rows*body.columns>1000000))throw new AppError(400,'invalid_metrics','Only bounded processing counts and timings are accepted.');
  const raw=cookie(request,'tidysheet-visitor'),id=UUID.test(raw)?raw:crypto.randomUUID();
  await rateLimit(request,'telemetry',id,180);
  if(user)await accountFor(user);
  await run('INSERT INTO site_events (id,visitor_id,user_id,kind,path,sample,outcome,duration_ms,row_count,column_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',body.id,id,user?.userId||null,body.kind,body.path,body.sample?1:0,body.outcome,body.kind==='page_view'?null:body.durationMs,body.kind==='page_view'?null:body.rows,body.kind==='page_view'?null:body.columns,Date.now());
  // Analytics retention is 90 days; every write removes a bounded batch.
  await run('DELETE FROM site_events WHERE id IN (SELECT id FROM site_events WHERE created_at<? LIMIT 1000)',Date.now()-90*86400000);
  return {setCookie:visitorCookie(id,request)};
}
export async function authEvent(request:Request,user:User,kind:string){
  const visitor=cookie(request,'tidysheet-visitor');
  await run('INSERT INTO site_events (id,visitor_id,user_id,kind,path,sample,outcome,created_at) VALUES (?,?,?,?,?,0,?,?)',crypto.randomUUID(),UUID.test(visitor)?visitor:null,user.userId,kind,'/account','success',Date.now());
}
export async function dashboard(days:number){
  if(![7,30,90].includes(days))throw new AppError(400,'invalid_range','Choose 7, 30 or 90 days.');
  const today=new Date();today.setUTCHours(0,0,0,0);const since=today.getTime()-(days-1)*86400000,until=today.getTime()+86400000;
  const [traffic,operations,accounts,trends,pages,recent]=await Promise.all([
    first("SELECT count(DISTINCT CASE WHEN kind='page_view' THEN visitor_id END) AS visitors,sum(CASE WHEN kind='page_view' THEN 1 ELSE 0 END) AS pageViews,count(DISTINCT user_id) AS activeAccounts FROM site_events WHERE created_at>=? AND created_at<?",since,until),
    all("SELECT kind,outcome,sample,count(*) AS count,avg(duration_ms) AS averageMs FROM site_events WHERE created_at>=? AND created_at<? AND kind IN ('import','clean','export') GROUP BY kind,outcome,sample",since,until),
    first('SELECT count(*) AS total,sum(CASE WHEN created_at>=? AND created_at<? THEN 1 ELSE 0 END) AS newAccounts FROM accounts',since,until),
    all("SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') AS date,count(DISTINCT CASE WHEN kind='page_view' THEN visitor_id END) AS visitors,sum(CASE WHEN kind='page_view' THEN 1 ELSE 0 END) AS pageViews,sum(CASE WHEN kind='clean' AND outcome='success' AND sample=0 THEN 1 ELSE 0 END) AS cleanings FROM site_events WHERE created_at>=? AND created_at<? GROUP BY date ORDER BY date",since,until),
    all("SELECT path,count(*) AS views,count(DISTINCT visitor_id) AS visitors FROM site_events WHERE kind='page_view' AND created_at>=? AND created_at<? GROUP BY path ORDER BY views DESC LIMIT 10",since,until),
    all('SELECT e.kind,e.path,e.sample,e.outcome,e.duration_ms,e.row_count,e.column_count,e.created_at,CASE WHEN e.user_id IS NULL THEN 0 ELSE 1 END AS signed_in FROM site_events e WHERE e.created_at>=? AND e.created_at<? ORDER BY e.created_at DESC LIMIT 40',since,until),
  ]);
  const byDate=new Map(trends.map(r=>[r.date,r]));
  return {days,since,until,generatedAt:Date.now(),traffic,operations,accounts,trends:Array.from({length:days},(_,i)=>{const date=new Date(since+i*86400000).toISOString().slice(0,10);return byDate.get(date)||{date,visitors:0,pageViews:0,cleanings:0};}),pages,recent};
}
