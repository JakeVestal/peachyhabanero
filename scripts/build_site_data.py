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
from datetime import datetime, timezone
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
    FRAME_NAMES,
    build_all,
    calculate_metrics,
    load_frames,
    save_frames,
    summarize,
    summarize_metrics,
    update_raw,
)
from cube_visualize import (  # noqa: E402
    load_thresholds,
    quarterly_complete,
    standardize,
)
from failure_cube import embed, load_or_update_rate_adjust  # noqa: E402
from macro_drivers import load_or_update_drivers  # noqa: E402

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
    "x2": "interest_pct_receipts",
    "x3": "primary_deficit_pct_gdp",
    "x4": "acm_10y_term_premium",
    "x5": "r_minus_g",
    "x6": "NFCI",
}

# Columns a human needs to replay the six formulas. Full auction tables stay in cache.
RAW_KEEP = {
    "fred_policy_rates": ["FEDFUNDS", "TB3MS", "DGS10", "DGS2"],
    "fred_fiscal_nipa": ["A091RC1Q027SBEA", "FGRECPT", "W006RC1Q027SBEA", "FGEXPND"],
    "fred_debt_stocks": ["GFDEBTN", "FYGFDPUN", "GFDEGDQ188S", "FYGFGDQ188S"],
    "fred_labor_output": ["UNRATE", "NROU", "GDP", "GDPC1", "GDPPOT"],
    "fred_term_premium": ["THREEFYTP10", "T10Y2Y", "T10Y3M"],
    "fred_financial_conditions": ["NFCI", "DRTSCILM", "BAMLC0A0CM", "BAMLH0A0HYM2"],
    "fred_inflation": ["PCEPILFE", "PCEPI", "CPILFESL"],
    "fiscal_mspd_composition": [
        "MSPD_BILLS_PUBLIC_MN",
        "MSPD_MARKETABLE_PUBLIC_MN",
        "MSPD_TOTAL_DEBT_MN",
        "MSPD_BILLS_SHARE_MARKETABLE",
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


ZONE = {
    "debt_gdp_warn": 100.0,
    "debt_gdp_death": 140.0,
    "int_rec_warn": 20.0,
    "int_rec_death": 30.0,
    "int_tax_warn": 25.0,
    "int_tax_death": 40.0,
    "refi_gap_warn": 0.50,
    "refi_gap_death": 1.50,
}
REFINANCE_WEIGHTS = {"tb3m": 0.25, "y2": 0.50, "y10": 0.25}


def _qe(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    s.index = pd.to_datetime(s.index)
    return s.sort_index().resample("QE").last()


def _piecewise(v: pd.Series, warn: float, death: float) -> pd.Series:
    v = v.astype(float)
    out = pd.Series(np.nan, index=v.index)
    below = v <= warn
    mid = (v > warn) & (v <= death)
    above = v > death
    out.loc[below] = (v.loc[below] / warn).clip(lower=0)
    span = max(death - warn, 1e-9)
    out.loc[mid] = 1.0 + (v.loc[mid] - warn) / span
    out.loc[above] = 2.0 + (v.loc[above] - death) / death
    return out


def _signed_dist(scores: np.ndarray, threshold: float) -> np.ndarray:
    delta = scores - threshold
    shortfall = np.clip(-delta, 0.0, None)
    outside = shortfall.any(axis=1)
    d_out = np.linalg.norm(shortfall, axis=1)
    d_in = delta.min(axis=1)
    return np.where(outside, d_out, -d_in)


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

    stock = _qe(_col_or(m01, "treasury_avg_marketable_coupon_pct", "effective_avg_coupon_pct"))
    funds = _qe(_col_or(m01, "FEDFUNDS"))
    funds_minus = _qe(_col_or(m01, "funds_minus_stock_coupon_pp"))
    int_rec = _qe(_col_or(m02, "interest_pct_of_current_receipts"))
    int_tax = _qe(_col_or(m02, "interest_pct_of_tax_receipts"))
    int_bn = _qe(_col_or(m02, "interest_bn_saar"))
    rec_bn = _qe(_col_or(m02, "current_receipts_bn_saar"))
    primary = _qe(_col_or(m03, "primary_deficit_pct_gdp"))
    tb3 = _qe(_col_or(policy, "TB3MS"))
    y2 = _qe(_col_or(policy, "DGS2"))
    y10 = _qe(_col_or(policy, "DGS10"))
    gdp = _qe(_col_or(labor, "GDP"))
    debt_pub_gdp = _qe(_col_or(debt, "FYGFGDQ188S"))
    tax_bn = _qe(_col_or(fiscal, "W006RC1Q027SBEA"))

    w = REFINANCE_WEIGHTS
    marginal = w["tb3m"] * tb3 + w["y2"] * y2 + w["y10"] * y10
    refi_gap = marginal - stock

    panel = pd.DataFrame({
        "funds_minus_stock": funds_minus,
        "FEDFUNDS": funds,
        "stock_avg_coupon": stock,
        "tb3m": tb3,
        "y2": y2,
        "y10": y10,
        "marginal_rate": marginal,
        "refi_gap": refi_gap,
        "int_rec_pct": int_rec,
        "int_tax_pct": int_tax,
        "interest_bn": int_bn,
        "receipts_bn": rec_bn,
        "tax_bn": tax_bn,
        "primary_deficit_pct_gdp": primary,
        "debt_gdp_pct": debt_pub_gdp,
        "gdp_bn": gdp,
        "int_gdp_pct": (int_bn / gdp) * 100.0,
    }).sort_index()
    panel["F1"] = y["y1"].reindex(panel.index) if "y1" in y.columns else np.nan
    panel["F3"] = y["y3"].reindex(panel.index) if "y3" in y.columns else np.nan

    def f2_of(series, c):
        s = series.dropna()
        sig = float(s.std(ddof=1)) or 1.0
        return (series - c) / sig

    panel["F2_rec"] = f2_of(panel["int_rec_pct"], ZONE["int_rec_warn"])
    panel["F2_tax"] = f2_of(panel["int_tax_pct"], ZONE["int_tax_warn"])

    s_debt = _piecewise(panel["debt_gdp_pct"], ZONE["debt_gdp_warn"], ZONE["debt_gdp_death"])
    s_gap = _piecewise(panel["refi_gap"], ZONE["refi_gap_warn"], ZONE["refi_gap_death"])
    panel["s_debt"] = s_debt
    panel["s_gap"] = s_gap
    for burden, warn, death, col in (
            ("rec", ZONE["int_rec_warn"], ZONE["int_rec_death"], "int_rec_pct"),
            ("tax", ZONE["int_tax_warn"], ZONE["int_tax_death"], "int_tax_pct"),
    ):
        s_bur = _piecewise(panel[col], warn, death)
        panel[f"s_{burden}"] = s_bur
        cube = np.column_stack([s_debt.to_numpy(), s_bur.to_numpy(), s_gap.to_numpy()])
        panel[f"dist_warn_{burden}"] = _signed_dist(cube, 1.0)
        panel[f"dist_death_{burden}"] = _signed_dist(cube, 2.0)
        panel[f"stress_{burden}"] = (
                0.20 * s_debt + 0.35 * s_bur + 0.25 * s_gap
                + 0.20 * _piecewise(panel["int_gdp_pct"], 3.0, 4.5)
        )

    sustain = panel.dropna(subset=["debt_gdp_pct", "int_rec_pct", "int_tax_pct", "refi_gap"])
    sustain = sustain.loc[sustain.index >= "2000-01-01"]
    fail = panel.dropna(subset=["F1", "F2_rec", "F2_tax", "F3"])

    payload = {
        "generated_at": generated_at,
        "zone": ZONE,
        "refinance_weights": REFINANCE_WEIGHTS,
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
            f"cubes fail {len(fail)}  latest {fail.index[-1].date()}  "
            f"F1={lastf.F1:.2f} F2rec={lastf.F2_rec:.2f} F3={lastf.F3:.2f}"
        )


def fetch_raw() -> None:
    log_step("Starting raw data fetch/update step...")
    CACHE.mkdir(parents=True, exist_ok=True)
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


def process_and_publish() -> None:
    log_step("Starting data processing and publication step...")
    if not RAW_JSON.exists():
        raise SystemExit(f"missing {RAW_JSON} — run with --fetch first")

    CACHE.mkdir(parents=True, exist_ok=True)
    PUB.mkdir(parents=True, exist_ok=True)

    log_step("Calculating metrics...")
    metrics = calculate_metrics(raw_path=RAW_JSON, metrics_path=METRICS_JSON, save=True)
    print(summarize_metrics(metrics).to_string(index=False))

    log_step("Loading critical threshold values and standardizing data...")
    thresh = load_thresholds(THRESH)
    aligned = quarterly_complete(metrics, thresh).sort_index()
    y, s_bits = standardize(aligned, thresh)
    state = embed(y, s_bits, (1, 2, 3), (4, 5, 6)).sort_index()
    for c in aligned.columns:
        state[c] = aligned[c]

    log_step("Updating rate adjustments and macro drivers...")
    rates = load_or_update_rate_adjust(RATE_CSV)
    state = state.join(rates[["rate_adjust"]], how="left")
    state["rate_adjust"] = state["rate_adjust"].fillna(0.0)
    drivers = load_or_update_drivers(DRIVERS_CSV)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    quarterly_cols = [
        "F1", "F2", "F3", "n_fiscal", "n_amp", "fail", "rate_adjust",
        "y1", "y2", "y3", "y4", "y5", "y6",
        "s1", "s2", "s3", "s4", "s5", "s6",
        "x1", "x2", "x3", "x4", "x5", "x6",
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

    log_step("Generating catalog and raw input published tables...")
    frames = load_frames(RAW_JSON)
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
            "rate_adjust.csv",
            "macro_drivers.csv",
            "thresholds.json",
            "cubes.json",
        ],
    })
    write_json(PUB / "thresholds.json", thresh.to_dict(orient="records"))

    log_step("Writing final CSV outputs...")
    drivers.to_csv(PUB / "macro_drivers.csv")
    rates.to_csv(PUB / "rate_adjust.csv")
    log_step(f"wrote {PUB / 'macro_drivers.csv'}")
    log_step(f"wrote {PUB / 'rate_adjust.csv'}")

    last = state.iloc[-1]
    log_step(f"quarters {len(state)}  {state.index.min().date()} -> {state.index.max().date()}")
    log_step(
        f"latest {state.index[-1].date()}  "
        f"F=({last.F1:.2f},{last.F2:.2f},{last.F3:.2f})  "
        f"fiscal={int(last.n_fiscal)}/3 amp={int(last.n_amp)}/3 fail={int(last.fail)}"
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