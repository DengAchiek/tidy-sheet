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
    const privateRegistration=root.hasAttribute('data-admin-registration');
    let adminInvitation=null,submitting=false,invitationReady=Promise.resolve();
    const form=root.querySelector('[data-auth-form]'),title=root.querySelector('[data-auth-title]'),description=root.querySelector('[data-auth-description]');
    const error=root.querySelector('[data-auth-error]'),submit=root.querySelector('[data-auth-submit]'),errorRecovery=root.querySelector('[data-auth-error-recover]');
    const recoveryResult=root.querySelector('[data-recovery-result]'),codeView=root.querySelector('[data-recovery-code]');
    function mode(value){
      if(submitting)return;
      const recovering=value==='recover',creating=value==='register';
      root.dataset.mode=value;
      root.querySelector('[data-name-field]').hidden=!creating;form.elements.name.required=creating;
      root.querySelector('[data-recovery-field]').hidden=!recovering;form.elements.recoveryCode.required=recovering;
      root.querySelector('[data-recovery-help]').hidden=!recovering;
      root.querySelector('[data-confirm-field]').hidden=value==='login';form.elements.confirmPassword.required=value!=='login';
      root.querySelector('[data-confirm-label]').textContent=recovering?'Confirm new password':'Confirm password';
      form.elements.password.value='';form.elements.confirmPassword.value='';if(!recovering)form.elements.recoveryCode.value='';
      form.elements.password.autocomplete=value==='login'?'current-password':'new-password';form.elements.password.minLength=value==='login'?1:15;
      root.querySelector('[data-password-help]').hidden=value==='login';
      root.querySelector('[data-password-label]').textContent=recovering?'New password':'Password';
      title.textContent=recovering?'Forgot password?':creating?'Create your account':'Welcome back.';
      description.textContent=recovering?'Use your saved recovery code to choose a new password.':privateRegistration?'Create your administrator account, or sign in if you already have one.':'Sign in to clean your own spreadsheet. Your file stays on your device.';
      submit.textContent=recovering?'Reset password':creating?'Create account & continue':'Sign in & continue';
      if(privateRegistration&&!recovering){title.textContent=creating?'Your admin workspace.':'Sign in as administrator';submit.textContent=creating?'Create account & activate admin':'Sign in & activate admin';}
      if(privateRegistration&&recovering)description.textContent='Reset your password with your recovery code, then sign in here to activate your admin invitation.';
      error.hidden=true;error.className='notice';errorRecovery.hidden=true;
      root.querySelector('[data-auth-mode="recover"]').hidden=value!=='login';
      root.querySelectorAll('[data-auth-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.authMode===value)));
    }
    root.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>mode(b.dataset.authMode));
    errorRecovery.onclick=()=>{mode('recover');form.elements.recoveryCode.focus();};
    mode(root.dataset.mode||'login');
    if(privateRegistration){
      const token=new URLSearchParams(location.hash.slice(1)).get('invite');history.replaceState(null,'',location.pathname);
      const status=root.querySelector('[data-invitation-status]');
      root.querySelectorAll('.auth-native,.auth-divider').forEach(el=>el.hidden=true);
      form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      invitationReady=(async()=>{
        try{
          if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('Open your complete private registration link to continue.');
          const data=await request('/api/admin/invitations/inspect',{token});adminInvitation=token;
          form.elements.email.value=data.email;form.elements.email.readOnly=true;
          status.textContent='Private invitation for '+data.email+' · Expires '+new Date(data.expiresAt).toLocaleString()+'.';
          form.querySelectorAll('input,button').forEach(el=>el.disabled=false);
        }catch(e){status.textContent=e.message;root.querySelectorAll('.auth-tabs button,[data-auth-mode="recover"]').forEach(el=>el.disabled=true);}
      })();
    }
    function showRecoveryCode(data,current){
      codeView.textContent=data.recoveryCode;recoveryResult.hidden=false;
      root.querySelectorAll('form,.auth-tabs,[data-auth-mode],.auth-native,.auth-divider').forEach(el=>el.hidden=true);
      title.textContent=current==='recover'?'Password reset.':'You’re ready to tidy.';
      const done=root.querySelector('[data-auth-done]');
      done.textContent=current==='recover'?'I saved my new code — back to sign in':'I saved my code — continue';
      done.onclick=()=>{
        if(current!=='recover'){codeView.textContent='';complete();return;}
        recoveryResult.hidden=true;codeView.textContent='';form.hidden=false;root.querySelector('.auth-tabs').hidden=false;
        root.querySelectorAll('[data-auth-mode]').forEach(el=>el.hidden=false);
        if(!privateRegistration)root.querySelectorAll('.auth-native,.auth-divider').forEach(el=>el.hidden=false);
        mode('login');error.className='notice success';error.textContent='Password reset. Sign in with your new password'+(privateRegistration?' to activate admin access.':'.');error.hidden=false;form.elements.password.focus();
      };
    }
    form.onsubmit=async e=>{
      e.preventDefault();if(submitting)return;
      const current=root.dataset.mode,fields=Object.fromEntries(new FormData(form));
      error.hidden=true;error.className='notice';errorRecovery.hidden=true;submitting=true;
      form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      try{
        await invitationReady;
        if(privateRegistration&&!adminInvitation)throw Error('This administrator invitation is invalid or expired.');
        if(current!=='login'&&fields.password!==fields.confirmPassword)throw Error('Passwords do not match.');
        const data=await request('/api/auth/'+current,{...fields,...(privateRegistration?{adminInvitation}:{})});
        form.elements.password.value='';form.elements.confirmPassword.value='';form.elements.recoveryCode.value='';
        if(current==='recover')user=null;else{try{await session();}catch{user=data.user;}}
        if(data.recoveryCode)showRecoveryCode(data,current);else complete();
      }catch(e){
        error.textContent=e.message;error.hidden=false;
        if(current==='login'&&e.code==='invalid_credentials'){error.textContent='Email or password is incorrect. You can reset your password using your saved recovery code.';errorRecovery.hidden=false;}
      }finally{submitting=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
    };
  }
  if(dialog){document.querySelector('[data-auth-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{waiting?.(null);waiting=null;});}
  window.TidyAccess={async ensure(){const data=await session();if(data.user)return data.user;if(!dialog){location.assign('/login');return null;}return new Promise(resolve=>{waiting=resolve;dialog.showModal();});},session};
  document.querySelectorAll('[data-signout]').forEach(b=>b.onclick=async e=>{e.preventDefault();b.disabled=true;try{const data=await request('/api/auth/logout',{});location.assign(data.nativeSignOut||'/sheet-cleaner.html');}catch(error){b.disabled=false;const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=error.message;b.after(p);}});
  const claim=document.getElementById('adminClaimForm');
  if(claim)claim.onsubmit=async e=>{e.preventDefault();const button=claim.querySelector('button'),notice=document.getElementById('adminClaimMessage');button.disabled=true;notice.hidden=true;try{await request('/api/admin/claim',{code:claim.elements.code.value});claim.elements.code.value='';location.assign('/admin');}catch(error){notice.textContent=error.message;notice.hidden=false;}finally{button.disabled=false;}};
  const passwordForm=document.getElementById('passwordChangeForm');
  if(passwordForm){
    const notice=document.getElementById('passwordChangeMessage'),result=document.getElementById('passwordChangeResult'),code=document.getElementById('passwordChangeCode');
    passwordForm.onsubmit=async e=>{
      e.preventDefault();const fields=Object.fromEntries(new FormData(passwordForm));notice.hidden=true;notice.className='notice';
      passwordForm.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      try{
        if(fields.password!==fields.confirmPassword)throw Error('New passwords do not match.');
        const data=await request('/api/auth/password',fields);passwordForm.reset();passwordForm.hidden=true;code.textContent=data.recoveryCode;result.hidden=false;
      }catch(error){notice.textContent=error.message;notice.hidden=false;}finally{passwordForm.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
    };
    document.getElementById('passwordChangeDone').onclick=()=>{result.hidden=true;code.textContent='';passwordForm.hidden=false;notice.className='notice success';notice.textContent='Your password and recovery code have been updated. Your other sessions are signed out.';notice.hidden=false;};
  }
  if(location.pathname==='/account')session().then(data=>{if(data.admin){const a=document.createElement('a');a.className='btn secondary';a.href='/admin';a.textContent='Admin dashboard ↗';document.querySelector('.account-heading')?.append(a);}}).catch(()=>{});
})();
