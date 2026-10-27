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


// Read-only drill-downs use the same UTC periods and event definitions as the cards.
// The report timestamp anchors pagination while new activity continues to arrive.
export async function metricDetails(params:URLSearchParams){
  const metric=params.get('metric')||'',days=Number(params.get('days')||30),now=Date.now();
  const at=Number(params.get('at')||now),pageText=params.get('page')||'1',page=Number(pageText),pageSize=25;
  if(!['visitors','pageViews','cleanings','failures','newAccounts','activeAccounts','imports','exports'].includes(metric))throw new AppError(400,'invalid_metric','Choose an application overview card.');
  if(![7,30,90].includes(days))throw new AppError(400,'invalid_range','Choose 7, 30 or 90 days.');
  if(!Number.isSafeInteger(at)||at<now-86400000||at>now+60000)throw new AppError(400,'expired_report','Refresh the overview to open a current report.');
  if(!/^\d{1,5}$/.test(pageText)||page<1||page>10000)throw new AppError(400,'invalid_page','Choose a valid report page.');
  const today=new Date(at);today.setUTCHours(0,0,0,0);
  const since=today.getTime()-(days-1)*86400000,until=Math.min(today.getTime()+86400000,at+1),offset=(page-1)*pageSize;
  let total=0,value=0,items:any[]=[];
  if(metric==='visitors'){
    const where="kind='page_view' AND visitor_id IS NOT NULL AND created_at>=? AND created_at<?";
    const count=await first('SELECT count(DISTINCT visitor_id) AS total FROM site_events WHERE '+where,since,until);
    total=value=Number(count?.total||0);
    items=await all('SELECT min(created_at) AS firstSeen,max(created_at) AS lastSeen,count(*) AS pageViews,count(DISTINCT path) AS pages FROM site_events WHERE '+where+' GROUP BY visitor_id ORDER BY lastSeen DESC,visitor_id DESC LIMIT ? OFFSET ?',since,until,pageSize,offset);
    items=items.map((row,i)=>({...row,browser:offset+i+1}));
  }else if(metric==='pageViews'){
    const where="kind='page_view' AND created_at>=? AND created_at<?";
    const count=await first('SELECT count(*) AS value,count(DISTINCT path) AS total FROM site_events WHERE '+where,since,until);
    total=Number(count?.total||0);value=Number(count?.value||0);
    items=await all('SELECT path,count(*) AS views,count(DISTINCT visitor_id) AS visitors,max(created_at) AS lastSeen FROM site_events WHERE '+where+' GROUP BY path ORDER BY views DESC,path ASC LIMIT ? OFFSET ?',since,until,pageSize,offset);
  }else if(metric==='newAccounts'){
    const count=await first('SELECT count(*) AS total FROM accounts WHERE created_at>=? AND created_at<?',since,until);
    total=value=Number(count?.total||0);
    items=await all('SELECT name,email,created_at AS createdAt FROM accounts WHERE created_at>=? AND created_at<? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',since,until,pageSize,offset);
  }else if(metric==='activeAccounts'){
    const where='e.user_id IS NOT NULL AND e.created_at>=? AND e.created_at<?';
    const count=await first('SELECT count(DISTINCT e.user_id) AS total FROM site_events e WHERE '+where,since,until);
    total=value=Number(count?.total||0);
    items=await all('SELECT a.name,a.email,count(*) AS events,max(e.created_at) AS lastSeen FROM site_events e LEFT JOIN accounts a ON a.id=e.user_id WHERE '+where+' GROUP BY e.user_id ORDER BY lastSeen DESC,e.user_id DESC LIMIT ? OFFSET ?',since,until,pageSize,offset);
  }else{
    const filter=metric==='failures'?"e.kind IN ('import','clean','export') AND e.outcome='failure'":("e.kind='"+({cleanings:'clean',imports:'import',exports:'export'}[metric])+"' AND e.outcome='success'");
    const where='e.sample=0 AND '+filter+' AND e.created_at>=? AND e.created_at<?';
    const count=await first('SELECT count(*) AS total FROM site_events e WHERE '+where,since,until);
    total=value=Number(count?.total||0);
    items=await all('SELECT e.kind,e.path,e.outcome,e.duration_ms AS durationMs,e.row_count AS rows,e.column_count AS columns,e.created_at AS createdAt,a.name,a.email FROM site_events e LEFT JOIN accounts a ON a.id=e.user_id WHERE '+where+' ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?',since,until,pageSize,offset);
  }
  return {metric,days,since,until,at,page,pageSize,total,value,items,pages:Math.max(1,Math.ceil(total/pageSize))};
}
