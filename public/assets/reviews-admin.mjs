import {reviewsCSV} from './review-csv.mjs?v=4.5.0';
const $=id=>document.getElementById(id);
if(document.querySelector('[data-admin-reviews]')&&await window.TidyAdminAccess?.ready){
  let rows=[],next=null,cursors=[null],page=0,busy=false,controller=null,generation=0;
  function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  function controls(){if(!document.querySelector('[data-admin-reviews]'))return;for(const id of ['reviewStatus','reviewsRefresh'])$(id).disabled=busy;$('reviewsExport').disabled=busy||!rows.length;$('reviewsPrevious').disabled=busy||page===0;$('reviewsNext').disabled=busy||!next;document.querySelectorAll('[data-review-update]').forEach(b=>b.disabled=busy);}
  function render(data){
    rows=data.items;next=data.nextCursor;
    $('reviewsTotal').textContent=Number(data.summary.total).toLocaleString();$('reviewsNew').textContent=Number(data.summary.newCount).toLocaleString();$('reviewsAverage').textContent=data.summary.averageRating==null?'—':Number(data.summary.averageRating).toFixed(1);
    const inbox=$('reviewInbox');inbox.replaceChildren();
    if(!rows.length){const empty=node('article',undefined,'panel review-empty');empty.append(node('h2','No reviews here yet.'),node('p',$('reviewStatus').value==='all'?'Client reviews will appear here after submission.':'No reviews match this status.','muted'));inbox.append(empty);}
    for(const r of rows){
      const card=node('article',undefined,'panel review-card'),head=node('div',undefined,'review-card-heading'),identity=node('div'),meta=node('div',undefined,'review-card-meta');
      identity.append(node('h2',r.name),node('p',r.email,'help'));
      meta.append(node('strong',r.rating+' / 5 ★','review-score'),node('span',r.status==='new'?'New':'Reviewed','badge'));
      head.append(identity,meta);const content=node('p',r.comment,'review-content'),bottom=node('div',undefined,'review-card-footer'),time=node('time',new Date(r.createdAt).toLocaleString(),'help');time.dateTime=new Date(r.createdAt).toISOString();
      const button=node('button',r.status==='new'?'Mark reviewed':'Mark as new','btn secondary');button.type='button';button.dataset.reviewUpdate=r.id;
      button.onclick=async()=>{
        if(busy)return;busy=true;controls();$('reviewsError').hidden=true;
        try{const response=await fetch('/api/admin/reviews/status',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,status:r.status==='new'?'reviewed':'new'})}),data=await response.json();if(response.status===401||response.status===403){window.TidyAdminAccess.deny();return;}if(!response.ok)throw Error(data.message||'Could not update this review.');cursors=[null];page=0;await load();}
        catch(e){$('reviewsError').textContent=e.message;$('reviewsError').hidden=false;}
        finally{busy=false;controls();}
      };
      bottom.append(time,button);card.append(head,content,bottom);inbox.append(card);
    }
    $('reviewsLoaded').textContent=rows.length?rows.length+' review'+(rows.length===1?'':'s')+' on page '+(page+1):'No reviews to display.';
  }
  async function load(){
    const id=++generation;controller?.abort();controller=new AbortController();busy=true;controls();$('reviewsError').hidden=true;
    const params=new URLSearchParams({status:$('reviewStatus').value});if(cursors[page])params.set('cursor',cursors[page]);
    try{const response=await fetch('/api/admin/reviews?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal}),data=await response.json();if(response.status===401||response.status===403){window.TidyAdminAccess.deny();return;}if(!response.ok)throw Error(data.message||'Could not load reviews.');if(id===generation)render(data);}
    catch(e){if(e.name!=='AbortError'){$('reviewsError').textContent=e.message;$('reviewsError').hidden=false;rows=[];next=null;$('reviewInbox').replaceChildren();$('reviewsLoaded').textContent='Reviews could not be loaded.';}}
    finally{if(id===generation){busy=false;controls();}}
  }
  $('reviewStatus').onchange=()=>{cursors=[null];page=0;load();};$('reviewsRefresh').onclick=()=>{cursors=[null];page=0;load();};
  $('reviewsNext').onclick=()=>{if(!busy&&next){page++;cursors[page]=next;load();}};$('reviewsPrevious').onclick=()=>{if(!busy&&page>0){page--;load();}};
  $('reviewsExport').onclick=()=>{if(busy||!rows.length)return;const url=URL.createObjectURL(new Blob([reviewsCSV(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='tidysheet-reviews-page-'+(page+1)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  window.addEventListener('tidysheet-admin-lock',()=>{generation++;controller?.abort();rows=[];next=null;});
  load();
}
