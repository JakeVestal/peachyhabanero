"""
Fetch raw series for the six-condition fiscal-cube dashboard.

Sources
-------
FRED (csv endpoint; optional FRED_API_KEY for the JSON API)
U.S. Treasury Fiscal Data API (no key): average coupons, MSPD composition,
auctions, interest expense, debt-to-the-penny.

Storage
-------
DatetimeIndex DataFrames written as JSON (records + date column).
Default: cube_raw_frames.json next to this file, or whatever path
build_site_data.py passes.

Usage
-----
    python cube_data.py              # full build
    python cube_data.py --update     # incremental append
    from cube_data import build_all, update_raw, load_frames
"""

from __future__ import annotations

import argparse
import io
import json
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FRED_API = "https://api.stlouisfed.org/fred/series/observations"
FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"

DEFAULT_START = "1970-01-01"
DEFAULT_RAW = Path(__file__).resolve().parent / "cube_raw_frames.json"
DEFAULT_METRICS = Path(__file__).resolve().parent / "calculated_metrics.json"
DEFAULT_PICKLE = DEFAULT_RAW
DEFAULT_METRICS_PICKLE = DEFAULT_METRICS

# Ordered list of frame names. Keep stable — update_pickle relies on position + name.
FRAME_NAMES = [
    "fred_policy_rates",
    "fred_fiscal_nipa",
    "fred_debt_stocks",
    "fred_labor_output",
    "fred_term_premium",
    "fred_official_holdings",
    "fred_financial_conditions",
    "fred_inflation",
    "fiscal_avg_coupon",
    "fiscal_mspd_composition",
    "fiscal_auctions",
    "fiscal_interest_expense",
    "fiscal_debt_to_penny",
]

FRED_GROUPS = {
    "fred_policy_rates": [
        "FEDFUNDS",  # effective federal funds
        "DFF",       # daily effective funds
        "IORB",      # interest on reserve balances (may be shorter history)
        "RRPONTSYD",  # ON RRP uptake, $bn (optional; skip if missing)
        "TB3MS",     # 3-month T-bill
        "DGS2",
        "DGS10",
        "DGS30",
        "DFII10",    # 10y TIPS real yield
    ],
    "fred_fiscal_nipa": [
        "A091RC1Q027SBEA",  # federal interest payments, SAAR $bn
        "FGRECPT",          # federal current receipts, SAAR $bn
        "W006RC1Q027SBEA",  # federal current tax receipts, SAAR $bn
        "FGEXPND",          # federal current expenditures, SAAR $bn
    ],
    "fred_debt_stocks": [
        "GFDEBTN",          # total public debt, $mn
        "FYGFDPUN",         # debt held by the public, $mn
        "GFDEGDQ188S",      # total debt / GDP %
        "FYGFGDQ188S",      # debt held by public / GDP %
    ],
    "fred_labor_output": [
        "UNRATE",
        "NROU",
        "GDP",              # nominal GDP SAAR $bn
        "GDPC1",            # real GDP
        "GDPPOT",           # potential GDP
    ],
    "fred_term_premium": [
        "THREEFYTP10",      # NY Fed ACM 10y term premium (FRED)
        "T10Y2Y",
        "T10Y3M",
    ],
    "fred_official_holdings": [
        "WSHOTSL",          # Fed SOMA Treasuries, $mn, Wednesday
        "FDHBFIN",          # federal debt held by foreign/international, $bn
    ],
    "fred_financial_conditions": [
        "NFCI",
        "DRTSCILM",         # SLOOS C&I tightening
        "BAMLC0A0CM",       # IG OAS
        "BAMLH0A0HYM2",     # HY OAS
    ],
    "fred_inflation": [
        "PCEPI",
        "PCEPILFE",
        "CPILFESL",
    ],
}

# IORB / RRP series may 404 on older csv combiners; fetch individually.
OPTIONAL_FRED = {"IORB", "RRPONTSYD", "DFF", "ACMTP10"}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "cube-data/1.0 (research)"})
    return s


def _get_json(sess: requests.Session, url: str, params: dict, retries: int = 4):
    last = None
    for i in range(retries):
        try:
            r = sess.get(url, params=params, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last = exc
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"GET failed {url} {params}: {last}") from last


