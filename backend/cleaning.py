"""Bounded, stateless data cleaning. Values remain strings to preserve identifiers."""
from __future__ import annotations

import calendar
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext

import numpy as np
import pandas as pd

MAX_ROWS = 50_000
MAX_CELLS = 100_000
MAX_COLUMNS = 100
MAX_EVENTS = 10_000
TYPES = {"text", "name", "email", "phone", "date", "number"}
MARKER = re.compile(r"(?:n/a|na|nan|nat|null|none|nil|undefined|-+)", re.I)


def missing(value):
    text = str(value if value is not None else "").strip()
    return not text or bool(MARKER.fullmatch(text))


def normalize_number(text):
    value = re.sub(r"^(?:KES|KSHS?\.?|USD|EUR|GBP|[$€£])\s*", "", text, flags=re.I)
    value = re.sub(r"\s*(?:KES|KSHS?\.?|USD|EUR|GBP)$", "", value, flags=re.I)
    negative = value.startswith("(") and value.endswith(")")
    if negative:
        value = value[1:-1]
    if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", value):
        return text, "Use digits, a decimal point and valid thousands separators."
    if negative and value.startswith(("+", "-")):
        return text, "Use parentheses or a minus sign, not both."
    value = value.replace(",", "")
    sign = "-" if negative or value.startswith("-") else ""
    value = value.lstrip("+-")
    whole, _, fraction = value.partition(".")
    whole = whole.lstrip("0") or "0"
    fraction = fraction.rstrip("0")
    if not any(c in "123456789" for c in whole + fraction):
        sign = ""
    return sign + whole + ("." + fraction if fraction else ""), None


def normalize_date(text, order):
    if match := re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", text):
        year, month, day = map(int, match.groups())
    elif match := re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", text):
        a, b, year = map(int, match.groups())
        day, month = (a, b) if order == "DMY" else (b, a)
    else:
        match = re.fullmatch(r"(\d{1,2})[\s-]+([a-z]+)[\s,-]+(\d{4})", text, re.I)
        if match:
            day, name, year = match.groups()
        elif match := re.fullmatch(r"([a-z]+)[\s-]+(\d{1,2}),?[\s-]+(\d{4})", text, re.I):
            name, day, year = match.groups()
        else:
            return text, "Use a complete date with a four-digit year and the selected date order."
        months = {n.lower(): i for i, n in enumerate(calendar.month_name) if n}
        months.update({n.lower(): i for i, n in enumerate(calendar.month_abbr) if n})
        month, day, year = months.get(name.lower(), 0), int(day), int(year)
    try:
        if year < 1000:
            raise ValueError()
        return date(year, month, day).isoformat(), None
    except ValueError:
        return text, "This calendar date does not exist. Check the day, month and year."


