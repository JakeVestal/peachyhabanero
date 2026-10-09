/* Draft field. Two states: debt ratio d, accruing rate r.
   gamma and the primary are the selected quarter, held still.
   alpha, dCrit, and sigma are knobs. */
(function () {
  const DATA = "data/published/cubes.json";
  const PLOT = { responsive: true, scrollZoom: false, displayModeBar: true, displaylogo: false };

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

  function paint(el, data, layout) {
    const h = el.clientHeight || parseInt(getComputedStyle(el).height, 10) || 640;
    layout.height = h;
    if (el.classList.contains("js-plotly-plot")) {
      Plotly.react(el, data, layout, PLOT);
      return;
    }
    el.replaceChildren();
    Plotly.newPlot(el, data, layout, PLOT);
  }

  function slider(id) {
    return Number(document.getElementById(id).value);
  }

  function growth(row) {
    if (!row) return null;
    const prev = BY[shiftYear(row.date, -1)];
    const y0 = prev ? num(prev.gdp_bn) : null;
    const y1 = num(row.gdp_bn);
    if (y0 === null || y1 === null || y0 === 0) return null;
    return 100 * (y1 / y0 - 1);
  }

  function primary(row) {
    return row ? num(row.primary_deficit_pct_gdp) : null;
  }

  function knobs() {
    return {
      alpha: slider("phase-alpha"),
      dCrit: slider("phase-crit"),
      sigma: slider("phase-sigma"),
    };
  }

  function step(d, r, gamma, prim, k) {
    return {
      d: ((r - gamma) / 100) * d + prim,
      r: k.alpha * (d - k.dCrit) - k.sigma * r,
    };
  }

  function selected() {
    return BY[document.getElementById("phase-quarter").value] || null;
  }

  function pathPoints() {
    const out = [];
    ROWS.forEach(function (row) {
      const d = num(row.debt_gdp_pct);
      const r = num(row.stock_avg_coupon);
      if (d === null || r === null) return;
      out.push({ date: row.date, d: d, r: r });
    });
    return out;
  }

  function bounds(pts) {
    let d0 = 30;
    let d1 = 130;
    let r0 = 0;
    let r1 = 10;
    pts.forEach(function (pt) {
      d0 = Math.min(d0, pt.d);
      d1 = Math.max(d1, pt.d);
      r0 = Math.min(r0, pt.r);
      r1 = Math.max(r1, pt.r);
    });
    return {
      d0: Math.floor(d0 - 8),
      d1: Math.ceil(d1 + 12),
      r0: Math.min(0, Math.floor(r0 - 1)),
      r1: Math.ceil(r1 + 2),
    };
  }

  function debtNull(box, gamma, prim) {
    const x = [];
    const y = [];
    for (let i = 0; i <= 80; i++) {
      const d = box.d0 + (box.d1 - box.d0) * i / 80;
      if (Math.abs(d) < 1) continue;
      x.push(d);
      y.push(gamma - (100 * prim) / d);
    }
    return { x: x, y: y };
  }

  function rateNull(box, k) {
    if (k.sigma === 0 && k.alpha === 0) return { x: [], y: [] };
    if (k.sigma === 0) {
      return { x: [k.dCrit, k.dCrit], y: [box.r0, box.r1] };
    }
    const y0 = (k.alpha / k.sigma) * (box.d0 - k.dCrit);
    const y1 = (k.alpha / k.sigma) * (box.d1 - k.dCrit);
    return { x: [box.d0, box.d1], y: [y0, y1] };
  }

  function field(box, gamma, prim, k) {
    const cols = 14;
    const rows = 11;
    const xs = [];
    const ys = [];
    const tips = [];
    const raw = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const d = box.d0 + (box.d1 - box.d0) * (i + 0.5) / cols;
        const r = box.r0 + (box.r1 - box.r0) * (j + 0.5) / rows;
        raw.push({ d: d, r: r, s: step(d, r, gamma, prim, k) });
      }
    }
    let peak = 0;
    raw.forEach(function (a) {
      peak = Math.max(peak, Math.abs(a.s.d) / (box.d1 - box.d0), Math.abs(a.s.r) / (box.r1 - box.r0));
    });
    const scale = peak > 0 ? Math.min(8, 0.11 / peak) : 1;
    raw.forEach(function (a) {
      const x1 = a.d + scale * a.s.d;
      const y1 = a.r + scale * a.s.r;
      xs.push(a.d, x1, null);
      ys.push(a.r, y1, null);
      tips.push({ x: x1, y: y1, d: a.d, r: a.r, sd: a.s.d, sr: a.s.r });
    });
    return { xs: xs, ys: ys, tips: tips, scale: scale };
  }

  function draw() {
    const row = selected();
    const el = document.getElementById("phase-plane");
    const gamma = growth(row);
    const prim = primary(row);
    const frozen = document.getElementById("phase-frozen");
    if (frozen) frozen.textContent = "γ " + fmt(gamma, 2) + "%    p " + fmt(prim, 2);
    if (!row || gamma === null || prim === null) {
      document.getElementById("phase-read").textContent = "This quarter has no primary deficit, or no GDP four quarters earlier. The field is not drawn.";
      el.textContent = "";
      return;
    }
    const k = knobs();
    const pts = pathPoints();
    const box = bounds(pts);
    const here = step(num(row.debt_gdp_pct), num(row.stock_avg_coupon), gamma, prim, k);
    document.getElementById("phase-read").textContent =
      row.date + "    d " + fmt(num(row.debt_gdp_pct), 1) +
      "    r " + fmt(num(row.stock_avg_coupon), 2) +
      "    γ " + fmt(gamma, 2) +
      "    p " + fmt(prim, 2) +
      "    one-year step  ḋ " + fmt(here.d, 2) +
      "    ṙ " + fmt(here.r, 2);

    const dn = debtNull(box, gamma, prim);
    const rn = rateNull(box, k);
    const arrows = field(box, gamma, prim, k);
    const dNow = num(row.debt_gdp_pct);
    const rNow = num(row.stock_avg_coupon);

    const traces = [
      {
        type: "scatter",
        mode: "lines",
        name: "debt ratio flat",
        x: dn.x,
        y: dn.y,
        hovertemplate: "d %{x:.1f}<br>r %{y:.2f}<extra>ḋ = 0</extra>",
        line: { color: "#c4a35a", width: 1.6, dash: "dot" },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "rate flat",
        x: rn.x,
        y: rn.y,
        hovertemplate: "d %{x:.1f}<br>r %{y:.2f}<extra>ṙ = 0</extra>",
        line: { color: "#ff2bd6", width: 1.6 },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "one-year step",
        x: arrows.xs,
        y: arrows.ys,
        hoverinfo: "skip",
        line: { color: "rgba(0,240,255,0.55)", width: 1.2 },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "step, hover for the size",
        x: arrows.tips.map(function (t) { return t.x; }),
        y: arrows.tips.map(function (t) { return t.y; }),
        customdata: arrows.tips.map(function (t) { return [t.d, t.r, t.sd, t.sr, arrows.scale]; }),
        hovertemplate:
          "at d %{customdata[0]:.1f}, r %{customdata[1]:.2f}<br>" +
          "ḋ %{customdata[2]:.2f} per year<br>ṙ %{customdata[3]:.2f} per year<br>" +
          "shaft × %{customdata[4]:.2f}<extra></extra>",
        marker: { size: 5, color: "#00f0ff", symbol: "circle" },
      },
      {
        type: "scatter",
        mode: "lines+markers",
        name: "printed",
        x: pts.map(function (pt) { return pt.d; }),
        y: pts.map(function (pt) { return pt.r; }),
        customdata: pts.map(function (pt) { return pt.date; }),
        hovertemplate: "%{customdata}<br>d %{x:.1f}<br>r %{y:.2f}<extra>printed</extra>",
        line: { color: "#d5e4f0", width: 1.4 },
        marker: { size: 5, color: "#d5e4f0" },
      },
    ];
    if (dNow !== null && rNow !== null) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: row.date,
        x: [dNow],
        y: [rNow],
        hovertemplate: row.date + "<br>d %{x:.1f}<br>r %{y:.2f}<extra>selected</extra>",
        marker: { size: 14, color: "#c4a35a", line: { color: "#ff2bd6", width: 2 } },
      });
    }

    paint(el, traces, {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 52, l: 58 },
      legend: legend(),
      xaxis: axis2d({ title: "debt / GDP, percent", range: [box.d0, box.d1] }),
      yaxis: axis2d({ title: "accruing rate, percent", range: [box.r0, box.r1] }),
    });

    if (!clickBound) {
      clickBound = true;
      el.on("plotly_click", function (ev) {
        const pt = ev.points && ev.points[0];
        if (!pt || pt.data.name !== "printed" || !pt.customdata) return;
        const iso = pt.customdata;
        if (!BY[iso]) return;
        document.getElementById("phase-quarter").value = iso;
        draw();
      });
    }
  }

  function boot(payload) {
    if (!payload || !Array.isArray(payload.sustain) || !payload.sustain.length) {
      fail("cubes.json has no sustain rows — rerun the nightly.");
      return;
    }
    const sample = payload.sustain[0];
    const need = ["debt_gdp_pct", "stock_avg_coupon", "primary_deficit_pct_gdp", "gdp_bn", "date"];
    const missing = need.filter(function (k) { return !(k in sample); });
    if (missing.length) {
      fail("cubes.json sustain row is missing " + missing.join(", ") + " — rerun --process.");
      return;
    }
    ROWS = payload.sustain.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    BY = {};
    ROWS.forEach(function (row) { BY[row.date] = row; });
    const usable = ROWS.filter(function (row) {
      return num(row.debt_gdp_pct) !== null && num(row.stock_avg_coupon) !== null && growth(row) !== null && primary(row) !== null;
    });
    if (!usable.length) {
      fail("No quarter has a debt ratio, a coupon, a primary deficit, and GDP a year earlier.");
      return;
    }
    stamp("cubes.json " + (payload.generated_at || "") + " · r on the path is the book coupon · " + usable.length + " quarters");
    const sel = document.getElementById("phase-quarter");
    sel.replaceChildren();
    usable.forEach(function (row) {
      const opt = document.createElement("option");
      opt.value = row.date;
      opt.textContent = row.date;
      sel.appendChild(opt);
    });
    sel.value = usable[usable.length - 1].date;
    sel.addEventListener("change", draw);
    [
      ["phase-alpha", "alpha-val", 3],
      ["phase-crit", "crit-val", 0],
      ["phase-sigma", "sigma-val", 2],
    ].forEach(function (spec) {
      const input = document.getElementById(spec[0]);
      const label = document.getElementById(spec[1]);
      const digits = spec[2];
      function sync() {
        label.textContent = Number(input.value).toFixed(digits);
        draw();
      }
      input.addEventListener("input", sync);
      label.textContent = Number(input.value).toFixed(digits);
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