# ---------------------------------------------------------------------------
# FRED
# ---------------------------------------------------------------------------

def fetch_fred_series(
        sess: requests.Session,
        series_id: str,
        start: str = DEFAULT_START,
        api_key: Optional[str] = None,
) -> pd.Series:
    """One FRED series as a DatetimeIndex Series named series_id."""
    api_key = api_key or os.environ.get("FRED_API_KEY")
    if api_key:
        payload = _get_json(
            sess,
            FRED_API,
            {
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "observation_start": start,
            },
        )
        obs = payload.get("observations") or []
        if not obs:
            return pd.Series(dtype="float64", name=series_id)
        df = pd.DataFrame(obs)
        df["date"] = pd.to_datetime(df["date"])
        df["value"] = pd.to_numeric(df["value"].replace(".", pd.NA), errors="coerce")
        s = df.set_index("date")["value"].sort_index().rename(series_id)
        s = s[~s.index.duplicated(keep="last")]
        return s

    # Public CSV graph endpoint — no key.
    r = sess.get(
        FRED_CSV,
        params={"id": series_id, "cosd": start},
        timeout=60,
    )
    r.raise_for_status()
    raw = r.text
    if raw.lstrip().startswith("<") or "Error" in raw[:200]:
        raise RuntimeError(f"FRED CSV error for {series_id}: {raw[:180]}")
    df = pd.read_csv(io.StringIO(raw))
    date_col = df.columns[0]
    val_col = df.columns[1]
    df[date_col] = pd.to_datetime(df[date_col])
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    s = df.set_index(date_col)[val_col].sort_index().rename(series_id)
    s = s[s.index >= pd.Timestamp(start)]
    s = s[~s.index.duplicated(keep="last")]
    return s


def fetch_fred_group(
        sess: requests.Session,
        ids: list[str],
        start: str,
        api_key: Optional[str] = None,
) -> pd.DataFrame:
    cols = []
    for sid in ids:
        try:
            cols.append(fetch_fred_series(sess, sid, start=start, api_key=api_key))
        except Exception as exc:
            if sid in OPTIONAL_FRED:
                print(f"  skip optional {sid}: {exc}")
                continue
            print(f"  WARN {sid}: {exc}")
    if not cols:
        return pd.DataFrame()
    out = pd.concat(cols, axis=1, sort=True).sort_index()
    out.index.name = "date"
    return out


# ---------------------------------------------------------------------------
# Treasury Fiscal Data
# ---------------------------------------------------------------------------

def fiscal_paginate(
        sess: requests.Session,
        endpoint: str,
        fields: Optional[str] = None,
        extra_filter: Optional[str] = None,
        start: Optional[str] = None,
        date_field: str = "record_date",
        page_size: int = 10000,
        sort: Optional[str] = None,
) -> pd.DataFrame:
    filters = []
    if start:
        filters.append(f"{date_field}:gte:{start}")
    if extra_filter:
        filters.append(extra_filter)
    params = {
        "page[size]": page_size,
        "page[number]": 1,
        "sort": sort or date_field,
    }
    if fields:
        params["fields"] = fields
    if filters:
        params["filter"] = ",".join(filters)

    rows = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        params["page[number]"] = page
        payload = _get_json(sess, f"{FISCAL_BASE}/{endpoint}", params)
        chunk = payload.get("data") or []
        rows.extend(chunk)
        meta = payload.get("meta") or {}
        total_pages = int(meta.get("total-pages") or 1)
        page += 1
        if not chunk:
            break
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    return df


def fetch_avg_coupon(sess: requests.Session, start: str) -> pd.DataFrame:
    """Monthly average coupon by security description, wide."""
    raw = fiscal_paginate(
        sess,
        "v2/accounting/od/avg_interest_rates",
        fields="record_date,security_type_desc,security_desc,avg_interest_rate_amt",
        start=start,
        sort="record_date",
    )
    if raw.empty:
        return raw
    raw["record_date"] = pd.to_datetime(raw["record_date"])
    raw["avg_interest_rate_amt"] = pd.to_numeric(
        raw["avg_interest_rate_amt"], errors="coerce"
    )
    raw["series"] = (
            raw["security_type_desc"].fillna("").str.strip()
            + "_"
            + raw["security_desc"].fillna("").str.strip()
    ).str.replace(r"[^A-Za-z0-9]+", "_", regex=True).str.strip("_")
    wide = (
        raw.pivot_table(
            index="record_date",
            columns="series",
            values="avg_interest_rate_amt",
            aggfunc="last",
        )
        .sort_index()
    )
    wide.columns = [f"AVG_COUPON_{c}" for c in wide.columns]
    wide.index.name = "date"
    return wide


