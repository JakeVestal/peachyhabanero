#!/usr/bin/env python3
"""Failure-mode fiscal cube -> 3D Plotly dashboard.

Cube axes are wires 1–3 (funds−stock, interest/receipts, primary deficit).
Magenta = all three on. Axes are the three fiscal wires only.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.io import to_html
from cube_data import (
    DEFAULT_METRICS_PICKLE,
    DEFAULT_PICKLE,
    FRAME_NAMES,
    load_frames,
    load_metrics,
    calculate_metrics,
    build_all,
    save_pickle,
)
from macro_drivers import JACOBIAN_CSV, HERE as DRIVERS_HERE, fit_jacobian, load_or_update_drivers, project_forces

HERE = Path(__file__).resolve().parent
DEFAULT_THRESH = HERE / "cube_critical_values.csv"
DEFAULT_HTML = HERE / "cube_trajectory.html"
PLANE_COLORS = ["#5eead4", "#fb7185", "#a78bfa", "#fbbf24", "#38bdf8", "#f472b6"]
NEON = ["#00f0ff", "#ff2bd6", "#39ff14", "#ffbf00", "#7aa2ff", "#ff6b4a"]


def load_thresholds(path=DEFAULT_THRESH):
    df = pd.read_csv(path)
    df["metric_id"] = pd.to_numeric(df["metric_id"], errors="coerce").astype(int)
    df["critical_value"] = pd.to_numeric(df["critical_value"], errors="coerce")
    return df.sort_values("metric_id")


def extract_headlines(metrics, thresh):
    cols = {}
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        series = pd.to_numeric(metrics[row["metric_key"]][row["headline_column"]], errors="coerce")
        series.index = pd.to_datetime(series.index)
        cols[f"x{mid}"] = series.resample("ME").last().ffill(limit=2)
    return pd.concat(cols, axis=1).sort_index().dropna(how="any")


def quarterly_complete(metrics, thresh):
    """Last print inside each calendar quarter, no carry across quarters. Drop incomplete quarters."""
    cols = {}
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        series = pd.to_numeric(metrics[row["metric_key"]][row["headline_column"]], errors="coerce").dropna()
        series.index = pd.to_datetime(series.index)
        cols[f"x{mid}"] = series.resample("QE").last()
    return pd.concat(cols, axis=1).sort_index().dropna(how="any")


def standardize(aligned, thresh, sigma_from=None):
    y = pd.DataFrame(index=aligned.index)
    s_bits = pd.DataFrame(index=aligned.index)
    ref = sigma_from if sigma_from is not None else aligned
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        x = aligned[f"x{mid}"]
        c = float(row["critical_value"])
        sigma = float(pd.to_numeric(ref[f"x{mid}"], errors="coerce").std(ddof=1))
        if not np.isfinite(sigma) or sigma == 0:
            sigma = 1.0
        # One sign convention for the whole site. at_or_below (F1 only):
        # flip so y>0 means the unthinkable side (funds at or under the book).
        raw = (x - c) / sigma
        if str(row["direction_unthinkable"]).lower() == "at_or_below":
            raw = -raw
        y[f"y{mid}"] = raw
        s_bits[f"s{mid}"] = (raw > 0).astype(int)
    return y, s_bits


def reduce_and_regime(y, s_bits):
    """
    Failure-mode embedding: axes are the three fiscal wires.
    F1 = y1 funds−stock, F2 = y2 interest/receipts, F3 = y3 primary deficit.
    Magenta iff s1=s2=s3=1. Amplifiers s4,s5,s6 color/size only.
    """
    out = pd.DataFrame(index=y.index)
    out["F1"] = y["y1"]
    out["F2"] = y["y2"]
    out["F3"] = y["y3"]
    out["n_fiscal"] = (s_bits["s1"] + s_bits["s2"] + s_bits["s3"]).astype(int)
    out["n_amp"] = (s_bits["s4"] + s_bits["s5"] + s_bits["s6"]).astype(int)
    out["fail"] = ((s_bits["s1"] == 1) & (s_bits["s2"] == 1) & (s_bits["s3"] == 1)).astype(int)
    out["R"] = (
            s_bits["s1"] * 1
            + s_bits["s2"] * 2
            + s_bits["s3"] * 4
            + s_bits["s4"] * 8
            + s_bits["s5"] * 16
            + s_bits["s6"] * 32
    ).astype(int)
    for i in range(1, 7):
        out[f"y{i}"] = y[f"y{i}"]
        out[f"s{i}"] = s_bits[f"s{i}"]
    return out


def _plane_zconst(axis, value, bounds, color, name, n=18):
    z1 = np.linspace(bounds["Z1"][0], bounds["Z1"][1], n)
    z2 = np.linspace(bounds["Z2"][0], bounds["Z2"][1], n)
    z3 = np.linspace(bounds["Z3"][0], bounds["Z3"][1], n)
    if axis == "Z1":
        yy, zz = np.meshgrid(z2, z3)
        xx = np.full_like(yy, value)
        return go.Surface(x=xx, y=yy, z=zz, showscale=False, opacity=0.18, colorscale=[[0, color], [1, color]], name=name, hoverinfo="name")
    if axis == "Z2":
        xx, zz = np.meshgrid(z1, z3)
        yy = np.full_like(xx, value)
        return go.Surface(x=xx, y=yy, z=zz, showscale=False, opacity=0.18, colorscale=[[0, color], [1, color]], name=name, hoverinfo="name")
    xx, yy = np.meshgrid(z1, z2)
    zz = np.full_like(xx, value)
    return go.Surface(x=xx, y=yy, z=zz, showscale=False, opacity=0.18, colorscale=[[0, color], [1, color]], name=name, hoverinfo="name")


def _corner_box(x0, x1, y0, y1, z0, z1, color="#ff2bd6", name="failure mode"):
    """Wireframe of the positive octant. No faces, so interior points stay hoverable."""
    corners = {
        0: (x0, y0, z0), 1: (x1, y0, z0), 2: (x1, y1, z0), 3: (x0, y1, z0),
        4: (x0, y0, z1), 5: (x1, y0, z1), 6: (x1, y1, z1), 7: (x0, y1, z1),
    }
    edges = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
    xs, ys, zs = [], [], []
    for a, b in edges:
        xa, ya, za = corners[a]
        xb, yb, zb = corners[b]
        xs += [xa, xb, None]
        ys += [ya, yb, None]
        zs += [za, zb, None]
    return go.Scatter3d(
        x=xs, y=ys, z=zs,
        mode="lines",
        line=dict(color=color, width=4),
        name=name,
        hoverinfo="skip",
        showlegend=True,
    )


def _critical_arrows(cuts, hi, scale=1.15):
    mid = 0.5 * (cuts["Z2"] + hi)
    midz = 0.5 * (cuts["Z3"] + hi)
    midx = 0.5 * (cuts["Z1"] + hi)
    L = 0.55 * scale
    return go.Cone(
        x=[cuts["Z1"], midx, midx], y=[mid, cuts["Z2"], mid], z=[midz, midz, cuts["Z3"]],
        u=[L, 0, 0], v=[0, L, 0], w=[0, 0, L],
        sizemode="absolute", sizeref=0.55, anchor="tail",
        colorscale=[[0, "#39ff14"], [1, "#39ff14"]],
        showscale=False, name="critical direction (+W)", hoverinfo="name",
    )


def build_figure(state, y):
    state = state.sort_index()
    pad = 0.08
    bounds = {}
    for ax in ("F1", "F2", "F3"):
        lo_i, hi_i = float(state[ax].min()), float(state[ax].max())
        span = hi_i - lo_i if hi_i > lo_i else 1.0
        bounds[ax] = (lo_i - pad * span, hi_i + pad * span)
    lo = min(b[0] for b in bounds.values())
    hi = max(b[1] for b in bounds.values())
    traces = []
    traces.append(_corner_box(0.0, hi, 0.0, hi, 0.0, hi, color="#ff2bd6", name="failure mode (1∧2∧3)"))
    bitmasks = state.apply(lambda r: "".join(str(int(r[f"s{i}"])) for i in range(1, 7)), axis=1)
    hover = [
        (
            f"{idx.date()}<br>"
            f"F1={r.F1:.2f}  F2={r.F2:.2f}  F3={r.F3:.2f}<br>"
            f"fiscal wires on: {int(r.n_fiscal)} / 3"
            f"{'  FAIL' if int(r.fail) else ''}<br>"
            f"amplifiers on: {int(r.n_amp)} / 3<br>"
            f"1 funds−stock {r.x1:.3f}<br>"
            f"2 int/receipts {r.x2:.3f}<br>"
            f"3 primary/GDP {r.x3:.3f}<br>"
            f"4 ACM TP {r.x4:.3f}<br>"
            f"5 r−g {r.x5:.3f}<br>"
            f"6 NFCI {r.x6:.3f}<br>"
            f"s={mask}"
        )
        for idx, r, mask in zip(state.index, state.itertuples(), bitmasks)
    ]
    sizes = (4 + 2 * state["n_amp"]).tolist()
    traces.append(go.Scatter3d(
        x=state["F1"], y=state["F2"], z=state["F3"],
        mode="lines+markers",
        marker=dict(
            size=sizes,
            color=state["n_amp"],
            colorscale=[[0, "#39ff14"], [0.5, "#ffbf00"], [1, "#ff2bd6"]],
            cmin=0, cmax=3,
            colorbar=dict(title="amplifiers on", x=1.02, tickvals=[0, 1, 2, 3]),
        ),
        line=dict(width=3, color="rgba(0,240,255,0.28)"),
        text=hover, hoverinfo="text", name="trajectory",
    ))
    failed = state[state["fail"] == 1]
    if len(failed):
        fail_hover = [
            (
                f"<b>FAIL  {idx.date()}</b><br>"
                f"F1={r.F1:.2f}  F2={r.F2:.2f}  F3={r.F3:.2f}<br>"
                f"fiscal wires on: {int(r.n_fiscal)} / 3<br>"
                f"amplifiers on: {int(r.n_amp)} / 3<br>"
                f"1 funds−stock {r.x1:.3f}<br>"
                f"2 int/receipts {r.x2:.3f}<br>"
                f"3 primary/GDP {r.x3:.3f}<br>"
                f"4 ACM TP {r.x4:.3f}<br>"
                f"5 r−g {r.x5:.3f}<br>"
                f"6 NFCI {r.x6:.3f}"
            )
            for idx, r in failed.iterrows()
        ]
        traces.append(go.Scatter3d(
            x=failed["F1"], y=failed["F2"], z=failed["F3"], mode="markers",
            marker=dict(size=9, color="#ff2bd6", symbol="diamond",
                        line=dict(width=1, color="#39ff14")),
            text=fail_hover, hoverinfo="text",
            name=f"failure mode ({len(failed)})",
        ))
    last = state.iloc[-1]
    traces.append(go.Scatter3d(
        x=[last["F1"]], y=[last["F2"]], z=[last["F3"]], mode="markers",
        marker=dict(size=9, color="#00f0ff", symbol="diamond"),
        name=f"latest {state.index[-1].date()}", hoverinfo="skip",
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
            text="Failure mode = funds≈stock ∧ interest/receipts ∧ primary deficit. Three fiscal wires.",
            font=dict(color="#00f0ff", size=15),
        ),
        paper_bgcolor="#07080c", plot_bgcolor="#07080c",
        font=dict(color="#c8d6e5", family="IBM Plex Mono, ui-monospace, monospace"),
        scene=dict(
            xaxis=dict(title="F1  y(funds − stock)", range=[lo, hi], **axis_style),
            yaxis=dict(title="F2  y(interest / receipts)", range=[lo, hi], **axis_style),
            zaxis=dict(title="F3  y(primary deficit / GDP)", range=[lo, hi], **axis_style),
            aspectmode="cube", bgcolor="#07080c",
        ),
        legend=dict(font=dict(size=10, color="#9fb3c8"), bgcolor="rgba(7,8,12,0.6)"),
        margin=dict(l=0, r=0, t=56, b=0),
        height=780,
    )
    return fig


def _pca_3(X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    Xc = X - X.mean(axis=0)
    u, s, vt = np.linalg.svd(Xc, full_matrices=False)
    scores = u[:, :3] * s[:3]
    comps = vt[:3]
    ev = (s ** 2) / max(len(X) - 1, 1)
    ratios = ev[:3] / ev.sum()
    return scores, comps, ratios


def _pca_hover(df, x_df, n_breach, kind):
    features = list(df.columns)
    vals = x_df.reindex(df.index) if x_df is not None else None
    hover = []
    for i, (idx, row) in enumerate(df.iterrows()):
        if kind == "raw":
            hit = [f for f, v in row.items() if v < 0]
            rule = "c−x < 0"
        else:
            hit = [f for f, v in row.items() if v > 0]
            rule = "y > 0"
        status = "SAFE" if not hit else ("WARNING" if len(hit) == 1 else "CRITICAL BREACH")
        src = vals.loc[idx] if vals is not None else row
        label = "metrics" if vals is not None else kind
        lines = "<br>".join(f"• {k}: {src[k]:.4f}" for k in features)
        hover.append(
            f"<b>{idx.date()}</b>  [{kind}]<br>"
            f"Status: <b>{status}</b> ({int(n_breach[i])} of 6 with {rule})<br>"
            f"Hit: <i>{', '.join(hit) if hit else 'none'}</i><br><br>"
            f"<b>{label}</b><br>{lines}"
        )
    return hover


def _pca_bundle(df, x_df, kind):
    X = df.to_numpy(dtype=float)
    scores, comps, ratios = _pca_3(X)
    if kind == "raw":
        n_breach = (X < 0).sum(axis=1)
    else:
        n_breach = (X > 0).sum(axis=1)
    colors = [
        "#39ff14" if n == 0 else ("#ffbf00" if n == 1 else "#ff2bd6")
        for n in n_breach
    ]
    hover = _pca_hover(df, x_df, n_breach, kind)
    return scores, comps, ratios, colors, hover


def _arrow_trace(scores, index, force3, color, name, visible):
    xs, ys, zs, hover = [], [], [], []
    for i, idx in enumerate(index):
        if idx not in force3.index:
            continue
        dx, dy, dz = force3.loc[idx, ["dx", "dy", "dz"]]
        if not np.isfinite([dx, dy, dz]).all():
            continue
        xs += [scores[i, 0], scores[i, 0] + dx, None]
        ys += [scores[i, 1], scores[i, 1] + dy, None]
        zs += [scores[i, 2], scores[i, 2] + dz, None]
        hover += [
            f"{idx.date()} {name}<br>ΔPC=({dx:.2f},{dy:.2f},{dz:.2f})",
            f"{idx.date()} {name} tip",
            None,
        ]
    return go.Scatter3d(
        x=xs, y=ys, z=zs, mode="lines",
        line=dict(color=color, width=4),
        text=hover, hoverinfo="text",
        name=name, visible=visible, showlegend=True,
    )


def build_pca_figure(
        gap_df: pd.DataFrame,
        x_df: pd.DataFrame | None = None,
        y_df: pd.DataFrame | None = None,
        drivers: pd.DataFrame | None = None,
) -> go.Figure:
    raw = gap_df.copy().sort_index()
    features = list(raw.columns)
    raw_s, raw_c, raw_r, raw_col, raw_h = _pca_bundle(raw, x_df, "raw")
    scaled = None
    if y_df is not None:
        scaled = y_df.reindex(raw.index)[features].copy()
        sc_s, sc_c, sc_r, sc_col, sc_h = _pca_bundle(scaled, x_df, "σ-scaled")

    fig = go.Figure()
    fig.add_trace(go.Scatter3d(
        x=raw_s[:, 0], y=raw_s[:, 1], z=raw_s[:, 2],
        mode="lines+markers",
        line=dict(color="rgba(0,240,255,0.45)", width=5),
        marker=dict(size=5, color=raw_col, line=dict(color="#07080c", width=0.5)),
        text=raw_h, hoverinfo="text",
        customdata=raw.index.strftime("%Y-%m-%d"),
        name="trajectory (raw c−x)",
        visible=True,
    ))
    if scaled is not None:
        fig.add_trace(go.Scatter3d(
            x=sc_s[:, 0], y=sc_s[:, 1], z=sc_s[:, 2],
            mode="lines+markers",
            line=dict(color="rgba(0,240,255,0.45)", width=5),
            marker=dict(size=5, color=sc_col, line=dict(color="#07080c", width=0.5)),
            text=sc_h, hoverinfo="text",
            customdata=scaled.index.strftime("%Y-%m-%d"),
            name="trajectory (σ-scaled y)",
            visible=False,
        ))
    fig.add_trace(go.Scatter3d(
        x=[0], y=[0], z=[0],
        mode="markers+text",
        marker=dict(size=9, color="#e8f6ff", symbol="diamond"),
        text=["6D origin"],
        textposition="top center",
        textfont=dict(color="#e8f6ff", size=11),
        name="origin",
        visible=True,
    ))

    def _rays(comps, scores, visible):
        scale = float(np.max(np.abs(scores))) * 0.75
        traces = []
        for i, name in enumerate(features):
            vec = comps[:, i] * scale
            traces.append(go.Scatter3d(
                x=[0, vec[0]], y=[0, vec[1]], z=[0, vec[2]],
                mode="lines+text",
                line=dict(color=PLANE_COLORS[i % len(PLANE_COLORS)], width=4),
                text=["", name],
                textposition="top center",
                textfont=dict(color="#e8f6ff", size=10),
                name=name, showlegend=False, visible=visible,
            ))
        return traces

    for t in _rays(raw_c, raw_s, True):
        fig.add_trace(t)
    if scaled is not None:
        for t in _rays(sc_c, sc_s, False):
            fig.add_trace(t)

    fig.add_trace(go.Scatter3d(
        x=[raw_s[-1, 0]], y=[raw_s[-1, 1]], z=[raw_s[-1, 2]],
        mode="markers",
        marker=dict(size=8, color="#00f0ff", symbol="diamond"),
        name=f"latest {raw.index[-1].date()} raw",
        hoverinfo="skip", visible=True,
    ))
    if scaled is not None:
        fig.add_trace(go.Scatter3d(
            x=[sc_s[-1, 0]], y=[sc_s[-1, 1]], z=[sc_s[-1, 2]],
            mode="markers",
            marker=dict(size=8, color="#00f0ff", symbol="diamond"),
            name=f"latest {raw.index[-1].date()} σ",
            hoverinfo="skip", visible=False,
        ))

    def _forces_for(matrix, scores, comps, visible_pi, visible_u):
        traces = []
        if drivers is None:
            return traces
        tag = "raw" if matrix is raw else "sigma"
        coef, fitted = fit_jacobian(matrix, drivers, features, path=DRIVERS_HERE / f"macro_jacobian_{tag}.csv")
        # arrow length = one quarter of fitted move; x2 so they read on the plot
        pi3, u3 = project_forces(fitted, features, comps, scale=2.0)
        traces.append(_arrow_trace(scores, matrix.index, pi3, "#00f0ff", "force: Δ core PCE", visible_pi))
        traces.append(_arrow_trace(scores, matrix.index, u3, "#ffbf00", "force: Δ unemployment", visible_u))
        return traces

    for t in _forces_for(raw, raw_s, raw_c, False, False):
        fig.add_trace(t)
    if scaled is not None:
        for t in _forces_for(scaled, sc_s, sc_c, False, False):
            fig.add_trace(t)

    # arrows default off
    raw_off = [True, False, True] + [True] * 6 + [False] * 6 + [True, False] + [False, False] + [False, False]
    raw_on = [True, False, True] + [True] * 6 + [False] * 6 + [True, False] + [True, True] + [False, False]
    sc_off = [False, True, True] + [False] * 6 + [True] * 6 + [False, True] + [False, False] + [False, False]
    sc_on = [False, True, True] + [False] * 6 + [True] * 6 + [False, True] + [False, False] + [True, True]
    raw_vis = raw_off
    sc_vis = sc_off
    if scaled is None:
        raw_vis = [True] * len(fig.data)
        sc_vis = raw_vis

    axis_style = dict(
        backgroundcolor="#0b0f16",
        gridcolor="rgba(0,240,255,0.12)",
        zerolinecolor="rgba(255,43,214,0.35)",
        color="#c8d6e5",
    )
    fig.update_layout(
        title=dict(
            text="PCA. Cyan arrows = fitted Δ from core PCE. Gold arrows = fitted Δ from unemployment.",
            font=dict(color="#00f0ff", size=15),
        ),
        paper_bgcolor="#07080c", plot_bgcolor="#07080c",
        font=dict(color="#c8d6e5", family="IBM Plex Mono, ui-monospace, monospace"),
        scene=dict(
            xaxis=dict(title=f"PC1 raw ({raw_r[0]*100:.1f}%)", **axis_style),
            yaxis=dict(title=f"PC2 raw ({raw_r[1]*100:.1f}%)", **axis_style),
            zaxis=dict(title=f"PC3 raw ({raw_r[2]*100:.1f}%)", **axis_style),
            aspectmode="cube", bgcolor="#07080c",
        ),
        legend=dict(font=dict(size=10, color="#9fb3c8"), bgcolor="rgba(7,8,12,0.6)"),
        margin=dict(l=0, r=0, t=56, b=16),
        height=800,
        uirevision="cube-pca",
        meta=dict(
            raw_off=raw_off, raw_on=raw_on, sc_off=sc_off, sc_on=sc_on,
            raw_titles=[f"PC1 raw ({raw_r[0]*100:.1f}%)", f"PC2 raw ({raw_r[1]*100:.1f}%)", f"PC3 raw ({raw_r[2]*100:.1f}%)"],
            sc_titles=[
                f"PC1 σ ({sc_r[0]*100:.1f}%)" if scaled is not None else "PC1",
                f"PC2 σ ({sc_r[1]*100:.1f}%)" if scaled is not None else "PC2",
                f"PC3 σ ({sc_r[2]*100:.1f}%)" if scaled is not None else "PC3",
            ],
        ),
    )
    return fig


def build_l2_figure(gap_df: pd.DataFrame, y_df: pd.DataFrame | None = None) -> go.Figure:
    g = gap_df.copy().sort_index()
    dist = np.sqrt((g.astype(float) ** 2).sum(axis=1))
    n_raw = (g.astype(float) < 0).sum(axis=1)
    colors_raw = ["#39ff14" if n == 0 else ("#ffbf00" if n == 1 else "#ff2bd6") for n in n_raw]
    hover_raw = [
        f"{idx.date()} [raw]<br>‖c−x‖₂ = {d:.3f}<br>{int(n)} of 6 with c−x < 0"
        for idx, d, n in zip(dist.index, dist.values, n_raw)
    ]
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dist.index, y=dist.values, mode="lines+markers",
        line=dict(color="#00f0ff", width=2),
        marker=dict(size=6, color=colors_raw, line=dict(color="#07080c", width=0.5)),
        text=hover_raw, hoverinfo="text",
        customdata=dist.index.strftime("%Y-%m-%d"),
        name="‖c−x‖₂ raw", visible=True,
    ))
    if y_df is not None:
        y = y_df.reindex(g.index)
        dist_s = np.sqrt((y.astype(float) ** 2).sum(axis=1))
        n_s = (y.astype(float) > 0).sum(axis=1)
        colors_s = ["#39ff14" if n == 0 else ("#ffbf00" if n == 1 else "#ff2bd6") for n in n_s]
        hover_s = [
            f"{idx.date()} [σ]<br>‖y‖₂ = {d:.3f}<br>{int(n)} of 6 with y > 0"
            for idx, d, n in zip(dist_s.index, dist_s.values, n_s)
        ]
        fig.add_trace(go.Scatter(
            x=dist_s.index, y=dist_s.values, mode="lines+markers",
            line=dict(color="#ff2bd6", width=2),
            marker=dict(size=6, color=colors_s, line=dict(color="#07080c", width=0.5)),
            text=hover_s, hoverinfo="text",
            customdata=dist_s.index.strftime("%Y-%m-%d"),
            name="‖y‖₂ σ-scaled", visible=False,
        ))
    fig.add_hline(y=0, line=dict(color="rgba(255,43,214,0.25)", width=1, dash="dot"))
    fig = _dark_layout(fig, "Distance from origin. Toolbar σ-scale swaps raw ‖c−x‖₂ for ‖y‖₂.", height=360)
    fig.update_layout(showlegend=True, legend=dict(font=dict(size=10, color="#9fb3c8"), bgcolor="rgba(7,8,12,0.6)"))
    return fig


def _dark_layout(fig, title, height=280):
    fig.update_layout(
        title=dict(text=title, font=dict(size=14, color="#00f0ff")),
        paper_bgcolor="#07080c", plot_bgcolor="#0b0f16",
        font=dict(color="#c8d6e5", family="IBM Plex Mono, ui-monospace, monospace", size=11),
        margin=dict(l=40, r=16, t=44, b=36), height=height,
        xaxis=dict(gridcolor="rgba(0,240,255,0.08)", zerolinecolor="rgba(255,43,214,0.25)"),
        yaxis=dict(gridcolor="rgba(0,240,255,0.08)", zerolinecolor="rgba(255,43,214,0.25)"),
        showlegend=False,
    )
    return fig


def build_series_figure(series, c, title, color):
    s = series.dropna()
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=s.index, y=s.values, mode="lines", line=dict(color=color, width=2), name=s.name or title))
    fig.add_hline(y=c, line=dict(color="#ff2bd6", width=1, dash="dot"))
    return _dark_layout(fig, title)


def trim_observed(df, asof=None):
    if df is None or df.empty:
        return df
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    out = out.dropna(how="all")
    cutoff = pd.Timestamp(asof) if asof is not None else pd.Timestamp.now().normalize()
    last_hit = out.dropna(how="all").index.max()
    if pd.notna(last_hit):
        cutoff = min(cutoff, pd.Timestamp(last_hit))
    return out.loc[out.index <= cutoff].sort_index()


def merge_metric_frames(metrics):
    parts = []
    for name, df in metrics.items():
        piece = df.copy()
        piece.columns = [f"{name}__{c}" for c in piece.columns]
        parts.append(piece)
    return pd.concat(parts, axis=1).sort_index()


def merge_raw_frames(frames, monthly=True):
    parts = []
    for name, df in zip(FRAME_NAMES, frames):
        piece = df.copy()
        piece.index = pd.to_datetime(piece.index)
        if monthly:
            piece = piece.select_dtypes(include="number").resample("ME").last()
        piece.columns = [f"{name}__{c}" for c in piece.columns]
        parts.append(piece)
    return pd.concat(parts, axis=1).sort_index()


def _fmt_cell(v):
    if pd.isna(v):
        return ""
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        av = abs(float(v))
        if av >= 1e6:
            return f"{v:,.0f}"
        if av >= 100:
            return f"{v:,.2f}"
        return f"{v:.4g}"
    return str(v)


def df_to_scroll_table(df, table_id):
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    out = out.sort_index(ascending=False)
    header = "<tr>" + "".join(f"<th>{c}</th>" for c in ["date", *out.columns]) + "</tr>"
    rows = []
    for idx, row in out.iterrows():
        cells = [idx.strftime("%Y-%m-%d")] + [_fmt_cell(v) for v in row]
        rows.append("<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
    body = "\n".join(rows)
    return f"""
    <div class="table-wrap">
      <div class="table-bar">
        <span class="table-meta">{len(out)} rows x {out.shape[1]} cols</span>
        <button class="neon-btn" type="button" onclick="downloadTable('{table_id}','{table_id}.csv')">download csv</button>
      </div>
      <div class="table-scroll">
        <table id="{table_id}">
          <thead>{header}</thead>
          <tbody>
{body}
          </tbody>
        </table>
      </div>
    </div>
    """


def fig_div(fig, div_id=None, include_plotlyjs="cdn"):
    return to_html(fig, include_plotlyjs=include_plotlyjs, full_html=False, div_id=div_id)


def build_page(fig_pca, fig_l2, series_figs, z_df, gap_df, x_df, calc_df, raw_df, l2_raw=None, l2_sigma=None):
    dates = [d.strftime("%Y-%m-%d") for d in z_df.sort_index().index]
    dates_js = json.dumps(dates)
    l2_raw_js = json.dumps(list(l2_raw) if l2_raw is not None else [])
    l2_sigma_js = json.dumps(list(l2_sigma) if l2_sigma is not None else [])
    date_min = dates[0] if dates else "1990-01-01"
    date_max = dates[-1] if dates else "2026-12-31"
    pca_html = fig_div(fig_pca, div_id="pca-plot")
    l2_html = fig_div(fig_l2, div_id="l2-plot", include_plotlyjs=False)
    series_html = "\n".join(f'<div class="series-card">{fig_div(f)}</div>' for f in series_figs)
    z_table = df_to_scroll_table(z_df, "quarterly_z")
    gap_table = df_to_scroll_table(gap_df, "quarterly_gap")
    x_table = df_to_scroll_table(x_df, "quarterly_x")
    calc_table = df_to_scroll_table(calc_df, "calc_metrics")
    raw_table = df_to_scroll_table(raw_df, "raw_data")
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Fiscal constraint dashboard</title>
<style>
:root {{ --bg:#07080c; --panel:#0d1117; --ink:#d5e4f0; --muted:#7f93a6; --cyan:#00f0ff; --mag:#ff2bd6; --lime:#39ff14; --line:rgba(0,240,255,0.18); }}
* {{ box-sizing:border-box; }}
html,body {{ margin:0; padding:0; background:radial-gradient(1200px 600px at 10% -10%, #122033 0%, var(--bg) 55%); color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",sans-serif; }}
header {{ padding:28px 28px 8px; border-bottom:1px solid var(--line); }}
h1 {{ margin:0 0 6px; font-family:"IBM Plex Mono",ui-monospace,monospace; font-weight:600; letter-spacing:0.04em; color:var(--cyan); text-shadow:0 0 18px rgba(0,240,255,0.25); }}
.sub {{ color:var(--muted); font-size:14px; max-width:980px; line-height:1.45; }}
section {{ padding:18px 28px 8px; }}
h2 {{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:15px; color:var(--mag); letter-spacing:0.08em; text-transform:uppercase; margin:12px 0 10px; }}
.grid-2 {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
@media (max-width:980px) {{ .grid-2 {{ grid-template-columns:1fr; }} }}
.series-card,.table-wrap {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
.plot-shell {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:visible; }}
.table-bar {{ display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--line); font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; color:var(--muted); }}
.neon-btn {{ background:transparent; color:var(--cyan); border:1px solid var(--cyan); border-radius:999px; padding:5px 12px; cursor:pointer; font-family:inherit; }}
.neon-btn:hover {{ background:rgba(0,240,255,0.12); }}
.neon-btn.active {{ background:rgba(0,240,255,0.18); }}
.toolbar {{ display:flex; flex-wrap:wrap; gap:16px; align-items:center; padding:12px 14px; margin:0 0 10px; background:var(--panel); border:1px solid var(--line); border-radius:10px; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; color:var(--muted); }}
.toolbar label {{ display:flex; align-items:center; gap:8px; }}
.toolbar input[type=range] {{ width:180px; accent-color:#00f0ff; }}
.toolbar .val {{ color:var(--cyan); min-width:5.5em; }}
.table-scroll {{ max-height:420px; overflow:auto; }}
table {{ border-collapse:collapse; width:max-content; min-width:100%; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; }}
th,td {{ padding:5px 8px; border-bottom:1px solid rgba(0,240,255,0.08); border-right:1px solid rgba(0,240,255,0.06); white-space:nowrap; text-align:right; }}
th {{ position:sticky; top:0; background:#101826; color:var(--cyan); text-align:left; z-index:1; }}
td:first-child,th:first-child {{ text-align:left; color:var(--lime); }}
footer {{ padding:24px 28px 40px; color:var(--muted); font-size:12px; }}
</style></head>
<body>
<header>
<h1>FISCAL CONSTRAINT STATE</h1>
<p class="sub">Diagnostic page: PCA and L2 of the six-vector, headline series, raw tables. The failure-mode cube lives in <b style="color:#00f0ff">failure_cube.html</b>.</p>
</header>
<section>
<div class="toolbar" id="cube-toolbar">
  <span>σ-scale</span>
  <button class="neon-btn active" type="button" id="btn-sigma-off">off</button>
  <button class="neon-btn" type="button" id="btn-sigma-on">on</button>
  <span>driver arrows</span>
  <button class="neon-btn active" type="button" id="btn-arrows-off">off</button>
  <button class="neon-btn" type="button" id="btn-arrows-on">on</button>
  <label>from <input id="date-from" type="range" min="0" max="{len(dates)-1}" value="0"/><span class="val" id="date-from-lab">{date_min}</span></label>
  <label>to <input id="date-to" type="range" min="0" max="{len(dates)-1}" value="{len(dates)-1}"/><span class="val" id="date-to-lab">{date_max}</span></label>
  <button class="neon-btn" type="button" id="btn-date-reset">full range</button>
</div>
<h2>01  /  PCA of distance from critical (all 6)</h2>
<p class="sub">Toolbar controls both plots. σ-scale uses cube y units. Arrows default off. Date sliders hide points outside the window.</p>
<div class="plot-shell">{pca_html}</div></section>
<section><h2>01c  /  6D Euclidean distance from origin</h2><div class="plot-shell">{l2_html}</div></section>
<section><h2>02  /  headline series vs threshold</h2><div class="grid-2">{series_html}</div></section>
<section><h2>03  /  quarterly complete cases (plotted F)</h2>{z_table}</section>
<section><h2>04  /  distance from critical (c − x)</h2>{gap_table}</section>
<section><h2>05  /  quarterly complete cases (six metrics)</h2>{x_table}</section>
<section><h2>06  /  calculated metrics</h2>{calc_table}</section>
<section><h2>07  /  raw inputs (month-end last)</h2>{raw_table}</section>
<footer>Generated from calculated_metrics.pkl and cube_raw_frames.pkl.</footer>
<script>
const CUBE_DATES = {dates_js};
const L2_RAW = {l2_raw_js};
const L2_SIGMA = {l2_sigma_js};
let sigmaOn = false;
let arrowsOn = false;
function arr(v) {{
  if (!v) return [];
  return Array.from(v);
}}
function cacheTrace(t) {{
  const colors = t.marker && t.marker.color;
  return {{
    x: arr(t.x), y: arr(t.y), z: t.z ? arr(t.z) : null,
    text: t.text ? arr(t.text) : null,
    name: t.name || "",
    color: (colors && typeof colors !== "string") ? arr(colors) : null
  }};
}}
function visList() {{
  const pca = document.getElementById("pca-plot");
  const meta = (pca && pca.layout && pca.layout.meta) || {{}};
  if (sigmaOn) return arrowsOn ? meta.sc_on : meta.sc_off;
  return arrowsOn ? meta.raw_on : meta.raw_off;
}}
function applyVis(gd, vis) {{
  if (!gd || !vis || !vis.length) return;
  vis.forEach((v, i) => {{ if (i < gd.data.length) Plotly.restyle(gd, {{visible: v}}, [i]); }});
}}
function applySlice(gd, full, i0, i1) {{
  const a = CUBE_DATES[i0], b = CUBE_DATES[i1];
  full.forEach((t, idx) => {{
    if (t.name && String(t.name).startsWith("force:")) {{
      const xs=[], ys=[], zs=[], text=[];
      for (let i=0;i<t.x.length;i+=3) {{
        const lab = t.text ? String(t.text[i]||"") : "";
        const m = lab.match(/(\\d{{4}}-\\d{{2}}-\\d{{2}})/);
        if (!m || m[1] < a || m[1] > b) continue;
        xs.push(t.x[i], t.x[i+1], null);
        ys.push(t.y[i], t.y[i+1], null);
        if (t.z) zs.push(t.z[i], t.z[i+1], null);
        if (t.text) text.push(t.text[i], t.text[i+1], null);
      }}
      const payload = {{x:[xs], y:[ys]}};
      if (t.z) payload.z = [zs];
      if (t.text) payload.text = [text];
      Plotly.restyle(gd, payload, [idx]);
      return;
    }}
    if (!t.x.length || t.x.length !== CUBE_DATES.length) return;
    const sl = {{
      x: [t.x.slice(i0, i1+1)],
      y: [t.y.slice(i0, i1+1)]
    }};
    if (t.z) sl.z = [t.z.slice(i0, i1+1)];
    if (t.text) sl.text = [t.text.slice(i0, i1+1)];
    if (t.color) sl["marker.color"] = [t.color.slice(i0, i1+1)];
    Plotly.restyle(gd, sl, [idx]);
  }});
}}
function applyCubeControls() {{
  const pca = document.getElementById("pca-plot");
  const l2 = document.getElementById("l2-plot");
  const i0 = Math.min(+document.getElementById("date-from").value, +document.getElementById("date-to").value);
  const i1 = Math.max(+document.getElementById("date-from").value, +document.getElementById("date-to").value);
  document.getElementById("date-from-lab").textContent = CUBE_DATES[i0];
  document.getElementById("date-to-lab").textContent = CUBE_DATES[i1];
  if (pca && window.Plotly) {{
    if (!pca._full) pca._full = pca.data.map(cacheTrace);
    applyVis(pca, visList());
    const meta = pca.layout.meta || {{}};
    const titles = sigmaOn ? meta.sc_titles : meta.raw_titles;
    if (titles) Plotly.relayout(pca, {{
      "scene.xaxis.title.text": titles[0],
      "scene.yaxis.title.text": titles[1],
      "scene.zaxis.title.text": titles[2]
    }});
    applySlice(pca, pca._full, i0, i1);
  }}
  if (l2 && window.Plotly && L2_RAW.length) {{
    const src = (sigmaOn && L2_SIGMA.length) ? L2_SIGMA : L2_RAW;
    Plotly.restyle(l2, {{
      x: [CUBE_DATES.slice(i0, i1+1)],
      y: [src.slice(i0, i1+1)]
    }}, [0]);
    if (l2.data.length > 1) Plotly.restyle(l2, {{visible: false}}, [1]);
    Plotly.relayout(l2, {{
      "yaxis.autorange": true,
      "xaxis.autorange": true,
      "title.text": sigmaOn ? "‖y‖₂   σ-scaled distance from the 6D origin" : "‖c−x‖₂   raw distance from the 6D origin"
    }});
  }}
}}
function setActive(onId, offId, on) {{
  document.getElementById(onId).classList.toggle("active", on);
  document.getElementById(offId).classList.toggle("active", !on);
}}
window.addEventListener("load", () => {{
  const pca = document.getElementById("pca-plot");
  const l2 = document.getElementById("l2-plot");
  if (pca) pca._full = pca.data.map(cacheTrace);
  if (l2) l2._full = l2.data.map(cacheTrace);
  document.getElementById("btn-sigma-off").onclick = () => {{ sigmaOn=false; setActive("btn-sigma-on","btn-sigma-off", false); applyCubeControls(); }};
  document.getElementById("btn-sigma-on").onclick = () => {{ sigmaOn=true; setActive("btn-sigma-on","btn-sigma-off", true); applyCubeControls(); }};
  document.getElementById("btn-arrows-off").onclick = () => {{ arrowsOn=false; setActive("btn-arrows-on","btn-arrows-off", false); applyCubeControls(); }};
  document.getElementById("btn-arrows-on").onclick = () => {{ arrowsOn=true; setActive("btn-arrows-on","btn-arrows-off", true); applyCubeControls(); }};
  document.getElementById("date-from").oninput = applyCubeControls;
  document.getElementById("date-to").oninput = applyCubeControls;
  document.getElementById("btn-date-reset").onclick = () => {{
    document.getElementById("date-from").value = 0;
    document.getElementById("date-to").value = CUBE_DATES.length-1;
    applyCubeControls();
  }};
}});
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


def get_metrics():
    metrics_path = Path(DEFAULT_METRICS_PICKLE)
    raw_path = Path(DEFAULT_PICKLE)
    if metrics_path.exists():
        return load_metrics(metrics_path)
    if not raw_path.exists():
        print(f"{raw_path} missing — fetching raw frames")
        save_pickle(build_all(), raw_path)
    print(f"{metrics_path} missing — computing metrics")
    return calculate_metrics(raw_path=raw_path, metrics_path=metrics_path, save=True)


def run(html_path=DEFAULT_HTML):
    metrics = get_metrics()
    thresh = load_thresholds()
    aligned = quarterly_complete(metrics, thresh).sort_index()
    y, s_bits = standardize(aligned, thresh)
    state = reduce_and_regime(y, s_bits).sort_index()
    for c in aligned.columns:
        state[c] = aligned[c]
    z_df = state[["F1", "F2", "F3", "n_fiscal", "n_amp", "fail"]].copy()
    z_df.index.name = "quarter_end"
    colmap = {
        "x1": "funds_minus_stock",
        "x2": "interest_pct_receipts",
        "x3": "primary_deficit_pct_gdp",
        "x4": "acm_10y_term_premium",
        "x5": "r_minus_g",
        "x6": "NFCI",
    }
    crit = {f"x{int(r.metric_id)}": float(r.critical_value) for _, r in thresh.iterrows()}
    gap_df = pd.DataFrame({colmap[c]: crit[c] - aligned[c] for c in aligned.columns}, index=aligned.index)
    gap_df.index.name = "quarter_end"
    x_df = aligned.rename(columns=colmap).copy()
    x_df.index.name = "quarter_end"
    titles = {
        1: "1  funds - stock coupon",
        2: "2  interest / current receipts",
        3: "3  primary deficit / GDP",
        4: "4  ACM 10y term premium",
        5: "5  r - g",
        6: "6  NFCI",
    }
    series_figs = []
    for _, row in thresh.iterrows():
        mid = int(row["metric_id"])
        series = pd.to_numeric(metrics[row["metric_key"]][row["headline_column"]], errors="coerce")
        series.index = pd.to_datetime(series.index)
        series.name = row["headline_column"]
        series_figs.append(build_series_figure(series, float(row["critical_value"]), titles[mid], NEON[(mid - 1) % len(NEON)]))
    calc_df = trim_observed(merge_metric_frames(metrics))
    raw_df = trim_observed(merge_raw_frames(load_frames(DEFAULT_PICKLE), monthly=True))
    calc_df.to_csv(HERE / "calculated_metrics_merged.csv")
    raw_df.to_csv(HERE / "raw_inputs_monthly.csv")
    y_named = pd.DataFrame(
        {colmap[f"x{i}"]: y[f"y{i}"] for i in range(1, 7)},
        index=aligned.index,
    )
    drivers = load_or_update_drivers()
    fig_pca = build_pca_figure(gap_df, x_df, y_named, drivers=drivers)
    fig_l2 = build_l2_figure(gap_df, y_named)
    l2_raw = np.sqrt((gap_df.astype(float) ** 2).sum(axis=1)).reindex(aligned.index).astype(float).tolist()
    l2_sigma = np.sqrt((y_named.astype(float) ** 2).sum(axis=1)).reindex(aligned.index).astype(float).tolist()
    Path(html_path).write_text(
        build_page(fig_pca, fig_l2, series_figs, z_df, gap_df, x_df, calc_df, raw_df, l2_raw, l2_sigma),
        encoding="utf-8",
    )
    return state


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--html", default=str(DEFAULT_HTML))
    args = p.parse_args()
    state = run(Path(args.html))
    print(f"quarters aligned: {len(state)}")
    print(f"date range: {state.index.min().date()} -> {state.index.max().date()}")
    last = state.iloc[-1]
    print(
        f"latest F=({last['F1']:.2f}, {last['F2']:.2f}, {last['F3']:.2f})  "
        f"fiscal={int(last['n_fiscal'])}/3  amp={int(last['n_amp'])}/3  fail={int(last['fail'])}"
    )
    print("latest s:", "".join(str(int(state[f"s{i}"].iloc[-1])) for i in range(1, 7)))
    print("failure-mode quarters (1∧2∧3):", int(state["fail"].sum()))
    print("all-six quarters (R=63):", int((state.R == 63).sum()))
    print(f"wrote {args.html}")


if __name__ == "__main__":
    main()