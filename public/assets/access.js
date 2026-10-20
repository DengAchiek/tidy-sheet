'use strict';
(()=>{
  let user=null,waiting=null;
  const dialog=document.getElementById('uploadAuthDialog');
  const returnTo=document.querySelector('[data-auth-return]')?.dataset.authReturn||'/sheet-cleaner.html';
  const request=async(path,body)=>{
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok){const error=Error(data.message||'Please try again shortly.');error.code=data.error;throw error;}
    return data;
  };
  async function session(){
    const response=await fetch('/api/session',{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw Error('Accounts are temporarily unavailable. Please try again.');
    const data=await response.json();user=data.user;
    if(user){
      const link=document.querySelector('.nav-links a[href="/login"]');
      if(link){link.href='/account';link.textContent='My account';}
      if(data.admin&&!document.querySelector('.nav-links a[href="/admin"]')){const a=document.createElement('a');a.href='/admin';a.textContent='Dashboard';document.querySelector('.nav-links')?.prepend(a);}
    }
    return data;
  }
  function complete(){
    if(dialog?.open){const resolve=waiting;waiting=null;dialog.close();resolve?.(user);}
    else location.assign(returnTo);
  }
  const root=document.querySelector('[data-auth-root]');
  if(root){
    const privateRegistration=root.hasAttribute('data-admin-registration'),emailReady=root.dataset.emailReady==='true';
    let adminInvitation=null,submitting=false,invitationValid=!privateRegistration,retryAt=0,invitationReady=Promise.resolve();
    const form=root.querySelector('[data-auth-form]'),title=root.querySelector('[data-auth-title]'),description=root.querySelector('[data-auth-description]');
    const error=root.querySelector('[data-auth-error]'),submit=root.querySelector('[data-auth-submit]'),errorRecovery=root.querySelector('[data-auth-error-recover]'),emailStatus=root.querySelector('[data-email-status]');
    function lock(value){
      submitting=value;
      root.querySelectorAll('input,button').forEach(el=>el.disabled=value||!invitationValid);
      if(!value&&root.dataset.mode==='recover'&&(!emailReady||Date.now()<retryAt))submit.disabled=true;
    }
    function mode(value){
      if(submitting)return;
      const recovering=value==='recover',creating=value==='register';root.dataset.mode=value;
      root.querySelector('[data-name-field]').hidden=!creating;form.elements.name.required=creating;
      root.querySelector('[data-password-field]').hidden=recovering;form.elements.password.required=!recovering;
      root.querySelector('[data-confirm-field]').hidden=!creating;form.elements.confirmPassword.required=creating;
      root.querySelector('[data-password-help]').hidden=!creating;
      root.querySelector('[data-email-unavailable]').hidden=!recovering||emailReady;
      form.elements.password.value='';form.elements.confirmPassword.value='';
      form.elements.password.autocomplete=creating?'new-password':'current-password';form.elements.password.minLength=creating?15:1;
      title.textContent=recovering?'Forgot password?':creating?'Create your account':'Welcome back.';
      description.textContent=recovering?'We’ll email you a private link to choose a new password.':privateRegistration?'Create your administrator account, or sign in if you already have one.':'Sign in to clean your own spreadsheet. Your file stays on your device.';
      submit.textContent=recovering?'Email me a reset link':creating?'Create account & continue':'Sign in & continue';
      if(privateRegistration&&!recovering){title.textContent=creating?'Your admin workspace.':'Sign in as administrator';submit.textContent=creating?'Create account & activate admin':'Sign in & activate admin';}
      if(privateRegistration&&recovering)description.textContent='Reset your password using the email link, then return to this invitation to sign in.';
      error.hidden=true;error.className='notice';errorRecovery.hidden=true;emailStatus.hidden=true;
      root.querySelector('[data-auth-mode="recover"]').hidden=value!=='login';
      root.querySelectorAll('[data-auth-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.authMode===value)));lock(false);
    }
    root.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>mode(b.dataset.authMode));
    errorRecovery.onclick=()=>{mode('recover');form.elements.email.focus();};
    mode(root.dataset.mode||'login');
    if(privateRegistration){
      const token=new URLSearchParams(location.hash.slice(1)).get('invite');history.replaceState(null,'',location.pathname);
      const status=root.querySelector('[data-invitation-status]');
      root.querySelectorAll('.auth-native,.auth-divider').forEach(el=>el.hidden=true);
      lock(true);
      invitationReady=(async()=>{
        try{
          if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('Open your complete private registration link to continue.');
          const data=await request('/api/admin/invitations/inspect',{token});adminInvitation=token;invitationValid=true;
          form.elements.email.value=data.email;form.elements.email.readOnly=true;
          status.textContent='Private invitation for '+data.email+' · Expires '+new Date(data.expiresAt).toLocaleString()+'.';
        }catch(e){status.textContent=e.message;}finally{lock(false);}
      })();
    }
    form.onsubmit=async e=>{
      e.preventDefault();if(submitting)return;
      const current=root.dataset.mode,fields=Object.fromEntries(new FormData(form));
      error.hidden=true;error.className='notice';errorRecovery.hidden=true;lock(true);
      try{
        await invitationReady;
        if(privateRegistration&&!adminInvitation)throw Error('This administrator invitation is invalid or expired.');
        if(current==='recover'){
          const data=await request('/api/auth/password-reset/request',{email:fields.email});
          emailStatus.textContent=data.message;emailStatus.hidden=false;retryAt=Date.now()+data.retryAfter*1000;
          setTimeout(()=>{if(!submitting&&invitationValid&&Date.now()>=retryAt)submit.disabled=false;},data.retryAfter*1000);return;
        }
        if(current==='register'&&fields.password!==fields.confirmPassword)throw Error('Passwords do not match.');
        const data=await request('/api/auth/'+current,{...fields,...(privateRegistration?{adminInvitation}:{})});
        form.elements.password.value='';form.elements.confirmPassword.value='';
        try{await session();}catch{user=data.user;}complete();
      }catch(e){
        error.textContent=e.message;error.hidden=false;
        if(current==='login'&&e.code==='invalid_credentials'){error.textContent='Email or password is incorrect. You can request a password reset email.';errorRecovery.hidden=false;}
      }finally{lock(false);}
    };
  }
  if(dialog){document.querySelector('[data-auth-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{waiting?.(null);waiting=null;});}
  window.TidyAccess={async ensure(){const data=await session();if(data.user)return data.user;if(!dialog){location.assign('/login');return null;}return new Promise(resolve=>{waiting=resolve;dialog.showModal();});},session};
  document.querySelectorAll('[data-signout]').forEach(b=>b.onclick=async e=>{e.preventDefault();b.disabled=true;try{const data=await request('/api/auth/logout',{});location.assign(data.nativeSignOut||'/sheet-cleaner.html');}catch(error){b.disabled=false;const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=error.message;b.after(p);}});
  const claim=document.getElementById('adminClaimForm');
  if(claim)claim.onsubmit=async e=>{e.preventDefault();const button=claim.querySelector('button'),notice=document.getElementById('adminClaimMessage');button.disabled=true;notice.hidden=true;try{await request('/api/admin/claim',{code:claim.elements.code.value});claim.elements.code.value='';location.assign('/admin');}catch(error){notice.textContent=error.message;notice.hidden=false;}finally{button.disabled=false;}};
  const passwordForm=document.getElementById('passwordChangeForm');
  if(passwordForm){
    const notice=document.getElementById('passwordChangeMessage');
    passwordForm.onsubmit=async e=>{
      e.preventDefault();const fields=Object.fromEntries(new FormData(passwordForm));notice.hidden=true;notice.className='notice';
      passwordForm.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      try{
        if(fields.password!==fields.confirmPassword)throw Error('New passwords do not match.');
        await request('/api/auth/password',fields);passwordForm.reset();notice.className='notice success';notice.textContent='Your password has been updated. Your other sessions are signed out.';notice.hidden=false;
      }catch(error){notice.textContent=error.message;notice.hidden=false;}finally{passwordForm.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
    };
  }
  const resetRoot=document.querySelector('[data-password-reset-root]');
  if(resetRoot){
    let token=new URLSearchParams(location.hash.slice(1)).get('token'),busy=false;
    history.replaceState(null,'',location.pathname);
    const resetForm=document.getElementById('passwordResetForm'),status=document.getElementById('passwordResetStatus'),error=document.getElementById('passwordResetError');
    (async()=>{
      try{if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('Open the complete reset link from your email, or request a new email.');await request('/api/auth/password-reset/inspect',{token});status.textContent='Your link is valid. Choose a new password below.';resetForm.hidden=false;}
      catch(e){token=null;status.textContent=e.message;status.className='notice';}
    })();
    resetForm.onsubmit=async e=>{
      e.preventDefault();if(busy||!token)return;busy=true;error.hidden=true;const fields=Object.fromEntries(new FormData(resetForm));resetForm.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      try{if(fields.password!==fields.confirmPassword)throw Error('New passwords do not match.');await request('/api/auth/password-reset',{token,...fields});token=null;resetForm.reset();resetForm.hidden=true;status.hidden=true;document.getElementById('passwordResetSuccess').hidden=false;}
      catch(e){error.textContent=e.message;error.hidden=false;}finally{busy=false;resetForm.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
    };
  }
  if(location.pathname==='/account')session().then(data=>{if(data.admin){const a=document.createElement('a');a.className='btn secondary';a.href='/admin';a.textContent='Admin dashboard ↗';document.querySelector('.account-heading')?.append(a);}}).catch(()=>{});
})();