def fetch_mspd_composition(sess: requests.Session, start: str) -> pd.DataFrame:
    """Monthly MSPD Table 1: bills / notes / bonds / total marketable ($mn)."""
    raw = fiscal_paginate(
        sess,
        "v1/debt/mspd/mspd_table_1",
        fields=(
            "record_date,security_type_desc,security_class_desc,"
            "debt_held_public_mil_amt,total_mil_amt"
        ),
        start=start,
        sort="record_date",
    )
    if raw.empty:
        return raw
    raw["record_date"] = pd.to_datetime(raw["record_date"])
    for c in ("debt_held_public_mil_amt", "total_mil_amt"):
        raw[c] = pd.to_numeric(raw[c], errors="coerce")

    def _class_mask(df, type_desc, class_desc=None):
        m = df["security_type_desc"] == type_desc
        if class_desc is not None:
            m &= df["security_class_desc"] == class_desc
        return m

    rows = []
    for dt, g in raw.groupby("record_date"):
        rec = {"date": dt}
        mapping = {
            "MSPD_BILLS_PUBLIC_MN": ("Marketable", "Bills"),
            "MSPD_NOTES_PUBLIC_MN": ("Marketable", "Notes"),
            "MSPD_BONDS_PUBLIC_MN": ("Marketable", "Bonds"),
            "MSPD_TIPS_PUBLIC_MN": ("Marketable", "Treasury Inflation-Protected Securities"),
            "MSPD_FRN_PUBLIC_MN": ("Marketable", "Floating Rate Notes"),
        }
        for col, (td, cd) in mapping.items():
            hit = g[_class_mask(g, td, cd)]
            rec[col] = hit["debt_held_public_mil_amt"].sum() if len(hit) else pd.NA
        tot_mkt = g[_class_mask(g, "Total Marketable")]
        rec["MSPD_MARKETABLE_PUBLIC_MN"] = (
            tot_mkt["debt_held_public_mil_amt"].sum() if len(tot_mkt) else pd.NA
        )
        tot_pub = g[_class_mask(g, "Total Public Debt Outstanding")]
        rec["MSPD_TOTAL_PUBLIC_MN"] = (
            tot_pub["debt_held_public_mil_amt"].sum() if len(tot_pub) else pd.NA
        )
        rec["MSPD_TOTAL_DEBT_MN"] = (
            tot_pub["total_mil_amt"].sum() if len(tot_pub) else pd.NA
        )
        rows.append(rec)
    out = pd.DataFrame(rows).set_index("date").sort_index()
    bills = pd.to_numeric(out["MSPD_BILLS_PUBLIC_MN"], errors="coerce")
    mkt = pd.to_numeric(out["MSPD_MARKETABLE_PUBLIC_MN"], errors="coerce")
    out["MSPD_BILLS_SHARE_MARKETABLE"] = bills / mkt
    return out


def fetch_auctions(sess: requests.Session, start: str) -> pd.DataFrame:
    """Auction results indexed by auction_date. One row per CUSIP/auction."""
    raw = fiscal_paginate(
        sess,
        "v1/accounting/od/auctions_query",
        fields=(
            "auction_date,security_type,security_term,cusip,"
            "bid_to_cover_ratio,offering_amt,total_accepted,total_tendered,"
            "high_yield,high_discnt_rate,high_investment_rate,"
            "primary_dealer_accepted,indirect_bidder_accepted,direct_bidder_accepted,"
            "soma_accepted"
        ),
        start=start,
        date_field="auction_date",
        sort="auction_date",
    )
    if raw.empty:
        return raw
    raw["auction_date"] = pd.to_datetime(raw["auction_date"])
    num_cols = [
        "bid_to_cover_ratio",
        "offering_amt",
        "total_accepted",
        "total_tendered",
        "high_yield",
        "high_discnt_rate",
        "high_investment_rate",
        "primary_dealer_accepted",
        "indirect_bidder_accepted",
        "direct_bidder_accepted",
        "soma_accepted",
    ]
    for c in num_cols:
        if c in raw.columns:
            raw[c] = pd.to_numeric(raw[c], errors="coerce")
    raw = raw.set_index("auction_date").sort_index()
    raw.index.name = "date"
    return raw


