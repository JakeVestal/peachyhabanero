const DATA = "data/published/raw_inputs.json";

function rawNum(row, col) {
  const x = row[col];
  if (x === null || x === undefined || x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function colMap(table, col) {
  const m = new Map();
  ((table && table.rows) || []).forEach((r) => {
    const v = rawNum(r, col);
    if (v !== null) m.set(String(r.date).slice(0, 7), v);
  });
  return m;
}

function seriesFromMap(m) {
  const xs = [];
  const ys = [];
  Array.from(m.keys()).sort().forEach((k) => {
    const v = m.get(k);
    if (!Number.isFinite(v)) return;
    xs.push(k + "-01");
    ys.push(v);
  });
  return { xs, ys };
}

function actionsFrom(map) {
  const keys = Array.from(map.keys()).sort();
  const hike = [];
  const cut = [];
  const amt = new Map();
  for (let i = 1; i < keys.length; i++) {
    const d = map.get(keys[i]) - map.get(keys[i - 1]);
    if (!Number.isFinite(d) || Math.abs(d) < 0.124) continue;
    amt.set(keys[i], d);
    if (d > 0) hike.push(keys[i]);
    else cut.push(keys[i]);
  }
  return { hike, cut, amt };
}

function fmtMove(d) {
  if (!Number.isFinite(d)) return "n/a";
  return (d > 0 ? "+" : "") + d.toFixed(2) + " pp";
}

function markersOn(series, months, color, symbol, name, spec) {
  const yAt = new Map();
  series.xs.forEach((d, i) => yAt.set(d.slice(0, 7), series.ys[i]));
  const xs = [];
  const ys = [];
  const text = [];
  months.forEach((k) => {
    const y = yAt.get(k);
    if (!Number.isFinite(y)) return;
    xs.push(k + "-01");
    ys.push(y);
    const move = spec.amt && spec.amt.get(k);
    const funds = spec.funds && spec.funds.get(k);
    const tgt = spec.target && spec.target.get(k);
    let tip = `<b>${name}</b> ${k}<br>move ${fmtMove(move)}`;
    if (Number.isFinite(tgt)) tip += `<br>DFEDTARU ${tgt.toFixed(2)}%`;
    if (Number.isFinite(funds)) tip += `<br>FEDFUNDS ${funds.toFixed(2)}%`;
    tip += `<br>${spec.label}  ${y.toFixed(2)}`;
    text.push(tip);
  });
  return {
    type: "scatter", mode: "markers",
    x: xs, y: ys, name, text,
    hoverinfo: "text",
    marker: { color, size: 8, symbol },
  };
}

function axisLayout() {
  return {
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 10 },
    margin: { l: 44, r: 8, t: 8, b: 28 },
    showlegend: false,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    shapes: [{
      type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: "rgba(232,246,255,0.35)", width: 1, dash: "dot" },
    }],
  };
}

function plotGap(el, series, color, hike, cut, spec) {
  const node = document.getElementById(el);
  if (!node) return;
  if (!series.xs.length) {
    node.innerHTML = `<p class="err">missing — run --process</p>`;
    return;
  }
  const box = window.getComputedStyle(node);
  const w = Math.round(parseFloat(box.width)) || 680;
  const h = Math.round(parseFloat(box.height)) || 340;
  const holdText = series.xs.map((d, i) => {
    const k = d.slice(0, 7);
    return `${k}<br>${spec.label}  ${series.ys[i].toFixed(2)}`;
  });
  return Plotly.newPlot(el, [
    { type: "scatter", mode: "lines", x: series.xs, y: series.ys,
      text: holdText, hoverinfo: "text",
      line: { color, width: 2 } },
    markersOn(series, hike, "#39ff14", "triangle-up", "hike", spec),
    markersOn(series, cut, "#ff2bd6", "triangle-down", "cut", spec),
  ], Object.assign(axisLayout(), { width: w, height: h }),
  { responsive: false, displaylogo: false });
}

