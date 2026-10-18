# TidySheet

A subscription service for cleaning CSV and Excel files, with a landing page, ChatGPT sign-in, account dashboard, Paystack billing, and a browser-local cleaner. The navbar stays visible while scrolling.

Start with a **$0, 7-day trial**, with no card required. **Regular is $10 USD/month** for business cleaning. **Premium is $20 USD/month or $240 USD/year** for business cleaning and training dataset preparation. A built-in business sample is available without signing in. The landing page and workspace chooser are public; customer workspaces require sign-in and entitlement checks.

## Billing activation status

The SaaS code and database migration are implemented. Live checkout remains unavailable until an activated Paystack account, secret key, and three matching USD plan codes are configured. Missing or mismatched prices fail closed. Payment-provider interactions are tested against controlled API fixtures, not a live card charge.

See [Billing setup](docs/BILLING_SETUP.md) for the remaining merchant setup, runtime secret names, webhook URL, and verification steps. Never commit payment secrets or paste them into GitHub issues.

## Local development

Requires Node.js **22.13 or later** and npm. Python is no longer required.

```sh
git clone https://github.com/DengAchiek/tidy-sheet.git
cd tidy-sheet
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_deep_bulldozer.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_soft_shaman.sql
npm run dev -- --port 5173 --hostname 127.0.0.1
```

Open the printed loopback URL. `Continue with ChatGPT` simulates a synthetic local user in development only. Production authentication is owned by the Sites platform. Application code does not implement or trust custom login cookies or client-supplied user IDs. `npm start` previews a built Worker and does not simulate sign-in.

The optional `tests/fixtures/local-trial.sql` grants the synthetic local user a one-hour trial for browser QA. Apply it only with Wrangler's **--local** flag after signing in locally. It is not a production migration and is never seeded during deployment.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover the cleaner, CSV/XLS/XLSX import/export, actual processing workers, signed billing webhooks, approved USD prices, monthly/annual access periods, tenant-bound payment verification, replay protection, cancellation, refunds, and test/live separation. Billing tests use an in-memory SQLite database and mocked provider responses; no test charges money.

Browser QA covers account creation, access checks, the free sample, a synthetic trial, workbook import/cleaning, workspace choice, training preparation and bundle download, usage counts, responsive pricing, and sticky navigation.

## Architecture

- `app/route.ts`, `app/[...path]/route.ts`: dynamic server routes using Vinext on Cloudflare Workers.
- `server/router.ts`: signed-in account, subscription, and usage authorization.
- `server/billing.ts`: Paystack checkout, provider verification, recurring events, and hosted billing management.
- `server/policy.mjs`: entitlement, price, origin, signature, and payment-validation rules.
- `server/store.ts`, `db/schema.ts`, `drizzle/`: D1 account, billing, receipt, event, and usage records.
- `server/templates/`: landing page, cleaner, and privacy HTML rendered by the server.
- `public/assets/`: browser-local business and training preparation engines, workers, styles, and bundled SheetJS library.
- `.openai/hosting.json`: existing Site identity and D1 binding. No secrets.

The full cleaner route is authorized server-side. Before each non-sample cleaning run, the browser also requests server authorization and records only row/column counts. Download controls recheck entitlement. **The cleaning engine is open-source client code**, so a user can self-host or reuse it; this subscription sells access to the hosted service, not an uncopyable algorithm. Browser-only execution cannot provide DRM over the cleaner itself.

## Account and subscription behavior

- Native ChatGPT identity supplies a site-specific user ID and verified contact information. D1 records and API operations are scoped to that ID.
- Only verified Paystack payments can extend paid access. A success URL or client-side flag cannot activate a subscription.
- Monthly and annual plans must match the approved USD amounts, intervals, and configured provider plan codes.
- Paid access expires at the recorded provider period end. Cancelling renewal preserves the already-paid period; a status refresh alone never extends it.
- Refunds and disputes revoke paid access. Replayed callbacks/webhooks do not restore a reversed payment or create duplicate receipts.
- Paystack test subscriptions cannot unlock live-mode access. Missing credentials never create a fake subscriber.
- `Manage billing` opens Paystack to update payment details or cancel renewal. To change billing cycle, cancel the existing renewal and choose the new cycle after the previous subscription ends. Prorated plan changes are not implemented.
- Trials default to **7 days** and are issued once per site account. Repeated sign-in cannot extend a trial. Trials expire without charging a card. A free sample remains available without payment or an account.