def fetch_interest_expense(sess: requests.Session, start: str) -> pd.DataFrame:
    raw = fiscal_paginate(
        sess,
        "v2/accounting/od/interest_expense",
        fields=(
            "record_date,expense_catg_desc,expense_group_desc,"
            "expense_type_desc,month_expense_amt,fytd_expense_amt"
        ),
        start=start,
        sort="record_date",
    )
    if raw.empty:
        return raw
    raw["record_date"] = pd.to_datetime(raw["record_date"])
    raw["month_expense_amt"] = pd.to_numeric(raw["month_expense_amt"], errors="coerce")
    raw["fytd_expense_amt"] = pd.to_numeric(raw["fytd_expense_amt"], errors="coerce")
    raw["series"] = (
            raw["expense_catg_desc"].fillna("")
            + "_"
            + raw["expense_group_desc"].fillna("")
            + "_"
            + raw["expense_type_desc"].fillna("")
    ).str.replace(r"[^A-Za-z0-9]+", "_", regex=True).str.strip("_")
    month = raw.pivot_table(
        index="record_date", columns="series", values="month_expense_amt", aggfunc="sum"
    )
    month.columns = [f"INT_EXP_M_{c}" for c in month.columns]
    fytd = raw.pivot_table(
        index="record_date", columns="series", values="fytd_expense_amt", aggfunc="sum"
    )
    fytd.columns = [f"INT_EXP_FYTD_{c}" for c in fytd.columns]
    out = pd.concat([month, fytd], axis=1).sort_index()
    out.index.name = "date"
    return out


def fetch_debt_to_penny(sess: requests.Session, start: str) -> pd.DataFrame:
    raw = fiscal_paginate(
        sess,
        "v2/accounting/od/debt_to_penny",
        fields="record_date,debt_held_public_amt,intragov_hold_amt,tot_pub_debt_out_amt",
        start=start,
        sort="record_date",
    )
    if raw.empty:
        return raw
    raw["record_date"] = pd.to_datetime(raw["record_date"])
    for c in ("debt_held_public_amt", "intragov_hold_amt", "tot_pub_debt_out_amt"):
        raw[c] = pd.to_numeric(raw[c], errors="coerce")
    raw = raw.rename(
        columns={
            "debt_held_public_amt": "DEBT_HELD_PUBLIC",
            "intragov_hold_amt": "DEBT_INTRAGOV",
            "tot_pub_debt_out_amt": "DEBT_TOTAL",
        }
    )
    out = raw.set_index("record_date")[
        ["DEBT_HELD_PUBLIC", "DEBT_INTRAGOV", "DEBT_TOTAL"]
    ].sort_index()
    out.index.name = "date"
    out = out[~out.index.duplicated(keep="last")]
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

FETCHERS = {
    "fred_policy_rates": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_policy_rates"], start),
    "fred_fiscal_nipa": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_fiscal_nipa"], start),
    "fred_debt_stocks": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_debt_stocks"], start),
    "fred_labor_output": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_labor_output"], start),
    "fred_term_premium": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_term_premium"], start),
    "fred_official_holdings": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_official_holdings"], start),
    "fred_financial_conditions": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_financial_conditions"], start),
    "fred_inflation": lambda s, start: fetch_fred_group(s, FRED_GROUPS["fred_inflation"], start),
    "fiscal_avg_coupon": fetch_avg_coupon,
    "fiscal_mspd_composition": fetch_mspd_composition,
    "fiscal_auctions": fetch_auctions,
    "fiscal_interest_expense": fetch_interest_expense,
    "fiscal_debt_to_penny": fetch_debt_to_penny,
}


