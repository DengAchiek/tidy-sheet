import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewsCSV} from '../public/assets/review-csv.mjs';
test('Review CSV exports quote multiline feedback, preserve UTF-8 and neutralize spreadsheet formulas',()=>{
 const csv=reviewsCSV([{name:'=HYPERLINK("bad")',email:'client@example.com',rating:3,comment:'  @SUM(1,2)\n"A quoted note" — café',status:'new',createdAt:0,reviewedAt:null}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"'=HYPERLINK\(""bad""\)"/);assert.match(csv,/"'  @SUM\(1,2\)\n""A quoted note"" — café"/);assert.match(csv,/1970-01-01T00:00:00.000Z/);assert.ok(csv.endsWith('\r\n'));
});
