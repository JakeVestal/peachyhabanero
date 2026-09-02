#!/usr/bin/env python3
"""Quarterly inflation / employment drivers for the PCA force overlay.

Sources (FRED CSV, no key)
--------------------------
PCEPILFE  core PCE price index -> year-over-year %
UNRATE    civilian unemployment rate, %
PAYEMS    nonfarm payrolls -> year-over-year %  (stored, not used in the 2-force map)

Storage
-------
macro_drivers.csv   quarter_end, core_pce_yoy, unrate, payroll_yoy
macro_jacobian.csv  written by fit_jacobian() when called

Protocol
--------
Create the csv if missing. Fetch FRED. Keep existing rows, replace any
quarter that now has a newer print, append new quarters.
"""
from __future__ import annotations

import io
import ssl
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DRIVERS_CSV = HERE / "macro_drivers.csv"
JACOBIAN_CSV = HERE / "macro_jacobian.csv"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"


def _http_get(url: str) -> str:
    try:
        import requests
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.text
        except requests.exceptions.SSLError:
            r = requests.get(url, timeout=30, verify=False)
            r.raise_for_status()
            print("warning: FRED fetch used requests verify=False")
            return r.text
    except Exception:
        pass
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = None
    if ctx is not None:
        try:
            with urllib.request.urlopen(url, context=ctx, timeout=30) as resp:
                return resp.read().decode()
        except Exception:
            pass
    print("warning: FRED fetch falling back to unverified SSL")
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(url, context=ctx, timeout=30) as resp:
        return resp.read().decode()


def _fred_series(sid: str) -> pd.Series:
    raw = _http_get(f"{FRED_CSV}?id={sid}")
    df = pd.read_csv(io.StringIO(raw))
    df.columns = ["date", sid]
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df[sid] = pd.to_numeric(df[sid], errors="coerce")
    return df.dropna().set_index("date")[sid].sort_index()


def drivers_from_raw(raw_path: Path | None = None) -> pd.DataFrame | None:
    """Prefer cached raw JSON so a FRED outage does not block the overlay."""
    path = raw_path or (HERE / "cube_raw_frames.json")
    if not path.exists():
        return None
    from cube_data import FRAME_NAMES, load_frames
    frames = load_frames(path)
    if not frames:
        return None
    by = dict(zip(FRAME_NAMES[: len(frames)], frames))
    if "fred_inflation" not in by or "fred_labor_output" not in by:
        return None
    pce = pd.to_numeric(by["fred_inflation"]["PCEPILFE"], errors="coerce").dropna().sort_index()
    unrate = pd.to_numeric(by["fred_labor_output"]["UNRATE"], errors="coerce").dropna().sort_index()
    out = pd.DataFrame({
        "core_pce_yoy": (pce.pct_change(12) * 100.0).resample("QE").last(),
        "unrate": unrate.resample("QE").last(),
    }).dropna(how="any")
    out.index.name = "quarter_end"
    return out


def fetch_quarterly_drivers() -> pd.DataFrame:
    from_cache = drivers_from_raw()
    if from_cache is not None and len(from_cache) > 20:
        print("drivers from cube_raw_frames.json")
        return from_cache
    pce = _fred_series("PCEPILFE")
    unrate = _fred_series("UNRATE")
    out = pd.DataFrame({
        "core_pce_yoy": (pce.pct_change(12) * 100.0).resample("QE").last(),
        "unrate": unrate.resample("QE").last(),
    }).dropna(how="any")
    out.index.name = "quarter_end"
    return out


def load_or_update_drivers(path: Path = DRIVERS_CSV) -> pd.DataFrame:
    fresh = fetch_quarterly_drivers()
    if path.exists():
        old = pd.read_csv(path, parse_dates=["quarter_end"]).set_index("quarter_end")
        combined = pd.concat([old, fresh])
        combined = combined[~combined.index.duplicated(keep="last")].sort_index()
        if len(combined) != len(old) or not np.allclose(
                combined.reindex(old.index).fillna(0), old.fillna(0), equal_nan=True
        ):
            combined.to_csv(path)
            print(f"updated {path}  {combined.index.min().date()} -> {combined.index.max().date()}")
        else:
            print(f"{path} already current")
        return combined
    fresh.to_csv(path)
    print(f"created {path}  {fresh.index.min().date()} -> {fresh.index.max().date()}")
    return fresh


def fit_jacobian(state_df: pd.DataFrame, drivers: pd.DataFrame, cols: list[str], path: Path = JACOBIAN_CSV):
    """OLS: Δstate_i = a + b_π Δπ + b_u Δu.

    state_df columns are the 6 coordinates used in that PCA (raw c−x or y).
    Returns (coef_df, fitted) where fitted has columns
        d_pi_<col>, d_u_<col>  — the fitted Δ of each coordinate this quarter.
    """
    aligned = state_df.join(drivers[["core_pce_yoy", "unrate"]], how="inner").sort_index()
    d_state = aligned[cols].diff()
    d_pi = aligned["core_pce_yoy"].diff()
    d_u = aligned["unrate"].diff()
    panel = pd.concat([d_state, d_pi.rename("d_pi"), d_u.rename("d_u")], axis=1).dropna()
    X = np.column_stack([np.ones(len(panel)), panel["d_pi"].to_numpy(), panel["d_u"].to_numpy()])
    rows = []
    fitted_pi = pd.DataFrame(index=panel.index)
    fitted_u = pd.DataFrame(index=panel.index)
    for col in cols:
        y = panel[col].to_numpy()
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        rows.append({
            "coordinate": col,
            "intercept": beta[0],
            "b_d_core_pce_yoy": beta[1],
            "b_d_unrate": beta[2],
            "n": len(panel),
        })
        fitted_pi[col] = beta[1] * panel["d_pi"].to_numpy()
        fitted_u[col] = beta[2] * panel["d_u"].to_numpy()
    coef = pd.DataFrame(rows)
    coef.to_csv(path, index=False)
    print(f"wrote {path}")
    fitted_pi.columns = [f"pi__{c}" for c in cols]
    fitted_u.columns = [f"u__{c}" for c in cols]
    return coef, fitted_pi.join(fitted_u)


def project_forces(fitted: pd.DataFrame, cols: list[str], comps: np.ndarray, scale: float = 1.0):
    """Map 6D fitted Δ through PCA loadings (comps is 3 x 6) -> 3D arrows."""
    pi = fitted[[f"pi__{c}" for c in cols]].to_numpy()
    u = fitted[[f"u__{c}" for c in cols]].to_numpy()
    pi3 = (pi @ comps.T) * scale
    u3 = (u @ comps.T) * scale
    return (
        pd.DataFrame(pi3, index=fitted.index, columns=["dx", "dy", "dz"]),
        pd.DataFrame(u3, index=fitted.index, columns=["dx", "dy", "dz"]),
    )


if __name__ == "__main__":
    df = load_or_update_drivers()
    print(df.tail())
    print(df.describe())