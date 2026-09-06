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
    "x2": "interest_pct_receipts",
    "x3": "primary_deficit_pct_gdp",
}

# Columns a human needs to replay the six formulas. Full auction tables stay in cache.
RAW_KEEP = {
    "fred_policy_rates": [
        "FEDFUNDS", "TB3MS", "DGS10", "DGS2", "DGS5", "DGS30", "DFII10",
        "DFEDTARU", "DFEDTARL",
    ],
    "fred_fiscal_nipa": ["A091RC1Q027SBEA", "FGRECPT", "W006RC1Q027SBEA", "FGEXPND"],
    "fred_debt_stocks": ["GFDEBTN", "FYGFDPUN", "GFDEGDQ188S", "FYGFGDQ188S"],
    "fred_labor_output": [
        "UNRATE", "NROU", "GDP", "GDPC1", "GDPPOT", "PAYEMS", "JTSJOL",
    ],
    "fred_term_premium": [
        "THREEFYTP10", "T10Y2Y", "T10Y3M", "T5YIE", "T10YIE", "T5YIFR",
    ],
    "fred_financial_conditions": ["NFCI", "DRTSCILM", "BAMLC0A0CM", "BAMLH0A0HYM2"],
    "fred_inflation": [
        "PCEPILFE", "PCEPI", "CPILFESL", "CPIAUCSL", "MICH", "PCETRIM12M159SFRBDAL",
    ],
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
    if path.exists():
        z = pd.read_csv(path)
        return {str(r["key"]): float(r["value"]) for _, r in z.iterrows()}
    return {
        "debt_gdp_warn": 100.0,
        "debt_gdp_death": 140.0,
        "int_rec_warn": 20.0,
        "int_rec_death": 30.0,
        "int_tax_warn": 25.0,
        "int_tax_death": 40.0,
        "refi_gap_warn": 0.50,
        "refi_gap_death": 1.00,
    }


ZONE = load_zone(DATA / "zone.csv")
SIGMA_WINDOW_START = "2000-01-01"  # plotted path and σ share this window
NONBILL_SPLIT = {"y2": 2.0 / 3.0, "y10": 1.0 / 3.0}  # applied to (1 - w_bills) only


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
    int_bn = _qe(_col_or(m02, "interest_bn_saar"))
    rec_bn = _qe(_col_or(m02, "current_receipts_bn_saar"))
    primary = _qe(_col_or(m03, "primary_deficit_pct_gdp"))
    tb3 = _qe(_col_or(policy, "TB3MS"))
    y2 = _qe(_col_or(policy, "DGS2"))
    y10 = _qe(_col_or(policy, "DGS10"))
    gdp = _qe(_col_or(labor, "GDP"))
    debt_pub_gdp = _qe(_col_or(debt, "FYGFGDQ188S"))
    tax_bn = _qe(_col_or(fiscal, "W006RC1Q027SBEA"))

    w_bills = _qe(_col_or(m01, "w_bills"))
    w_2y = _qe(_col_or(m01, "w_2y"))
    w_10y = _qe(_col_or(m01, "w_10y"))
    marginal = _qe(_col_or(m01, "marginal_rate"))
    refi_gap = _qe(_col_or(m01, "refi_gap"))
    if min(int(s.dropna().shape[0]) for s in (w_bills, w_2y, w_10y, marginal, refi_gap)) < 8:
        raise SystemExit("metric 01 missing issuance weights / refi_gap — rerun calculate_metrics")

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
        "interest_bn": int_bn,
        "receipts_bn": rec_bn,
        "tax_bn": tax_bn,
        "primary_deficit_pct_gdp": primary,
        "debt_gdp_pct": debt_pub_gdp,
        "gdp_bn": gdp,
        "int_gdp_pct": (int_bn / gdp) * 100.0,
    }).sort_index()
    panel = panel.loc[panel.index >= SIGMA_WINDOW_START]
    need = [
        "debt_gdp_pct", "int_rec_pct", "int_tax_pct", "refi_gap",
        "funds_minus_stock", "primary_deficit_pct_gdp",
    ]
    panel = panel.dropna(subset=need)

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
    panel["F2_rec"] = y["y2"].reindex(panel.index) if "y2" in y.columns else (panel["int_rec_pct"] - ZONE["int_rec_warn"]) / sig_rec
    panel["F2_tax"] = (panel["int_tax_pct"] - ZONE["int_tax_warn"]) / sig_tax
    panel["F1"] = y["y1"].reindex(panel.index) if "y1" in y.columns else np.nan
    panel["F3"] = y["y3"].reindex(panel.index) if "y3" in y.columns else np.nan
    log_step(f"sigma int/rec={sig_rec:.4f}  int/tax={sig_tax:.4f}")

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

    sustain = panel.dropna(subset=["F1", "F2_rec", "F2_tax", "F3"])
    fail = sustain

    payload = {
        "generated_at": generated_at,
        "zone": ZONE,
        "coupon_source": coupon_source,
        "refinance_rule": "MSPD Table 3 remaining-maturity weights x TB3MS/DGS2/DGS5/DGS10/DGS30/DFII10/FEDFUNDS minus Fiscal Data Total Marketable coupon",
        "nonbill_split": NONBILL_SPLIT,
        "sigma_window": {
            "requested_start": SIGMA_WINDOW_START,
            "start": str(panel.index.min().date()) if len(panel) else SIGMA_WINDOW_START,
            "end": str(panel.index.max().date()) if len(panel) else None,
            "n": int(len(panel)),
        },
        "sigma": {"int_rec": sig_rec, "int_tax": sig_tax},
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
    aligned = aligned.loc[aligned.index >= SIGMA_WINDOW_START]
    if aligned.empty:
        raise SystemExit(f"no complete quarters on or after {SIGMA_WINDOW_START}")
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