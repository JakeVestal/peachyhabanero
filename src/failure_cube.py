#!/usr/bin/env python3
"""
Failure-mode cube — standalone story page.

The question this figure is allowed to answer:
    If inflation printed hot tomorrow, would a hike be unthinkable
    because of the fiscal arithmetic?

Axes are the three fiscal wires only.
    F1  y(funds − stock)         hike *is* the fiscal rate when F1 > 0
    F2  y(interest / receipts)   coupon step is a program when F2 > 0
    F3  y(primary deficit / GDP) no surplus to absorb it when F3 > 0

Magenta wireframe = F1>0 and F2>0 and F3>0.
Color / size = how many amplifiers (term premium, r−g, NFCI) are on.
Those do not define the failure. They grade how ugly the skip would be.

Tune the story in CONFIG. Rebuild:
    python failure_cube.py
"""
from __future__ import annotations

import argparse
import io
import ssl
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.io import to_html

from cube_visualize import (
    DEFAULT_THRESH,
    HERE,
    NEON,
    build_series_figure,
    df_to_scroll_table,
    get_metrics,
    load_thresholds,
    quarterly_complete,
    standardize,
)

# ---------------------------------------------------------------------------
# Story config — edit here, not in the dashboard script.
# ---------------------------------------------------------------------------
CONFIG = {
    "html": HERE / "failure_cube.html",
    "rate_csv": HERE / "rate_adjust.csv",
    "fiscal_ids": (1, 2, 3),
    "amp_ids": (4, 5, 6),
    "highlight_fail": True,
    "mark_latest": True,
    "wireframe_color": "#ff2bd6",
    "title": "FAILURE MODE",
}

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"

COLMAP = {
    "x1": "funds_minus_stock",
    "x2": "interest_pct_receipts",
    "x3": "primary_deficit_pct_gdp",
    "x4": "acm_10y_term_premium",
    "x5": "r_minus_g",
    "x6": "NFCI",
}

AXIS_LABEL = {
    1: "F1  y(funds − stock)",
    2: "F2  y(interest / receipts)",
    3: "F3  y(primary deficit / GDP)",
}

SERIES_TITLE = {
    1: "1  funds − stock coupon",
    2: "2  interest / current receipts",
    3: "3  primary deficit / GDP",
    4: "4  ACM 10y term premium  (amplifier)",
    5: "5  r − g  (amplifier)",
    6: "6  NFCI  (amplifier)",
}


def _http_get(url: str) -> str:
    """Fetch text. requests first; urllib+certifi next; unverified last (macOS python.org)."""
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


def fetch_target_daily() -> pd.Series:
    """Point target through 2008-12-15, then upper bound of the range."""
    point = _fred_series("DFEDTAR")
    upper = _fred_series("DFEDTARU")
    daily = pd.concat([point, upper.loc[upper.index > point.index.max()]])
    daily.name = "target"
    return daily.sort_index()


def quarterly_rate_adjust(daily: pd.Series) -> pd.DataFrame:
    q_end = daily.resample("QE").last()
    out = pd.DataFrame({"rate_adjust": q_end.diff()})
    out.index.name = "quarter_end"
    out["target_end"] = q_end
    return out.dropna(subset=["rate_adjust"])


def load_or_update_rate_adjust(path=None) -> pd.DataFrame:
    """Create rate_adjust.csv if missing; append any newer FRED prints if it exists."""
    path = Path(path or CONFIG["rate_csv"])
    fresh = quarterly_rate_adjust(fetch_target_daily())
    if path.exists():
        old = pd.read_csv(path, parse_dates=["quarter_end"]).set_index("quarter_end")
        combined = pd.concat([old, fresh])
        combined = combined[~combined.index.duplicated(keep="last")].sort_index()
        if len(combined) != len(old) or not combined.equals(old.reindex(combined.index)):
            combined.to_csv(path)
            print(f"updated {path}  {combined.index.min().date()} -> {combined.index.max().date()}")
        else:
            print(f"{path} already current")
        return combined
    fresh.to_csv(path)
    print(f"created {path}  {fresh.index.min().date()} -> {fresh.index.max().date()}")
    return fresh