def build_all(start: str = DEFAULT_START, verbose: bool = True) -> list[pd.DataFrame]:
    sess = _session()
    frames = []
    for name in FRAME_NAMES:
        if verbose:
            print(f"fetching {name} ...")
        try:
            df = FETCHERS[name](sess, start)
        except Exception as exc:
            print(f"  ERROR {name}: {exc}")
            df = pd.DataFrame()
        if df is None:
            df = pd.DataFrame()
        if not df.empty:
            df.index = pd.to_datetime(df.index)
            df.index.name = "date"
        if verbose:
            last = df.index.max() if len(df) else None
            print(f"  -> {df.shape} last={last}")
        frames.append(df)
    return frames


def _frame_to_split(df: pd.DataFrame) -> dict:
    if df is None or df.empty:
        return {"index": [], "columns": [], "data": []}
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    payload = json.loads(out.to_json(orient="split", date_format="iso"))
    return payload


def _frame_from_split(obj: dict | None) -> pd.DataFrame:
    if not obj or not obj.get("index"):
        return pd.DataFrame()
    df = pd.DataFrame(data=obj.get("data") or [], columns=obj.get("columns") or [], index=obj.get("index") or [])
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df


def save_frames(
        frames: list[pd.DataFrame],
        path: Path | str = DEFAULT_RAW,
) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "names": FRAME_NAMES[: len(frames)],
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "frames": [_frame_to_split(df) for df in frames],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


save_pickle = save_frames


