# TidySheet

A browser-local CSV and Excel cleaner with direct, free access. The landing page's cleaning buttons open the uploader, where visitors sign in or register to import, clean, review and export their own files. The sample remains available without an account; business cleaning needs no subscription. The navbar stays visible while scrolling.

Training dataset preparation retains its account and entitlement checks, with a **$0, 7-day trial** and **Premium at $20 USD/month or $240 USD/year**. Legacy Regular subscriptions remain supported by the billing backend. The cleaner and sample remain publicly accessible on both deployments. Users sign in or register before importing their own files. Accounts, billing, training workspaces, and the admin dashboard have server-side access checks.

## Billing activation status

The SaaS code and database migration are implemented. Live checkout remains unavailable until an activated Paystack account, secret key, and three matching USD plan codes are configured. Missing or mismatched prices fail closed. Payment-provider interactions are tested against controlled API fixtures, not a live card charge.

See [Billing setup](docs/BILLING_SETUP.md) for the remaining merchant setup, runtime secret names, webhook URL, and verification steps. Never commit payment secrets or paste them into GitHub issues.

## Local development

Requires Node.js **22.13 or later** and npm. Python is no longer required.

The Cloudflare toolchain is pinned together: Wrangler `4.151.2`, Workers types `5.20261019.1`, and Vite plugin `1.64.0`. Commit both `package.json` and `package-lock.json` when changing these versions, and use `npm run install:ci` (or `npm ci`) in build environments. Wrangler `4.151.2` requires Workers types `^5.20261019.1`; the older `4.20260515.1` pin causes npm `ERESOLVE` if Wrangler is upgraded alone. Resolve the package versions rather than using `--force` or `--legacy-peer-deps`.

For Cloudflare Workers Builds, use `npm run build` as the build command and `npm run deploy` as the deploy command. The deploy script calls the installed Wrangler directly and passes `dist/server/wrangler.json`, avoiding framework auto-configuration and a separate latest-version install. The build must use the GitHub branch containing these dependency files; retrying an older commit keeps its old Workers types pin. Sites publication and GitHub pushes are separate operations.

