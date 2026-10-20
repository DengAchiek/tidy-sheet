import {first,all} from './store';
import {rateLimit,type User} from './auth';
import {AppError} from './policy.mjs';

const uuid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export async function submitReview(request:Request,user:User,body:any){
  const comment=typeof body.comment==='string'?body.comment.trim():'';
  if(Object.keys(body).some(key=>!['id','rating','comment'].includes(key))||!uuid(body.id)||!Number.isInteger(body.rating)||body.rating<1||body.rating>5||comment.length<10||comment.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment))throw new AppError(400,'invalid_review','Choose 1–5 stars and write a review between 10 and 2,000 characters.');
  const id=body.id.toLowerCase();
  const checkExisting=async()=>{const existing=await first('SELECT user_id,rating,comment FROM client_reviews WHERE id=?',id);if(!existing)return false;if(existing.user_id!==user.userId||existing.rating!==body.rating||existing.comment!==comment)throw new AppError(409,'review_conflict','This submission changed. Reload the page before submitting another review.');return true;};
  if(await checkExisting())return {received:true,id};
  await rateLimit(request,'review-submit',user.userId,3);
  const now=Date.now(),created=await first('INSERT INTO client_reviews (id,user_id,rating,comment,status,created_at) SELECT ?,?,?,?,\'new\',? WHERE NOT EXISTS (SELECT 1 FROM client_reviews WHERE user_id=? AND created_at>?) ON CONFLICT(id) DO NOTHING RETURNING id',id,user.userId,body.rating,comment,now,user.userId,now-60000);
  if(!created&&!await checkExisting())throw new AppError(429,'review_too_soon','Your last review was received. Please wait a minute before sending another.');
  return {received:true,id};
}
export async function reviewInbox(params:URLSearchParams){
  const status=params.get('status')||'all',limit=Number(params.get('limit')||25),cursor=params.get('cursor');
  if(!['all','new','reviewed'].includes(status)||!Number.isInteger(limit)||limit<1||limit>50)throw new AppError(400,'invalid_review_filter','Choose a valid review filter.');
  let before:{createdAt:number,id:string}|null=null;
  if(cursor){if(cursor.length>250)throw new AppError(400,'invalid_review_cursor','Reload the reviews list to continue.');try{before=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(cursor.length>250||!before||!Number.isSafeInteger(before.createdAt)||before.createdAt<0||!uuid(before.id))throw Error();}catch{throw new AppError(400,'invalid_review_cursor','Reload the reviews list to continue.');}}
  const clauses:string[]=[],args:any[]=[];
  if(status!=='all'){clauses.push('r.status=?');args.push(status);}
  if(before){clauses.push('(r.created_at<? OR (r.created_at=? AND r.id<?))');args.push(before.createdAt,before.createdAt,before.id);}
  const rows=await all('SELECT r.id,r.rating,r.comment,r.status,r.created_at AS createdAt,r.reviewed_at AS reviewedAt,a.name,a.email FROM client_reviews r JOIN accounts a ON a.id=r.user_id'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+' ORDER BY r.created_at DESC,r.id DESC LIMIT ?',...args,limit+1);
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
  const summary=await first("SELECT count(*) AS total,coalesce(sum(CASE WHEN status='new' THEN 1 ELSE 0 END),0) AS newCount,avg(rating) AS averageRating FROM client_reviews");
  return {items,summary,nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.id})).toString('base64url'):null};
}
export async function updateReview(body:any){
  if(!uuid(body.id)||!['new','reviewed'].includes(body.status))throw new AppError(400,'invalid_review_status','Choose a valid review status.');
  const row=await first('UPDATE client_reviews SET status=?,reviewed_at=? WHERE id=? RETURNING id',body.status,body.status==='reviewed'?Date.now():null,body.id.toLowerCase());
  if(!row)throw new AppError(404,'review_not_found','This review could not be found.');return {saved:true};
}