def normalize_value(value, kind, config):
    if not value:
        return value, None
    if kind == "number":
        return normalize_number(value)
    if kind == "date":
        return normalize_date(value, config.get("dateOrder", "DMY"))
    if kind == "name" and config.get("titleCase"):
        text = value.lower()
        return re.sub(r"(^|[\s\-'’])([^\W\d_])", lambda m: m[1] + m[2].upper(), text), None
    if kind == "phone":
        if not re.fullmatch(r"\+?[\d\s().-]+", value):
            return value, "Use a Kenyan mobile number such as 0712345678 or +254712345678."
        digits = re.sub(r"[\s().-]", "", value).lstrip("+")
        if digits.startswith("00254"):
            digits = digits[2:]
        if re.fullmatch(r"0[17]\d{8}", digits):
            digits = "254" + digits[1:]
        elif re.fullmatch(r"[17]\d{8}", digits):
            digits = "254" + digits
        return ("+" + digits, None) if re.fullmatch(r"254[17]\d{8}", digits) else (value, "Expected 9 mobile digits after +254.")
    if kind == "email":
        text = value.lower()
        parts = text.split("@")
        local, domain = (parts + [""])[:2]
        labels = domain.split(".")
        valid = (len(parts) == 2 and len(text) <= 254 and len(local) <= 64
                 and re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.\-]+", local)
                 and not local.startswith(".") and not local.endswith(".") and ".." not in local
                 and len(domain) <= 253 and len(labels) >= 2
                 and all(len(p) <= 63 and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", p) for p in labels)
                 and re.fullmatch(r"[a-z]{2,63}", labels[-1]))
        return (text, None) if valid else (value, "Check the email format; the original value is preserved.")
    return value, None


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) - {"model", "config"}:
        raise ValueError("Provide a dataset and its cleaning rules.")
    model, config = payload.get("model"), payload.get("config")
    if not isinstance(model, dict) or not isinstance(config, dict):
        raise ValueError("Provide a dataset and its cleaning rules.")
    headers, rows, sources = model.get("headers"), model.get("rows"), model.get("sourceRows")
    if (not isinstance(headers, list) or not 1 <= len(headers) <= MAX_COLUMNS
            or any(not isinstance(h, str) or not h or len(h) > 200 for h in headers)
            or len(set(headers)) != len(headers)):
        raise ValueError("Use unique named columns, up to 100 columns.")
    if (not isinstance(rows, list) or len(rows) > MAX_ROWS or len(rows) * len(headers) > MAX_CELLS
            or not isinstance(sources, list) or len(sources) != len(rows)
            or any(type(n) is not int or not 1 <= n <= 1_000_001 for n in sources)
            or len(set(sources)) != len(sources)):
        raise ValueError("Server cleaning supports 50,000 rows and 100,000 cells per run.")
    if any(not isinstance(r, list) or len(r) != len(headers)
           or any(not isinstance(v, str) or len(v) > 10_000 for v in r) for r in rows):
        raise ValueError("Every row must match the headers and contain text values up to 10,000 characters.")
    booleans = ["trim", "nulls", "titleCase", "removeEmpty", "removeEmptyColumns", "removeDuplicates", "caseInsensitive", "dropInvalid"]
    if any(k in config and type(config[k]) is not bool for k in booleans):
        raise ValueError("Cleanup switches must be true or false.")
    types = config.get("types")
    if not isinstance(types, list) or len(types) != len(headers) or any(t not in TYPES for t in types):
        raise ValueError("Choose a supported type for every column.")
    if config.get("dateOrder", "DMY") not in {"DMY", "MDY"}:
        raise ValueError("Choose DMY or MDY date order.")
    keys = config.get("keys", [])
    col = lambda n: type(n) is int and 0 <= n < len(headers)
    if not isinstance(keys, list) or len(set(keys)) != len(keys) or not all(col(n) for n in keys):
        raise ValueError("Choose valid duplicate-key columns.")
    business = config.get("business", {})
    fields = business.get("fields", []) if isinstance(business, dict) else []
    if len(fields) != len(headers):
        raise ValueError("Business rules must match the dataset columns.")
    for i, f in enumerate(fields):
        if (not isinstance(f, dict) or f.get("name") != headers[i] or f.get("type") != types[i]
                or type(f.get("key")) is not bool or f.get("missing") not in {"optional", "review", "drop", "fill"}):
            raise ValueError("Check column types, duplicate keys and missing-value policies.")
        if f["missing"] == "fill" and (not isinstance(f.get("fill"), str) or missing(f["fill"]) or len(f["fill"]) > 1000):
            raise ValueError("Fill policies need a non-missing replacement up to 1,000 characters.")
        for bound in ["min", "max"]:
            v = f.get(bound, "")
            if not isinstance(v, str) or len(v) > 120 or v and normalize_number(v)[1]:
                raise ValueError("Numeric limits must be valid numbers up to 120 characters.")
        if f.get("min") and f.get("max") and Decimal(normalize_number(f["min"])[0]) > Decimal(normalize_number(f["max"])[0]):
            raise ValueError("Minimum cannot exceed maximum.")
        allowed, mappings = f.get("allowed", []), f.get("mapping", [])
        if (not isinstance(allowed, list) or len(allowed) > 200 or any(not isinstance(v, str) or len(v) > 1000 for v in allowed)
                or not isinstance(mappings, list) or len(mappings) > 200):
            raise ValueError("Use up to 200 valid categories and mappings per column.")
        names = {}
        for mapping in mappings:
            if not isinstance(mapping, dict) or any(not isinstance(mapping.get(k), str) or missing(mapping[k]) or len(mapping[k]) > 1000 for k in ["from", "to"]):
                raise ValueError("Mappings need non-missing source and destination values.")
            a, b = mapping["from"].strip().lower(), mapping["to"].strip().lower()
            if a in names:
                raise ValueError("Duplicate category mapping.")
            names[a] = b
        if any(v in names and names[v] != v for v in names.values()):
            raise ValueError("Map aliases directly to final categories, without chains.")
    rules = business.get("crossRules", [])
    if not isinstance(rules, list) or len(rules) > 30:
        raise ValueError("Use up to 30 cross-column checks.")
    for rule in rules:
        if not isinstance(rule, dict) or rule.get("kind") not in {"dateOrder", "total"} or rule.get("severity") not in {"error", "warning"}:
            raise ValueError("Choose valid cross-column checks and severity.")
        names = ["start", "end"] if rule["kind"] == "dateOrder" else ["qty", "price", "total"]
        if not all(col(rule.get(k)) for k in names):
            raise ValueError("Choose every column used by a business check.")
        if rule["kind"] == "total":
            tolerance = str(rule.get("tolerance", ""))
            if not re.fullmatch(r"\d+(?:\.\d{1,6})?", tolerance) or len(tolerance) > 120:
                raise ValueError("Use a non-negative tolerance with up to six decimal places.")
    for name, required in [("fuzzy", ["column", "scope"]), ("insights", ["id", "date", "amount", "category", "currencyColumn"])]:
        opts = business.get(name, {})
        if not isinstance(opts, dict) or opts.get("enabled") and any(opts.get(k) != -1 and not col(opts.get(k)) for k in required):
            raise ValueError("Choose valid reporting and duplicate-review columns.")
    return model, config