def load_payload(path: Path | str = DEFAULT_RAW) -> dict:
    path = Path(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        frames = [_frame_from_split(x) if isinstance(x, dict) else pd.DataFrame() for x in payload]
        return {"names": FRAME_NAMES[: len(frames)], "frames": frames}
    names = payload.get("names") or FRAME_NAMES
    raw_frames = payload.get("frames") or []
    if isinstance(raw_frames, dict):
        frames = [_frame_from_split(raw_frames.get(n)) for n in names]
    else:
        frames = [_frame_from_split(x) for x in raw_frames]
    return {"names": names, "frames": frames, "saved_at": payload.get("saved_at")}


def load_frames(path: Path | str = DEFAULT_RAW) -> list[pd.DataFrame]:
    return load_payload(path)["frames"]


def _overlap_append(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    """Append new rows; if indexes overlap, prefer new values."""
    if old is None or old.empty:
        return new
    if new is None or new.empty:
        return old
    old = old.copy()
    new = new.copy()
    old.index = pd.to_datetime(old.index)
    new.index = pd.to_datetime(new.index)
    # union columns
    for c in new.columns:
        if c not in old.columns:
            old[c] = pd.NA
    for c in old.columns:
        if c not in new.columns:
            new[c] = pd.NA
    new = new[old.columns]
    keep_old = old[old.index < new.index.min()] if len(new) else old
    combined = pd.concat([keep_old, new], axis=0)
    combined = combined[~combined.index.duplicated(keep="last")].sort_index()
    combined.index.name = "date"
    return combined


def update_raw(
        path: Path | str = DEFAULT_RAW,
        lookback_days: int = 14,
        verbose: bool = True,
) -> list[pd.DataFrame]:
    """
    Load cached JSON, inspect each frame's last date, re-query from
    last_date - lookback_days, append, and save.
    """
    path = Path(path)
    if not path.exists():
        if verbose:
            print(f"no cache at {path}; running full build")
        frames = build_all(verbose=verbose)
        save_frames(frames, path)
        return frames

    payload = load_payload(path)
    frames = payload["frames"]
    names = payload.get("names") or FRAME_NAMES[: len(frames)]
    sess = _session()
    updated = []
    for i, name in enumerate(FRAME_NAMES):
        old = frames[i] if i < len(frames) else pd.DataFrame()
        if old is not None and len(old):
            last = pd.to_datetime(old.index.max())
            start = (last - timedelta(days=lookback_days)).date().isoformat()
        else:
            start = DEFAULT_START
        if verbose:
            print(f"updating {name} from {start} ...")
        try:
            fresh = FETCHERS[name](sess, start)
        except Exception as exc:
            print(f"  ERROR {name}: {exc} (keeping existing)")
            fresh = pd.DataFrame()
        merged = _overlap_append(old, fresh)
        if verbose:
            print(f"  -> {merged.shape} last={merged.index.max() if len(merged) else None}")
        updated.append(merged)
    save_frames(updated, path)
    return updated


update_pickle = update_raw


METRIC_NAMES = [
    "01_funds_equals_fiscal_rate",
    "02_interest_share_of_receipts",
    "03_primary_deficit_not_in_hole",
    "04_duration_demand_term_premium",
    "05_r_minus_g",
    "06_financial_conditions",
]


def _by_name(frames: list[pd.DataFrame]) -> dict[str, pd.DataFrame]:
    names = FRAME_NAMES[: len(frames)]
    return {n: frames[i] for i, n in enumerate(names)}


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    if df is None or df.empty or name not in df.columns:
        return pd.Series(dtype="float64", name=name)
    s = pd.to_numeric(df[name], errors="coerce")
    s.index = pd.to_datetime(s.index)
    s = s[~s.index.duplicated(keep="last")].sort_index().dropna()
    s.name = name
    return s


def _to_quarter_start(s: pd.Series) -> pd.Series:
    """Map any DatetimeIndex onto the first day of its quarter."""
    if s is None or s.empty:
        return pd.Series(dtype="float64", name=getattr(s, "name", None))
    out = s.copy()
    out.index = pd.to_datetime(out.index).to_period("Q").to_timestamp(how="start")
    out = out.groupby(level=0).last()
    return out


def _frame(*series: pd.Series) -> pd.DataFrame:
    parts = [s for s in series if s is not None and len(s)]
    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, axis=1, sort=True)
    out.index = pd.to_datetime(out.index)
    out.index.name = "date"
    return out.sort_index()


def calculate_metrics(
        raw_path: Path | str = DEFAULT_PICKLE,
        metrics_path: Path | str = DEFAULT_METRICS_PICKLE,
        save: bool = True,
) -> dict[str, pd.DataFrame]:
    """
    Build the six cube-condition metrics from the raw pickle.

    Returns a dict of DatetimeIndex DataFrames (not merged across metrics).
    Writes / overwrites calculated_metrics.pkl when save=True.
    """
    frames = load_frames(raw_path)
    src = _by_name(frames)

    policy = src.get("fred_policy_rates", pd.DataFrame())
    nipa = src.get("fred_fiscal_nipa", pd.DataFrame())
    debt = src.get("fred_debt_stocks", pd.DataFrame())
    labor = src.get("fred_labor_output", pd.DataFrame())
    term = src.get("fred_term_premium", pd.DataFrame())
    holdings = src.get("fred_official_holdings", pd.DataFrame())
    fci = src.get("fred_financial_conditions", pd.DataFrame())
    mspd = src.get("fiscal_mspd_composition", pd.DataFrame())
    coupon = src.get("fiscal_avg_coupon", pd.DataFrame())
    auctions = src.get("fiscal_auctions", pd.DataFrame())
    penny = src.get("fiscal_debt_to_penny", pd.DataFrame())

    funds = _col(policy, "FEDFUNDS")
    tb3 = _col(policy, "TB3MS")
    interest = _col(nipa, "A091RC1Q027SBEA")  # $bn SAAR
    receipts = _col(nipa, "FGRECPT")
    tax_receipts = _col(nipa, "W006RC1Q027SBEA")
    exp = _col(nipa, "FGEXPND")
    gfdebt = _col(debt, "GFDEBTN")  # $mn, quarterly Bulletin (lagged)
    penny_total = _col(penny, "DEBT_TOTAL")  # $
    mspd_total = _col(mspd, "MSPD_TOTAL_DEBT_MN")  # $mn
    gdp = _col(labor, "GDP")  # $bn SAAR
    unrate = _col(labor, "UNRATE")
    nrou = _col(labor, "NROU")
    gdpc1 = _col(labor, "GDPC1")
    gdppot = _col(labor, "GDPPOT")

    # Stock: daily debt-to-the-penny first, then MSPD, then Bulletin.
    # All converted to $bn so the latest official print wins the date.
    stock_parts = []
    if len(penny_total):
        stock_parts.append((penny_total / 1e9).rename("debt_bn"))
    if len(mspd_total):
        stock_parts.append((mspd_total / 1000.0).rename("debt_bn"))
    if len(gfdebt):
        stock_parts.append((gfdebt / 1000.0).rename("debt_bn"))
    if stock_parts:
        debt_bn = pd.concat(stock_parts).groupby(level=0).last().sort_index()
        debt_bn = debt_bn[~debt_bn.index.duplicated(keep="last")]
    else:
        debt_bn = pd.Series(dtype="float64", name="debt_bn")
    debt_bn_m = debt_bn.resample("ME").last().dropna()

    # Interest is NIPA quarterly SAAR. Hold the last quarter against the
    # current stock so r_stock moves when the stock prints, not when the Bulletin does.
    interest_m = interest.resample("ME").last().ffill()
    r_stock = (100.0 * interest_m / debt_bn_m).rename("effective_avg_coupon_pct")
    r_stock = r_stock.replace([float("inf"), float("-inf")], pd.NA).dropna()

    funds_m = funds.resample("ME").last()
    funds_minus_stock = (funds_m - r_stock).rename("funds_minus_stock_coupon_pp")

    bills_share = _col(mspd, "MSPD_BILLS_SHARE_MARKETABLE").rename(
        "bills_share_of_marketable"
    )
    # Treasury published average coupon on total marketable, if present
    mkt_coupon_cols = [
        c
        for c in (coupon.columns if not coupon.empty else [])
        if "Total_Marketable" in c or c.endswith("Total_Marketable")
    ]
    avg_mkt_coupon = None
    if mkt_coupon_cols:
        avg_mkt_coupon = pd.to_numeric(
            coupon[mkt_coupon_cols[0]], errors="coerce"
        ).rename("treasury_avg_marketable_coupon_pct")

    metric_1 = _frame(
        bills_share,
        r_stock,
        funds.rename("FEDFUNDS"),
        tb3.rename("TB3MS"),
        funds_minus_stock,
        *([avg_mkt_coupon] if avg_mkt_coupon is not None else []),
    )

    interest_over_receipts = (100.0 * interest / receipts).rename(
        "interest_pct_of_current_receipts"
    )
    interest_over_tax = (100.0 * interest / tax_receipts).rename(
        "interest_pct_of_tax_receipts"
    )
    metric_2 = _frame(interest_over_receipts, interest_over_tax, interest.rename("interest_bn_saar"), receipts.rename("current_receipts_bn_saar"))

    # primary deficit = (outlays net of interest) - receipts; positive = deficit
    primary_bn = ((exp - interest) - receipts).rename("primary_deficit_bn_saar")
    primary_gdp = (100.0 * primary_bn / gdp).rename("primary_deficit_pct_gdp")
    slack_u = (unrate - nrou).rename("unemployment_gap_pp")
    output_gap = (100.0 * (gdpc1 / gdppot - 1.0)).rename("output_gap_pct")
    metric_3 = _frame(primary_gdp, primary_bn, slack_u, output_gap)

    tp = _col(term, "THREEFYTP10").rename("acm_10y_term_premium_pp")
    t10y2y = _col(term, "T10Y2Y").rename("T10Y2Y_pp")
    t10y3m = _col(term, "T10Y3M").rename("T10Y3M_pp")
    # 10y auction bid-to-cover, native auction dates only
    btc_10y = pd.Series(dtype="float64", name="auction_btc_10y")
    if auctions is not None and not auctions.empty and "bid_to_cover_ratio" in auctions.columns:
        a = auctions.copy()
        a.index = pd.to_datetime(a.index)
        term_col = a["security_term"].astype(str) if "security_term" in a.columns else None
        if term_col is not None:
            mask = term_col.str.contains(r"10[-\s]?Year", case=False, na=False)
            btc_10y = pd.to_numeric(a.loc[mask, "bid_to_cover_ratio"], errors="coerce")
            btc_10y = btc_10y[~btc_10y.index.duplicated(keep="last")].sort_index()
            btc_10y.name = "auction_btc_10y"
    metric_4 = _frame(tp, t10y2y, t10y3m, btc_10y)

    g_nom = (100.0 * gdp.pct_change(4)).rename("nominal_gdp_yoy_pct")
    g_nom_m = g_nom.resample("ME").last()
    g_nom_m = g_nom_m.reindex(r_stock.index).ffill()
    r_minus_g = (r_stock - g_nom_m).rename("r_minus_g_pp")
    metric_5 = _frame(r_minus_g, r_stock, g_nom)

    nfci = _col(fci, "NFCI").rename("NFCI")
    sloos = _col(fci, "DRTSCILM").rename("sloos_ci_tightening_pct")
    ig = _col(fci, "BAMLC0A0CM").rename("ig_oas_pp")
    hy = _col(fci, "BAMLH0A0HYM2").rename("hy_oas_pp")
    metric_6 = _frame(nfci, sloos, ig, hy)

    def _keep_where(df: pd.DataFrame, headline: str) -> pd.DataFrame:
        if df.empty or headline not in df.columns:
            return df.dropna(how="all")
        return df.loc[df[headline].notna()].copy()

    metrics = {
        "01_funds_equals_fiscal_rate": metric_1.dropna(how="all"),
        "02_interest_share_of_receipts": _keep_where(
            metric_2, "interest_pct_of_current_receipts"
        ),
        "03_primary_deficit_not_in_hole": _keep_where(
            metric_3, "primary_deficit_pct_gdp"
        ),
        "04_duration_demand_term_premium": metric_4.dropna(how="all"),
        "05_r_minus_g": _keep_where(metric_5, "r_minus_g_pp"),
        "06_financial_conditions": metric_6.dropna(how="all"),
    }

    if save:
        save_metrics(metrics, metrics_path)
    return metrics


def save_metrics(
        metrics: dict[str, pd.DataFrame],
        path: Path | str = DEFAULT_METRICS,
) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "names": list(metrics.keys()),
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "frames": {name: _frame_to_split(df) for name, df in metrics.items()},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


save_metrics_pickle = save_metrics


def load_metrics(path: Path | str = DEFAULT_METRICS) -> dict[str, pd.DataFrame]:
    path = Path(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "frames" in payload:
        frames = payload["frames"]
        if isinstance(frames, dict):
            return {k: _frame_from_split(v) for k, v in frames.items()}
        names = payload.get("names") or []
        return {names[i]: _frame_from_split(frames[i]) for i in range(len(frames))}
    return payload


def update_metrics(
        raw_path: Path | str = DEFAULT_RAW,
        metrics_path: Path | str = DEFAULT_METRICS,
        verbose: bool = True,
) -> dict[str, pd.DataFrame]:
    """
    Recompute all six metrics from the current raw JSON and write
    calculated_metrics.json. Derived series: full rebuild, not append.
    """
    if verbose:
        print(f"recomputing metrics from {raw_path}")
    metrics = calculate_metrics(raw_path=raw_path, metrics_path=metrics_path, save=True)
    if verbose:
        print(summarize_metrics(metrics).to_string(index=False))
        p = Path(metrics_path)
        print(f"saved {p} ({p.stat().st_size / 1e6:.2f} MB)")
    return metrics


def summarize_metrics(metrics: dict[str, pd.DataFrame]) -> pd.DataFrame:
    rows = []
    for name, df in metrics.items():
        rows.append(
            {
                "metric": name,
                "rows": int(len(df)),
                "cols": int(df.shape[1]) if df is not None else 0,
                "start": df.index.min() if len(df) else pd.NaT,
                "end": df.index.max() if len(df) else pd.NaT,
                "columns": ", ".join(map(str, df.columns)),
            }
        )
    return pd.DataFrame(rows)


def summarize(frames: list[pd.DataFrame]) -> pd.DataFrame:
    rows = []
    for name, df in zip(FRAME_NAMES, frames):
        rows.append(
            {
                "frame": name,
                "rows": int(len(df)),
                "cols": int(df.shape[1]) if df is not None else 0,
                "start": df.index.min() if len(df) else pd.NaT,
                "end": df.index.max() if len(df) else pd.NaT,
                "columns": ", ".join(map(str, df.columns[:8]))
                           + ("..." if df.shape[1] > 8 else ""),
            }
        )
    return pd.DataFrame(rows)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--update", action="store_true")
    p.add_argument("--metrics", action="store_true", help="recompute calculated_metrics.json")
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--raw", default=str(DEFAULT_RAW))
    p.add_argument("--metrics-json", default=str(DEFAULT_METRICS))
    args = p.parse_args()
    if args.metrics:
        update_metrics(args.raw, args.metrics_json)
        return
    path = Path(args.raw)
    if args.update:
        frames = update_raw(path)
    else:
        frames = build_all(start=args.start)
        save_frames(frames, path)
    print()
    print(summarize(frames).to_string(index=False))
    print(f"\nsaved {path} ({path.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()