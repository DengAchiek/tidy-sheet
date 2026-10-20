'use strict';
(()=>{
  const paths=['/','/index.html','/sheet-cleaner.html','/cleaner','/choose','/training','/account','/account/security','/forgot-password','/login','/register','/admin','/admin/register','/privacy.html','/reviews','/admin/reviews'];
  let pageReady=Promise.resolve();
  const send=event=>fetch('/api/telemetry',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),path:location.pathname,sample:false,outcome:'success',...event})}).catch(()=>{});
  window.TidyTelemetry={record:event=>pageReady.then(()=>send(event))};
  if(paths.includes(location.pathname))pageReady=send({kind:'page_view'});
})();
