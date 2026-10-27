export const activityLabels = { page_view: 'Page viewed', import: 'File imported', clean: 'Cleaning', export: 'Export prepared', registration: 'Registration', login: 'Sign in' };
export function filterActivity(rows, { query = '', kind = 'all', outcome = 'all' } = {}) {
  const text = query.trim().toLowerCase();
  return rows.filter(row => (kind === 'all' || row.kind === kind) && (outcome === 'all' || row.outcome === outcome) && (!text || [activityLabels[row.kind] || row.kind, row.path, row.outcome, row.sample ? 'Sample' : row.signed_in ? 'Account' : 'Visitor'].join(' ').toLowerCase().includes(text)));
}
export function trafficCSV(rows) {
  const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return '\uFEFF' + [['Date (UTC)', 'Unique browser visitors', 'Page views', 'Successful own-file cleanings'], ...rows.map(row => [row.date, row.visitors, row.pageViews, row.cleanings])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const metricInfo = {
  visitors: {label:'Unique visitors', description:'Distinct browsers with page views in this period. Browser numbers label this report only; they do not identify people.'},
  pageViews: {label:'Page views', description:'All tracked application pages, ranked by views. A browser visiting several pages is counted on each page.'},
  cleanings: {label:'Successful cleanings', description:'Successful own-file cleaning events. Sample runs and cancelled or failed attempts are excluded.'},
  failures: {label:'Failed operations', description:'Failed own-file imports, cleanings and exports. Spreadsheet contents, filenames and private error messages are not collected.'},
  newAccounts: {label:'New accounts', description:'Accounts created during this reporting period. These are separate from the total number of accounts.'},
  activeAccounts: {label:'Active accounts', description:'Accounts with at least one tracked event during this period, including page views, sign-ins and sample activity.'},
  imports: {label:'Files imported', description:'Successful own-file import events. Files are read on a device; their filenames and contents are not recorded here.'},
  exports: {label:'Exports prepared', description:'Successful own-file export preparation events. Preparing an export does not confirm that a browser saved the file.'}
};
export function metricTable(data){
  const fmt=n=>Number(n||0).toLocaleString(),utc=n=>n==null?'—':new Date(Number(n)).toISOString().replace('T',' ').slice(0,19);
  if(data.metric==='visitors')return {headers:['Browser','Page views','Pages visited','First seen (UTC)','Last seen (UTC)'],rows:data.items.map(r=>['Browser '+fmt(r.browser),fmt(r.pageViews),fmt(r.pages),utc(r.firstSeen),utc(r.lastSeen)])};
  if(data.metric==='pageViews')return {headers:['Page','Views','Visitors','Last viewed (UTC)'],rows:data.items.map(r=>[r.path,fmt(r.views),fmt(r.visitors),utc(r.lastSeen)])};
  if(data.metric==='newAccounts')return {headers:['Name','Email','Registered (UTC)'],rows:data.items.map(r=>[r.name||'—',r.email||'—',utc(r.createdAt)])};
  if(data.metric==='activeAccounts')return {headers:['Name','Email','Tracked events','Last active (UTC)'],rows:data.items.map(r=>[r.name||'—',r.email||'—',fmt(r.events),utc(r.lastSeen)])};
  return {headers:['Operation','Account','Email','Outcome','Rows × columns','Duration','Time (UTC)'],rows:data.items.map(r=>[activityLabels[r.kind]||r.kind,r.name||'—',r.email||'—',r.outcome,r.rows==null?'—':fmt(r.rows)+' × '+fmt(r.columns),r.durationMs==null?'—':(r.durationMs/1000).toFixed(2)+'s',utc(r.createdAt)])};
}