For a separate Cloudflare Worker, create a D1 database named `tidy-sheet-production` in the same account, then set the build variable `TIDYSHEET_D1_DATABASE_ID` to its actual database ID before building. The Vite configuration emits the real `DB` binding and points Wrangler migrations to `drizzle/`. Do not edit generated `dist/server/wrangler.json`; each build recreates it. Apply all pending schema migrations before deploying:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config dist/server/wrangler.json
```

This command needs a Cloudflare credential with D1 write access. The database can also be initialized through its dashboard SQL console using the existing migration files in order. Do not replay already applied migrations. Leave `TIDYSHEET_D1_DATABASE_ID` unset for local previews and Sites publication, where Sites provisions the hosted database. Local previews continue to use a placeholder ID with Wrangler's `--local` flag.

Standalone builds also emit `TIDYSHEET_IDENTITY_MODE=disabled`: they cannot trust the Sites identity headers without its gateway. Public pages and the free sample remain available. Email-and-password registration, sessions and recovery codes work on both deployments. Sites publication also preserves native ChatGPT sign-in. Password accounts are never automatically linked to a ChatGPT account with the same email.

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

The business cleaner shell is public, and choosing an own file opens an authentication dialog. A dropped file is retained only in memory while the visitor signs in; canceling the dialog leaves the sample available. Imported contents and filenames never leave the device. Own-file cleaning checks an active login; business access is free, while training retains its entitlement checks. Bounded processing metadata and page paths feed an administrator-only dashboard. The sample URL preloads example data and own-file importing still requires sign-in. **The cleaning engine is open-source client code**; browser-only execution cannot provide DRM over it.

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

The business workspace analyzes null and missing values on import and after cleaning. Per-column counts separate blanks (including whitespace) from exact, case-insensitive markers: N/A, NA, null, none, nil, undefined, and one or more dashes. Zero and false remain values. Before counts use all imported rows; after counts use retained cleaned rows, with separate percentage denominators. Analysis includes markers even when conversion to blanks is disabled. Cleaning does not fill missing cells. Download a standalone CSV report, or find the comparison in the Excel export's **Null analysis** worksheet.

Excel exports retain text phone numbers and IDs and export safe amounts with up to 15 digits as numbers. Longer amounts remain strings. CSV exports use proper quoting and prefix formula-like text, including +254 phone strings, with an apostrophe. A complete change log is available for business cleaning. Training exports include preparation reports and source-row mapping, which can contain original labels and filenames; handle exports with the same care as the source data.

## Third-party software

SheetJS Community Edition 0.20.3 is bundled from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/). Its Apache 2.0 license is in `public/assets/vendor/SHEETJS-LICENSE.txt`. The supplied Sites/Vinext build integration and its license are preserved under `build/`.


## Business workflows

The business workspace now provides Customer, Sales/invoice, Inventory and Supplier templates. General cleaning retains the existing exact-row deduplication default; business templates default to keeping transaction rows. Inventory presets flag negative stock, and a Sales template adds date-order and quantity × price checks when matching columns exist. Review the inferred fields before cleaning.

Each column supports optional/required, explicit missing-row removal, or a chosen fill value; numeric bounds; approved categories; and exact, case-insensitive alias-to-category mappings. Missing policies recognize the markers documented above. Required fields flag retained rows. Format-based removal and missing-policy removal are separate, explicit settings. Category mappings must point directly to a final label, avoiding cascading changes on repeat runs.

Cross-field checks flag a delivery date before an order date or a total outside a selected quantity × price tolerance. Totals use exact decimal arithmetic through six places; invalid or excessive-precision inputs are marked as uncheckable. Numeric bounds also preserve decimal precision. Business validation flags issues without silently removing those rows. Quality output distinguishes required completeness, flagged cells, configured consistency checks, duplicate decisions, and descriptive date coverage. Accuracy against authoritative records is **not verified**.

Possible entity duplicates are optional and bounded: normalized company/name comparisons within the same first two normalized characters and optional exact group, up to 64 candidates per group, 200,000 comparisons and 200 suggestions. Values longer than 120 characters are skipped. Similarity is a string heuristic, not proof of identity. Review each value before approving a merge; keep-both and merge decisions enter the change log. Undo last merge restores the two records. Original imported rows remain available separately. Repeated purchases by a customer can be valid.

Business summaries require confirmation of the amount meaning, date, units and currency mappings. They include monthly totals by currency, category counts, missing IDs, and format-valid contact coverage. Decimal sums preserve up to six places; amounts with invalid formats, currency conflicts or extra precision are excluded and counted. Invalid dates enter an Undated bucket, and currencies are never converted or added together. Excel exports include Null analysis, Quality report, and configured Business summary sheets. CSV reports are available separately.

Saved templates are device-local settings scoped to the signed-in site identity (the free sample has its own namespace). They include column names and user-entered mappings, **not spreadsheet rows**. Explicit JSON export/import enables reuse on another device. Applying a template requires the same named columns; column order may differ. Browser storage clearing removes the saved settings. This does not create cloud spreadsheet history.

## Processing performance and measurement

Business CSV imports decode UTF-8 incrementally, including quoted newlines and split multibyte characters. Import preparation and missing-value profiling, complete datasets, corrections, search/filtering, processing and exports stay in the worker. The UI receives metadata and 50-row pages; it does not clone complete datasets into the main thread for every cleaning run. CSV exports use transferable chunks and Excel generation uses dense worksheets and compression. XLS/XLSX parsing and workbook generation still require in-memory workbook representations; large Excel exports use substantially more memory than CSV.

Cancelling business processing terminates the worker. The source File, manual corrections and reviewed merges remain in the current tab and are reapplied on retry; fresh results require cleaning again. Cancelling training processing resets that workspace and asks the user to choose the source files again. Closing or refreshing the tab clears source data and review decisions.

Signed-in processing emits best-effort, tenant-scoped counts and timings: import/clean/export, success/failure/cancelled, dimensions, duration, and time to first prepared export. Free business and training samples are excluded from these performance events. No filenames, column names, errors containing data, or spreadsheet values are accepted by the endpoint. Events are client-reported operational metrics, not billing authority. The account page shows prepared exports, failures, average cleaning time, first-export time and active weeks over eight weeks. A prepared export does not prove that the browser saved the file.

Run `npm run benchmark` to reproduce `docs/performance-latest.json`. It processes synthetic 10k, 50k and 100k-row normal, malformed-value, long-text and 10-column files in isolated Node worker-source harnesses. Every case verifies row retention, CSV, quality-report and XLSX generation, and records timings and peak RSS. These are Node measurements on the recorded host, not browser guarantees or a universal speed claim. Browser QA separately checks templates, summary mappings, review/undo, and responsive controls. Existing limits remain 20 MB, 100,000 data rows, 100 columns and 1 million input cells.

Local previews require the additive `drizzle/0002_military_adam_destine.sql` migration for the operational metrics table. Hosted deployment applies the generated schema migration through Sites before updating the Worker.


## Login and administration

`/register` and `/login` use D1-backed email/password accounts on both hosts. Passwords are salted scrypt hashes with N=16384, r=8, p=5 (16 MiB working memory); Node-compatible crypto runs server-side. Passwords must be 15–128 characters. HTTPS sessions use a seven-day, Secure, HttpOnly, SameSite=Lax `__Host-` cookie; D1 stores only a SHA-256 token hash. Login rotates the current session, logout deletes it, and expiry is checked on every request. Cross-origin writes are rejected. D1-backed 15-minute limits cover login, registration, recovery, admin activation and analytics; raw IP addresses are not stored. Email addresses on password accounts are unverified and confer no privileges.

Registration displays a recovery code once. `/api/auth/recover` requires that code, rotates it, changes the password, and revokes all sessions. No reset email or email provider is configured. The UI tells users to keep their recovery code. Do not seed production credentials, choose user passwords, or grant administrator access to the first registrant.

`/admin` and `/api/admin/overview?days=7|30|90` require a row in `administrators` for the authenticated account ID. The dashboard includes browser visitors, page views, new/active accounts, own-file imports/cleanings/exports, failures, operation durations, UTC daily traffic, popular paths and recent activity. Empty periods show zeros. Browser-reported metrics are approximate and may be blocked or falsified; they are not billing or security-audit evidence. Samples are separated, exports mean prepared files, and imports happen locally. No spreadsheet contents, filenames, query strings or raw user-agent data are recorded. A first-party random visitor cookie lasts 30 days; analytics retention is 90 days with bounded cleanup on writes. Each deployment has its own database and statistics.

To invite the first administrator, generate a cryptographically random 20-byte hex code outside the repository. Configure runtime secrets `ADMIN_INVITE_EMAIL` and `ADMIN_INVITE_HASH` (SHA-256 of the raw code) on the deployment. Give the raw code privately to the invited person. They register/sign in, open `/admin`, and enter the code themselves. Activation requires both the matching account email and possession of the code. A transaction consumes the invitation and creates membership; revoking membership does not make that code reusable. Never place codes or user passwords in Git, build variables, URLs or public HTML. Runtime secrets survive standalone Wrangler builds; apply Sites environment changes with a new deployment. Native ChatGPT identities and password accounts remain separate, so activate using the identity you will use for administration.

Apply additive migrations `0003_common_multiple_man.sql` and `0004_high_the_order.sql` after earlier migrations in an existing standalone D1 database. Sites applies them during deployment. They contain schema only and never pre-create an admin. `tests/accounts-admin.test.mjs` verifies sessions, recovery, throttling, invitation consumption, server-side role checks, visitor counting and UTC filters with SQLite and the real server modules.
