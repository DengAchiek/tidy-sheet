"""Seaborn figures use exact counts and explicit before/after populations."""
from __future__ import annotations

import base64
import io
import os
import textwrap

os.environ.setdefault("MPLCONFIGDIR", "/tmp/tidysheet-matplotlib")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from cleaning import normalize_number

BEFORE = "#64748b"
AFTER = "#56703d"
INK = "#26332a"


def image_for(fig, key, title, description, rows):
    stream = io.BytesIO()
    try:
        fig.savefig(stream, format="png", dpi=135, facecolor="white", bbox_inches="tight")
    finally:
        plt.close(fig)
    return dict(id=key, title=title, description=description, image="data:image/png;base64," + base64.b64encode(stream.getvalue()).decode(), data=rows)


def title_for(ax, title, subtitle):
    ax.set_title(title, loc="left", fontsize=15, color=INK, fontweight="bold", pad=32)
    ax.text(0, 1.035, subtitle, transform=ax.transAxes, fontsize=9, color="#637068", va="bottom", wrap=True)


def make_charts(original, cleaned, result, before, config):
    sns.set_theme(style="whitegrid", font="DejaVu Sans", rc={"axes.spines.top": False, "axes.spines.right": False, "axes.labelcolor": INK, "text.color": INK, "grid.color": "#e9ece6", "axes.edgecolor": "#bec7bc"})
    charts = []
    stats = result["stats"]
    outcomes = [("Rows kept", stats["output"]), ("Empty rows", stats["empty"]), ("Duplicate rows", stats["duplicates"]), ("Missing-value policy", stats["businessDropped"]), ("Invalid-value policy", stats["dropped"])]
    rows = [{"outcome": name, "rows": n, "inputRows": stats["input"]} for name, n in outcomes]
    fig, ax = plt.subplots(figsize=(9, 4.2))
    sns.barplot(data=pd.DataFrame(rows), x="rows", y="outcome", color=AFTER, edgecolor=INK, linewidth=.6, ax=ax)
    ax.set_xlim(0, max(stats["input"] * 1.16, 1))
    for bar, (_, n) in zip(ax.patches, outcomes):
        ax.text(bar.get_width() + max(stats["input"] * .015, .03), bar.get_y() + bar.get_height() / 2, f"{n:,}", va="center", fontsize=10)
    ax.set(xlabel="Rows", ylabel="")
    ax.xaxis.set_major_locator(plt.MaxNLocator(integer=True))
    title_for(ax, "Rows kept and removed", f"{stats['input']:,} rows submitted for this run · Each row appears in one outcome")
    charts.append(image_for(fig, "row-outcomes", "Rows kept and removed", "Counts partition the rows submitted to this cleaning run. Reviewed merges made before this run are not counted again.", rows))

    after = {c["name"]: c for c in result["nullAnalysis"]["columns"]}
    selected = sorted(before["columns"], key=lambda c: c["missing"], reverse=True)[:12]
    table = []
    plot = []
    labels = []
    for i, column in enumerate(selected):
        name = column["name"]
        label = textwrap.fill(f"{i + 1}. " + (name if len(name) <= 64 else name[:61] + "…"), 28)
        labels.append(label)
        next_column = after.get(name)
        table.append(dict(column=name, beforeMissing=column["missing"], beforeRows=before["rowCount"], beforePercent=column["percentage"], afterMissing=next_column["missing"] if next_column else None,
                          afterRows=result["nullAnalysis"]["rowCount"], afterPercent=next_column["percentage"] if next_column else None, status="Kept" if next_column else "Removed empty column"))
        plot.append({"column": label, "phase": "Before", "percentage": column["percentage"]})
        if next_column:
            plot.append({"column": label, "phase": "After", "percentage": next_column["percentage"]})
    fig, ax = plt.subplots(figsize=(9, max(4.2, len(selected) * .55 + 1.5)))
    sns.barplot(data=pd.DataFrame(plot), x="percentage", y="column", hue="phase", order=labels, hue_order=["Before", "After"], palette={"Before": BEFORE, "After": AFTER}, edgecolor=INK, linewidth=.45, errorbar=None, ax=ax)
    for i, column in enumerate(selected):
        if column["name"] not in after:
            ax.text(1.5, i + .2, "Column removed", va="center", fontsize=9, color=INK)
    ax.set(xlim=(0, 105), xlabel="Missing values (%)", ylabel="")
    ax.legend(title=None, loc="lower right", frameon=True)
    title_for(ax, "Missing values by column", f"Top {len(selected)} of {len(before['columns'])} columns · Before: {before['rowCount']:,} rows · After: {len(cleaned):,} rows")
    charts.append(image_for(fig, "missing-values", "Missing values by column", "Percentages use each phase’s own row count. Removed columns are labelled as removed, not shown as 0% missing. Includes blanks and recognized null markers.", table))

    numeric = []
    numeric_rows = []
    for i, kind in enumerate(config["types"]):
        if kind != "number" or i not in result["outputColumnIndices"]:
            continue
        groups = []
        counts = []
        for phase, frame in [("Before", original), ("After", cleaned)]:
            parsed = []
            excluded = 0
            for value in frame.iloc[:, i]:
                text, error = normalize_number(value.strip())
                try:
                    n = float(text) if not error else np.nan
                except (ValueError, OverflowError):
                    n = np.nan
                if np.isfinite(n) and abs(n) <= 1e100:
                    parsed.append(n)
                else:
                    excluded += 1
            summary = dict(column=original.columns[i], phase=phase, included=len(parsed), excluded=excluded, rows=len(frame))
            if parsed:
                q1, median, q3 = np.percentile(parsed, [25, 50, 75])
                spread = q3 - q1
                summary.update(minimum=float(np.min(parsed)), q1=float(q1), median=float(median), q3=float(q3), maximum=float(np.max(parsed)),
                               outliers=int(np.count_nonzero((np.asarray(parsed) < q1 - 1.5 * spread) | (np.asarray(parsed) > q3 + 1.5 * spread))))
            counts.append(summary)
            groups += [{"phase": phase, "value": v} for v in parsed]
        if min(c["included"] for c in counts) < 5:
            continue
        numeric.append((original.columns[i], groups, counts))
        numeric_rows.extend(counts)
        if len(numeric) == 3:
            break
    if numeric:
        fig, axes = plt.subplots(len(numeric), 1, figsize=(9, 3.2 * len(numeric)), squeeze=False)
        for ax, (name, groups, counts) in zip(axes.flat, numeric):
            sns.boxplot(data=pd.DataFrame(groups), x="value", y="phase", hue="phase", order=["Before", "After"], hue_order=["Before", "After"], palette={"Before": BEFORE, "After": AFTER}, legend=False, linewidth=.8, fliersize=2, ax=ax)
            ax.set(xlabel=name if len(name) <= 80 else name[:77] + "…", ylabel="")
            title_for(ax, "Numeric distribution · " + (name if len(name) <= 50 else name[:47] + "…"), f"Usable values: {counts[0]['included']:,} before · {counts[1]['included']:,} after · Outliers shown, not removed automatically")
        fig.subplots_adjust(hspace=1.1)
        charts.append(image_for(fig, "numeric-distributions", "Numeric distributions", "Up to three explicitly numeric columns with at least five usable values per phase. Boxes show quartiles; whiskers use 1.5×IQR. Invalid, missing, non-finite values and numbers outside ±1e100 are excluded from the figure only; the dataset retains them.", numeric_rows))
    return charts
