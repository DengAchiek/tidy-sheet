'use strict';
(()=>{
  const form=document.getElementById('clientReviewForm');if(!form)return;
  const error=document.getElementById('reviewSubmitError'),button=form.querySelector('button[type="submit"]');
  const id=crypto.randomUUID();let busy=false;
  form.onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;error.hidden=true;
    const fields=new FormData(form),body={id,rating:Number(fields.get('rating')),comment:fields.get('comment')};
    button.disabled=true;button.textContent='Sending review…';
    try{
      const response=await fetch('/api/reviews',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
      if(!response.ok)throw Error(data.message||'Your review could not be saved. Please try again.');
      form.reset();form.hidden=true;document.getElementById('reviewSubmitSuccess').hidden=false;
    }catch(e){error.textContent=e.message;error.hidden=false;}
    finally{busy=false;button.disabled=false;button.textContent='Send my review';}
  };
})();
