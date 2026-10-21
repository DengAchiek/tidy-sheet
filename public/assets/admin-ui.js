'use strict';
(() => {
  const layout = document.querySelector('.admin-layout');
  if (!layout) return;
  const button = document.getElementById('adminCollapse');
  const apply = collapsed => {
    layout.classList.toggle('admin-compact', collapsed);
    button?.setAttribute('aria-expanded', String(!collapsed));
    button?.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    if (button) button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  };
  try { apply(localStorage.getItem('tidysheet-admin-sidebar') === 'compact'); } catch {}
  button?.addEventListener('click', () => {
    const collapsed = !layout.classList.contains('admin-compact');
    apply(collapsed);
    try { localStorage.setItem('tidysheet-admin-sidebar', collapsed ? 'compact' : 'expanded'); } catch {}
  });
  if (!document.querySelector('[data-admin-overview]')) return;
  const links = [...document.querySelectorAll('[data-admin-section]')].filter(a => ['overview', 'traffic', 'activity'].includes(a.dataset.adminSection));
  const sections = ['overview', 'traffic', 'activity'].map(id => document.getElementById(id));
  let ticking = false;
  const track = () => {
    let active = 'overview';
    for (const section of sections) if (section.getBoundingClientRect().top <= 190) active = section.id;
    for (const link of links) {
      const selected = link.dataset.adminSection === active;
      link.classList.toggle('admin-active', selected);
      if (selected) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
    ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(track); } }, { passive: true });
  track();
})();
