#!/usr/bin/env python3
"""Nightly / local data build.

Steps you can run separately:
    python scripts/build_site_data.py --fetch
    python scripts/build_site_data.py --process
    python scripts/build_site_data.py          # both

Raw frames stay in CUBE_CACHE (not git).
Derived tables land in data/published/ for the static page.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

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
DATA = Path(os.environ.get("CUBE_DATA_DIR", ROOT / "data"))
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
    "fred_debt_stocks": ["GFDEBTN", "FYGFDPUN", "GFDEGDQ188S"],
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
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {path}")


def fetch_raw() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    if FULL or not RAW_JSON.exists():
        print("full raw build")
        frames = build_all()
        save_frames(frames, RAW_JSON)
    else:
        print("incremental raw update")
        frames = update_raw(RAW_JSON)
    print(summarize(frames).to_string(index=False))
    print(f"cached {RAW_JSON}")


def process_and_publish() -> None:
    if not RAW_JSON.exists():
        raise SystemExit(f"missing {RAW_JSON} — run with --fetch first")

    CACHE.mkdir(parents=True, exist_ok=True)
    PUB.mkdir(parents=True, exist_ok=True)

    metrics = calculate_metrics(raw_path=RAW_JSON, metrics_path=METRICS_JSON, save=True)
    print(summarize_metrics(metrics).to_string(index=False))

    thresh = load_thresholds(THRESH)
    aligned = quarterly_complete(metrics, thresh).sort_index()
    y, s_bits = standardize(aligned, thresh)
    state = embed(y, s_bits, (1, 2, 3), (4, 5, 6)).sort_index()
    for c in aligned.columns:
        state[c] = aligned[c]

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

    metric_tables = {}
    for name, df in metrics.items():
        metric_tables[name] = df_to_table(df)
    write_json(PUB / "calculated_metrics.json", {
        "generated_at": generated_at,
        "tables": metric_tables,
    })

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
        ],
    })
    write_json(PUB / "thresholds.json", thresh.to_dict(orient="records"))
    drivers.to_csv(PUB / "macro_drivers.csv")
    rates.to_csv(PUB / "rate_adjust.csv")
    print(f"wrote {PUB / 'macro_drivers.csv'}")
    print(f"wrote {PUB / 'rate_adjust.csv'}")

    last = state.iloc[-1]
    print(f"quarters {len(state)}  {state.index.min().date()} -> {state.index.max().date()}")
    print(
        f"latest {state.index[-1].date()}  "
        f"F=({last.F1:.2f},{last.F2:.2f},{last.F3:.2f})  "
        f"fiscal={int(last.n_fiscal)}/3 amp={int(last.n_amp)}/3 fail={int(last.fail)}"
    )


def main() -> None:
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


if __name__ == "__main__":
    main()