def embed(y: pd.DataFrame, s_bits: pd.DataFrame, fiscal_ids, amp_ids) -> pd.DataFrame:
    out = pd.DataFrame(index=y.index)
    fids = list(fiscal_ids)
    out["F1"] = y[f"y{fids[0]}"]
    out["F2"] = y[f"y{fids[1]}"]
    out["F3"] = y[f"y{fids[2]}"]
    out["n_fiscal"] = sum(s_bits[f"s{i}"] for i in fids).astype(int)
    if amp_ids:
        out["n_amp"] = sum(s_bits[f"s{i}"] for i in amp_ids).astype(int)
    fail = s_bits[f"s{fids[0]}"] == 1
    for i in fids[1:]:
        fail = fail & (s_bits[f"s{i}"] == 1)
    out["fail"] = fail.astype(int)
    for col in list(y.columns) + list(s_bits.columns):
        if col.startswith("y") or col.startswith("s"):
            src = y if col.startswith("y") else s_bits
            if col in src.columns:
                out[col] = src[col]
    return out


def _wireframe(x0, x1, y0, y1, z0, z1, color, name):
    corners = {
        0: (x0, y0, z0), 1: (x1, y0, z0), 2: (x1, y1, z0), 3: (x0, y1, z0),
        4: (x0, y0, z1), 5: (x1, y0, z1), 6: (x1, y1, z1), 7: (x0, y1, z1),
    }
    edges = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
             (0, 4), (1, 5), (2, 6), (3, 7)]
    xs, ys, zs = [], [], []
    for a, b in edges:
        xa, ya, za = corners[a]
        xb, yb, zb = corners[b]
        xs += [xa, xb, None]
        ys += [ya, yb, None]
        zs += [za, zb, None]
    return go.Scatter3d(
        x=xs, y=ys, z=zs, mode="lines",
        line=dict(color=color, width=4),
        name=name, hoverinfo="skip", showlegend=True,
    )


def _hover_row(idx, r, fail_tag=False):
    tag = "<b>FAIL</b> " if fail_tag or int(r.fail) else ""
    return (
        f"{tag}{idx.date()}<br>"
        f"F1={r.F1:.2f}  F2={r.F2:.2f}  F3={r.F3:.2f}<br>"
        f"fiscal {int(r.n_fiscal)}/3   amplifiers {int(r.n_amp)}/3<br>"
        f"1 funds−stock {r.x1:.3f}<br>"
        f"2 int/receipts {r.x2:.3f}<br>"
        f"3 primary/GDP {r.x3:.3f}<br>"
        f"4 ACM TP {r.x4:.3f}<br>"
        f"5 r−g {r.x5:.3f}<br>"
        f"6 NFCI {r.x6:.3f}<br>"
        f"rate_adjust {getattr(r, 'rate_adjust', float('nan')):+.2f}"
    )