def null_analysis(frame):
    stripped = frame.apply(lambda c: c.str.strip())
    blanks = stripped.eq("").to_numpy(dtype=bool)
    markers = stripped.apply(lambda c: c.str.fullmatch(MARKER, na=False)).to_numpy(dtype=bool)
    masks = np.logical_or(blanks, markers)
    row_count, width = frame.shape
    missing_count = int(np.count_nonzero(masks))
    columns = []
    for i, name in enumerate(frame.columns):
        n = int(np.count_nonzero(masks[:, i]))
        columns.append(dict(name=name, blank=int(np.count_nonzero(blanks[:, i])), markers=int(np.count_nonzero(markers[:, i])), missing=n, percentage=n / row_count * 100 if row_count else 0))
    rows_missing = int(np.count_nonzero(np.any(masks, axis=1)))
    return dict(rowCount=row_count, cellCount=row_count * width, blank=int(np.count_nonzero(blanks)), markers=int(np.count_nonzero(markers)), missing=missing_count,
                percentage=missing_count / (row_count * width) * 100 if row_count * width else 0, rowsWithMissing=rows_missing, completeRows=row_count - rows_missing, columns=columns)


def clean_dataset(payload):
    model, config = validate_payload(payload)
    headers, source_ids = model["headers"], model["sourceRows"]
    original = pd.DataFrame(model["rows"], columns=headers, index=source_ids, dtype=str)
    frame = original.copy()
    fields, types = config["business"]["fields"], config["types"]
    flags = pd.DataFrame(False, index=source_ids, columns=headers)
    changed = flags.copy()
    issues, audit = [], []
    event_counts = {"audit": 0, "issues": 0, "errors": 0, "warnings": 0}
    stats = dict(input=len(frame), output=0, changed=0, duplicates=0, empty=0, invalid=0, dropped=0, review=0, nulls=0, businessDropped=0, filled=0)

    def event(source, column, before, after, detail, action, severity="info", issue=False):
        item = dict(row=int(source) if source != "" else "", column=column, original=str(before)[:300], cleaned=str(after)[:300], issue=detail, action=action, severity=severity)
        event_counts["audit"] += 1
        if len(audit) < MAX_EVENTS:
            audit.append(item)
        if issue:
            event_counts["issues"] += 1
            if len(issues) < MAX_EVENTS:
                issues.append(item)
            if severity in {"error", "warning"} and not ("Removed" in action or "Dropped" in action):
                event_counts["errors" if severity == "error" else "warnings"] += 1

    before = null_analysis(original)
    blanks = frame.apply(lambda c: c.str.strip().eq(""))
    markers = frame.apply(lambda c: c.str.strip().str.fullmatch(MARKER, na=False))
    empty = (blanks | markers if config.get("nulls") else blanks).all(axis=1) if config.get("removeEmpty") else pd.Series(False, index=frame.index)
    for source in frame.index[empty]:
        event(source, "Entire row", "", "", "Entire row empty before fill policies", "Removed empty")
    stats["empty"] = int(empty.sum())
    frame = frame.loc[~empty].copy()
    drop_columns = [f["name"] for f in fields if f["missing"] == "drop"]
    drop = frame[drop_columns].apply(lambda c: c.map(missing)).any(axis=1) if drop_columns else pd.Series(False, index=frame.index)
    for source in frame.index[drop]:
        event(source, "Entire row", "", "", "Missing value under an explicit remove-row policy", "Removed by missing policy")
    stats["businessDropped"] = int(drop.sum())
    frame = frame.loc[~drop].copy()
    policy_original = frame.copy()
    for ci, field in enumerate(fields):
        name = headers[ci]
        mask = frame[name].map(missing)
        if field["missing"] == "fill":
            frame.loc[mask, name] = field["fill"]
            stats["filled"] += int(mask.sum())
        mapping = {m["from"].strip().lower(): m["to"] for m in field.get("mapping", [])}
        mapped = frame[name].str.strip().str.lower().map(mapping)
        # A fill value is final; do not map it again in the same pass.
        eligible = mapped.notna()
        if field["missing"] == "fill":
            eligible &= ~mask
        frame.loc[eligible, name] = mapped.loc[eligible]
        for source in frame.index[frame[name].ne(policy_original[name])]:
            event(source, name, policy_original.at[source, name], frame.at[source, name], "Filled with the chosen replacement" if mask.at[source] else "Applied category mapping", "Changed by business policy")

    format_issues = {}
    for ci, name in enumerate(headers):
        raw = frame[name].copy()
        values = raw.str.replace(r"\s+", " ", regex=True).str.strip() if config.get("trim", True) else raw.copy()
        nulls = values.str.strip().str.fullmatch(MARKER, na=False) if config.get("nulls") else pd.Series(False, index=values.index)
        stats["nulls"] += int(nulls.sum())
        values.loc[nulls] = ""
        normalized = [normalize_value(v, types[ci], config) for v in values]
        for source, (value, problem) in zip(frame.index, normalized):
            if problem:
                value = raw.at[source]
                flags.at[source, name] = True
                format_issues.setdefault(source, []).append((name, value, problem))
                stats["invalid"] += 1
            frame.at[source, name] = value
            changed.at[source, name] = value != original.at[source, name]
            if value != raw.at[source]:
                event(source, name, raw.at[source], value, "Normalized null marker to blank" if nulls.at[source] else "Standardized " + types[ci], "Changed")
    stats["changed"] = int(changed.loc[frame.index].to_numpy().sum())
    empty_after = frame.apply(lambda c: c.str.strip().eq("")).all(axis=1) if config.get("removeEmpty") else pd.Series(False, index=frame.index)
    for source in frame.index[empty_after]:
        event(source, "Entire row", "", "", "Empty after normalization", "Removed empty")
    stats["empty"] += int(empty_after.sum())
    frame = frame.loc[~empty_after].copy()
    invalid_rows = flags.loc[frame.index].any(axis=1) if config.get("dropInvalid") else pd.Series(False, index=frame.index)
    for source in frame.index[invalid_rows]:
        for name, value, detail in format_issues.pop(source, []):
            event(source, name, value, value, detail, "Dropped invalid row", "error", True)
    stats["dropped"] = int(invalid_rows.sum())
    frame = frame.loc[~invalid_rows].copy()

    if config.get("removeDuplicates") and len(frame):
        keys = config.get("keys") or list(range(len(headers)))
        names = [headers[i] for i in keys]
        key_frame = frame[names].copy()
        if config.get("caseInsensitive", True):
            key_frame = key_frame.apply(lambda c: c.str.lower())
        eligible = frame[names].apply(lambda c: c.str.strip().ne("")).all(axis=1) & ~flags.loc[frame.index, names].any(axis=1) if config.get("keys") else pd.Series(True, index=frame.index)
        duplicate = key_frame.loc[eligible].duplicated(keep="first")
        for source in duplicate.index[duplicate]:
            event(source, "Entire row", "", "", "Matching duplicate key; first record kept", "Removed duplicate", "info", True)
            for name, value, detail in format_issues.pop(source, []):
                event(source, name, value, value, detail, "Removed duplicate row", "error", True)
        stats["duplicates"] = int(duplicate.sum())
        frame = frame.drop(index=duplicate.index[duplicate])
    for source in frame.index:
        for name, value, detail in format_issues.get(source, []):
            event(source, name, value, value, detail, "Review", "error", True)

    checked = failed = 0
    protected = set(config.get("keys", []))

    def review(source, ci, detail, severity="error"):
        name = headers[ci]
        flags.at[source, name] = True
        event(source, name, frame.at[source, name], frame.at[source, name], detail, "Business review", severity, True)

    for ci, field in enumerate(fields):
        if field["missing"] != "optional" or field["key"] or field.get("min") or field.get("max") or field.get("allowed") or field.get("mapping"):
            protected.add(ci)
        for source in frame.index:
            value = frame.at[source, headers[ci]]
            if missing(value):
                if field["missing"] == "review":
                    review(source, ci, "Required business value is missing.")
                continue
            allowed = {v.strip().lower() for v in field.get("allowed", [])}
            if allowed and value.strip().lower() not in allowed:
                review(source, ci, "Value is outside the approved categories.")
            if field.get("min") or field.get("max"):
                normalized, error = normalize_number(value)
                if not error:
                    if len(normalized) > 120:
                        review(source, ci, "Numeric range check supports up to 120 characters.")
                    elif (field.get("min") and Decimal(normalized) < Decimal(normalize_number(field["min"])[0])) or (field.get("max") and Decimal(normalized) > Decimal(normalize_number(field["max"])[0])):
                        review(source, ci, "Value is outside the configured numeric range.")
    for rule in config["business"].get("crossRules", []):
        indices = [rule[k] for k in (["start", "end"] if rule["kind"] == "dateOrder" else ["qty", "price", "total"])]
        protected.update(indices)
        for source in frame.index:
            vals = [frame.at[source, headers[i]] for i in indices]
            if any(missing(v) for v in vals):
                review(source, indices[-1], "Business check could not run because an input is missing.", rule["severity"])
                continue
            if rule["kind"] == "dateOrder":
                parsed = [normalize_date(v, config.get("dateOrder", "DMY")) for v in vals]
                if any(error for _, error in parsed):
                    review(source, indices[-1], "Date-order check needs two valid dates.", rule["severity"])
                    continue
                bad = parsed[1][0] < parsed[0][0]
            else:
                parsed = [normalize_number(v) for v in vals]
                if any(error or len(v) > 120 or not re.fullmatch(r"-?\d+(?:\.\d{1,6})?", v) for v, error in parsed):
                    review(source, indices[-1], "Total check needs valid numbers with up to six decimal places.", rule["severity"])
                    continue
                with localcontext() as context:
                    context.prec = 512
                    qty, price, total = [Decimal(v) for v, _ in parsed]
                    bad = abs(qty * price - total) > Decimal(str(rule["tolerance"]))
            checked += 1
            if bad:
                failed += 1
                review(source, indices[-1], "Date order is invalid." if rule["kind"] == "dateOrder" else "Total differs from quantity × unit price beyond the chosen tolerance.", rule["severity"])
    for group, names in [("fuzzy", ["column", "scope"]), ("insights", ["id", "date", "amount", "category", "currencyColumn"])]:
        opts = config["business"].get(group, {})
        if opts.get("enabled"):
            protected.update(opts[k] for k in names if opts.get(k, -1) >= 0)
    kept = [i for i, name in enumerate(headers) if not (config.get("removeEmptyColumns") and len(frame) and i not in protected and frame[name].str.strip().eq("").all())]
    if not kept:
        kept = list(range(len(headers)))
    removed = [{"index": i, "name": name} for i, name in enumerate(headers) if i not in kept]
    for column in removed:
        event("", column["name"], "", "", "All retained values are empty after cleaning.", "Removed empty column")
    after = null_analysis(frame.iloc[:, kept])
    after["removedColumns"] = [c["name"] for c in removed]
    required = [f["name"] for f in fields if f["missing"] == "review"]
    stats.update(output=len(frame), emptyColumns=len(removed), outputColumns=len(kept), review=int(flags.loc[frame.index].any(axis=1).sum()))
    quality = dict(requiredCells=len(required) * len(frame), requiredMissing=int(frame[required].apply(lambda c: c.map(missing)).to_numpy().sum()) if required else 0,
                   missing=after["missing"], cells=after["cellCount"], flaggedCells=int(flags.loc[frame.index].to_numpy().sum()), consistencyChecked=checked, consistencyFailed=failed,
                   errors=event_counts["errors"], warnings=event_counts["warnings"], accuracy="Not verified against authoritative records", timeliness="Freshness requirements depend on your business.")
    result = dict(rows=frame.values.tolist(), sourceRows=[int(n) for n in frame.index], flags=flags.loc[frame.index].values.tolist(), changed=changed.loc[frame.index].values.tolist(),
                  outputColumnIndices=kept, outputHeaders=[headers[i] for i in kept], removedColumns=removed, stats=stats, nullAnalysis=after, quality=quality, audit=audit, issues=issues,
                  auditMeta=dict(total=event_counts["audit"], returned=len(audit), truncated=event_counts["audit"] > len(audit), valueCharacterLimit=300),
                  issuesMeta=dict(total=event_counts["issues"], returned=len(issues), truncated=event_counts["issues"] > len(issues)))
    return original, frame, result, before
