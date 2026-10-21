# Cleaning outcome charts

These are per-run figures generated with Seaborn and Matplotlib, embedded in the existing cleaner. They are not application visitor statistics.

| Figure | Question | Reviewed data | Form |
| --- | --- | --- | --- |
| Rows kept and removed | Which rules retained or removed submitted rows? | Mutually exclusive final row outcomes; counts sum to rows submitted for this run | Horizontal bars, zero baseline, exact counts |
| Missing values by column | Where did missingness change? | Top 12 input columns by initial missing count, with independent phase row denominators; removed columns have no after percentage | Grouped horizontal bars, 0–100%; removed columns labelled explicitly |
| Numeric distributions | How did explicitly numeric columns change? | Up to three configured numeric columns, at least five usable values in each phase; finite numbers within ±1e100 only for stable chart arithmetic | Before/after horizontal box plots, shared value axis within each column |

Before uses worksheet values after reviewed edits/merges and before this cleaning pass. After uses rows retained by this pass. Duplicate removal is performed after normalization. Empty required or referenced columns remain for review. Numeric parsing keeps cleaned values as exact decimal strings; chart coordinates are approximate floating-point values. Numbers outside ±1e100 are excluded from figures only and are included in the exclusions table; their cleaned strings remain intact. Box plots expose outliers without removing them. Slate represents before; olive represents after, with direct phase labels and exact tables so colour is not the only distinction. PNGs and chart data tables are available for download/review. Files and figures are held in memory for the request and returned to the requesting tab; the service does not persist datasets.