def build_cube(state: pd.DataFrame) -> go.Figure:
    state = state.sort_index()
    pad = 0.08
    lo_hi = []
    for ax in ("F1", "F2", "F3"):
        lo_i, hi_i = float(state[ax].min()), float(state[ax].max())
        span = hi_i - lo_i if hi_i > lo_i else 1.0
        lo_hi.append((lo_i - pad * span, hi_i + pad * span))
    lo = min(p[0] for p in lo_hi)
    hi = max(p[1] for p in lo_hi)

    traces = [
        _wireframe(0.0, hi, 0.0, hi, 0.0, hi,
                   CONFIG["wireframe_color"], "failure octant (1∧2∧3)")
    ]
    hover = [_hover_row(idx, r) for idx, r in state.iterrows()]
    adj = state["rate_adjust"].fillna(0.0) if "rate_adjust" in state.columns else pd.Series(0.0, index=state.index)
    span = float(adj.abs().max()) or 1.0
    traces.append(go.Scatter3d(
        x=state["F1"], y=state["F2"], z=state["F3"],
        mode="lines+markers",
        marker=dict(
            size=(4 + 2 * state["n_amp"]).tolist(),
            color=state["n_amp"],
            colorscale=[[0, "#39ff14"], [0.5, "#ffbf00"], [1, "#ff2bd6"]],
            cmin=0, cmax=3,
            colorbar=dict(title="amplifiers on", x=1.02, tickvals=[0, 1, 2, 3]),
        ),
        line=dict(width=3, color="rgba(0,240,255,0.28)"),
        text=hover, hoverinfo="text", name="quarterly path",
    ))
    failed = state[state["fail"] == 1]
    if CONFIG["highlight_fail"] and len(failed):
        traces.append(go.Scatter3d(
            x=failed["F1"], y=failed["F2"], z=failed["F3"],
            mode="markers",
            marker=dict(size=9, color="#ff2bd6", symbol="diamond",
                        line=dict(width=1, color="#39ff14")),
            text=[_hover_row(idx, r, fail_tag=True) for idx, r in failed.iterrows()],
            hoverinfo="text",
            name=f"inside ({len(failed)} quarters)",
        ))
    if CONFIG["mark_latest"]:
        last = state.iloc[-1]
        traces.append(go.Scatter3d(
            x=[last["F1"]], y=[last["F2"]], z=[last["F3"]],
            mode="markers",
            marker=dict(size=10, color="#00f0ff", symbol="diamond"),
            text=[_hover_row(state.index[-1], last)],
            hoverinfo="text",
            name=f"latest {state.index[-1].date()}",
        ))

    axis_style = dict(
        backgroundcolor="#0b0f16",
        gridcolor="rgba(0,240,255,0.12)",
        zerolinecolor="rgba(255,43,214,0.35)",
        color="#c8d6e5",
    )
    fig = go.Figure(data=traces)
    fig.update_layout(
        title=dict(
            text="Magenta frame = hike unthinkable on fiscal arithmetic. Color is amplifiers only.",
            font=dict(color="#00f0ff", size=15),
        ),
        paper_bgcolor="#07080c", plot_bgcolor="#07080c",
        font=dict(color="#c8d6e5", family="IBM Plex Mono, ui-monospace, monospace"),
        scene=dict(
            xaxis=dict(title=AXIS_LABEL[CONFIG["fiscal_ids"][0]], range=[lo, hi], **axis_style),
            yaxis=dict(title=AXIS_LABEL[CONFIG["fiscal_ids"][1]], range=[lo, hi], **axis_style),
            zaxis=dict(title=AXIS_LABEL[CONFIG["fiscal_ids"][2]], range=[lo, hi], **axis_style),
            aspectmode="cube", bgcolor="#07080c",
        ),
        legend=dict(font=dict(size=10, color="#9fb3c8"), bgcolor="rgba(7,8,12,0.6)"),
        margin=dict(l=0, r=0, t=80, b=0),
        height=820,
        updatemenus=[
            dict(
                type="buttons",
                direction="right",
                x=0.0, xanchor="left", y=1.08, yanchor="top",
                bgcolor="#0d1117",
                bordercolor="rgba(0,240,255,0.35)",
                font=dict(color="#00f0ff", size=12),
                buttons=[
                    dict(
                        label="rate changes  off",
                        method="restyle",
                        args=[{
                            "marker.color": [state["n_amp"]],
                            "marker.colorscale": [[[0, "#39ff14"], [0.5, "#ffbf00"], [1, "#ff2bd6"]]],
                            "marker.cmin": 0,
                            "marker.cmax": 3,
                            "marker.colorbar.title.text": "amplifiers on",
                        }, [1]],
                    ),
                    dict(
                        label="rate changes  on",
                        method="restyle",
                        args=[{
                            "marker.color": [adj],
                            "marker.colorscale": [[[0, "#ff2b4a"], [0.5, "#ffbf00"], [1, "#39ff14"]]],
                            "marker.cmin": -span,
                            "marker.cmax": span,
                            "marker.colorbar.title.text": "rate_adjust %",
                        }, [1]],
                    ),
                ],
            )
        ],
    )
    return fig


