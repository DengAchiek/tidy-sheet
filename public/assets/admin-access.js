'use strict';
(() => {
  if (!document.body.classList.contains('admin-body')) return;
  const expected = document.querySelector('meta[name="tidysheet-admin-id"]')?.content;
  const returnTo = location.pathname === '/admin/reviews' ? '/admin/reviews' : '/admin';
  let blocked = false, redirecting = false, checking = null;
  function lock() {
    blocked = true;
    document.body.classList.add('admin-session-pending');
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    window.dispatchEvent(new Event('tidysheet-admin-lock'));
    document.querySelectorAll('.admin-layout,.admin-metric-dialog').forEach(layout => layout.replaceChildren());
  }
  function deny() {
    if (redirecting) return;
    redirecting = true; lock();
    location.replace('/login?returnTo=' + encodeURIComponent(returnTo));
  }
  function verify() {
    if (blocked) return Promise.resolve(false);
    if (checking) return checking;
    document.body.classList.add('admin-session-pending');
    checking = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !expected || data.admin !== true || data.user?.id !== expected) { deny(); return false; }
        if (blocked) return false;
        document.body.classList.remove('admin-session-pending'); return true;
      } catch { deny(); return false; }
      finally { clearTimeout(timeout); checking = null; }
    })();
    return checking;
  }
  window.TidyAdminAccess = { ready: verify(), verify, lock, deny };
  window.addEventListener('focus', () => { if (!document.hidden) verify(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) document.body.classList.add('admin-session-pending'); else verify();
  });
  // A restored page must obtain fresh server authorization before showing data.
  window.addEventListener('pageshow', event => { if (event.persisted) { lock(); location.reload(); } });
  const interval = setInterval(() => { if (!document.hidden) verify(); }, 60000);
  window.addEventListener('pagehide', () => { clearInterval(interval); lock(); }, { once: true });
  window.TidyAuthChannel?.addEventListener('message', event => {
    if (event.data === 'changed') { lock(); location.reload(); }
  });
})();
