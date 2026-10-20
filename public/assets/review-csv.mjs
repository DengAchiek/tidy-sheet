function cell(value){let text=String(value??'');if(/^[\s\uFEFF]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
export function reviewsCSV(rows){
  return '\uFEFF'+[['Name','Email','Rating','Review','Status','Submitted (UTC)','Reviewed (UTC)'],...rows.map(r=>[r.name,r.email,r.rating,r.comment,r.status,new Date(r.createdAt).toISOString(),r.reviewedAt==null?'':new Date(r.reviewedAt).toISOString()])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