def build_page(fig, series_figs, f_df, x_fiscal, rate_df):
    cube = to_html(fig, include_plotlyjs="cdn", full_html=False)
    series_html = "\n".join(
        f'<div class="series-card">{to_html(f, include_plotlyjs=False, full_html=False)}</div>'
        for f in series_figs
    )
    f_table = df_to_scroll_table(f_df, "failure_f")
    x_table = df_to_scroll_table(x_fiscal, "failure_x")
    rate_table = df_to_scroll_table(rate_df, "rate_adjust")
    n_fail = int(f_df["fail"].sum()) if "fail" in f_df.columns else 0
    last = f_df.sort_index().iloc[-1]
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Failure mode cube</title>
<style>
:root {{ --bg:#07080c; --panel:#0d1117; --ink:#d5e4f0; --muted:#7f93a6; --cyan:#00f0ff; --mag:#ff2bd6; --lime:#39ff14; --line:rgba(0,240,255,0.18); }}
* {{ box-sizing:border-box; }}
html,body {{ margin:0; padding:0; background:radial-gradient(1200px 600px at 10% -10%, #122033 0%, var(--bg) 55%); color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",sans-serif; }}
header {{ padding:28px 28px 12px; border-bottom:1px solid var(--line); }}
h1 {{ margin:0 0 8px; font-family:"IBM Plex Mono",ui-monospace,monospace; font-weight:600; letter-spacing:0.08em; color:var(--cyan); text-shadow:0 0 18px rgba(0,240,255,0.25); }}
.sub, .story {{ color:var(--muted); font-size:14px; max-width:820px; line-height:1.55; }}
.story {{ margin-top:10px; }}
.story b {{ color:var(--ink); }}
.stat {{ font-family:"IBM Plex Mono",ui-monospace,monospace; color:var(--cyan); }}
section {{ padding:18px 28px 8px; }}
h2 {{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:15px; color:var(--mag); letter-spacing:0.08em; text-transform:uppercase; margin:12px 0 10px; }}
.grid-2 {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
@media (max-width:980px) {{ .grid-2 {{ grid-template-columns:1fr; }} }}
.series-card,.plot-shell,.table-wrap {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
.table-bar {{ display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--line); font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; color:var(--muted); }}
.neon-btn {{ background:transparent; color:var(--cyan); border:1px solid var(--cyan); border-radius:999px; padding:5px 12px; cursor:pointer; font-family:inherit; }}
.neon-btn:hover {{ background:rgba(0,240,255,0.12); }}
.table-scroll {{ max-height:420px; overflow:auto; }}
table {{ border-collapse:collapse; width:max-content; min-width:100%; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; }}
th,td {{ padding:5px 8px; border-bottom:1px solid rgba(0,240,255,0.08); border-right:1px solid rgba(0,240,255,0.06); white-space:nowrap; text-align:right; }}
th {{ position:sticky; top:0; background:#101826; color:var(--cyan); text-align:left; z-index:1; }}
td:first-child,th:first-child {{ text-align:left; color:var(--lime); }}
footer {{ padding:24px 28px 40px; color:var(--muted); font-size:12px; }}
</style></head>
<body>
<header>
<h1>{CONFIG["title"]}</h1>
<p class="sub">One question: <b style="color:#e8f6ff">would a hike be unthinkable if inflation printed hot?</b> Not “how stretched is the six-vector.” That lives on the diagnostic page.</p>
<p class="story">
Magenta frame is the AND of three fiscal wires — funds has met the book, interest already eats a fifth of receipts, primary deficit is still open while the economy is not in a hole.
Amplifiers (term premium, r−g, NFCI) only color the dots.
{n_fail} quarter{"s" if n_fail != 1 else ""} sit inside.
Latest <span class="stat">{f_df.index.max().date()}</span>
&nbsp; F=({last["F1"]:.2f}, {last["F2"]:.2f}, {last["F3"]:.2f})
&nbsp; fiscal {int(last["n_fiscal"])}/3
&nbsp; amp {int(last["n_amp"])}/3
&nbsp; fail {int(last["fail"])}.
</p>
</header>
<section><h2>01  /  the cube</h2><div class="plot-shell">{cube}</div></section>
<section><h2>02  /  the three wires, raw</h2><div class="grid-2">{series_html}</div></section>
<section><h2>03  /  plotted F  (what you are looking at)</h2>{f_table}</section>
<section><h2>04  /  raw fiscal headlines, same quarters</h2>{x_table}</section>
<section><h2>05  /  FOMC target change by quarter (rate_adjust)</h2>{rate_table}</section>
<footer>failure_cube.py · DFEDTAR + DFEDTARU via FRED · toggle on the cube: rate changes off/on</footer>
<script>
function downloadTable(id, filename) {{
  const table = document.getElementById(id);
  let csv = [];
  for (const row of table.querySelectorAll("tr")) {{
    const cells = [...row.querySelectorAll("th,td")].map(td => '"' + td.innerText.replaceAll('"','""') + '"');
    csv.push(cells.join(","));
  }}
  const blob = new Blob([csv.join("\\n")], {{type: "text/csv"}});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}}
</script>
</body></html>
"""


def run(html_path=None):
    html_path = Path(html_path or CONFIG["html"])
    metrics = get_metrics()
    thresh = load_thresholds()
    aligned = quarterly_complete(metrics, thresh).sort_index()
    y, s_bits = standardize(aligned, thresh)
    state = embed(y, s_bits, CONFIG["fiscal_ids"], CONFIG["amp_ids"]).sort_index()
    for c in aligned.columns:
        state[c] = aligned[c]
    rates = load_or_update_rate_adjust()
    state = state.join(rates[["rate_adjust"]], how="left")
    state["rate_adjust"] = state["rate_adjust"].fillna(0.0)

    fig = build_cube(state)
    series_figs = []
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        if mid not in CONFIG["fiscal_ids"]:
            continue
        series = pd.to_numeric(metrics[row["metric_key"]][row["headline_column"]], errors="coerce")
        series.index = pd.to_datetime(series.index)
        series.name = row["headline_column"]
        series_figs.append(
            build_series_figure(series, float(row["critical_value"]), SERIES_TITLE[mid], NEON[(mid - 1) % 6])
        )

    f_df = state[["F1", "F2", "F3", "n_fiscal", "n_amp", "fail", "rate_adjust"]].copy()
    f_df.index.name = "quarter_end"
    x_fiscal = aligned.rename(columns=COLMAP)[
        ["funds_minus_stock", "interest_pct_receipts", "primary_deficit_pct_gdp"]
    ].copy()
    x_fiscal.index.name = "quarter_end"
    rate_df = rates.reindex(state.index)[["rate_adjust"]].copy()
    rate_df["rate_adjust"] = rate_df["rate_adjust"].fillna(0.0)
    rate_df.index.name = "quarter_end"

    html_path.write_text(build_page(fig, series_figs, f_df, x_fiscal, rate_df), encoding="utf-8")
    return state, html_path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--html", default=str(CONFIG["html"]))
    args = p.parse_args()
    state, path = run(args.html)
    last = state.iloc[-1]
    print(f"quarters: {len(state)}  {state.index.min().date()} -> {state.index.max().date()}")
    print(f"inside: {int(state['fail'].sum())}")
    print(
        f"latest {state.index[-1].date()}  "
        f"F=({last['F1']:.2f},{last['F2']:.2f},{last['F3']:.2f})  "
        f"fiscal={int(last['n_fiscal'])}/3 amp={int(last['n_amp'])}/3 fail={int(last['fail'])}"
    )
    print(f"wrote {path}")


if __name__ == "__main__":
    main()