/* Path is measured. The identity uses r = interest/GDP ÷ debt/GDP and the
   exact one-year map. The score chart is printed minus that identity.
   The grid, sliders, and poles are a model and sit below the score. */
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

  function growth(row) {
    const prev = BY[shiftYear(row.date, -1)];
    if (!prev) return null;
    const now = num(row.gdp_bn);
    const then = num(prev.gdp_bn);
    if (now === null || then === null || then === 0) return null;
    return (now / then - 1) * 100;
  }

  function rate(row) {
    const i = num(row.int_gdp_pct);
    const b = num(row.debt_gdp_pct);
    if (i === null || b === null || b === 0) return null;
    return (100 * i) / b;
  }

  function carry(r, g) {
    return (1 + r / 100) / (1 + g / 100) - 1;
  }

  function identity(row) {
    const r = rate(row);
    const g = growth(row);
    const b = num(row.debt_gdp_pct);
    const d = num(row.primary_deficit_pct_gdp);
    if (r === null || g === null || b === null || d === null) return null;
    return carry(r, g) * b + d;
  }

  function printed(row) {
    const b = num(row.debt_gdp_pct);
    const ahead = BY[shiftYear(row.date, 1)];
    if (b === null || !ahead) return null;
    const aheadB = num(ahead.debt_gdp_pct);
    if (aheadB === null) return null;
    return aheadB - b;
  }

  function fieldOk(row) {
    return identity(row) !== null;
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
    return {
      d0: wide ? Math.min.apply(null, ds) - 1 : -6,
      d1: wide ? Math.max.apply(null, ds) + 1 : 10,
      b0: Math.min.apply(null, bs) - 3,
      b1: Math.max.apply(null, bs) + 3,
    };
  }

  function step(d, b, r, g, bq, gam, rh) {
    const a = carry(r, g);
    const db = a * b + d;
    const dStar = -a * bq - rh * (b - bq);
    return { dd: gam * (dStar - d), db: db, a: a };
  }

  function polesOf(r, g, gam, rh) {
    const a = carry(r, g);
    const tr = -gam + a;
    const det = gam * (rh - a);
    const half = tr / 2;
    const disc = half * half - det;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { tr: tr, det: det, disc: disc, a: a, poles: [
        { re: half + s, im: 0 },
        { re: half - s, im: 0 },
      ] };
    }
    const s = Math.sqrt(-disc);
    return { tr: tr, det: det, disc: disc, a: a, poles: [
      { re: half, im: s },
      { re: half, im: -s },
    ] };
  }

  function regime(info) {
    if (info.disc < -1e-10) {
      const side = info.tr < 0 ? "spiral sink" : (info.tr > 0 ? "spiral source" : "center");
      return "Complex poles: a " + side + ". That rotation is the policy rule, not a cycle in the data.";
    }
    if (info.det < -1e-10) return "Saddle. One direction decays and one grows.";
    if (info.tr < -1e-10 && info.det > 1e-10) return "Sink. Both poles are in the left half.";
    if (info.tr > 1e-10 && info.det > 1e-10) return "Source. Both poles are in the right half.";
    return "A pole is on the imaginary axis.";
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
      const ident = identity(row);
      const act = printed(row);
      const gap = ident !== null && act !== null ? act - ident : null;
      x.push(d);
      y.push(b);
      cd.push([
        row.date,
        fmt(num(row.int_gdp_pct), 2),
        fmt(rate(row), 2),
        fmt(num(row.stock_avg_coupon), 2),
        fmt(growth(row), 2),
        fmt(ident, 2),
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
        "interest/GDP %{customdata[1]}<br>" +
        "r used %{customdata[2]}%<br>" +
        "book coupon %{customdata[3]}%<br>" +
        "nominal growth %{customdata[4]}%<br>" +
        "identity next-year Δdebt/GDP %{customdata[5]}<br>" +
        "printed next-year Δdebt/GDP %{customdata[6]}<br>" +
        "gap (printed − identity) %{customdata[7]}" +
        "<extra>click to set the quarter</extra>",
      line: { color: "#00f0ff", width: 1.6 },
      marker: { color: "#00f0ff", size: 7 },
    };
  }

  function drawPath(row, ident) {
    const el = document.getElementById("phase-plane");
    const box = view();
    const r = rate(row);
    const g = growth(row);
    const d = num(row.primary_deficit_pct_gdp);
    const b = num(row.debt_gdp_pct);
    const down = ident < 0;
    paint(el, [nullcline(box, r, g), pathTrace(), {
      type: "scatter",
      mode: "markers",
      name: "selected",
      x: [d],
      y: [b],
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
        x: d,
        y: b,
        text: "identity " + fmt(ident, 2),
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

  function drawScore() {
    const el = document.getElementById("phase-score");
    const date = [];
    const ident = [];
    const act = [];
    const gap = [];
    const cd = [];
    ROWS.forEach(function (row) {
      const idn = identity(row);
      if (idn === null) return;
      const printedChange = printed(row);
      date.push(row.date);
      ident.push(idn);
      act.push(printedChange);
      gap.push(printedChange === null ? null : printedChange - idn);
      cd.push([fmt(rate(row), 2), fmt(num(row.stock_avg_coupon), 2), fmt(growth(row), 2)]);
    });
    paint(el, [
      {
        type: "scatter",
        mode: "lines",
        name: "printed",
        x: date,
        y: act,
        customdata: cd,
        hovertemplate: "%{x}<br>printed %{y:.2f}<br>r %{customdata[0]}%<br>coupon %{customdata[1]}%<br>growth %{customdata[2]}%<extra></extra>",
        line: { color: "#00f0ff", width: 1.8 },
        connectgaps: false,
      },
      {
        type: "scatter",
        mode: "lines",
        name: "identity",
        x: date,
        y: ident,
        hovertemplate: "%{x}<br>identity %{y:.2f}<extra></extra>",
        line: { color: "#c4a35a", width: 1.8 },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "gap",
        x: date,
        y: gap,
        hovertemplate: "%{x}<br>printed − identity %{y:.2f}<extra></extra>",
        line: { color: "#ff2bd6", width: 1.4 },
        connectgaps: false,
      },
    ], {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 48, r: 16, b: 48, l: 52 },
      legend: legend(),
      xaxis: axis2d({ title: "", type: "date" }),
      yaxis: axis2d({ title: "change in debt/GDP, points, over the next year", zeroline: true }),
    });
  }

  function drawModel(row) {
    const el = document.getElementById("phase-model");
    const r = rate(row);
    const g = growth(row);
    const bq = num(row.debt_gdp_pct);
    const gam = gamma();
    const rh = rho();
    const box = view();
    const bags = segments(box, r, g, bq, gam, rh);
    const a = carry(r, g);
    const eq = gam > 0 && Math.abs(rh - a) >= 1e-4 ? { d: -a * bq, b: bq } : null;
    const traces = [
      lineTrace(bags.rising, "debt ratio rising", "#ff2bd6"),
      lineTrace(bags.falling, "debt ratio falling", "#00f0ff"),
      lineTrace(bags.flat, "almost still", "#c4a35a"),
      nullcline(box, r, g),
      pathTrace(),
    ];
    if (eq) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: "equilibrium",
        x: [eq.d],
        y: [eq.b],
        hovertemplate: "primary %{x:.2f}<br>debt/GDP %{y:.1f}<extra>model equilibrium</extra>",
        marker: { size: 12, color: "#07080c", symbol: "circle", line: { color: "#c4a35a", width: 2 } },
      });
    }
    paint(el, traces, {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      margin: { t: 64, r: 16, b: 52, l: 58 },
      legend: legend(),
      xaxis: axis2d({ title: "primary deficit / GDP", range: [box.d0, box.d1] }),
      yaxis: axis2d({ title: "debt held by the public / GDP", range: [box.b0, box.b1] }),
    });

    const info = polesOf(r, g, gam, rh);
    const poles = document.getElementById("phase-poles");
    let m = 0.15;
    info.poles.forEach(function (p) {
      m = Math.max(m, Math.abs(p.re) * 1.45, Math.abs(p.im) * 1.45);
    });
    paint(poles, [{
      type: "scatter",
      mode: "markers",
      name: "poles",
      showlegend: false,
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

    let sentence = "Model only. These poles are not the printed debt ratio. ";
    if (gam === 0) {
      sentence += "γ is zero, so the primary stays put and ρ is idle. One pole is zero. The other is the one-year carry, (1+r)/(1+g) − 1, equal to "
        + fmt(info.a, 4) + ". ";
    } else {
      sentence += regime(info) + " ";
    }
    if (eq === null && gam > 0 && Math.abs(rh - a) < 1e-4) {
      sentence += "ρ equals the carry, so the policy line and the flat line are the same line. No single equilibrium.";
    }
    document.getElementById("phase-status").textContent = sentence;
  }

  function draw() {
    const row = selected();
    if (!row || !fieldOk(row)) {
      document.getElementById("phase-plane").textContent = "This quarter has no interest, debt ratio, or four-quarter GDP growth.";
      return;
    }
    const ident = identity(row);
    const act = printed(row);
    const gap = act === null ? null : act - ident;
    const r = rate(row);
    const g = growth(row);
    document.getElementById("phase-read").textContent =
      row.date + "\n" +
      "primary " + fmt(num(row.primary_deficit_pct_gdp), 2) + "% of GDP\n" +
      "debt/GDP " + fmt(num(row.debt_gdp_pct), 1) + "\n" +
      "r used (interest/GDP ÷ debt/GDP) " + fmt(r, 2) + "%\n" +
      "book coupon " + fmt(num(row.stock_avg_coupon), 2) + "%    not used in the arrow\n" +
      "nominal growth " + fmt(g, 2) + "%\n" +
      "identity next-year Δdebt/GDP " + fmt(ident, 2) + "\n" +
      "printed next-year Δdebt/GDP " + fmt(act, 2) + "\n" +
      "gap (printed − identity) " + fmt(gap, 2);
    drawPath(row, ident);
    drawScore();
    drawModel(row);
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
      fail("No quarter has interest, a debt ratio, and four-quarter GDP growth.");
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
    stamp("cubes.json " + (payload.generated_at || "") + " · r = interest/GDP ÷ debt/GDP · " + usable.length + " quarters");
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
