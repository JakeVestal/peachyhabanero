/* Phase plane: measured (primary, debt/GDP) path plus a one-year identity.
   Arrows use the selected quarter's coupon and nominal growth. No fill. */
(function () {
  const DATA = "data/published/cubes.json";
  const PLOT = {
    responsive: true,
    scrollZoom: false,
    displayModeBar: true,
    displaylogo: false,
  };

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
    if (v === null || !isFinite(v)) return "—";
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
    const h = el.clientHeight || parseInt(getComputedStyle(el).height, 10) || 480;
    layout.height = h;
    if (el.classList.contains("js-plotly-plot")) {
      Plotly.react(el, data, layout, PLOT);
      return;
    }
    el.replaceChildren();
    Plotly.newPlot(el, data, layout, PLOT);
  }

  function growth(row) {
    const prev = BY[shiftYear(row.date, -1)];
    if (!prev) return null;
    const now = num(row.gdp_bn);
    const then = num(prev.gdp_bn);
    if (now === null || then === null || then === 0) return null;
    return (now / then - 1) * 100;
  }

  function fieldOk(row) {
    return num(row.primary_deficit_pct_gdp) !== null
      && num(row.debt_gdp_pct) !== null
      && num(row.stock_avg_coupon) !== null
      && row.stock_avg_coupon !== 0
      && growth(row) !== null;
  }

  function gamma() {
    return Number(document.getElementById("phase-gamma").value);
  }

  function rho() {
    return Number(document.getElementById("phase-rho").value);
  }

  function selected() {
    const iso = document.getElementById("phase-quarter").value;
    return BY[iso] || null;
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
    const b0 = Math.min.apply(null, bs) - 3;
    const b1 = Math.max.apply(null, bs) + 3;
    const d0 = wide ? Math.min.apply(null, ds) - 1 : -6;
    const d1 = wide ? Math.max.apply(null, ds) + 1 : 10;
    return { d0: d0, d1: d1, b0: b0, b1: b1 };
  }

  function step(d, b, r, g, bq, gam, rh) {
    const rg = r - g;
    const db = (rg / 100) * b + d;
    const dStar = -(rg / 100) * bq - rh * (b - bq);
    const dd = gam * (dStar - d);
    return { dd: dd, db: db };
  }

  function polesOf(r, g, gam, rh) {
    const rg = r - g;
    const tr = -gam + rg / 100;
    const det = gam * (rh - rg / 100);
    const half = tr / 2;
    const disc = half * half - det;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { tr: tr, det: det, disc: disc, poles: [
        { re: half + s, im: 0 },
        { re: half - s, im: 0 },
      ] };
    }
    const s = Math.sqrt(-disc);
    return { tr: tr, det: det, disc: disc, poles: [
      { re: half, im: s },
      { re: half, im: -s },
    ] };
  }

  function regime(info, rg) {
    if (Math.abs(info.poles[0].re) < 1e-12 && Math.abs(info.poles[1].re) < 1e-12
        && Math.abs(info.poles[0].im) < 1e-12) {
      return "Both poles are on zero. The linear step does not push.";
    }
    if (info.disc < -1e-10) {
      const side = info.tr < 0 ? "spiral sink" : (info.tr > 0 ? "spiral source" : "center");
      return "Complex poles: a " + side + ". r − g is " + fmt(rg, 2)
        + " percentage points. The rotation is the policy rule, not a cycle in the data.";
    }
    if (info.det < -1e-10) {
      return "Saddle. One direction decays and one grows. r − g is "
        + fmt(rg, 2) + " percentage points.";
    }
    if (info.tr < -1e-10 && info.det > 1e-10) {
      return "Sink. Both poles are in the left half. r − g is "
        + fmt(rg, 2) + " percentage points.";
    }
    if (info.tr > 1e-10 && info.det > 1e-10) {
      return "Source. Both poles are in the right half. r − g is "
        + fmt(rg, 2) + " percentage points.";
    }
    return "A pole is on the imaginary axis. r − g is " + fmt(rg, 2) + " percentage points.";
  }

  function segments(box, r, g, bq, gam, rh) {
    const rising = { x: [], y: [] };
    const falling = { x: [], y: [] };
    const flat = { x: [], y: [] };
    const nd = 14;
    const nb = 12;
    for (let i = 0; i < nd; i++) {
      for (let j = 0; j < nb; j++) {
        const d = box.d0 + (box.d1 - box.d0) * (i + 0.5) / nd;
        const b = box.b0 + (box.b1 - box.b0) * (j + 0.5) / nb;
        const s = step(d, b, r, g, bq, gam, rh);
        const bag = Math.abs(s.db) < 0.05 && Math.abs(s.dd) < 0.05 ? flat
          : (s.db > 0 ? rising : falling);
        bag.x.push(d, d + s.dd, null);
        bag.y.push(b, b + s.db, null);
      }
    }
    return { rising: rising, falling: falling, flat: flat };
  }

  function lineTrace(bag, name, color) {
    return {
      type: "scatter",
      mode: "lines",
      name: name,
      x: bag.x,
      y: bag.y,
      hoverinfo: "skip",
      line: { color: color, width: 1.4 },
    };
  }

  function nullcline(box, r, g) {
    const x = [];
    const y = [];
    const rg = r - g;
    for (let k = 0; k <= 60; k++) {
      const b = box.b0 + (box.b1 - box.b0) * k / 60;
      x.push(-(rg / 100) * b);
      y.push(b);
    }
    return {
      type: "scatter",
      mode: "lines",
      name: "debt ratio flat",
      x: x,
      y: y,
      hovertemplate: "primary %{x:.2f}<br>debt/GDP %{y:.1f}<extra>Δb = 0</extra>",
      line: { color: "#c4a35a", width: 1.5, dash: "dot" },
    };
  }

  function equilibrium(r, g, bq, gam, rh) {
    if (gam <= 0) return null;
    const rg = r - g;
    if (Math.abs(rh - rg / 100) < 1e-4) return null;
    return { d: -(rg / 100) * bq, b: bq };
  }

  function pathTrace() {
    const x = [];
    const y = [];
    const cd = [];
    ROWS.forEach(function (row) {
      const d = num(row.primary_deficit_pct_gdp);
      const b = num(row.debt_gdp_pct);
      if (d === null || b === null) return;
      const g = growth(row);
      const r = num(row.stock_avg_coupon);
      const ahead = BY[shiftYear(row.date, 1)];
      const aheadB = ahead ? num(ahead.debt_gdp_pct) : null;
      let pred = null;
      let actual = null;
      if (g !== null && r !== null) pred = ((r - g) / 100) * b + d;
      if (aheadB !== null) actual = aheadB - b;
      x.push(d);
      y.push(b);
      cd.push([
        row.date,
        fmt(num(row.int_gdp_pct), 2),
        fmt(r, 2),
        fmt(g, 2),
        g !== null && r !== null ? fmt(r - g, 2) : "—",
        fmt(pred, 2),
        fmt(actual, 2),
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
        "interest/GDP %{customdata[1]}<br>" +
        "book coupon %{customdata[2]}%<br>" +
        "nominal growth %{customdata[3]}%<br>" +
        "r − g %{customdata[4]} pp<br>" +
        "identity next-year Δdebt/GDP %{customdata[5]}<br>" +
        "printed next-year Δdebt/GDP %{customdata[6]}" +
        "<extra>click to set the field</extra>",
      line: { color: "#00f0ff", width: 1.6 },
      marker: { color: "#00f0ff", size: 7, line: { color: "#07080c", width: 0 } },
    };
  }

  function drawPoles(info) {
    const el = document.getElementById("phase-poles");
    let m = 0.15;
    info.poles.forEach(function (p) {
      m = Math.max(m, Math.abs(p.re) * 1.45, Math.abs(p.im) * 1.45);
    });
    const trace = {
      type: "scatter",
      mode: "markers",
      name: "poles",
      x: info.poles.map(function (p) { return p.re; }),
      y: info.poles.map(function (p) { return p.im; }),
      marker: {
        symbol: "x",
        size: 14,
        color: info.poles.map(function (p) {
          if (Math.abs(p.re) <= 1e-8) return "#c4a35a";
          return p.re > 0 ? "#ff2bd6" : "#00f0ff";
        }),
      },
      hovertemplate: "Re %{x:.4f}<br>Im %{y:.4f}<extra></extra>",
    };
    paint(el, [trace], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 16, r: 16, b: 48, l: 52 },
      showlegend: false,
      xaxis: axis2d({ title: "real part, per year", range: [-m, m], zeroline: false }),
      yaxis: axis2d({ title: "imaginary part, per year", range: [-m, m] }),
      shapes: [
        { type: "rect", xref: "x", yref: "y", x0: -m, x1: 0, y0: -m, y1: m,
          fillcolor: "rgba(0,240,255,0.05)", line: { width: 0 } },
        { type: "rect", xref: "x", yref: "y", x0: 0, x1: m, y0: -m, y1: m,
          fillcolor: "rgba(255,43,214,0.05)", line: { width: 0 } },
        { type: "line", xref: "x", yref: "y", x0: 0, x1: 0, y0: -m, y1: m,
          line: { color: "#c4a35a", width: 1, dash: "dot" } },
      ],
    });
  }

  function draw() {
    const row = selected();
    const plane = document.getElementById("phase-plane");
    if (!row || !fieldOk(row)) {
      plane.textContent = "This quarter has no coupon or no four-quarter GDP growth. Pick another.";
      return;
    }
    const r = num(row.stock_avg_coupon);
    const g = growth(row);
    const bq = num(row.debt_gdp_pct);
    const dq = num(row.primary_deficit_pct_gdp);
    const iq = num(row.int_gdp_pct);
    const gam = gamma();
    const rh = rho();
    const rg = r - g;
    const box = view();
    const bags = segments(box, r, g, bq, gam, rh);
    const eq = equilibrium(r, g, bq, gam, rh);
    const info = polesOf(r, g, gam, rh);
    const traces = [
      lineTrace(bags.rising, "debt ratio rising", "#ff2bd6"),
      lineTrace(bags.falling, "debt ratio falling", "#00f0ff"),
      lineTrace(bags.flat, "almost still", "#c4a35a"),
      nullcline(box, r, g),
      pathTrace(),
      {
        type: "scatter",
        mode: "markers",
        name: "field quarter",
        x: [dq],
        y: [bq],
        hovertemplate: row.date + "<br>primary %{x:.2f}<br>debt/GDP %{y:.1f}<extra>field</extra>",
        marker: { size: 14, color: "#c4a35a", line: { color: "#ff2bd6", width: 2 } },
      },
    ];
    if (eq) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: "equilibrium",
        x: [eq.d],
        y: [eq.b],
        hovertemplate: "primary %{x:.2f}<br>debt/GDP %{y:.1f}<extra>model equilibrium</extra>",
        marker: { size: 12, color: "#07080c", line: { color: "#c4a35a", width: 2 }, symbol: "circle" },
      });
    }
    paint(plane, traces, {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 64, r: 16, b: 52, l: 58 },
      legend: {
        orientation: "h",
        y: 1.02,
        x: 0,
        yanchor: "bottom",
        font: { color: "#d5e4f0", size: 11 },
        bgcolor: "rgba(0,0,0,0)",
      },
      xaxis: axis2d({ title: "primary deficit / GDP", range: [box.d0, box.d1] }),
      yaxis: axis2d({ title: "debt held by the public / GDP", range: [box.b0, box.b1] }),
    });
    if (!clickBound) {
      clickBound = true;
      plane.on("plotly_click", function (ev) {
        const pt = ev.points && ev.points[0];
        if (!pt || pt.data.name !== "NIPA" || !pt.customdata) return;
        const iso = pt.customdata[0];
        if (!fieldOk(BY[iso])) return;
        document.getElementById("phase-quarter").value = iso;
        draw();
      });
    }
    drawPoles(info);

    const implied = (r / 100) * bq;
    const gap = iq === null ? null : iq - implied;
    const ident = ((rg / 100) * bq) + dq;
    const ahead = BY[shiftYear(row.date, 1)];
    const actual = ahead && num(ahead.debt_gdp_pct) !== null ? num(ahead.debt_gdp_pct) - bq : null;
    document.getElementById("phase-read").textContent =
      row.date + "\n" +
      "primary " + fmt(dq, 2) + "% of GDP\n" +
      "debt/GDP " + fmt(bq, 1) + "\n" +
      "interest/GDP " + fmt(iq, 2) + "    coupon × debt/GDP " + fmt(implied, 2) +
      "    gap " + fmt(gap, 2) + " pp\n" +
      "book coupon " + fmt(r, 2) + "%    nominal growth " + fmt(g, 2) +
      "%    r − g " + fmt(rg, 2) + " pp\n" +
      "identity next-year Δdebt/GDP " + fmt(ident, 2) +
      "    printed " + fmt(actual, 2) + "\n" +
      "γ " + fmt(gam, 2) + "    ρ " + fmt(rh, 3) + "\n" +
      "poles " + (Math.abs(info.poles[0].im) > 1e-8
        ? fmt(info.poles[0].re, 4) + " ± " + fmt(Math.abs(info.poles[0].im), 4) + "i"
        : fmt(info.poles[0].re, 4) + " and " + fmt(info.poles[1].re, 4));

    let sentence;
    if (gam === 0) {
      sentence = "γ is zero, so the primary stays put and ρ is idle. One pole is zero. The other is (r − g) per year ("
        + fmt(rg / 100, 4) + "). "
        + (rg < 0
          ? "It is negative: growth is above the coupon, so a debt ratio off the gold line is pulled back toward it."
          : rg > 0
            ? "It is positive: the coupon is above growth, so a debt ratio off the gold line moves farther away."
            : "r and g are equal, so the debt ratio only moves with the primary.");
    } else {
      sentence = regime(info, rg);
    }
    if (eq === null && gam > 0 && Math.abs(rh - rg / 100) < 1e-4) {
      sentence += " ρ equals (r − g)/100, so the policy line and the flat line are the same line. No single equilibrium.";
    }
    document.getElementById("phase-status").textContent = sentence;
  }

  function boot(payload) {
    if (!payload || !Array.isArray(payload.sustain) || !payload.sustain.length) {
      fail("cubes.json has no sustain rows — rerun the nightly.");
      return;
    }
    const sample = payload.sustain[0];
    const need = ["primary_deficit_pct_gdp", "debt_gdp_pct", "stock_avg_coupon", "gdp_bn", "int_gdp_pct", "date"];
    const missing = need.filter(function (k) { return !(k in sample); });
    if (missing.length) {
      fail("cubes.json sustain row is missing " + missing.join(", ") + " — rerun --process.");
      return;
    }
    ROWS = payload.sustain.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : 1;
    });
    BY = {};
    ROWS.forEach(function (r) { BY[r.date] = r; });
    const usable = ROWS.filter(fieldOk);
    if (!usable.length) {
      fail("No quarter has a coupon and a four-quarter GDP growth. Nothing to draw.");
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
    stamp("cubes.json " + (payload.generated_at || "") + " · " + usable.length + " quarters in the field");
    sel.addEventListener("change", draw);
    document.getElementById("phase-gamma").addEventListener("input", function () {
      document.getElementById("gamma-val").textContent = gamma().toFixed(2);
      draw();
    });
    document.getElementById("phase-rho").addEventListener("input", function () {
      document.getElementById("rho-val").textContent = rho().toFixed(3);
      draw();
    });
    document.getElementById("phase-wide").addEventListener("change", draw);
    draw();
  }

  fetch(DATA).then(function (res) {
    if (!res.ok) throw new Error(res.status + " " + DATA);
    return res.json();
  }).then(boot).catch(function (err) {
    fail(String(err && err.message ? err.message : err));
  });
})();