function axis3d(title) {
  return {
    title: { text: title, font: { size: 11, color: "#c8d6e5" } },
    backgroundcolor: "rgba(0,0,0,0)",
    showbackground: false,
    showgrid: false,
    showline: true,
    linecolor: "rgba(196,163,90,0.45)",
    zeroline: false,
    color: "#c8d6e5",
  };
}

async function main() {
  const stamp = document.getElementById("stamp");
  const res = await fetch(DATA);
  if (!res.ok) {
    stamp.innerHTML = `<span class="err">${res.status} raw_inputs.json — python scripts/build_site_data.py --process</span>`;
    return;
  }
  const pack = await res.json();
  const tables = pack.tables || {};
  stamp.textContent = `raw_inputs ${pack.generated_at || ""}`;

  const pceMap = new Map();
  const rawPce = colMap(tables.fred_inflation, "PCEPI");
  const pceKeys = Array.from(rawPce.keys()).sort();
  pceKeys.forEach((key) => {
    const [y, m] = key.split("-").map(Number);
    const prev = `${String(y - 1).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
    if (!rawPce.has(prev)) return;
    pceMap.set(key, 100 * (rawPce.get(key) / rawPce.get(prev) - 1) - 2);
  });

  const uMap = colMap(tables.fred_labor_output, "UNRATE");
  const nMap = colMap(tables.fred_labor_output, "NROU");
  const empMap = new Map();
  let lastN = null;
  Array.from(new Set([...uMap.keys(), ...nMap.keys()])).sort().forEach((k) => {
    if (nMap.has(k)) lastN = nMap.get(k);
    const u = uMap.get(k);
    if (lastN == null || !Number.isFinite(u)) return;
    empMap.set(k, lastN - u);
  });

  const tpRaw = colMap(tables.fred_term_premium, "THREEFYTP10");
  const tpMap = new Map();
  tpRaw.forEach((v, k) => { if (v !== 0) tpMap.set(k, v); });

  const fundsMap = colMap(tables.fred_policy_rates, "FEDFUNDS");
  const hiMap = colMap(tables.fred_policy_rates, "DFEDTARU");
  const loMap = colMap(tables.fred_policy_rates, "DFEDTARL");
  const fromTarget = actionsFrom(hiMap);
  const fromFunds = actionsFrom(fundsMap);
  const amt = new Map(fromFunds.amt);
  fromTarget.amt.forEach((v, k) => amt.set(k, v));
  const hike = Array.from(new Set([...fromTarget.hike, ...fromFunds.hike])).sort();
  const cut = Array.from(new Set([...fromTarget.cut, ...fromFunds.cut])).sort();

  const pi = seriesFromMap(pceMap);
  const emp = seriesFromMap(empMap);
  const tp = seriesFromMap(tpMap);
  const funds = seriesFromMap(fundsMap);
  const hi = seriesFromMap(hiMap);
  const lo = seriesFromMap(loMap);

  const monthsAll = Array.from(pceMap.keys()).filter((k) => empMap.has(k) && tpMap.has(k)).sort();
  const cubeEl = document.getElementById("fed-cube");
  const fromEl = document.getElementById("fed-from");
  const toEl = document.getElementById("fed-to");
  const rangeLab = document.getElementById("fed-range-label");
  if (monthsAll.length && toEl && !toEl.value) {
    toEl.value = monthsAll[monthsAll.length - 1];
  }
  if (fromEl && monthsAll.length && fromEl.value < monthsAll[0]) {
    fromEl.value = monthsAll[0];
  }

  function selectedMonths() {
    const a = fromEl && fromEl.value ? fromEl.value : "2000-01";
    const b = toEl && toEl.value ? toEl.value : "9999-12";
    return monthsAll.filter((k) => k >= a && k <= b);
  }

  function actionHover(kind, k, x, y, z) {
    const d = amt.get(k);
    const signed = Number.isFinite(d)
      ? (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2)) + " pp"
      : "n/a";
    return (
      `<b>${kind}</b> ${k}<br>` +
      `move ${signed}<br>` +
      `PCE yoy − 2%  ${x.toFixed(2)}<br>` +
      `NROU − UNRATE  ${y.toFixed(2)}<br>` +
      `ACM 10y TP  ${z.toFixed(2)}`
    );
  }

  async function drawCube() {
    if (!cubeEl) return;
    const months = selectedMonths();
    if (rangeLab) rangeLab.textContent = months.length
      ? `${months[0]} → ${months[months.length - 1]}  (${months.length} mo)`
      : "no months";
    if (!months.length) {
      cubeEl.innerHTML = `<p class="err">no months in that window</p>`;
      return;
    }
    const X = months.map((k) => pceMap.get(k));
    const Y = months.map((k) => empMap.get(k));
    const Z = months.map((k) => tpMap.get(k));
    const hover = months.map((k, i) =>
      `${k}<br>PCE yoy − 2%  ${X[i].toFixed(2)}<br>NROU − UNRATE  ${Y[i].toFixed(2)}<br>ACM 10y TP  ${Z[i].toFixed(2)}`);
    const hikeSet = new Set(hike);
    const cutSet = new Set(cut);
    const hx = [], hy = [], hz = [], ht = [];
    const cx = [], cy = [], cz = [], ct = [];
    months.forEach((k, i) => {
      if (hikeSet.has(k)) {
        hx.push(X[i]); hy.push(Y[i]); hz.push(Z[i]);
        ht.push(actionHover("hike", k, X[i], Y[i], Z[i]));
      }
      if (cutSet.has(k)) {
        cx.push(X[i]); cy.push(Y[i]); cz.push(Z[i]);
        ct.push(actionHover("cut", k, X[i], Y[i], Z[i]));
      }
    });
    const gd = cubeEl._fullLayout && cubeEl.layout && cubeEl.layout.scene
      ? cubeEl.layout.scene.camera : null;
    const layout = {
      paper_bgcolor: "#07080c",
      plot_bgcolor: "#07080c",
      font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace" },
      margin: { l: 0, r: 0, t: 8, b: 0 },
      height: 560,
      uirevision: "fed-cam",
      showlegend: true,
      legend: {
        font: { size: 11, color: "#9fb3c8" },
        bgcolor: "rgba(7,8,12,0.55)",
        orientation: "h", x: 0, y: 1.02,
      },
      scene: {
        xaxis: axis3d("PCE yoy − 2%"),
        yaxis: axis3d("NROU − UNRATE"),
        zaxis: axis3d("ACM 10y TP"),
        aspectmode: "cube",
        bgcolor: "#07080c",
        camera: gd || {
          up: { x: 0, y: 0, z: 1 },
          center: { x: 0, y: 0, z: 0 },
          eye: { x: 1.6, y: 1.6, z: 0.9 },
        },
      },
    };
    await Plotly.react("fed-cube", [
      {
        type: "scatter3d", mode: "lines+markers",
        x: X, y: Y, z: Z,
        text: hover, hoverinfo: "text",
        marker: { size: 3, color: "#00f0ff" },
        line: { color: "rgba(0,240,255,0.35)", width: 3 },
        name: "hold / path",
      },
      {
        type: "scatter3d", mode: "markers",
        x: hx, y: hy, z: hz, name: "hike",
        text: ht, hoverinfo: "text",
        marker: { size: 6, color: "#39ff14", symbol: "diamond" },
      },
      {
        type: "scatter3d", mode: "markers",
        x: cx, y: cy, z: cz, name: "cut",
        text: ct, hoverinfo: "text",
        marker: { size: 6, color: "#ff2bd6", symbol: "diamond" },
      },
      {
        type: "scatter3d", mode: "markers",
        x: [X[X.length - 1]], y: [Y[Y.length - 1]], z: [Z[Z.length - 1]],
        name: "latest " + months[months.length - 1],
        text: ["latest " + hover[hover.length - 1]],
        hoverinfo: "text",
        marker: { size: 11, color: "#ff8a00", symbol: "circle",
          line: { color: "#fff3d6", width: 2 } },
      },
    ], layout, { responsive: true, displaylogo: false });
  }

  if (cubeEl && monthsAll.length) {
    await drawCube();
    if (fromEl) fromEl.addEventListener("change", drawCube);
    if (toEl) toEl.addEventListener("change", drawCube);
  } else if (cubeEl) {
    cubeEl.innerHTML = `<p class="err">need PCEPI, UNRATE/NROU, THREEFYTP10 — run --process</p>`;
  }

  const fomc = document.getElementById("fed-fomc");
  if (fomc) {
    const traces = [];
    if (lo.xs.length && hi.xs.length) {
      traces.push({
        type: "scatter", mode: "lines",
        x: hi.xs.concat(lo.xs.slice().reverse()),
        y: hi.ys.concat(lo.ys.slice().reverse()),
        fill: "toself", fillcolor: "rgba(196,163,90,0.18)",
        line: { width: 0 }, name: "target range", hoverinfo: "skip",
      });
    }
    if (hi.xs.length) {
      traces.push({
        type: "scatter", mode: "lines",
        x: hi.xs, y: hi.ys, name: "DFEDTARU",
        line: { color: "#c4a35a", width: 1.5 },
      });
    }
    traces.push({
      type: "scatter", mode: "lines",
      x: funds.xs, y: funds.ys, name: "FEDFUNDS",
      line: { color: "#00f0ff", width: 2 },
    });
    const yAtHi = new Map();
    hi.xs.forEach((d, i) => yAtHi.set(d.slice(0, 7), hi.ys[i]));
    const yAtF = new Map();
    funds.xs.forEach((d, i) => yAtF.set(d.slice(0, 7), funds.ys[i]));
    function actionTips(kind, months) {
      return months.map((k) => {
        const tgt = yAtHi.get(k);
        const ff = yAtF.get(k);
        let tip = `<b>${kind}</b> ${k}<br>move ${fmtMove(amt.get(k))}`;
        if (Number.isFinite(tgt)) tip += `<br>DFEDTARU ${tgt.toFixed(2)}%`;
        if (Number.isFinite(ff)) tip += `<br>FEDFUNDS ${ff.toFixed(2)}%`;
        return tip;
      });
    }
    traces.push({
      type: "scatter", mode: "markers",
      x: hike.map((k) => k + "-01"),
      y: hike.map((k) => yAtHi.get(k) ?? yAtF.get(k)),
      name: "hike",
      text: actionTips("hike", hike),
      hoverinfo: "text",
      marker: { color: "#39ff14", size: 8, symbol: "triangle-up" },
    });
    traces.push({
      type: "scatter", mode: "markers",
      x: cut.map((k) => k + "-01"),
      y: cut.map((k) => yAtHi.get(k) ?? yAtF.get(k)),
      name: "cut",
      text: actionTips("cut", cut),
      hoverinfo: "text",
      marker: { color: "#ff2bd6", size: 8, symbol: "triangle-down" },
    });
    await Plotly.newPlot("fed-fomc", traces, {
      paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
      font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
      margin: { l: 48, r: 16, t: 28, b: 36 }, height: 360,
      showlegend: true,
      legend: {
        font: { size: 10, color: "#9fb3c8" },
        bgcolor: "rgba(7,8,12,0.55)",
        orientation: "h", x: 0, y: 1.02,
      },
      xaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
      yaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false, title: "%" },
    }, { responsive: true, displaylogo: false });
  }

  const hoverSpec = {
    amt,
    funds: fundsMap,
    target: hiMap,
  };
  await plotGap("fed-pi", pi, "#ff2bd6", hike, cut,
    Object.assign({ label: "PCE yoy − 2%" }, hoverSpec));
  await plotGap("fed-u", emp, "#00f0ff", hike, cut,
    Object.assign({ label: "NROU − UNRATE" }, hoverSpec));
  await plotGap("fed-tp", tp, "#c4a35a", hike, cut,
    Object.assign({ label: "ACM 10y TP" }, hoverSpec));
}

main().catch((e) => {
  const s = document.getElementById("stamp");
  if (s) s.innerHTML = `<span class="err">${e.message}</span>`;
});
