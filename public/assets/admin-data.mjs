export const activityLabels = { page_view: 'Page viewed', import: 'File imported', clean: 'Cleaning', export: 'Export prepared', registration: 'Registration', login: 'Sign in' };
export function filterActivity(rows, { query = '', kind = 'all', outcome = 'all' } = {}) {
  const text = query.trim().toLowerCase();
  return rows.filter(row => (kind === 'all' || row.kind === kind) && (outcome === 'all' || row.outcome === outcome) && (!text || [activityLabels[row.kind] || row.kind, row.path, row.outcome, row.sample ? 'Sample' : row.signed_in ? 'Account' : 'Visitor'].join(' ').toLowerCase().includes(text)));
}
export function trafficCSV(rows) {
  const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return '\uFEFF' + [['Date (UTC)', 'Unique browser visitors', 'Page views', 'Successful own-file cleanings'], ...rows.map(row => [row.date, row.visitors, row.pageViews, row.cleanings])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