## Training dataset preparation

Choose Business operations or Model training before uploading. Training preparation supports classification, regression, clustering/unsupervised, text/NLP, time series, and image/audio **annotation tables**. It prepares and exports data; it does not train models or process raw image/audio files. Text tokenization, augmentation, embeddings, sliding windows, and model-specific transforms belong in the downstream training pipeline.

- Import UTF-8 CSV/TSV, XLS/XLSX (choose a worksheet per file), JSON arrays of objects, or JSONL records. Combine up to 5 files (20 MB each, 40 MB total). Matching columns align by name; explicit union mode fills absent columns with blanks. Nested JSON is preserved as text.
- Inspect missing counts, unique values and examples, then confirm numeric/categorical/text/ignored roles and the target. ID-like columns default to Ignore. Users must exclude target leakage and choose an appropriate split.
- Configure missing tokens, numeric median/mean/zero imputation or row removal, categorical missing bucket/mode or row removal, one-hot/ordinal/preserved categories, standard/min-max/no scaling, outer trimming, duplicate removal, and training-constant feature removal.
- Choose seeded random, target-stratified, chronological ISO date/time, or group-preserving splits. The target is never imputed, encoded or scaled. Missing targets and invalid numeric regression targets are removed and logged. Chronological splitting is by records, without automatic temporal windows or gaps.
- All fitted imputation statistics, category vocabularies, constant-column decisions and scaling use **training rows only**. Unknown categories get explicit flags or sentinels. Small/empty splits and single-class labels produce review warnings.
- Export a ZIP with train/validation/test CSV and JSONL, fitted preprocessing manifest, quality report, source-column profile, and source-row mapping. A separate training JSONL download is available. JSONL preserves exact text and numeric types. Optional formula escaping modifies CSV text for spreadsheet viewing; it defaults off for training input.

Input limits are shared across the combined dataset: 100,000 rows, 100 columns and 1 million cells. Output is capped at 500 features and 2 million cells; one-hot columns support up to 50 observed training categories each. Large encoded output fails clearly. Export bundles are capped at 80 MB. The manifest records transformations and fitted values; users apply them consistently to future inference data in their pipeline.

## Privacy and limits

Spreadsheet contents, filenames, and cleaned output stay in the tab and processing worker. The server stores account identity, billing references/status, paid-access dates, and workspace mode and cleaning counts/timestamps. Paystack stores payment details. Card numbers and payment authorization tokens are never stored by TidySheet.

Refreshing/closing the cleaner clears spreadsheet data. Account and billing records persist. Export before closing. There is no cloud spreadsheet history or file upload endpoint.

Limits remain 20 MB per file, 100,000 data rows, 100 columns, and 1,000,000 cells per sheet. CSV/TSV must be UTF-8. Only the selected sheets are processed. Source formulas, formatting, macros, and unrelated sheets are not retained. Recalculate/save formula workbooks before import; only saved formula results are available.

Invalid values are preserved unless the user explicitly removes their rows. Duplicate removal keeps the first matching record, without merging records; blank or invalid selected keys are excluded. Numeric dates use an explicit date order and four-digit years.

Excel exports retain text phone numbers and IDs and export safe amounts with up to 15 digits as numbers. Longer amounts remain strings. CSV exports use proper quoting and prefix formula-like text, including +254 phone strings, with an apostrophe. A complete change log is available for business cleaning. Training exports include preparation reports and source-row mapping, which can contain original labels and filenames; handle exports with the same care as the source data.

## Third-party software

SheetJS Community Edition 0.20.3 is bundled from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/). Its Apache 2.0 license is in `public/assets/vendor/SHEETJS-LICENSE.txt`. The supplied Sites/Vinext build integration and its license are preserved under `build/`.
