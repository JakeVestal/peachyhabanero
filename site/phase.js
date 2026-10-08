/* Roll-rate identity, the printed gap, and a labeled debt-to-premium loop.
   The loop's boundary is a saddle. It is not a Hopf. */
(function () {
  const DATA = "data/published/cubes.json";
  const PLOT = {
    responsive: true,
    scrollZoom: false,
    displayModeBar: true,
    displaylogo: false,
  };
  const RECENT = 8;

  let ROWS = [];
  let BY = {};
  let clickBound = false;

  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function shiftYear(iso, dy) {
    const p = iso.split("-").map(Number);
    return (p[0] + dy) + "-" + pad(p[1]) + "-" + pad(p[2]);
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toFixed(digits);
  }

  function stamp(html) {
    const el = document.getElementById("stamp");
    if (el) el.innerHTML = html;
  }

  function fail(msg) {
    stamp('<span class="err">' + msg + "</span>");
  }

  function axis2d(extra) {
    return Object.assign({
      titlefont: { color: "#c4a35a", size: 12 },
      tickfont: { color: "#d5e4f0", size: 11 },
      gridcolor: "rgba(196,163,90,0.28)",
      zerolinecolor: "rgba(196,163,90,0.45)",
      linecolor: "rgba(196,163,90,0.7)",
      zeroline: true,
    }, extra || {});
  }

  function paint(el, data, layout) {
    const h = el.clientHeight || parseInt(getComputedStyle(el).height, 10) || 420;
    layout.height = h;
    if (el.classList.contains("js-plotly-plot")) {
      Plotly.react(el, data, layout, PLOT);
      return;
    }
    el.replaceChildren();
    Plotly.newPlot(el, data, layout, PLOT);
  }

  function legend() {
    return {
      orientation: "h",
      y: 1.02,
      x: 0,
      yanchor: "bottom",
      font: { color: "#d5e4f0", size: 11 },
      bgcolor: "rgba(0,0,0,0)",
    };
  }

  function slider(id) {
    return Number(document.getElementById(id).value);
  }

  function growth(row) {
    const prev = BY[shiftYear(row.date, -1)];
    if (!prev) return null;
    const now = num(row.gdp_bn);
    const then = num(prev.gdp_bn);
    if (now === null || then === null || then === 0) return null;
    return (now / then - 1) * 100;
  }

  function rate(row) {
    const coupon = num(row.stock_avg_coupon);
    const w = num(row.resid_w_0_1y);
    const marginal = num(row.marginal_rate);
    if (coupon === null || w === null || marginal === null) return null;
    return coupon + w * (marginal - coupon);
  }

  function carry(r, g) {
    return (1 + r / 100) / (1 + g / 100) - 1;
  }

  function parts(row) {
    const r = rate(row);
    const g = growth(row);
    const b = num(row.debt_gdp_pct);
    const d = num(row.primary_deficit_pct_gdp);
    const w = num(row.resid_w_0_1y);
    if (r === null || g === null || b === null || d === null || w === null) return null;
    const den = 1 + g / 100;
    const snowInterest = (r / 100) * b / den;
    const snowGrowth = -(g / 100) * b / den;
    const snowball = snowInterest + snowGrowth;
    return {
      r: r,
      g: g,
      b: b,
      d: d,
      w: w,
      coupon: num(row.stock_avg_coupon),
      marginal: num(row.marginal_rate),
      snowInterest: snowInterest,
      snowGrowth: snowGrowth,
      snowball: snowball,
      ident: snowball + d,
    };
  }

  function printed(row) {
    const b = num(row.debt_gdp_pct);
    const ahead = BY[shiftYear(row.date, 1)];
    if (b === null || !ahead) return null;
    const aheadB = num(ahead.debt_gdp_pct);
    if (aheadB === null) return null;
    return aheadB - b;
  }

  function distances(p) {
    const dStar = -p.snowball;
    const primaryCushion = dStar - p.d;
    const ratio = p.b === 0 ? null : p.d / p.b;
    let gStar = null;
    let rStar = null;
    let gapRoom = null;
    if (ratio !== null && ratio < 1) {
      gStar = ((1 + p.r / 100) / (1 - ratio) - 1) * 100;
      rStar = ((1 + p.g / 100) * (1 - ratio) - 1) * 100;
      if (p.w > 0) gapRoom = (rStar - p.r) / p.w;
    }
    return { dStar: dStar, primaryCushion: primaryCushion, gStar: gStar, rStar: rStar, gapRoom: gapRoom };
  }

  function median(xs) {
    const a = xs.filter(function (v) { return v !== null && isFinite(v); }).slice().sort(function (p, q) { return p - q; });
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function scoredGaps() {
    const out = [];
    ROWS.forEach(function (row) {
      const p = parts(row);
      const act = printed(row);
      if (!p || act === null) return;
      out.push({ date: row.date, gap: act - p.ident, ident: p.ident, printed: act });
    });
    return out;
  }

  function fieldOk(row) {
    return parts(row) !== null;
  }

  function selected() {
    return BY[document.getElementById("phase-quarter").value] || null;
  }

  function view() {
    const wide = document.getElementById("phase-wide").checked;
    const bs = [];
    const ds = [];
    ROWS.forEach(function (r) {
      const b = num(r.debt_gdp_pct);
      const d = num(r.primary_deficit_pct_gdp);
      if (b !== null) bs.push(b);
      if (d !== null) ds.push(d);
    });
    return {
      d0: wide ? Math.min.apply(null, ds) - 1 : -6,
      d1: wide ? Math.max.apply(null, ds) + 1 : 10,
      b0: Math.min.apply(null, bs) - 3,
      b1: Math.max.apply(null, bs) + 3,
    };
  }

  function nullcline(box, r, g) {
    const x = [];
    const y = [];
    const a = carry(r, g);
    for (let k = 0; k <= 60; k++) {
      const b = box.b0 + (box.b1 - box.b0) * k / 60;
      x.push(-a * b);
      y.push(b);
    }
    return {
      type: "scatter",
      mode: "lines",
      name: "identity flat",
      x: x,
      y: y,
      hovertemplate: "primary %{x:.2f}<br>debt/GDP %{y:.1f}<extra>identity Δb = 0</extra>",
      line: { color: "#c4a35a", width: 1.5, dash: "dot" },
    };
  }

  function pathTrace() {
    const x = [];
    const y = [];
    const cd = [];
    ROWS.forEach(function (row) {
      const d = num(row.primary_deficit_pct_gdp);
      const b = num(row.debt_gdp_pct);
      if (d === null || b === null) return;
      const p = parts(row);
      const act = printed(row);
      const gap = p && act !== null ? act - p.ident : null;
      x.push(d);
      y.push(b);
      cd.push([
        row.date,
        p ? fmt(p.r, 2) : "—",
        p ? fmt(p.coupon, 2) : "—",
        p ? fmt(p.w * 100, 1) : "—",
        p ? fmt(p.marginal, 2) : "—",
        p ? fmt(p.g, 2) : "—",
        p ? fmt(p.ident, 2) : "—",
        fmt(act, 2),
        fmt(gap, 2),
      ]);
    });
    return {
      type: "scatter",
      mode: "lines+markers",
      name: "NIPA",
      x: x,
      y: y,
      customdata: cd,
      hovertemplate:
        "%{customdata[0]}<br>" +
        "primary %{x:.2f}% of GDP<br>" +
        "debt/GDP %{y:.1f}<br>" +
        "r used %{customdata[1]}%<br>" +
        "coupon %{customdata[2]}%<br>" +
        "due inside a year %{customdata[3]}% of marketable<br>" +
        "marginal %{customdata[4]}%<br>" +
        "nominal growth %{customdata[5]}%<br>" +
        "identity next-year Δdebt/GDP %{customdata[6]}<br>" +
        "printed next-year Δdebt/GDP %{customdata[7]}<br>" +
        "gap (printed − identity) %{customdata[8]}" +
        "<extra>click to set the quarter</extra>",
      line: { color: "#00f0ff", width: 1.6 },
      marker: { color: "#00f0ff", size: 7 },
    };
  }

  function drawPath(row, p) {
    const el = document.getElementById("phase-plane");
    const box = view();
    const down = p.ident < 0;
    paint(el, [nullcline(box, p.r, p.g), pathTrace(), {
      type: "scatter",
      mode: "markers",
      name: "selected",
      x: [p.d],
      y: [p.b],
      hovertemplate: row.date + "<extra>selected</extra>",
      marker: { size: 14, color: "#c4a35a", line: { color: "#ff2bd6", width: 2 } },
    }], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 52, l: 58 },
      legend: legend(),
      xaxis: axis2d({ title: "primary deficit / GDP", range: [box.d0, box.d1] }),
      yaxis: axis2d({ title: "debt held by the public / GDP", range: [box.b0, box.b1] }),
      annotations: [{
        x: p.d,
        y: p.b,
        text: "identity " + fmt(p.ident, 2),
        showarrow: true,
        arrowhead: 3,
        ax: 70,
        ay: down ? 36 : -36,
        font: { color: down ? "#00f0ff" : "#ff2bd6", size: 12 },
        arrowcolor: down ? "#00f0ff" : "#ff2bd6",
        bgcolor: "#07080c",
      }],
    });
    if (!clickBound) {
      clickBound = true;
      el.on("plotly_click", function (ev) {
        const pt = ev.points && ev.points[0];
        if (!pt || pt.data.name !== "NIPA" || !pt.customdata) return;
        const iso = pt.customdata[0];
        if (!BY[iso] || !fieldOk(BY[iso])) return;
        document.getElementById("phase-quarter").value = iso;
        draw();
      });
    }
  }

  function drawScore(forecast) {
    const el = document.getElementById("phase-score");
    const date = [];
    const ident = [];
    const act = [];
    const gap = [];
    ROWS.forEach(function (row) {
      const p = parts(row);
      if (!p) return;
      const printedChange = printed(row);
      date.push(row.date);
      ident.push(p.ident);
      act.push(printedChange);
      gap.push(printedChange === null ? null : printedChange - p.ident);
    });
    const traces = [
      {
        type: "scatter", mode: "lines", name: "printed",
        x: date, y: act, connectgaps: false,
        hovertemplate: "%{x}<br>printed %{y:.2f}<extra></extra>",
        line: { color: "#00f0ff", width: 1.8 },
      },
      {
        type: "scatter", mode: "lines", name: "identity",
        x: date, y: ident,
        hovertemplate: "%{x}<br>identity %{y:.2f}<extra></extra>",
        line: { color: "#c4a35a", width: 1.8 },
      },
      {
        type: "scatter", mode: "lines", name: "gap",
        x: date, y: gap, connectgaps: false,
        hovertemplate: "%{x}<br>printed − identity %{y:.2f}<extra></extra>",
        line: { color: "#ff2bd6", width: 1.4 },
      },
    ];
    if (forecast) {
      traces.push({
        type: "scatter", mode: "markers", name: "identity + recent gap",
        x: [forecast.date], y: [forecast.value],
        hovertemplate: "%{x}<br>identity + median gap of the last " + RECENT + " scored quarters<br>%{y:.2f}<extra>not a fit</extra>",
        marker: { size: 14, color: "#c4a35a", symbol: "diamond", line: { color: "#ff2bd6", width: 2 } },
      });
    }
    paint(el, traces, {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 48, l: 52 },
      legend: legend(),
      xaxis: axis2d({ title: "", type: "date" }),
      yaxis: axis2d({ title: "change in debt/GDP, points, over the next year" }),
    });
  }

  function drawSplit() {
    const el = document.getElementById("phase-split");
    const date = [];
    const snow = [];
    const primary = [];
    const resid = [];
    ROWS.forEach(function (row) {
      const p = parts(row);
      if (!p) return;
      const act = printed(row);
      date.push(row.date);
      snow.push(p.snowball);
      primary.push(p.d);
      resid.push(act === null ? null : act - p.ident);
    });
    paint(el, [
      { type: "scatter", mode: "lines", name: "snowball", x: date, y: snow, hovertemplate: "%{x}<br>snowball %{y:.2f}<extra></extra>", line: { color: "#00f0ff", width: 1.6 } },
      { type: "scatter", mode: "lines", name: "primary", x: date, y: primary, hovertemplate: "%{x}<br>primary %{y:.2f}<extra></extra>", line: { color: "#c4a35a", width: 1.6 } },
      { type: "scatter", mode: "lines", name: "residual", x: date, y: resid, connectgaps: false, hovertemplate: "%{x}<br>printed − identity %{y:.2f}<extra></extra>", line: { color: "#ff2bd6", width: 1.4 } },
    ], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 48, l: 52 },
      legend: legend(),
      xaxis: axis2d({ title: "", type: "date" }),
      yaxis: axis2d({ title: "points of debt/GDP over the next year" }),
    });
  }

  function drawYields() {
    const el = document.getElementById("phase-yields");
    const date = [];
    const y10 = [];
    const tp = [];
    let anyTp = false;
    ROWS.forEach(function (row) {
      const y = num(row.y10);
      const t = num(row.THREEFYTP10);
      if (y === null && t === null) return;
      date.push(row.date);
      y10.push(y);
      tp.push(t);
      if (t !== null) anyTp = true;
    });
    const traces = [
      { type: "scatter", mode: "lines", name: "10-year", x: date, y: y10, connectgaps: false, hovertemplate: "%{x}<br>DGS10 %{y:.2f}%<extra></extra>", line: { color: "#00f0ff", width: 1.6 } },
    ];
    if (anyTp) {
      traces.push({ type: "scatter", mode: "lines", name: "10-year term premium", x: date, y: tp, connectgaps: false, hovertemplate: "%{x}<br>ACM THREEFYTP10 %{y:.2f}<extra></extra>", line: { color: "#c4a35a", width: 1.6 } });
    }
    paint(el, traces, {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 48, l: 52 },
      legend: legend(),
      xaxis: axis2d({ title: "", type: "date" }),
      yaxis: axis2d({ title: "percent" }),
    });
    const note = document.getElementById("yield-note");
    if (note) {
      note.textContent = anyTp
        ? ""
        : "The 10-year is on this file. The ACM term premium is not yet. It is fetched already; the next nightly writes THREEFYTP10 onto the cube row. This chart will pick it up. Nothing here is filled in.";
    }
  }

  function polesOf(alpha, beta, phi, psi, lambda) {
    const tr = alpha - lambda;
    const det = (-alpha * lambda) - (beta * psi * phi);
    const half = tr / 2;
    const disc = half * half - det;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { tr: tr, det: det, disc: disc, poles: [{ re: half + s, im: 0 }, { re: half - s, im: 0 }] };
    }
    const s = Math.sqrt(-disc);
    return { tr: tr, det: det, disc: disc, poles: [{ re: half, im: s }, { re: half, im: -s }] };
  }

  function drawBoundary(p) {
    const el = document.getElementById("phase-boundary");
    const phi = slider("phase-phi");
    const psi = slider("phase-psi");
    const lambda = slider("phase-lambda");
    const alpha = carry(p.r, p.g);
    const beta = p.b * p.w / (100 + p.g);
    const phiMax = 0.2;
    const psiMax = 1;
    function curve(lam) {
      const x = [];
      const y = [];
      if (!(alpha < 0) || !(beta > 0) || !(lam > 0)) return { x: x, y: y };
      for (let i = 1; i <= 80; i++) {
        const ph = phiMax * i / 80;
        const ps = (-alpha * lam) / (beta * ph);
        if (ps < 0 || ps > psiMax) continue;
        x.push(ph);
        y.push(ps);
      }
      return { x: x, y: y };
    }
    const ruler = curve(1);
    const live = curve(lambda);
    paint(el, [
      {
        type: "scatter", mode: "lines", name: "if the premium faded in one year",
        x: ruler.x, y: ruler.y,
        hovertemplate: "φ %{x:.3f}<br>ψ %{y:.2f}<extra>λ = 1, a ruler, not a claim</extra>",
        line: { color: "#c4a35a", width: 1.2, dash: "dot" },
      },
      {
        type: "scatter", mode: "lines", name: "boundary at this fade",
        x: live.x, y: live.y,
        hovertemplate: "φ %{x:.3f}<br>ψ %{y:.2f}<extra>above this curve, one pole is positive</extra>",
        line: { color: "#ff2bd6", width: 1.6 },
      },
      {
        type: "scatter", mode: "markers", name: "these speeds",
        x: [phi], y: [psi],
        hovertemplate: "φ %{x:.3f}<br>ψ %{y:.2f}<extra>sliders</extra>",
        marker: { size: 12, color: "#07080c", line: { color: "#00f0ff", width: 2 } },
      },
    ], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 52, l: 58 },
      legend: legend(),
      xaxis: axis2d({ title: "φ  premium points per year, per point of debt/GDP", range: [0, phiMax] }),
      yaxis: axis2d({ title: "ψ  points of the marginal rate, per point of premium", range: [0, psiMax] }),
    });

    const info = polesOf(alpha, beta, phi, psi, lambda);
    const poles = document.getElementById("phase-poles");
    let m = 0.2;
    info.poles.forEach(function (q) {
      m = Math.max(m, Math.abs(q.re) * 1.45, Math.abs(q.im) * 1.45);
    });
    paint(poles, [{
      type: "scatter", mode: "markers", name: "poles", showlegend: false,
      x: info.poles.map(function (q) { return q.re; }),
      y: info.poles.map(function (q) { return q.im; }),
      marker: {
        symbol: "x", size: 14,
        color: info.poles.map(function (q) {
          if (Math.abs(q.re) <= 1e-8) return "#c4a35a";
          return q.re > 0 ? "#ff2bd6" : "#00f0ff";
        }),
      },
      hovertemplate: "Re %{x:.4f}<br>Im %{y:.4f}<extra>model</extra>",
    }], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 16, r: 16, b: 48, l: 52 },
      showlegend: false,
      xaxis: axis2d({ title: "real part, per year", range: [-m, m], zeroline: false }),
      yaxis: axis2d({ title: "imaginary part, per year", range: [-m, m] }),
      shapes: [
        { type: "rect", xref: "x", yref: "y", x0: -m, x1: 0, y0: -m, y1: m, fillcolor: "rgba(0,240,255,0.05)", line: { width: 0 } },
        { type: "rect", xref: "x", yref: "y", x0: 0, x1: m, y0: -m, y1: m, fillcolor: "rgba(255,43,214,0.05)", line: { width: 0 } },
        { type: "line", xref: "x", yref: "y", x0: 0, x1: 0, y0: -m, y1: m, line: { color: "#c4a35a", width: 1, dash: "dot" } },
      ],
    });

    const product = phi * psi;
    const critical = (alpha < 0 && beta > 0 && lambda > 0) ? (-alpha * lambda / beta) : null;
    let sentence = "Model only. These poles are not the printed debt ratio. ";
    if (phi === 0 && psi === 0) {
      sentence += "Both speeds are off. The premium does not answer the debt. The debt pole is the snowball, " + fmt(alpha, 4) + " per year. ";
    } else if (lambda === 0 && product > 0) {
      sentence += "The premium does not fade. Any positive pair of speeds is a saddle: the premium ratchets, and one pole is positive. ";
    } else if (alpha >= 0 && product > 0) {
      sentence += "r is already above growth. Positive feedback cannot put both poles in the left half. The snowball itself is the push. ";
    } else if (critical !== null && product > critical + 1e-12) {
      sentence += "Above the curve. One pole is positive. The product φψ is " + fmt(product, 4) + "; the line at this fade is " + fmt(critical, 4) + ". ";
    } else if (critical !== null) {
      sentence += "Below the curve. Both poles are in the left half at these speeds. The product φψ is " + fmt(product, 4) + "; the line at this fade is " + fmt(critical, 4) + ". ";
    }
    if (Math.abs(info.poles[0].im) > 1e-8) {
      sentence += "The poles are complex. That happens when the premium fades and the feedback is weak or negative. It is not the runaway loop.";
    } else {
      sentence += "Poles " + fmt(info.poles[0].re, 4) + " and " + fmt(info.poles[1].re, 4) + ". Real, not a cycle.";
    }
    document.getElementById("phase-status").textContent = sentence;
  }

  function readout(row, p, dist, gaps, forecast) {
    const recent = gaps.slice(-RECENT);
    const med = median(recent.map(function (g) { return g.gap; }));
    const prev = BY[shiftYear(row.date, -1)];
    const prevParts = prev ? parts(prev) : null;
    const cushion = -p.ident;
    const prevCushion = prevParts ? -prevParts.ident : null;
    let drift = "no prior year to compare.";
    if (prevCushion !== null) {
      const delta = cushion - prevCushion;
      drift = (delta < -0.05 ? "The accounting cushion shrank " : delta > 0.05 ? "The accounting cushion widened " : "The accounting cushion is about unchanged, ")
        + fmt(Math.abs(delta), 2) + " points of GDP versus " + prev.date + ".";
    }
    const act = printed(row);
    const gap = act === null ? null : act - p.ident;
    const tp = num(row.THREEFYTP10);
    const y10 = num(row.y10);
    const spiral = p.ident > 0.05
      ? "Accounting spiral: yes. The identity says the debt ratio rises " + fmt(p.ident, 2) + " points of GDP over the next year."
      : p.ident < -0.05
        ? "Accounting spiral: no. The identity says the debt ratio falls " + fmt(Math.abs(p.ident), 2) + " points of GDP over the next year."
        : "Accounting spiral: on the line. The identity is about zero.";
    const lines = [
      row.date,
      "",
      spiral,
      "  snowball " + fmt(p.snowball, 2) + "   interest " + fmt(p.snowInterest, 2) + "   growth " + fmt(p.snowGrowth, 2),
      "  primary " + fmt(p.d, 2),
      "r " + fmt(p.r, 2) + "%    coupon " + fmt(p.coupon, 2) + "%    marginal " + fmt(p.marginal, 2) + "%    share due inside a year " + fmt(p.w * 100, 1) + "%",
      "nominal growth " + fmt(p.g, 2) + "%    " + (p.r < p.g ? "r is below g" : p.r > p.g ? "r is above g" : "r equals g"),
      "",
      "Distance to a flat identity, holding the other inputs:",
      "  primary is " + (dist.primaryCushion >= 0 ? fmt(dist.primaryCushion, 2) + " pp tighter than the line (the line is " + fmt(dist.dStar, 2) + "% of GDP)" : fmt(-dist.primaryCushion, 2) + " pp past the line (the line is " + fmt(dist.dStar, 2) + "% of GDP)"),
      "  nominal growth " + (dist.gStar === null ? "—" : "can " + (p.g >= dist.gStar ? "fall " + fmt(p.g - dist.gStar, 2) + " pp, to " + fmt(dist.gStar, 2) + "%" : "would need to rise " + fmt(dist.gStar - p.g, 2) + " pp, to " + fmt(dist.gStar, 2) + "%")),
      "  refi gap " + (dist.gapRoom === null ? "—" : "can " + (dist.gapRoom >= 0 ? "widen " + fmt(dist.gapRoom, 2) + " pp" : "would need to tighten " + fmt(-dist.gapRoom, 2) + " pp") + " before the line"),
      drift,
      "",
      "Printed change, this quarter to one year later: " + fmt(act, 2),
      "Gap, printed minus identity: " + fmt(gap, 2),
      forecast
        ? "Median gap, last " + recent.length + " scored quarters: " + fmt(med, 2)
        : "Median gap is a forecast for the latest quarter only. This quarter already has a print, or the sample has no scored gap.",
      forecast ? "Identity plus that median: " + fmt(forecast.value, 2) : "Identity plus the recent median: —",
      forecast ? "That last number is the identity plus the recent miss. It is not a fit." : "",
      "",
      "10-year " + fmt(y10, 2) + "%    term premium " + (tp === null ? "not on this file yet" : fmt(tp, 2)),
    ];
    document.getElementById("phase-read").textContent = lines.join("\n");
  }

  function draw() {
    const row = selected();
    if (!row || !fieldOk(row)) {
      document.getElementById("phase-plane").textContent = "This quarter has no coupon, one-year share, marginal rate, or four-quarter GDP growth.";
      return;
    }
    const p = parts(row);
    const dist = distances(p);
    const gaps = scoredGaps();
    const recent = gaps.slice(-RECENT);
    const med = median(recent.map(function (g) { return g.gap; }));
    const latest = ROWS.filter(fieldOk).slice(-1)[0];
    const forecast = med !== null && latest && row.date === latest.date
      ? { date: row.date, value: p.ident + med }
      : null;
    readout(row, p, dist, gaps, forecast);
    drawPath(row, p);
    drawScore(forecast);
    drawSplit();
    drawYields();
    drawBoundary(p);
  }

  function boot(payload) {
    if (!payload || !Array.isArray(payload.sustain) || !payload.sustain.length) {
      fail("cubes.json has no sustain rows — rerun the nightly.");
      return;
    }
    const sample = payload.sustain[0];
    const need = ["primary_deficit_pct_gdp", "debt_gdp_pct", "stock_avg_coupon", "resid_w_0_1y", "marginal_rate", "gdp_bn", "y10", "date"];
    const missing = need.filter(function (k) { return !(k in sample); });
    if (missing.length) {
      fail("cubes.json sustain row is missing " + missing.join(", ") + " — rerun --process.");
      return;
    }
    ROWS = payload.sustain.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    BY = {};
    ROWS.forEach(function (r) { BY[r.date] = r; });
    const usable = ROWS.filter(fieldOk);
    if (!usable.length) {
      fail("No quarter has a coupon, a one-year share, a marginal rate, and four-quarter GDP growth.");
      return;
    }
    const sel = document.getElementById("phase-quarter");
    usable.forEach(function (r) {
      const opt = document.createElement("option");
      opt.value = r.date;
      opt.textContent = r.date;
      sel.appendChild(opt);
    });
    sel.value = usable[usable.length - 1].date;
    stamp("cubes.json " + (payload.generated_at || "") + " · r = coupon + share due inside a year × refi gap · " + usable.length + " quarters");
    sel.addEventListener("change", draw);
    document.getElementById("phase-wide").addEventListener("change", draw);
    ["phase-phi", "phase-psi", "phase-lambda"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function () {
        const map = { "phase-phi": ["phi-val", 3], "phase-psi": ["psi-val", 2], "phase-lambda": ["lambda-val", 2] };
        document.getElementById(map[id][0]).textContent = slider(id).toFixed(map[id][1]);
        draw();
      });
    });
    draw();
  }

  fetch(DATA).then(function (res) {
    if (!res.ok) throw new Error(res.status + " " + DATA);
    return res.json();
  }).then(boot).catch(function (err) {
    fail(String(err && err.message ? err.message : err));
  });
})();
