'use strict';
(async () => {
  const { filterActivity, trafficCSV, activityLabels } = await import('./admin-data.mjs?v=4.6.0');
  const $ = id => document.getElementById(id);
  if (!$('adminRange')) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => Number(value || 0);
  const fmt = value => number(value).toLocaleString();
  let controller, generation = 0, snapshot = null, busy = false, selectedDay = 0, geometry;
  const series = { visitors: true, pageViews: true };
  function table(headers, rows, empty) {
    return '<thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map(row => '<tr>' + row.map((v, i) => '<' + (i ? 'td' : 'th scope="row"') + '>' + v + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '" class="muted">' + esc(empty) + '</td></tr>') + '</tbody>';
  }
  function renderActivity() {
    if (!snapshot) return;
    const rows = filterActivity(snapshot.recent, { query: $('adminActivitySearch').value, kind: $('adminActivityKind').value, outcome: $('adminActivityOutcome').value });
    $('adminActivity').innerHTML = table(['Activity', 'Workspace', 'Outcome', 'Duration', 'Rows × columns', 'Time (UTC)'], rows.map(row => [
      esc(activityLabels[row.kind] || row.kind) + '<small class="event-path">' + esc(row.path) + '</small>',
      row.sample ? 'Sample' : row.signed_in ? 'Account' : 'Visitor',
      '<span class="event-state ' + (row.outcome === 'failure' ? 'failed' : row.outcome === 'cancelled' ? 'cancelled' : '') + '">' + esc(row.outcome) + '</span>',
      row.duration_ms == null ? '—' : (row.duration_ms / 1000).toFixed(2) + 's',
      row.row_count == null ? '—' : fmt(row.row_count) + ' × ' + fmt(row.column_count),
      esc(new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19))
    ]), snapshot.recent.length ? 'No recent events match these filters. Try another search or clear filters.' : 'Activity will appear here as people use the application.');
    $('adminActivityCount').textContent = 'Showing ' + rows.length + ' of ' + snapshot.recent.length + ' recent events. Filters apply to this list only.';
  }
  function selectDay(index) {
    if (!snapshot?.trends.length || !geometry) return;
    selectedDay = Math.max(0, Math.min(snapshot.trends.length - 1, Math.round(index)));
    const row = snapshot.trends[selectedDay], { x, y, height, bottom } = geometry;
    $('adminChartDay').value = String(selectedDay);
    $('adminChartDay').setAttribute('aria-valuetext', row.date + ' UTC: ' + fmt(row.visitors) + ' visitors, ' + fmt(row.pageViews) + ' page views');
    $('adminChartSummary').innerHTML = '<time datetime="' + esc(row.date) + '">' + esc(new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(row.date + 'T00:00:00Z'))) + ' UTC</time><span><strong>' + fmt(row.visitors) + '</strong> visitors</span><span><strong>' + fmt(row.pageViews) + '</strong> page views</span>';
    const cursor = $('adminChartCursor');
    if (cursor) { cursor.setAttribute('x1', x(selectedDay)); cursor.setAttribute('x2', x(selectedDay)); cursor.setAttribute('y2', height - bottom); }
    for (const key of ['visitors', 'pageViews']) {
      const dot = $('adminChartDot-' + key);
      if (dot) { dot.setAttribute('cx', x(selectedDay)); dot.setAttribute('cy', y(number(row[key]))); }
    }
  }
  function renderChart() {
    const rows = snapshot.trends, width = 960, height = 250, left = 40, right = 12, top = 18, bottom = 32;
    const max = Math.max(1, ...rows.flatMap(row => Object.keys(series).filter(key => series[key]).map(key => number(row[key]))));
    const x = i => left + i * (width - left - right) / Math.max(1, rows.length - 1), y = v => height - bottom - v / max * (height - top - bottom);
    geometry = { x, y, width, height, bottom, left, right };
    const colors = { visitors: '#347351', pageViews: '#a4c572' };
    const points = key => rows.map((row, i) => x(i) + ',' + y(number(row[key]))).join(' ');
    const ticks = [...new Set([0, Math.floor(max / 2), max])];
    $('adminChart').innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Daily visitors and page views. Use the day slider below to explore values.">' +
      '<defs><linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a6c97c" stop-opacity=".3"/><stop offset="100%" stop-color="#a6c97c" stop-opacity=".015"/></linearGradient></defs>' +
      ticks.map(v => '<line x1="' + left + '" y1="' + y(v) + '" x2="' + (width - right) + '" y2="' + y(v) + '" stroke="#e9eee5" stroke-dasharray="4 5"/><text x="0" y="' + (y(v) + 4) + '" fill="#8c9a8b" font-size="10">' + fmt(v) + '</text>').join('') +
      (series.visitors && rows.length ? '<polygon points="' + x(0) + ',' + y(0) + ' ' + points('visitors') + ' ' + x(rows.length - 1) + ',' + y(0) + '" fill="url(#trafficFill)"/>' : '') +
      Object.keys(series).filter(key => series[key]).map(key => '<polyline points="' + points(key) + '" fill="none" stroke="' + colors[key] + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>').join('') +
      [...new Set([0, Math.floor(rows.length / 3), Math.floor(rows.length * 2 / 3), rows.length - 1])].filter(i => rows[i]).map(i => '<text x="' + x(i) + '" y="' + (height - 7) + '" text-anchor="' + (i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle') + '" fill="#8c9a8b" font-size="10">' + esc(rows[i].date.slice(5)) + '</text>').join('') +
      '<line id="adminChartCursor" y1="' + top + '" stroke="#68896d" stroke-dasharray="3 4"/>' +
      Object.keys(series).filter(key => series[key]).map(key => '<circle id="adminChartDot-' + key + '" r="4" fill="' + colors[key] + '" stroke="#fff" stroke-width="2"/>').join('') + '</svg>';
    const svg = $('adminChart').querySelector('svg');
    const inspect = event => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      selectDay((local.x - left) / (width - left - right) * (rows.length - 1));
    };
    svg.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') inspect(event); });
    svg.addEventListener('pointerdown', inspect);
    $('adminChartDay').max = String(Math.max(0, rows.length - 1));
    $('adminChartDay').disabled = !rows.length;
    for (const button of document.querySelectorAll('[data-chart-series]')) {
      button.setAttribute('aria-pressed', String(series[button.dataset.chartSeries]));
      button.disabled = series[button.dataset.chartSeries] && Object.values(series).filter(Boolean).length === 1;
    }
    selectDay(selectedDay);
  }
  function render(data) {
    const changedPeriod = snapshot?.days !== data.days;
    snapshot = data;
    if (changedPeriod) selectedDay = Math.max(0, data.trends.length - 1);
    const op = (kind, sample = false, outcome = 'success') => data.operations.find(row => row.kind === kind && !!row.sample === sample && row.outcome === outcome);
    const count = kind => number(op(kind)?.count);
    const attempts = data.operations.filter(row => row.kind === 'clean' && !row.sample && row.outcome !== 'cancelled').reduce((n, row) => n + number(row.count), 0);
    const failed = data.operations.filter(row => !row.sample && row.outcome === 'failure').reduce((n, row) => n + number(row.count), 0);
    const metrics = [
      ['Unique visitors', data.traffic.visitors, 'Distinct browsers in this period', '↗', 'accent'],
      ['Page views', data.traffic.pageViews, 'Across tracked application pages', '▧', ''],
      ['Successful cleanings', count('clean'), attempts ? Math.round(count('clean') / attempts * 100) + '% of non-cancelled cleaning attempts' : 'No completed attempts yet', '✓', ''],
      ['Failed operations', failed, 'Own-file imports, cleanings & exports', '!', failed ? 'alert' : ''],
      ['New accounts', data.accounts.newAccounts, fmt(data.accounts.total) + ' accounts in total', '+', ''],
      ['Active accounts', data.traffic.activeAccounts, 'With activity in this period', '◎', ''],
      ['Files imported', count('import'), 'Own files read on a device', '↑', ''],
      ['Exports prepared', count('export'), 'Own-file exports prepared', '↓', '']
    ];
    $('adminMetrics').innerHTML = metrics.map(([label, value, note, symbol, tone]) => '<article class="admin-metric" data-tone="' + tone + '"><div class="metric-title">' + esc(label) + '<span class="metric-symbol" aria-hidden="true">' + symbol + '</span></div><strong>' + fmt(value) + '</strong><small>' + esc(note) + '</small></article>').join('');
    $('adminMetrics').setAttribute('aria-busy', 'false');
    renderChart();
    $('adminDaily').innerHTML = table(['Date (UTC)', 'Visitors', 'Page views', 'Own-file cleanings'], data.trends.map(row => [esc(row.date), fmt(row.visitors), fmt(row.pageViews), fmt(row.cleanings)]), 'No traffic recorded.');
    const maxOperation = Math.max(1, count('import'), count('clean'), count('export'));
    $('adminOperations').innerHTML = ['import', 'clean', 'export'].map((kind, i) => {
      const real = op(kind), sample = op(kind, true);
      return '<div class="operation-row"><span class="operation-number">0' + (i + 1) + '</span><div><strong>' + ({ import: 'Files imported', clean: 'Cleaning completed', export: 'Exports prepared' }[kind]) + '</strong><span>' + fmt(sample?.count) + ' sample runs · ' + (real?.averageMs != null ? (real.averageMs / 1000).toFixed(2) + 's average' : 'No own-file timing yet') + '</span><div class="operation-track" aria-hidden="true"><i style="width:' + count(kind) / maxOperation * 100 + '%"></i></div></div><b>' + fmt(real?.count) + '</b></div>';
    }).join('');
    const maxViews = Math.max(1, ...data.pages.map(row => number(row.views)));
    $('adminPages').innerHTML = table(['Page', 'Views', 'Visitors'], data.pages.map(row => ['<span class="page-path" title="' + esc(row.path) + '">' + esc(row.path) + '</span><span class="page-bar" aria-hidden="true"><i style="width:' + number(row.views) / maxViews * 100 + '%"></i></span>', fmt(row.views), fmt(row.visitors)]), 'No page views in this period.');
    renderActivity();
    $('adminUpdated').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + new Date(data.since).toISOString().slice(0, 10) + ' — ' + new Date(data.until - 1).toISOString().slice(0, 10) + ' UTC';
    $('adminLiveState').textContent = 'Up to date';
    $('adminLiveState').dataset.state = 'ready';
  }
  async function load() {
    const id = ++generation;
    controller?.abort(); controller = new AbortController(); busy = true;
    document.querySelector('[data-admin-overview]').setAttribute('aria-busy', 'true');
    $('adminRefresh').disabled = true; $('adminTrafficExport').disabled = true; $('adminMessage').hidden = true;
    $('adminLiveState').textContent = 'Refreshing';
    $('adminLiveState').dataset.state = 'loading';
    const days = $('adminRange').value;
    for (const button of document.querySelectorAll('[data-admin-range]')) button.setAttribute('aria-pressed', String(button.dataset.adminRange === days));
    try {
      const response = await fetch('/api/admin/overview?days=' + days, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || 'Could not load activity.');
      if (id === generation) render(data);
    } catch (error) {
      if (id === generation && error.name !== 'AbortError') {
        $('adminMessage').textContent = error.message + (snapshot ? ' Showing the last successful report (' + snapshot.days + ' days). Retry to update.' : ' Use Refresh to try again.');
        $('adminMessage').hidden = false;
        $('adminLiveState').textContent = snapshot ? 'Report out of date' : 'Unavailable';
        $('adminLiveState').dataset.state = 'error';
        if (!snapshot) { $('adminMetrics').replaceChildren(); $('adminMetrics').setAttribute('aria-busy', 'false'); $('adminUpdated').textContent = 'Activity could not be loaded.'; }
      }
    } finally {
      if (id === generation) {
        busy = false; $('adminRefresh').disabled = false; $('adminTrafficExport').disabled = !snapshot;
        document.querySelector('[data-admin-overview]').setAttribute('aria-busy', 'false');
      }
    }
  }
  for (const button of document.querySelectorAll('[data-admin-range]')) button.addEventListener('click', () => { $('adminRange').value = button.dataset.adminRange; load(); });
  $('adminRange').addEventListener('change', load);
  $('adminRefresh').addEventListener('click', load);
  $('adminChartDay').addEventListener('input', event => selectDay(Number(event.target.value)));
  for (const button of document.querySelectorAll('[data-chart-series]')) button.addEventListener('click', () => { if (!snapshot) return; const key = button.dataset.chartSeries; series[key] = !series[key]; renderChart(); });
  for (const id of ['adminActivitySearch', 'adminActivityKind', 'adminActivityOutcome']) $(id).addEventListener(id === 'adminActivitySearch' ? 'input' : 'change', renderActivity);
  $('adminActivityClear').addEventListener('click', () => { $('adminActivitySearch').value = ''; $('adminActivityKind').value = 'all'; $('adminActivityOutcome').value = 'all'; renderActivity(); });
  $('adminTrafficExport').addEventListener('click', () => {
    if (!snapshot || busy) return;
    const url = URL.createObjectURL(new Blob([trafficCSV(snapshot.trends)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tidysheet-daily-traffic-' + snapshot.days + '-days.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  const interval = setInterval(() => { if ($('adminAutoRefresh').checked && !document.hidden && !busy) load(); }, 60000);
  window.addEventListener('pagehide', () => { clearInterval(interval); controller?.abort(); }, { once: true });
  load();
})();
