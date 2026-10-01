#!/usr/bin/env python3
"""Nightly / local data build.

Steps you can run separately:
    python scripts/build_site_data.py --fetch
    python scripts/build_site_data.py --process
    python scripts/build_site_data.py          # both

Raw frames stay in CUBE_CACHE (not git).
Derived tables land in site/data/published/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Helper for real-time progress logging in CI/CD runners
def log_step(msg: str) -> None:
    print(f"==> [{datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}] {msg}")
    sys.stdout.flush()

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

log_step("Importing local modules from src...")
from cube_data import (  # noqa: E402
    FOMC_POINT_END,
    FRAME_NAMES,
    build_all,
    build_daily_refi,
    calculate_metrics,
    ensure_fomc_point_seed,
    fetch_fred_series,
    load_fomc_point_steps,
    load_frames,
    save_frames,
    summarize,
    summarize_metrics,
    update_raw,
    _session,
)
import cube_data as cube_data_mod  # noqa: E402
from cube_visualize import (  # noqa: E402
    load_thresholds,
    quarterly_complete,
    standardize,
)
from failure_cube import embed  # noqa: E402

CACHE = Path(os.environ.get("CUBE_CACHE", ROOT / ".cache"))
DATA = Path(os.environ.get("CUBE_DATA_DIR", ROOT / "site" / "data"))
PUB = DATA / "published"
THRESH = DATA / "cube_critical_values.csv"
RAW_JSON = CACHE / "cube_raw_frames.json"
METRICS_JSON = CACHE / "calculated_metrics.json"
RATE_CSV = CACHE / "rate_adjust.csv"
DRIVERS_CSV = CACHE / "macro_drivers.csv"
FULL = str(os.environ.get("CUBE_FULL_REBUILD", "")).lower() in {"1", "true", "yes"}

COLMAP = {
    "x1": "funds_minus_stock",
    "x2": "interest_pct_gf_receipts",
    "x3": "primary_deficit_pct_gdp",
}

# Columns a human needs to replay the six formulas. Full auction tables stay in cache.
RAW_KEEP = {
    "fred_policy_rates": [
        "FEDFUNDS", "TB3MS", "DGS3MO", "DGS10", "DGS2", "DGS5", "DGS30", "DFII10",
        "DFF", "DFEDTAR", "DFEDTARU", "DFEDTARL", "RRPONTSYD",
    ],
    "fred_fiscal_nipa": ["A091RC1Q027SBEA", "FGRECPT", "W006RC1Q027SBEA", "W780RC1Q027SBEA", "FGEXPND"],
    "fred_debt_stocks": ["GFDEBTN", "FYGFDPUN", "GFDEGDQ188S", "FYGFGDQ188S"],
    "fred_labor_output": [
        "UNRATE", "NROU", "GDP", "GDPC1", "GDPPOT", "PAYEMS", "JTSJOL",
    ],
    "fred_term_premium": [
        "THREEFYTP10", "T10Y2Y", "T10Y3M", "T5YIE", "T10YIE", "T5YIFR",
    ],
    "fred_financial_conditions": ["NFCI", "DRTSCILM", "BAMLC0A0CM", "BAMLH0A0HYM2", "TOTLL"],
    "fred_inflation": [
        "PCEPILFE", "PCEPI", "CPILFESL", "CPIAUCSL", "MICH", "PCETRIM12M159SFRBDAL",
        "M2V", "M2SL",
    ],
    "fred_official_holdings": ["WSHOTSL", "WSHOBL", "WSHONBNL", "WSHONBIIL", "WALCL", "FDHBFIN"],
    "fiscal_mspd_composition": [
        "MSPD_BILLS_PUBLIC_MN",
        "MSPD_NOTES_PUBLIC_MN",
        "MSPD_BONDS_PUBLIC_MN",
        "MSPD_TIPS_PUBLIC_MN",
        "MSPD_FRN_PUBLIC_MN",
        "MSPD_MARKETABLE_PUBLIC_MN",
        "MSPD_TOTAL_DEBT_MN",
        "MSPD_BILLS_SHARE_MARKETABLE",
        "MSPD_NOTES_SHARE_MARKETABLE",
        "MSPD_BONDS_SHARE_MARKETABLE",
        "MSPD_TIPS_SHARE_MARKETABLE",
        "MSPD_FRN_SHARE_MARKETABLE",
    ],
    "fiscal_mspd_residual": [
        "RESID_W_0_1Y", "RESID_W_1_3Y", "RESID_W_3_7Y",
        "RESID_W_7_10Y", "RESID_W_10YPLUS", "RESID_W_TIPS", "RESID_W_FRN",
        "RESID_AMT_0_1Y", "RESID_AMT_1_3Y", "RESID_AMT_3_7Y",
        "RESID_AMT_7_10Y", "RESID_AMT_10YPLUS", "RESID_AMT_TIPS", "RESID_AMT_FRN",
    ],
    "fiscal_debt_to_penny": ["DEBT_HELD_PUBLIC", "DEBT_INTRAGOV", "DEBT_TOTAL"],
}


def _json_safe(v):
    if pd.isna(v):
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        return v.item()
    return v


def df_to_table(df: pd.DataFrame, date_key: str = "date") -> dict:
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    out = out.sort_index(ascending=False)
    columns = [date_key, *[str(c) for c in out.columns]]
    rows = []
    for idx, row in out.iterrows():
        rec = {date_key: idx.strftime("%Y-%m-%d")}
        for c, v in row.items():
            rec[str(c)] = _json_safe(v)
        rows.append(rec)
    return {
        "columns": columns,
        "rows": rows,
        "n_rows": len(rows),
        "n_cols": len(out.columns),
        "start": out.index.min().strftime("%Y-%m-%d") if len(out) else None,
        "end": out.index.max().strftime("%Y-%m-%d") if len(out) else None,
    }


def write_json(path: Path, payload) -> None:
    log_step(f"Writing output file: {path}")
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_zone(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"missing {path} — zone wires are required, no hardcoded fallback")
    z = pd.read_csv(path)
    out = {str(r["key"]): float(r["value"]) for _, r in z.iterrows()}
    need = (
        "debt_gdp_warn", "debt_gdp_restruct",
        "int_rec_warn", "int_rec_restruct",
        "int_tax_warn", "int_tax_restruct",
        "int_gf_warn", "int_gf_restruct",
        "refi_gap_warn", "refi_gap_restruct",
    )
    miss = [k for k in need if k not in out or not np.isfinite(out[k])]
    if miss:
        raise SystemExit(f"zone.csv missing/nonfinite: {', '.join(miss)}")
    return out


ZONE = load_zone(DATA / "zone.csv")
SIGMA_WINDOW_START = "2000-01-01"  # plotted path and σ share this window
NONBILL_SPLIT = {"y2": 2.0 / 3.0, "y10": 1.0 / 3.0}  # applied to (1 - w_bills) only


def _qe(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    s.index = pd.to_datetime(s.index)
    return s.sort_index().resample("QE").last()


def _piecewise(v: pd.Series, warn: float, restruct: float) -> pd.Series:
    v = v.astype(float)
    out = pd.Series(np.nan, index=v.index)
    below = v <= warn
    mid = (v > warn) & (v <= restruct)
    above = v > restruct
    out.loc[below] = (v.loc[below] / warn).clip(lower=0)
    span = max(restruct - warn, 1e-9)
    out.loc[mid] = 1.0 + (v.loc[mid] - warn) / span
    out.loc[above] = 2.0 + (v.loc[above] - restruct) / restruct
    return out


def _signed_dist(scores: np.ndarray, threshold: float) -> np.ndarray:
    delta = scores - threshold
    shortfall = np.clip(-delta, 0.0, None)
    outside = shortfall.any(axis=1)
    d_out = np.linalg.norm(shortfall, axis=1)
    d_in = delta.min(axis=1)
    return np.where(outside, d_out, -d_in)


# Cron is 08:20 UTC = 4:20 AM Eastern, before the 8:30 AM release.
# The job dated the release day cannot see the print. The next job is
# the following morning. GitHub sometimes starts that cron late; if it
# starts after FRED has the series, the point can show up the same day.
def _pickup_morning(release_iso: str) -> str:
    day = datetime.strptime(release_iso, "%Y-%m-%d").date() + timedelta(days=1)
    return day.isoformat()


# Quarter-end label -> (release date, why that release and not an earlier one).
# Sustainability waits on FYGFGDQ188S. The Q2 advance (2026-07-30) and the
# second estimate (2026-08-26) were on the FRED calendar and did not add a
# quarter. Fiscal dominance waits on the advance GDP / NIPA print.
_SUS_RELEASE = {
    "2026-06-30": (
        "2026-09-30",
        "Debt held by the public / GDP (FYGFGDQ188S). FRED schedules it "
        "with Debt to GDP Ratios. The July 30 advance and the August 26 "
        "second estimate did not add this quarter.",
    ),
    "2026-09-30": (
        "2026-12-23",
        "Debt held by the public / GDP (FYGFGDQ188S) for the third quarter. "
        "October 29 and November 25 are also on that calendar, but the last "
        "new quarter of this series arrived only on the third estimate. "
        "If it prints earlier, the next nightly draws it and this box moves.",
    ),
}
_FD_RELEASE = {
    "2026-09-30": (
        "2026-10-29",
        "BEA advance estimate of third-quarter GDP. FRED updates GDP, "
        "FGEXPND, FGRECPT, and A091 with that release. This cube does not "
        "wait on the debt/GDP ratio.",
    ),
}

_PREVIOUS_CUBES = os.environ.get(
    "CUBE_PREVIOUS_CUBES",
    "https://peachyhabanero.com/data/published/cubes.json",
)

# Economic values. A sigma rebuild moves F1/F2/F3 with no new print.
# That is not logged as a revision of the history.
_SUS_AXES = (
    ("debt_gdp_pct", "Debt held by the public / GDP", "%", "FYGFGDQ188S", 0.005),
    ("int_rec_pct", "Interest / receipts", "%", "A091RC1Q027SBEA / FGRECPT", 0.005),
    ("refi_gap", "Refi gap", "pp", "Table 3 weights × CMT − Total Marketable coupon", 0.0005),
)
_FD_AXES = (
    ("funds_minus_stock", "F1  funds − book coupon", "pp", "FEDFUNDS − Fiscal Data Total Marketable", 0.0005, "F1"),
    ("int_gf_pct", "F2  interest / general-fund receipts", "%", "A091 / (FGRECPT − W780)", 0.005, "F2"),
    ("primary_deficit_pct_gdp", "F3  primary / GDP", "%", "(FGEXPND − A091 − FGRECPT) / GDP", 0.005, "F3"),
)


def _changed(old, new, tol: float) -> bool:
    if old is None and new is None:
        return False
    if old is None or new is None:
        return True
    try:
        return abs(float(old) - float(new)) > tol
    except (TypeError, ValueError):
        return old != new


def _row_map(rows) -> dict:
    out = {}
    for row in rows or []:
        if isinstance(row, dict) and row.get("date"):
            out[str(row["date"])[:10]] = row
    return out


def _load_previous_cubes() -> dict | None:
    local = PUB / "cubes.json"
    if local.exists():
        try:
            return json.loads(local.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log_step(f"local cubes.json unreadable ({exc})")
    try:
        with urllib.request.urlopen(_PREVIOUS_CUBES, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        log_step(f"no previous cubes.json ({exc}); changelog will not backfill")
        return None


def _axis_event(name, units, series, old, new, coordinate_old=None, coordinate_new=None):
    rec = {
        "axis": name,
        "units": units,
        "series": series,
        "old": None if old is None else _json_safe(old),
        "new": None if new is None else _json_safe(new),
    }
    if coordinate_old is not None or coordinate_new is not None:
        rec["coordinate_old"] = None if coordinate_old is None else _json_safe(coordinate_old)
        rec["coordinate_new"] = None if coordinate_new is None else _json_safe(coordinate_new)
    return rec


def _diff_cube(cube_name: str, old_rows, new_df: pd.DataFrame, axes, generated_at: str) -> list:
    old = _row_map(old_rows)
    events = []
    if new_df is None or new_df.empty:
        return events
    for ts, row in new_df.sort_index().iterrows():
        q = pd.Timestamp(ts).strftime("%Y-%m-%d")
        prev = old.get(q)
        changed = []
        for spec in axes:
            col, label, units, series, tol = spec[:5]
            coord = spec[5] if len(spec) > 5 else None
            new_v = row.get(col)
            new_v = None if pd.isna(new_v) else new_v
            old_v = None if prev is None else prev.get(col)
            if not _changed(old_v, new_v, tol):
                continue
            coord_old = None if prev is None or not coord else prev.get(coord)
            coord_new = None
            if coord:
                cv = row.get(coord)
                coord_new = None if pd.isna(cv) else cv
            changed.append(_axis_event(label, units, series, old_v, new_v, coord_old, coord_new))
        if not changed:
            continue
        events.append({
            "logged_at": generated_at,
            "cube": cube_name,
            "kind": "new release" if prev is None else "revision",
            "quarter": q,
            "axes": changed,
        })
    return events


def _penny_on_quarter_end(penny: pd.Series, q_end: pd.Timestamp):
    """Debt to the Penny on the quarter-end date, or the last print within 5 days before it."""
    s = pd.to_numeric(penny, errors="coerce").dropna()
    if s.empty:
        return None
    s = s.copy()
    s.index = pd.to_datetime(s.index)
    s = s.groupby(s.index).last().sort_index()
    q_end = pd.Timestamp(q_end)
    if q_end in s.index and pd.notna(s.loc[q_end]):
        v = s.loc[q_end]
        if isinstance(v, pd.Series):
            v = v.iloc[-1]
        return q_end, float(v)
    window = s[(s.index <= q_end) & (s.index >= q_end - pd.Timedelta(days=5))]
    if window.empty:
        return None
    return window.index.max(), float(window.iloc[-1])


def _bridge_debt_gdp(fred_ratio: pd.Series, gdp: pd.Series, penny: pd.Series):
    """Quarters FRED's FYGFGDQ188S has not posted yet.

    Same arithmetic St. Louis uses — stock / GDP × 100 — with Debt to the
    Penny's quarter-end debt held by the public instead of FYGFDPUN.
    Does not rewrite any quarter FRED has already published.
    """
    out = fred_ratio.copy() if fred_ratio is not None else pd.Series(dtype="float64")
    prov = {}
    if gdp is None or penny is None:
        return out, prov
    gdp = pd.to_numeric(gdp, errors="coerce").dropna()
    if gdp.empty or penny.dropna().empty:
        return out, prov
    fred_ok = pd.to_numeric(out, errors="coerce").dropna()
    last_fred = fred_ok.index.max() if len(fred_ok) else None
    for ts, g in gdp.sort_index().items():
        ts = pd.Timestamp(ts)
        if last_fred is not None and ts <= last_fred:
            continue
        if ts in out.index and pd.notna(out.loc[ts] if not isinstance(out.loc[ts], pd.Series) else out.loc[ts].iloc[-1]):
            continue
        g = float(g)
        if not np.isfinite(g) or g == 0:
            continue
        hit = _penny_on_quarter_end(penny, ts)
        if not hit:
            continue
        asof, amt = hit
        ratio = amt / (g * 1e9) * 100.0
        if not np.isfinite(ratio):
            continue
        out.loc[ts] = ratio
        prov[ts.strftime("%Y-%m-%d")] = {
            "debt_asof": pd.Timestamp(asof).strftime("%Y-%m-%d"),
            "debt_dollars": float(amt),
            "gdp_bn": g,
            "ratio": float(ratio),
        }
    return out.sort_index(), prov


def _debt_src(row) -> str | None:
    if row is None:
        return None
    src = row.get("debt_gdp_source") if isinstance(row, dict) else None
    if src in ("fred", "treasury"):
        return src
    if row.get("debt_gdp_pct") is not None:
        return "fred"
    return None


def _fred_update_event(q, old_v, new_v, generated_at) -> dict:
    diff = None
    try:
        if old_v is not None and new_v is not None:
            diff = float(new_v) - float(old_v)
    except (TypeError, ValueError):
        diff = None
    if diff is None:
        how = "comparison unavailable"
    elif abs(diff) <= 0.005:
        how = "same as the Treasury print within 0.005 pp"
    else:
        how = f"differs from the Treasury print by {diff:+.3f} pp"
    return {
        "logged_at": generated_at,
        "cube": "sustainability",
        "kind": "FRED Update",
        "quarter": q,
        "axes": [_axis_event(
            "Debt held by the public / GDP",
            "%",
            f"FYGFGDQ188S replaced the Treasury print. {how}.",
            old_v,
            new_v,
        )],
    }


def _split_debt_events(events, old_map, new_df: pd.DataFrame, prov: dict, generated_at: str) -> list:
    """Treasury-filled debt/GDP is 'new print'. FRED catching up is 'FRED Update'."""
    out = []
    swapped = set()
    for ev in events:
        q = ev["quarter"]
        debt_axes = [a for a in ev["axes"] if a.get("axis") == "Debt held by the public / GDP"]
        other = [a for a in ev["axes"] if a.get("axis") != "Debt held by the public / GDP"]
        prev = old_map.get(q)
        ts = pd.Timestamp(q)
        new_src = None
        new_v = None
        if ts in new_df.index and "debt_gdp_source" in new_df.columns:
            new_src = new_df.at[ts, "debt_gdp_source"]
            if isinstance(new_src, pd.Series):
                new_src = new_src.iloc[-1]
            raw_v = new_df.at[ts, "debt_gdp_pct"]
            if isinstance(raw_v, pd.Series):
                raw_v = raw_v.iloc[-1]
            new_v = None if pd.isna(raw_v) else _json_safe(raw_v)
        old_src = _debt_src(prev)
        if new_src == "treasury" and prev is None:
            if other:
                kept = dict(ev)
                kept["axes"] = other
                kept["kind"] = "new release"
                out.append(kept)
            info = prov.get(q) or {}
            dollars = info.get("debt_dollars")
            stock = f"${dollars / 1e12:.3f}T" if dollars else "Debt to the Penny"
            asof = info.get("debt_asof") or q
            gdp_bn = info.get("gdp_bn")
            gdp_txt = f"{gdp_bn:.3f} bn" if isinstance(gdp_bn, float) else "GDP"
            ratio = info.get("ratio", new_v)
            out.append({
                "logged_at": generated_at,
                "cube": "sustainability",
                "kind": "new print",
                "quarter": q,
                "axes": [_axis_event(
                    "Debt held by the public / GDP",
                    "%",
                    f"Treasury Debt to the Penny {asof} ({stock}) / FRED GDP {gdp_txt}. "
                    "Same arithmetic as FYGFGDQ188S, different numerator. Not the FRED ratio.",
                    None,
                    ratio,
                )],
            })
            continue
        if old_src == "treasury" and new_src == "fred":
            if other:
                kept = dict(ev)
                kept["axes"] = other
                out.append(kept)
            old_v = None if prev is None else prev.get("debt_gdp_pct")
            if new_v is None and debt_axes:
                new_v = debt_axes[0].get("new")
            out.append(_fred_update_event(q, old_v, new_v, generated_at))
            swapped.add(q)
            continue
        if new_src == "treasury" and debt_axes:
            for axis in debt_axes:
                axis["series"] = (
                    "Treasury Debt to the Penny / GDP, restated before FRED posted. Not FYGFGDQ188S."
                )
        out.append(ev)
    if new_df is None or new_df.empty or "debt_gdp_source" not in new_df.columns:
        return out
    for ts, row in new_df.sort_index().iterrows():
        q = pd.Timestamp(ts).strftime("%Y-%m-%d")
        if q in swapped:
            continue
        prev = old_map.get(q)
        if _debt_src(prev) == "treasury" and row.get("debt_gdp_source") == "fred":
            raw_v = row.get("debt_gdp_pct")
            new_v = None if pd.isna(raw_v) else _json_safe(raw_v)
            old_v = None if prev is None else prev.get("debt_gdp_pct")
            out.append(_fred_update_event(q, old_v, new_v, generated_at))
    return out


def _value_at(df: pd.DataFrame, ts, col):
    if df is None or df.empty or col not in df.columns or ts not in df.index:
        return None
    v = df.at[ts, col]
    if isinstance(v, pd.Series):
        v = v.iloc[-1]
    if pd.isna(v):
        return None
    return _json_safe(v)


def _inside_quarter(series: pd.Series, q_end: pd.Timestamp):
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return None
    s = s.copy()
    s.index = pd.to_datetime(s.index)
    s = s.groupby(s.index).last().sort_index()
    start = pd.Timestamp(q_end).to_period("Q").start_time
    window = s[(s.index >= start) & (s.index <= pd.Timestamp(q_end))]
    if window.empty:
        return None
    return {"asof": window.index.max().strftime("%Y-%m-%d"), "value": _json_safe(window.iloc[-1])}


def _next_block(last_ts, panel: pd.DataFrame, release_table: dict, fields: tuple) -> dict:
    if last_ts is None:
        return {
            "label": None,
            "release": None,
            "pickup": None,
            "note": "No plotted quarter yet, so the next label is not known.",
            "have": [],
            "waiting": [],
            "partial": [],
        }
    nxt = pd.Timestamp(last_ts) + pd.offsets.QuarterEnd(1)
    label = nxt.strftime("%Y-%m-%d")
    gate = release_table.get(label)
    if gate:
        release, why = gate
        pickup = _pickup_morning(release)
        note = (
            f"Scheduled pickup is {pickup}, the 4:20 AM Eastern nightly. "
            f"That job is the first one after the {release} release. "
            f"The nightly on {release} is set for 4:20 AM, before the "
            f"8:30 AM release, so it cannot see it. GitHub sometimes starts "
            f"the cron late; if that run starts after FRED has posted, the "
            f"point can appear on {release} instead. {why}"
        )
    else:
        release = None
        pickup = None
        note = (
            "No release date is listed for this quarter. The nightly draws "
            "the point the morning after FRED has every series it needs. "
            "The job is scheduled for 4:20 AM Eastern, before the 8:30 AM "
            "print, so the point does not appear the morning of the release."
        )
    have, waiting = [], []
    for col, name, units, series in fields:
        val = _value_at(panel, nxt, col)
        rec = {
            "name": name,
            "units": units,
            "series": series,
            "value": val,
            "asof": label if val is not None else None,
        }
        (have if val is not None else waiting).append(rec)
    return {
        "label": label,
        "release": release,
        "pickup": pickup,
        "note": note,
        "have": have,
        "waiting": waiting,
        "partial": [],
    }


def _col_or(df: pd.DataFrame, *names) -> pd.Series:
    for n in names:
        if df is not None and n in df.columns:
            return pd.to_numeric(df[n], errors="coerce")
    return pd.Series(dtype="float64")


def publish_cubes(metrics: dict, y: pd.DataFrame, frames: list, generated_at: str) -> None:
    log_step("Publishing cubes data...")
    by = {n: frames[i] for i, n in enumerate(FRAME_NAMES) if i < len(frames)}
    m01 = metrics["01_funds_equals_fiscal_rate"]
    m02 = metrics["02_interest_share_of_receipts"]
    m03 = metrics["03_primary_deficit_not_in_hole"]
    policy = by.get("fred_policy_rates", pd.DataFrame())
    fiscal = by.get("fred_fiscal_nipa", pd.DataFrame())
    debt = by.get("fred_debt_stocks", pd.DataFrame())
    labor = by.get("fred_labor_output", pd.DataFrame())
    infl = by.get("fred_inflation", pd.DataFrame())

    stock_fd = _qe(_col_or(m01, "treasury_avg_marketable_coupon_pct"))
    if int(stock_fd.dropna().shape[0]) < 8:
        raise SystemExit(
            "missing treasury_avg_marketable_coupon_pct — Fiscal Data Total Marketable required; no NIPA fallback"
        )
    stock = stock_fd
    coupon_source = "fiscal_data_marketable"
    log_step(f"book coupon source: {coupon_source}")
    funds = _qe(_col_or(m01, "FEDFUNDS"))
    funds_minus = (funds - stock).rename("funds_minus_stock")
    int_rec = _qe(_col_or(m02, "interest_pct_of_current_receipts"))
    int_tax = _qe(_col_or(m02, "interest_pct_of_tax_receipts"))
    int_gf = _qe(_col_or(m02, "interest_pct_of_gf_receipts"))
    if int(int_gf.dropna().shape[0]) < 8:
        raise SystemExit(
            "missing interest_pct_of_gf_receipts — fetch W780RC1Q027SBEA and rerun --process"
        )
    int_bn = _qe(_col_or(m02, "interest_bn_saar"))
    rec_bn = _qe(_col_or(m02, "current_receipts_bn_saar"))
    primary = _qe(_col_or(m03, "primary_deficit_pct_gdp"))
    tb3 = _qe(_col_or(policy, "TB3MS"))
    y2 = _qe(_col_or(policy, "DGS2"))
    y10 = _qe(_col_or(policy, "DGS10"))
    gdp = _qe(_col_or(labor, "GDP"))
    debt_pub_gdp = _qe(_col_or(debt, "FYGFGDQ188S"))
    penny = _col_or(by.get("fiscal_debt_to_penny", pd.DataFrame()), "DEBT_HELD_PUBLIC")
    debt_pub_gdp, debt_prov = _bridge_debt_gdp(debt_pub_gdp, gdp, penny)
    if debt_prov:
        log_step(
            "treasury debt/GDP bridge (not FYGFGDQ188S): "
            + ", ".join(f"{q}={info['ratio']:.2f}" for q, info in debt_prov.items())
        )
    tax_bn = _qe(_col_or(fiscal, "W006RC1Q027SBEA"))

    def _yoy_pct(s: pd.Series) -> pd.Series:
        out = pd.to_numeric(s, errors="coerce").dropna()
        if out.empty:
            return pd.Series(dtype="float64")
        out.index = pd.to_datetime(out.index)
        m = out.groupby(out.index.to_period("M")).last()
        m.index = m.index.to_timestamp(how="end").normalize()
        return (m / m.shift(12) - 1.0) * 100.0

    pce_yoy = _yoy_pct(_col_or(infl, "PCEPI"))
    pce_core_yoy = _yoy_pct(_col_or(infl, "PCEPILFE"))
    unrate_q = _qe(_col_or(labor, "UNRATE"))
    nrou_q = _qe(_col_or(labor, "NROU"))

    w_bills = _qe(_col_or(m01, "w_bills"))
    w_2y = _qe(_col_or(m01, "w_2y"))
    w_10y = _qe(_col_or(m01, "w_10y"))
    marginal = _qe(_col_or(m01, "marginal_rate"))
    refi_gap = _qe(_col_or(m01, "refi_gap"))
    if min(int(s.dropna().shape[0]) for s in (w_bills, w_2y, w_10y, marginal, refi_gap)) < 8:
        raise SystemExit("metric 01 missing issuance weights / refi_gap — rerun calculate_metrics")

    point = pd.to_numeric(_col_or(policy, "DFEDTAR"), errors="coerce")
    point.index = pd.to_datetime(point.index)
    upper = pd.to_numeric(_col_or(policy, "DFEDTARU"), errors="coerce")
    upper.index = pd.to_datetime(upper.index)
    steps = load_fomc_point_steps()
    point = pd.concat([steps, point]).sort_index()
    point = point[~point.index.duplicated(keep="last")]
    upper = upper.dropna().sort_index()
    if point.loc[point.index <= FOMC_POINT_END].dropna().empty:
        raise SystemExit(
            "DFEDTAR empty after attaching site/data/fomc_point_target.csv — "
            "that frozen FOMC change log is required"
        )
    if upper.empty:
        raise SystemExit("DFEDTARU missing — FOMC range upper bound required after 2008-12")
    # Standing instrument on a complete month-end calendar. The target holds
    # between meetings — that is the FOMC series, not a fill of unknown Δ.
    cal_start = min(pd.Timestamp("1982-09-30"), point.dropna().index.min())
    cal_end = max(pd.Timestamp.now().normalize(), upper.index.max())
    cal = pd.date_range(cal_start, cal_end, freq="ME")
    point_m = point.reindex(cal.union(point.index)).sort_index().ffill()
    point_m = point_m.where(point_m.index <= FOMC_POINT_END)
    upper_m = upper.reindex(cal.union(upper.index)).sort_index().ffill()
    upper_m = upper_m.where(upper_m.index > FOMC_POINT_END)
    target = point_m.combine_first(upper_m).dropna()
    q_target = target.resample("QE").last()
    rate_adjust = q_target.diff().rename("rate_adjust")
    target_end = q_target.rename("target_end")

    panel = pd.DataFrame({
        "funds_minus_stock": funds_minus,
        "FEDFUNDS": funds,
        "stock_avg_coupon": stock,
        "tb3m": tb3,
        "y2": y2,
        "y10": y10,
        "w_bills": w_bills,
        "w_2y": w_2y,
        "w_10y": w_10y,
        "marginal_rate": marginal,
        "refi_gap": refi_gap,
        "auction_bills_share": _qe(_col_or(m01, "auction_bills_share")),
        "refi_gap_auction": _qe(_col_or(m01, "refi_gap_auction")),
        "marginal_residual": _qe(_col_or(m01, "marginal_residual")),
        "refi_gap_residual": _qe(_col_or(m01, "refi_gap_residual")),
        "marginal_bills21": _qe(_col_or(m01, "marginal_bills21")),
        "refi_gap_bills21": _qe(_col_or(m01, "refi_gap_bills21")),
        "resid_w_0_1y": _qe(_col_or(m01, "resid_w_0_1y")),
        "resid_w_1_3y": _qe(_col_or(m01, "resid_w_1_3y")),
        "resid_w_3_7y": _qe(_col_or(m01, "resid_w_3_7y")),
        "resid_w_7_10y": _qe(_col_or(m01, "resid_w_7_10y")),
        "resid_w_10yplus": _qe(_col_or(m01, "resid_w_10yplus")),
        "resid_w_tips": _qe(_col_or(m01, "resid_w_tips")),
        "resid_w_frn": _qe(_col_or(m01, "resid_w_frn")),
        "int_rec_pct": int_rec,
        "int_tax_pct": int_tax,
        "int_gf_pct": int_gf,
        "interest_bn": int_bn,
        "receipts_bn": rec_bn,
        "tax_bn": tax_bn,
        "primary_deficit_pct_gdp": primary,
        "debt_gdp_pct": debt_pub_gdp,
        "gdp_bn": gdp,
        "int_gdp_pct": (int_bn / gdp) * 100.0,
        "rate_adjust": rate_adjust,
        "target_end": target_end,
        "pce_yoy": _qe(pce_yoy),
        "pce_gap": _qe(pce_yoy) - 2.0,
        "pce_core_yoy": _qe(pce_core_yoy),
        "pce_core_gap": _qe(pce_core_yoy) - 2.0,
        "unrate": unrate_q,
        "nrou": nrou_q,
        "emp_gap": nrou_q - unrate_q,
    }).sort_index()
    panel["debt_gdp_source"] = None
    panel["debt_gdp_debt_asof"] = None
    panel["debt_gdp_debt_bn"] = np.nan
    panel.loc[panel["debt_gdp_pct"].notna(), "debt_gdp_source"] = "fred"
    for q, info in debt_prov.items():
        ts = pd.Timestamp(q)
        if ts not in panel.index:
            continue
        panel.at[ts, "debt_gdp_source"] = "treasury"
        panel.at[ts, "debt_gdp_debt_asof"] = info["debt_asof"]
        panel.at[ts, "debt_gdp_debt_bn"] = info["debt_dollars"] / 1e9
    panel = panel.loc[panel.index >= SIGMA_WINDOW_START]
    # Do not dropna a shared "need" that includes refi_gap — that is a
    # sustainability series. Requiring it here deleted every FD quarter
    # whose Table-3 residual was blank (looked like "the cube starts in 2015").

    def _sigma(series, name):
        s = pd.to_numeric(series, errors="coerce").dropna()
        if len(s) < 8:
            raise SystemExit(f"sigma window too short for {name}")
        sig = float(s.std(ddof=1))
        if not np.isfinite(sig) or sig == 0:
            raise SystemExit(f"sigma undefined for {name}")
        return sig

    sig_rec = _sigma(panel["int_rec_pct"], "int_rec")
    sig_tax = _sigma(panel["int_tax_pct"], "int_tax")
    sig_gf = _sigma(panel["int_gf_pct"], "int_gf")
    if "y1" not in y.columns or "y2" not in y.columns or "y3" not in y.columns:
        raise SystemExit("standardize did not return y1/y2/y3 — cannot plot F1/F2/F3")
    panel["F1"] = y["y1"].reindex(panel.index)
    panel["F2"] = (panel["int_gf_pct"] - ZONE["int_gf_warn"]) / sig_gf
    panel["F2_rec"] = y["y2"].reindex(panel.index)
    panel["F2_tax"] = (panel["int_tax_pct"] - ZONE["int_tax_warn"]) / sig_tax
    panel["F3"] = y["y3"].reindex(panel.index)
    log_step(f"sigma int/gf={sig_gf:.4f}  int/rec={sig_rec:.4f}  int/tax={sig_tax:.4f}")

    s_debt = _piecewise(panel["debt_gdp_pct"], ZONE["debt_gdp_warn"], ZONE["debt_gdp_restruct"])
    s_gap = _piecewise(panel["refi_gap"], ZONE["refi_gap_warn"], ZONE["refi_gap_restruct"])
    panel["s_debt"] = s_debt
    panel["s_gap"] = s_gap
    for burden, warn, restruct, col in (
            ("rec", ZONE["int_rec_warn"], ZONE["int_rec_restruct"], "int_rec_pct"),
            ("tax", ZONE["int_tax_warn"], ZONE["int_tax_restruct"], "int_tax_pct"),
    ):
        s_bur = _piecewise(panel[col], warn, restruct)
        panel[f"s_{burden}"] = s_bur
        cube = np.column_stack([s_debt.to_numpy(), s_bur.to_numpy(), s_gap.to_numpy()])
        panel[f"dist_warn_{burden}"] = _signed_dist(cube, 1.0)
        panel[f"dist_restruct_{burden}"] = _signed_dist(cube, 2.0)
        panel[f"stress_{burden}"] = (
                0.20 * s_debt + 0.35 * s_bur + 0.25 * s_gap
                + 0.20 * _piecewise(panel["int_gdp_pct"], 3.0, 4.5)
        )

    sustain = panel.dropna(subset=["debt_gdp_pct", "int_rec_pct", "int_tax_pct", "refi_gap"])
    fail = panel.dropna(subset=["F1", "F2", "F3"])
    # NROU and GDPPOT are CBO projections out to the 2030s. They must not
    # be reported as the last date on the cube.
    observed = pd.concat([
        sustain.index.to_series() if len(sustain) else pd.Series(dtype="datetime64[ns]"),
        fail.index.to_series() if len(fail) else pd.Series(dtype="datetime64[ns]"),
    ])
    obs_ts = pd.to_datetime(observed, errors="coerce").dropna()
    observed_end = str(obs_ts.max().date()) if len(obs_ts) else None
    observed_start = str(obs_ts.min().date()) if len(obs_ts) else SIGMA_WINDOW_START

    sus_fields = tuple((a[0], a[1], a[2], a[3]) for a in _SUS_AXES)
    fd_fields = tuple((a[0], a[1], a[2], a[3]) for a in _FD_AXES)
    sus_next = _next_block(sustain.index.max() if len(sustain) else None, panel, _SUS_RELEASE, sus_fields)
    fd_next = _next_block(fail.index.max() if len(fail) else None, panel, _FD_RELEASE, fd_fields)

    def _attach_partial(block, specs):
        if not block.get("label"):
            return
        q = pd.Timestamp(block["label"])
        have_names = {h["name"] for h in block["have"]}
        partial = []
        for series, name, units, sid in specs:
            if name in have_names:
                continue
            hit = _inside_quarter(series, q)
            if not hit:
                continue
            partial.append({
                "name": name,
                "units": units,
                "series": sid,
                "value": hit["value"],
                "asof": hit["asof"],
                "note": "Inside the quarter. Not the quarter print.",
            })
        block["partial"] = partial

    _attach_partial(fd_next, (
        (_col_or(policy, "FEDFUNDS"), "Federal funds", "%", "FEDFUNDS"),
        (_col_or(m01, "treasury_avg_marketable_coupon_pct"), "Book coupon", "%", "Fiscal Data Total Marketable"),
        (_col_or(m01, "refi_gap"), "Refi gap", "pp", "Table 3 × CMT − coupon"),
    ))
    _attach_partial(sus_next, (
        (debt_pub_gdp, "Debt held by the public / GDP", "%", "FYGFGDQ188S"),
        (_col_or(m01, "refi_gap"), "Refi gap", "pp", "Table 3 × CMT − coupon"),
        (int_rec, "Interest / receipts", "%", "A091RC1Q027SBEA / FGRECPT"),
    ))

    previous = _load_previous_cubes()
    if previous is None:
        changelog = []
        changelog_note = (
            "No previous cubes.json could be read, so this run recorded "
            "nothing. History is not backfilled. Gemini guesses are never logged."
        )
    else:
        changelog = list(previous.get("changelog") or [])
        old_sus = _row_map(previous.get("sustain"))
        sus_events = _split_debt_events(
            _diff_cube("sustainability", previous.get("sustain"), sustain, _SUS_AXES, generated_at),
            old_sus,
            sustain,
            debt_prov,
            generated_at,
        )
        changelog.extend(sus_events)
        changelog.extend(_diff_cube(
            "fiscal dominance", previous.get("fail"), fail, _FD_AXES, generated_at,
        ))
        changelog_note = (
            "Adds and revisions of plotted quarters only. A sustainability "
            "debt/GDP quarter filled from Debt to the Penny, before FRED posts "
            "FYGFGDQ188S, is kind 'new print'. When FRED later posts that "
            "quarter, kind 'FRED Update' records the swap and whether the "
            "number moved. The log starts the first nightly that could read "
            "the previous cubes.json. Earlier history is not backfilled. "
            "Gemini guesses are not entries."
        )
    log_step(f"changelog events {len(changelog)}")

    payload = {
        "generated_at": generated_at,
        "zone": ZONE,
        "coupon_source": coupon_source,
        "refinance_rule": "MSPD Table 3 remaining-maturity weights on nominal paper + FRN (TIPS dropped, rest renormalized) x TB3MS/DGS2/DGS5/DGS10/DGS30/FEDFUNDS minus Fiscal Data Total Marketable coupon",
        "nonbill_split": NONBILL_SPLIT,
        "sigma_window": {
            "requested_start": SIGMA_WINDOW_START,
            "start": observed_start,
            "end": observed_end,
            "n": int(len(sustain)),
            "note": "End is the last plotted quarter on either cube, not the CBO projection on NROU or GDPPOT.",
        },
        "sigma": {"int_gf": sig_gf, "int_rec": sig_rec, "int_tax": sig_tax},
        "next": {"sustain": sus_next, "fail": fd_next},
        "changelog_note": changelog_note,
        "changelog": changelog,
        "sustain": df_to_table(sustain)["rows"][::-1],
        "fail": df_to_table(fail)["rows"][::-1],
    }
    write_json(PUB / "cubes.json", payload)
    if len(sustain):
        last = sustain.iloc[-1]
        log_step(
            f"cubes sustain {len(sustain)}  latest {sustain.index[-1].date()}  "
            f"debt/gdp={last.debt_gdp_pct:.1f} refi={last.refi_gap:+.2f}"
        )
    if len(fail):
        lastf = fail.iloc[-1]
        log_step(
            f"cubes fail {len(fail)}  {fail.index.min().date() if len(fail) else '—'} → "
            f"{fail.index.max().date() if len(fail) else '—'}  "
            f"F1={lastf.F1:.2f} F2={lastf.F2:.2f} F3={lastf.F3:.2f}"
        )


def fetch_raw() -> None:
    log_step("Starting raw data fetch/update step...")
    CACHE.mkdir(parents=True, exist_ok=True)
    log_step("Ensuring FOMC point-target seed (DFEDTAR, once)...")
    ensure_fomc_point_seed()
    if FULL or not RAW_JSON.exists():
        log_step("Running full raw build (CUBE_FULL_REBUILD or missing cache)...")
        frames = build_all()
        log_step("Saving raw frames to cache...")
        save_frames(frames, RAW_JSON)
    else:
        log_step(f"Running incremental raw update using existing cache: {RAW_JSON}")
        frames = update_raw(RAW_JSON)

    print(summarize(frames).to_string(index=False))
    log_step(f"Cached raw frames successfully to {RAW_JSON}")


def _as_q(s: pd.Series, name: str) -> pd.Series:
    out = pd.to_numeric(s, errors="coerce").dropna() if s is not None else pd.Series(dtype="float64")
    if out.empty:
        return pd.Series(dtype="float64", name=name)
    out = out.copy()
    out.index = pd.to_datetime(out.index)
    out = out.groupby(out.index.to_period("Q")).last()
    out.index = out.index.to_timestamp(how="end").normalize()
    out.name = name
    return out


def rebuild_primary(metrics: dict, frames: list) -> dict:
    """If 03 is empty, form primary/GDP here from raw NIPA + GDP. Does not fill."""
    m03 = metrics.get("03_primary_deficit_not_in_hole", pd.DataFrame())
    n = 0
    if m03 is not None and not m03.empty and "primary_deficit_pct_gdp" in m03.columns:
        n = int(pd.to_numeric(m03["primary_deficit_pct_gdp"], errors="coerce").dropna().shape[0])
    if n >= 8:
        return metrics
    log_step(f"03 primary empty ({n} prints) — rebuilding from NIPA + GDP")
    by = {name: frames[i] for i, name in enumerate(FRAME_NAMES) if i < len(frames)}
    nipa = by.get("fred_fiscal_nipa", pd.DataFrame())
    labor = by.get("fred_labor_output", pd.DataFrame())

    def col(df, sid):
        if df is None or df.empty or sid not in df.columns:
            return pd.Series(dtype="float64", name=sid)
        s = pd.to_numeric(df[sid], errors="coerce")
        s.index = pd.to_datetime(df.index)
        return s.dropna().rename(sid)

    def need(sid, have):
        have = pd.to_numeric(have, errors="coerce").dropna() if have is not None else pd.Series(dtype="float64")
        if int(have.shape[0]) >= 8:
            return have.rename(sid)
        log_step(f"{sid} only {int(have.shape[0])} prints in cache — fetching")
        s = fetch_fred_series(_session(), sid, start="1970-01-01")
        s = pd.to_numeric(s, errors="coerce").dropna()
        if int(s.shape[0]) < 8:
            raise SystemExit(f"FRED {sid} empty — https://fred.stlouisfed.org/series/{sid}")
        return s.rename(sid)

    interest = need("A091RC1Q027SBEA", col(nipa, "A091RC1Q027SBEA"))
    receipts = need("FGRECPT", col(nipa, "FGRECPT"))
    exp = need("FGEXPND", col(nipa, "FGEXPND"))
    gdp = need("GDP", col(labor, "GDP"))
    q_int = _as_q(interest, "interest")
    q_exp = _as_q(exp, "exp")
    q_rec = _as_q(receipts, "receipts")
    q_gdp = _as_q(gdp, "gdp")
    log_step(
        f"primary inputs interest={len(q_int)} exp={len(q_exp)} "
        f"receipts={len(q_rec)} gdp={len(q_gdp)} "
        f"exp[{q_exp.index.min().date() if len(q_exp) else '—'}→{q_exp.index.max().date() if len(q_exp) else '—'}] "
        f"gdp[{q_gdp.index.min().date() if len(q_gdp) else '—'}→{q_gdp.index.max().date() if len(q_gdp) else '—'}]"
    )
    primary_bn = ((q_exp - q_int) - q_rec).rename("primary_deficit_bn_saar")
    primary_gdp = (100.0 * primary_bn / q_gdp).rename("primary_deficit_pct_gdp")
    if int(primary_gdp.dropna().shape[0]) < 8:
        raise SystemExit(
            "primary_deficit_pct_gdp still empty after rebuild — "
            f"quarter overlap={int(q_exp.index.intersection(q_gdp.index).nunique())}"
        )
    rebuilt = pd.concat([primary_gdp, primary_bn], axis=1)
    if m03 is not None and not m03.empty:
        for c in m03.columns:
            if c not in rebuilt.columns:
                rebuilt[c] = m03[c].reindex(rebuilt.index)
    metrics["03_primary_deficit_not_in_hole"] = rebuilt.loc[primary_gdp.notna()].copy()
    log_step(f"03 rebuilt: {int(len(metrics['03_primary_deficit_not_in_hole']))} quarters")
    return metrics


BUYBACK_CLASSES = (
    "long_10y_plus",
    "cash_management",
    "liquidity_under_10y",
    "tips",
    "small_value",
)
HOUSE_SPEECH = "2026-09-08"  # SMU: "I am the house now." Clock starts this day, inclusive.
BUYBACK_RESTART = "2024-04-01"


def _buyback_totals(df: pd.DataFrame, start: str, end: str | None = None) -> dict:
    """Settled par from start inclusive to end exclusive. end=None means through the last row."""
    sub = df[df.index >= pd.Timestamp(start)]
    if end:
        sub = sub[sub.index < pd.Timestamp(end)]
    settled = sub[pd.to_numeric(sub["total_par_amt_accepted"], errors="coerce").notna()]
    out = {}
    for cls in BUYBACK_CLASSES:
        piece = settled[settled["buyback_class"] == cls]
        acc = float(pd.to_numeric(piece["total_par_amt_accepted"], errors="coerce").sum())
        cap = float(pd.to_numeric(piece["max_par_amt_redeemed"], errors="coerce").fillna(0).sum())
        out[cls] = {
            "n": int(len(piece)),
            "accepted_bn": acc / 1e9,
            "cap_bn": cap / 1e9,
        }
    out["pending_unsettled"] = int(pd.to_numeric(sub["total_par_amt_accepted"], errors="coerce").isna().sum())
    return out


def publish_buybacks(frames: list, generated_at: str) -> None:
    """Operation-level Treasury buybacks. Not a month-end resample."""
    if "fiscal_buybacks" not in FRAME_NAMES:
        raise SystemExit("FRAME_NAMES missing fiscal_buybacks")
    i = FRAME_NAMES.index("fiscal_buybacks")
    if i >= len(frames) or frames[i] is None or frames[i].empty:
        raise SystemExit(
            "fiscal_buybacks missing from the cache — run fetch. "
            "https://fiscaldata.treasury.gov/datasets/treasury-securities-buybacks/"
        )
    df = frames[i].copy()
    df.index = pd.to_datetime(df.index)
    need = {"buyback_class", "total_par_amt_accepted", "max_par_amt_redeemed", "maturity_bucket", "operation_type"}
    missing = sorted(need - set(df.columns))
    if missing:
        raise SystemExit(f"fiscal_buybacks missing columns {missing} — refetch")
    if int(pd.to_numeric(df["total_par_amt_accepted"], errors="coerce").notna().sum()) < 8:
        raise SystemExit("fiscal_buybacks has almost no settled operations — not publishing an empty tape")

    ops = []
    for idx, row in df.sort_index().iterrows():
        acc = _json_safe(row["total_par_amt_accepted"])
        cap = _json_safe(row["max_par_amt_redeemed"])
        offered = _json_safe(row["total_par_amt_offered"]) if "total_par_amt_offered" in df.columns else None
        ops.append({
            "date": idx.strftime("%Y-%m-%d"),
            "operation_type": None if pd.isna(row["operation_type"]) else str(row["operation_type"]),
            "security_type": None if "security_type" not in df.columns or pd.isna(row["security_type"]) else str(row["security_type"]),
            "maturity_bucket": None if pd.isna(row["maturity_bucket"]) else str(row["maturity_bucket"]),
            "buyback_class": str(row["buyback_class"]),
            "accepted_bn": None if acc is None else acc / 1e9,
            "cap_bn": None if cap is None else cap / 1e9,
            "offered_bn": None if offered is None else offered / 1e9,
            "settled": acc is not None,
        })

    settled_ops = [o for o in ops if o["settled"] and o["date"] >= BUYBACK_RESTART]
    # monthly sums of settled par, restart onward
    monthly = {}
    for o in settled_ops:
        key = o["date"][:7]
        slot = monthly.setdefault(key, {c: 0.0 for c in BUYBACK_CLASSES})
        slot[o["buyback_class"]] = slot.get(o["buyback_class"], 0.0) + (o["accepted_bn"] or 0.0)
    months = []
    running = {c: 0.0 for c in BUYBACK_CLASSES}
    for key in sorted(monthly):
        row = {"month": key}
        for c in BUYBACK_CLASSES:
            row[c] = monthly[key][c]
            running[c] += monthly[key][c]
            row[f"cum_{c}"] = running[c]
        months.append(row)

    payload = {
        "generated_at": generated_at,
        "source": "https://fiscaldata.treasury.gov/datasets/treasury-securities-buybacks/",
        "endpoint": "v1/accounting/od/buybacks_operations",
        "restart": BUYBACK_RESTART,
        "house_speech": HOUSE_SPEECH,
        "note": (
            "Par accepted at Treasury buyback operations. Not the cube, and not a stance. "
            "The clock for the House claim starts 2026-09-08, the SMU speech "
            "(\"I am the house now\"), and includes that day. Taking office is not the start. "
            "long_10y_plus is nominal coupons whose bucket starts at 10Y or 20Y — the long-end "
            "piece the House article is about. cash_management is a different operation: "
            "short coupons (1 month to 2 years), and before the speech it was most of the dollars. "
            "An operation with no accepted par is announced, not done, and is left out of the sums."
        ),
        "classes": {
            "long_10y_plus": "Liquidity-support buybacks of nominal coupons, remaining-maturity bucket starting at 10Y or 20Y.",
            "cash_management": "Cash-management buybacks. In this sample, 1 month to 2 year nominal coupons. Not the long-end trade.",
            "liquidity_under_10y": "Liquidity-support nominal coupons whose bucket starts below 10Y.",
            "tips": "TIPS buybacks, any bucket.",
            "small_value": "Small-value test operations.",
        },
        "since_restart": _buyback_totals(df, BUYBACK_RESTART),
        "before_speech": _buyback_totals(df, BUYBACK_RESTART, HOUSE_SPEECH),
        "since_speech": _buyback_totals(df, HOUSE_SPEECH),
        "operations": ops,
        "monthly_since_restart": months,
    }
    write_json(PUB / "buybacks.json", payload)
    s = payload["since_speech"]
    log_step(
        "buybacks since House speech  "
        f"long {s['long_10y_plus']['accepted_bn']:.1f}bn  "
        f"cash {s['cash_management']['accepted_bn']:.1f}bn  "
        f"under10 {s['liquidity_under_10y']['accepted_bn']:.1f}bn"
    )


def process_and_publish() -> None:
    log_step("Starting data processing and publication step...")
    if not RAW_JSON.exists():
        raise SystemExit(f"missing {RAW_JSON} — run with --fetch first")

    CACHE.mkdir(parents=True, exist_ok=True)
    PUB.mkdir(parents=True, exist_ok=True)
    log_step("Ensuring FOMC point-target seed (DFEDTAR, once)...")
    ensure_fomc_point_seed()

    log_step(f"cube_data.py loaded from {cube_data_mod.__file__}")
    log_step("Calculating metrics...")
    metrics = calculate_metrics(raw_path=RAW_JSON, metrics_path=METRICS_JSON, save=True)
    frames = load_frames(RAW_JSON)
    metrics = rebuild_primary(metrics, frames)
    print(summarize_metrics(metrics).to_string(index=False))

    log_step("Loading critical threshold values and standardizing data...")
    thresh = load_thresholds(THRESH)
    aligned = quarterly_complete(metrics, thresh).sort_index()
    aligned = aligned.loc[aligned.index >= SIGMA_WINDOW_START]
    if aligned.empty:
        bits = []
        for _, row in thresh.iterrows():
            mk, hc = str(row["metric_key"]), str(row["headline_column"])
            n = 0
            if mk in metrics and hc in metrics[mk].columns:
                n = int(pd.to_numeric(metrics[mk][hc], errors="coerce").dropna().shape[0])
            bits.append(f"{mk}.{hc}={n}")
        raise SystemExit(
            f"no complete quarters on or after {SIGMA_WINDOW_START} — "
            + " ".join(bits)
        )
    log_step(f"sigma window {aligned.index.min().date()} → {aligned.index.max().date()}  n={len(aligned)}")
    y, s_bits = standardize(aligned, thresh)
    state = embed(y, s_bits, (1, 2, 3), ()).sort_index()
    for c in aligned.columns:
        state[c] = aligned[c]

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    quarterly_cols = [
        "F1", "F2", "F3", "n_fiscal", "fail",
        "y1", "y2", "y3",
        "s1", "s2", "s3",
        "x1", "x2", "x3",
    ]
    qdf = state[quarterly_cols].rename(columns=COLMAP)

    published = {
        "generated_at": generated_at,
        "thresholds": thresh.to_dict(orient="records"),
        "latest": None,
        "quarters": df_to_table(qdf, date_key="quarter_end")["rows"][::-1],
    }
    if published["quarters"]:
        published["latest"] = published["quarters"][-1]
    write_json(PUB / "quarterly.json", published)

    log_step("Building metric series JSON payloads...")
    series = {}
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        key = row["metric_key"]
        col = row["headline_column"]
        frame = metrics[key]
        s = pd.to_numeric(frame[col], errors="coerce").dropna()
        s.index = pd.to_datetime(s.index)
        series[f"m{mid}"] = {
            "metric_id": mid,
            "metric_key": key,
            "headline_column": col,
            "critical_value": float(row["critical_value"]),
            "direction_unthinkable": row["direction_unthinkable"],
            "units": row.get("units", ""),
            "rationale": row.get("rationale", ""),
            "points": [
                {"date": i.strftime("%Y-%m-%d"), "value": _json_safe(v)}
                for i, v in s.items()
            ],
        }
    write_json(PUB / "series.json", series)

    log_step("Building metric tables...")
    metric_tables = {}
    for name, df in metrics.items():
        metric_tables[name] = df_to_table(df)
    write_json(PUB / "calculated_metrics.json", {
        "generated_at": generated_at,
        "tables": metric_tables,
    })

    publish_cubes(metrics, y, frames=load_frames(RAW_JSON), generated_at=generated_at)

    log_step("Building daily refi tape (last mix × live CMT)...")
    daily = build_daily_refi(load_frames(RAW_JSON))
    last_d = daily.iloc[-1]
    def _iso(v):
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        try:
            return pd.Timestamp(v).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            return _json_safe(v)
    write_json(PUB / "daily_refi.json", {
        "generated_at": generated_at,
        "note": (
            "Not the cube. The cube is quarterly. This tape holds last-known "
            "Table 3 remaining-maturity weights (TIPS dropped, rest renormalized) "
            "against that day's CMT, minus last Fiscal Data Total Marketable coupon. "
            "0–1y uses DGS3MO (daily); the cube's monthly print uses TB3MS. FRN uses DFF. "
            "A day is blank if a published bucket has weight and no CMT that day. Mix and coupon "
            "do not move until the next monthly print."
        ),
        "rule": (
            "m_t = Σ_b w_b,last × y_b,t  (b ∈ 0–1y, 1–3y, 3–7y, 7–10y, 10y+, FRN); "
            "refi_t = m_t − coupon_last. No fill."
        ),
        "warn": ZONE["refi_gap_warn"],
        "restruct": ZONE["refi_gap_restruct"],
        "last": {
            "date": last_d.name.strftime("%Y-%m-%d"),
            "refi_gap": _json_safe(last_d["refi_gap"]),
            "marginal": _json_safe(last_d["marginal"]),
            "coupon": _json_safe(last_d["coupon"]),
            "weights_asof": _iso(last_d["weights_asof"]),
            "coupon_asof": _iso(last_d["coupon_asof"]),
        },
        "points": [
            {
                "date": i.strftime("%Y-%m-%d"),
                "refi_gap": _json_safe(r["refi_gap"]),
                "marginal": _json_safe(r["marginal"]),
                "coupon": _json_safe(r["coupon"]),
                "dgs3mo": _json_safe(r["dgs3mo"]),
                "dgs10": _json_safe(r["dgs10"]),
                "weights_asof": _iso(r["weights_asof"]),
                "coupon_asof": _iso(r["coupon_asof"]),
            }
            for i, r in daily.iterrows()
        ],
    })
    log_step(
        f"daily refi {daily.index.min().date()} → {daily.index.max().date()}  "
        f"last={float(last_d['refi_gap']):.3f} on {last_d.name.date()}"
    )

    log_step("Generating catalog and raw input published tables...")
    frames = load_frames(RAW_JSON)
    i = FRAME_NAMES.index("fiscal_mspd_composition")
    if i < len(frames) and frames[i] is not None and not frames[i].empty:
        m = frames[i].copy()
        mkt = pd.to_numeric(m.get("MSPD_MARKETABLE_PUBLIC_MN"), errors="coerce")
        for src, share in (
            ("MSPD_BILLS_PUBLIC_MN", "MSPD_BILLS_SHARE_MARKETABLE"),
            ("MSPD_NOTES_PUBLIC_MN", "MSPD_NOTES_SHARE_MARKETABLE"),
            ("MSPD_BONDS_PUBLIC_MN", "MSPD_BONDS_SHARE_MARKETABLE"),
            ("MSPD_TIPS_PUBLIC_MN", "MSPD_TIPS_SHARE_MARKETABLE"),
            ("MSPD_FRN_PUBLIC_MN", "MSPD_FRN_SHARE_MARKETABLE"),
        ):
            if src in m.columns:
                m[share] = pd.to_numeric(m[src], errors="coerce") / mkt
        frames[i] = m
        save_frames(frames, RAW_JSON)
        log_step("Rewrote MSPD class shares from dollar columns")
    publish_buybacks(frames, generated_at)
    raw_tables = {}
    catalog = []
    for name, df in zip(FRAME_NAMES, frames):
        catalog.append({
            "frame": name,
            "rows": int(len(df)),
            "cols": int(df.shape[1]) if df is not None else 0,
            "start": df.index.min().strftime("%Y-%m-%d") if len(df) else None,
            "end": df.index.max().strftime("%Y-%m-%d") if len(df) else None,
            "columns": [str(c) for c in (df.columns if df is not None else [])],
        })
        keep = RAW_KEEP.get(name)
        if not keep or df is None or df.empty:
            continue
        cols = [c for c in keep if c in df.columns]
        if not cols:
            continue
        piece = df[cols].copy()
        piece.index = pd.to_datetime(piece.index)
        # month-end last keeps the follow-along table readable
        piece = piece.resample("ME").last()
        raw_tables[name] = df_to_table(piece)
    write_json(PUB / "raw_inputs.json", {
        "generated_at": generated_at,
        "catalog": catalog,
        "tables": raw_tables,
        "note": "Auction / coupon / holdings frames stay in .cache; only formula inputs are published.",
    })

    write_json(PUB / "manifest.json", {
        "generated_at": generated_at,
        "files": [
            "quarterly.json",
            "series.json",
            "calculated_metrics.json",
            "raw_inputs.json",
            "thresholds.json",
            "cubes.json",
            "daily_refi.json",
            "buybacks.json",
        ],
    })
    write_json(PUB / "thresholds.json", thresh.to_dict(orient="records"))

    last = state.iloc[-1]
    log_step(f"quarters {len(state)}  {state.index.min().date()} -> {state.index.max().date()}")
    log_step(
        f"latest {state.index[-1].date()}  "
        f"F=({last.F1:.2f},{last.F2:.2f},{last.F3:.2f})  "
        f"fiscal={int(last.n_fiscal)}/3 fail={int(last.fail)}"
    )


def main() -> None:
    log_step("Data build script initialized.")
    p = argparse.ArgumentParser()
    p.add_argument("--fetch", action="store_true", help="pull / update raw frames into .cache")
    p.add_argument("--process", action="store_true", help="compute metrics and write data/published")
    args = p.parse_args()
    do_fetch = args.fetch or not (args.fetch or args.process)
    do_process = args.process or not (args.fetch or args.process)
    if args.fetch and not args.process:
        do_process = False
    if args.process and not args.fetch:
        do_fetch = False

    if do_fetch:
        fetch_raw()
    if do_process:
        process_and_publish()
    log_step("Build script completed successfully.")


if __name__ == "__main__":
    main()