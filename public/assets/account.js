'use strict';
(() => {
  const message=document.getElementById('accountMessage');
  function notify(text,error=false){if(!message)return;message.textContent=text;message.className='notice '+(error?'error':'success');message.hidden=false;}
  async function post(path,body={}){
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.message||'Please try again.');return result;
  }
  function busy(value){document.querySelectorAll('[data-checkout],[data-portal],[data-refresh],[data-verify],[data-trial]').forEach(button=>button.disabled=value||button.dataset.unavailable==='true');}
  document.querySelectorAll('[data-checkout][disabled]').forEach(button=>button.dataset.unavailable='true');
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-checkout],[data-portal],[data-refresh],[data-verify],[data-trial]');if(!button)return;
    busy(true);notify('Connecting securely…');
    try{
      if(button.hasAttribute('data-checkout')){const result=await post('/api/billing/checkout',{cycle:button.dataset.checkout});location.assign(result.url);}
      else if(button.hasAttribute('data-portal')){const result=await post('/api/billing/portal');location.assign(result.url);}
      else if(button.hasAttribute('data-refresh')){await post('/api/billing/refresh');location.assign('/account');}
      else if(button.hasAttribute('data-trial')){await post('/api/trial');location.assign('/choose');}
      else await checkPayment(button.dataset.verify);
    }catch(error){notify(error.message,true);busy(false);}
  });
  async function checkPayment(reference){
    notify('Confirming your payment with Paystack…');
    await post('/api/billing/verify',{reference});
    location.replace('/account?payment=confirmed');
  }
  const url=new URL(location.href),reference=url.searchParams.get('reference')||url.searchParams.get('trxref');
  if(reference&&/^[A-Za-z0-9_.-]{8,120}$/.test(reference)){
    busy(true);checkPayment(reference).catch(error=>{
      notify(error.message,true);busy(false);
      const button=document.createElement('button');button.type='button';button.className='btn secondary small-btn';button.dataset.verify=reference;button.textContent='Check payment again';message?.after(button);
    });
  }
})();
