# TidySheet

A working, private spreadsheet cleaner rebuilt from the two original HTML prototypes. The originals in the parent folder remain available for reference.

## Run locally

Requires Node.js (for tests) and Python 3 (for the local server). No package installation or API key is required.

```sh
cd /Users/dengachiek/Downloads/files/tidysheet
npm start
```

Open http://127.0.0.1:4173. Use an HTTP server rather than opening the HTML as a file: background workers are restricted on `file://` pages. The app and Excel library are bundled locally, so local operation has no runtime CDN dependency.

## Workflow

1. Open the cleaner and select CSV, TSV, XLSX, or XLS. CSV/TSV must be UTF-8.
2. Choose the worksheet and confirm whether the first row is a header. Excel import skips an empty cover sheet when a usable sheet follows.
3. Confirm each column's type. Company names and IDs stay text by default; inferred person names can be title-cased.
4. Choose numeric date order, blank handling, and duplicate keys. No selected keys means whole-row matching. Selected keys must all be present and valid. First matching row wins; records are not merged.
5. Clean, compare original and cleaned previews, search or filter rows, and review invalid cells. Manual corrections trigger a fresh clean and are included in the log.
6. Download Excel, CSV, or the complete change log.

## Data handling

- File content stays in the tab and its processing worker. The app has no upload endpoint, analytics, browser-storage writes, or backend database.
- Refresh/close clears the session. New file clears the workspace and resets rules. Download before leaving.
- Limits: 20 MB per file, 100,000 data rows, 100 columns, and 1,000,000 cells per sheet.
- Processing occurs off the main thread. Cancel terminates the worker; changing sheets lazily restores the workbook.
- Invalid values remain exactly as imported unless the user chooses to remove their rows.
- Logs use source worksheet/CSV record numbers, including the header. For CSVs containing embedded newlines, these are logical record numbers, not physical text line numbers.
- Numeric dates require four-digit years. Day/month/year is the default; ambiguous dates obey the selected order.
- Validation checks syntax; it does not verify contact activity, deliverability, ownership, or real-world accuracy.

## Export details

- Exports contain tabular values from one sheet. Original formulas, workbook styling, macros, and unrelated sheets are not retained. Recalculate/save formula workbooks before import; only cached results are available.
- Excel exports include Cleaned, Issues, and Summary worksheets. Phone numbers, IDs, and formula-looking text are string cells. Cleaned amounts with at most 15 digits become numbers; longer amounts remain strings to preserve precision.
- CSV and log exports include a UTF-8 BOM, CRLF record endings, proper field quoting, and apostrophe escaping for formula-like text. This includes +254 phone strings; choose Excel to preserve those phone strings without a visible CSV escape prefix.
- The change log includes standardized cells, manual corrections, removed empty rows, removed duplicates, and validation issues. “Values standardized” counts changed cells across all input rows, including later-removed rows; rows to review counts retained rows only.

## Files

- `dist/index.html`: landing page
- `dist/sheet-cleaner.html`: application
- `dist/privacy.html`: data behavior and limits
- `dist/assets/core.js`: pure parsing, validation, cleaning, and CSV export
- `dist/assets/worker.js`: CSV/Excel imports, background cleaning, and Excel export
- `dist/assets/app.js`: workspace interactions and downloads
- `dist/assets/styles.css`: responsive shared design
- `dist/assets/vendor/`: SheetJS 0.20.3 and Apache 2.0 license
- `tests/`: regression tests and generated synthetic fixtures

## Verify

```sh
npm test
```

Tests cover quoted and malformed CSVs, headerless/ragged data, duplicate-key safety, invalid-value preservation, date order and leap years, precision, CSV formula protection, actual worker operations, multi-sheet XLSX, legacy XLS, custom Excel date formats, row references, encoding errors, and XLSX exports.

Browser QA also checks sample import, manual correction, Excel download, actual Excel upload, worksheet switching, empty-sheet recovery, paging/search, rule invalidation, and responsive layouts.

## Product scope

This is a complete free browser utility. It does not include subscriptions, payments, accounts, cloud storage, CRM connections, or a managed cleaning service. The former $9 offer and external prototype links were removed because those services were not implemented. A private hosted deployment provides owner-only access; making it publicly accessible is a separate audience choice.

## Third-party component

SheetJS Community Edition 0.20.3 is bundled from the official source described at https://docs.sheetjs.com/docs/getting-started/installation/standalone/. Its license is in `dist/assets/vendor/SHEETJS-LICENSE.txt`.
