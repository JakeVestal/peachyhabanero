const DATA = "data/published/cubes.json";

const ZONE_FALLBACK = {
  debt_gdp_warn: 100,
  debt_gdp_death: 140,
  int_rec_warn: 20,
  int_rec_death: 30,
  int_tax_warn: 25,
  int_tax_death: 40,
  refi_gap_warn: 0.75,
  refi_gap_death: 1.0,
};

function znum(zone, key) {
  const v = Number(zone && zone[key]);
  return Number.isFinite(v) ? v : ZONE_FALLBACK[key];
}

function wire(xmin, xmax, ymin, ymax, zmin, zmax, color, name, width) {
  const edges = [
    [[xmin, ymin, zmin], [xmax, ymin, zmin]],
    [[xmax, ymin, zmin], [xmax, ymax, zmin]],
    [[xmax, ymax, zmin], [xmin, ymax, zmin]],
    [[xmin, ymax, zmin], [xmin, ymin, zmin]],
    [[xmin, ymin, zmax], [xmax, ymin, zmax]],
    [[xmax, ymin, zmax], [xmax, ymax, zmax]],
    [[xmax, ymax, zmax], [xmin, ymax, zmax]],
    [[xmin, ymax, zmax], [xmin, ymin, zmax]],
    [[xmin, ymin, zmin], [xmin, ymin, zmax]],
    [[xmax, ymin, zmin], [xmax, ymin, zmax]],
    [[xmax, ymax, zmin], [xmax, ymax, zmax]],
    [[xmin, ymax, zmin], [xmin, ymax, zmax]],
  ];
  const xs = [], ys = [], zs = [];
  edges.forEach(([a, b]) => {
    xs.push(a[0], b[0], null);
    ys.push(a[1], b[1], null);
    zs.push(a[2], b[2], null);
  });
  return {
    type: "scatter3d", mode: "lines",
    x: xs, y: ys, z: zs,
    line: { color, width: width || 4 },
    name, hoverinfo: "skip",
  };
}

function axis3d(title) {
  return {
    title,
    backgroundcolor: "rgba(0,0,0,0)",
    showbackground: false,
    showgrid: false,
    showline: true,
    linecolor: "rgba(196,163,90,0.45)",
    zeroline: false,
    ticks: "outside",
    color: "#c8d6e5",
  };
}

function layout3d(title, xt, yt, zt, ranges) {
  const scene = {
    xaxis: Object.assign(axis3d(xt), ranges ? { range: ranges.x } : {}),
    yaxis: Object.assign(axis3d(yt), ranges ? { range: ranges.y } : {}),
    zaxis: Object.assign(axis3d(zt), ranges ? { range: ranges.z } : {}),
    aspectmode: "cube",
    bgcolor: "#07080c",
    camera: {
      up: { x: 0, y: 0, z: 1 },
      center: { x: 0, y: 0, z: -0.12 },
      eye: { x: -1.55, y: -1.55, z: 0.95 },
    },
  };

  return {
    title: { text: title, font: { color: "#00f0ff", size: 14 } },
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#07080c",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace" },
    scene,
    legend: {
      font: { size: 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.55)",
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 1.12,
      yanchor: 'bottom'
    },
    margin: { l: 0, r: 0, t: 48, b: 72 },
    height: 720,
    uirevision: "keep-camera",
  };
}

function keepCamera(id, layout) {
  const gd = document.getElementById(id);
  const cam = gd && gd.layout && gd.layout.scene && gd.layout.scene.camera;
  if (cam) layout.scene.camera = cam;
  return layout;
}

function armCubeScroll(id) {
  const plot = document.getElementById(id);
  if (!plot || plot.dataset.scrollArmed === "1") return;
  plot.dataset.scrollArmed = "1";
  const wrap = plot.closest(".cube-wrap") || plot.parentElement;
  wrap.classList.add("cube-wrap");

  plot.addEventListener("wheel", (e) => {
    e.stopImmediatePropagation();
  }, { capture: true, passive: true });

  let shield = wrap.querySelector(".cube-shield");
  if (!shield) {
    shield = document.createElement("button");
    shield.type = "button";
    shield.className = "cube-shield";
    shield.setAttribute("aria-label", "Click to rotate the cube. Scroll still moves the page.");
    shield.innerHTML = "<span>click to rotate</span>";
    wrap.appendChild(shield);
  }

  const lock = () => wrap.classList.remove("is-live");
  const unlock = () => wrap.classList.add("is-live");
  shield.addEventListener("click", (e) => {
    e.preventDefault();
    unlock();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.classList.contains("is-live")) return;
    if (wrap.contains(e.target)) return;
    lock();
  });
}

function win(vals) {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return [-0.2, 1];
  const lo = Math.min(s[Math.floor(s.length * 0.02)], 0);
  const hi = Math.max(s[Math.min(s.length - 1, Math.floor(s.length * 0.98))], 0.6);
  const room = hi > lo ? hi - lo : 1;
  return [lo - 0.15 * room, hi + 0.15 * room];
}

function winAll(vals) {
  const s = vals.filter((v) => Number.isFinite(v));
  if (!s.length) return [-0.2, 1];
  const lo = Math.min(...s, 0);
  const hi = Math.max(...s, 0.6);
  const room = hi > lo ? hi - lo : 1;
  return [lo - 0.08 * room, hi + 0.08 * room];
}

function sustainTraces(rows, zone, burden) {
  const ycol = burden === "tax" ? "int_tax_pct" : "int_rec_pct";
  const ywarn = znum(zone, burden === "tax" ? "int_tax_warn" : "int_rec_warn");
  const ydeath = znum(zone, burden === "tax" ? "int_tax_death" : "int_rec_death");
  const xwarn = znum(zone, "debt_gdp_warn");
  const xdeath = znum(zone, "debt_gdp_death");
  const zwarn = znum(zone, "refi_gap_warn");
  const zdeath = znum(zone, "refi_gap_death");
  const stressCol = burden === "tax" ? "stress_tax" : "stress_rec";
  const distW = burden === "tax" ? "dist_warn_tax" : "dist_warn_rec";
  const distD = burden === "tax" ? "dist_death_tax" : "dist_death_rec";
  const hover = rows.map((r) =>
    `${r.date}<br>` +
    `debt/GDP ${Number(r.debt_gdp_pct).toFixed(1)}%<br>` +
    `int/rec ${Number(r.int_rec_pct).toFixed(1)}%  int/tax ${Number(r.int_tax_pct).toFixed(1)}%<br>` +
    `refi gap ${Number(r.refi_gap) >= 0 ? "+" : ""}${Number(r.refi_gap).toFixed(2)} pp<br>` +
    `dist_warn ${Number(r[distW]) >= 0 ? "+" : ""}${Number(r[distW]).toFixed(2)}  ` +
    `dist_death ${Number(r[distD]) >= 0 ? "+" : ""}${Number(r[distD]).toFixed(2)}<br>` +
    `stress ${Number(r[stressCol]).toFixed(2)} (color only; int/GDP sleeve is not an axis)`
  );
  const last = rows[rows.length - 1];
  const xmin = Math.min(0, ...rows.map((r) => Number(r.debt_gdp_pct)).filter(Number.isFinite));
  const xmax = Math.max(200, xdeath, ...rows.map((r) => r.debt_gdp_pct), 0) + 8;
  const ymin = Math.min(10, ...rows.map((r) => Number(r[ycol])).filter(Number.isFinite));
  const ymax = Math.max(ydeath + 8, ...rows.map((r) => r[ycol]), 0) + 3;
  const zmax = Math.max(5, zdeath, ...rows.map((r) => r.refi_gap), 0) + 0.4;
  const zmin = Math.min(-2, ...rows.map((r) => r.refi_gap), 0) - 0.3;
  const traces = [
    wire(xwarn, xmax, ywarn, ymax, zwarn, zmax, "#c4a35a", "Danger Zone", 5),
    wire(xdeath, xmax, ydeath, ymax, zdeath, zmax, "#ff2bd6", "Restructuring Zone", 5),
    {
      type: "scatter3d",
      x: rows.map((r) => r.debt_gdp_pct),
      y: rows.map((r) => r[ycol]),
      z: rows.map((r) => r.refi_gap),
      mode: "lines+markers",
      marker: {
        size: 4,
        color: rows.map((r) => r[stressCol]),
        colorscale: [[0, "#39ff14"], [0.45, "#ffbf00"], [1, "#ff2bd6"]],
        cmin: 0, cmax: 2.5,
        colorbar: {
          title: { text: "stress", side: "top", font: { size: 11, color: "#00f0ff" } },
          orientation: "h", x: 0.5, y: -0.08, xanchor: "center", yanchor: "top",
          len: 0.72, thickness: 14, tickfont: { size: 10, color: "#c8d6e5" },
        },
      },
      line: { color: "rgba(0,240,255,0.35)", width: 3 },
      text: hover, hoverinfo: "text", name: "path",
    },
    {
      type: "scatter3d",
      x: [last.debt_gdp_pct], y: [last[ycol]], z: [last.refi_gap],
      mode: "markers",
      marker: { size: 10, color: "#00f0ff", symbol: "diamond" },
      text: [hover[hover.length - 1]], hoverinfo: "text",
      name: `latest ${last.date}`,
    },
  ];
  return {
    traces,
    ranges: {
      x: [xmin, xmax],
      y: [ymin, ymax],
      z: [zmin, zmax],
    },
  };
}

function failTraces(rows, tax, showRates) {
  const f2key = tax ? "F2_tax" : "F2_rec";
  const f2 = rows.map((r) => r[f2key]);
  const nAdj = rows.filter((r) => Number.isFinite(Number(r.rate_adjust))).length;
  const hover = rows.map((r) => {
    const f2v = Number(r[f2key]);
    const inside = r.F1 > 0 && f2v > 0 && r.F3 > 0;
    const adj = Number(r.rate_adjust);
    const tgt = Number(r.target_end);
    let rateLine;
    if (!Number.isFinite(adj)) {
      rateLine = "FOMC Δ this quarter: missing — rerun --process (need DFEDTAR stitch)";
    } else {
      const tag = adj > 0 ? "hike" : adj < 0 ? "cut" : "hold";
      const sign = adj > 0 ? "+" : "";
      const tgtBit = Number.isFinite(tgt) ? `  target ${tgt.toFixed(2)}%` : "";
      rateLine = `FOMC Δ this quarter: ${sign}${adj.toFixed(2)} pp (${tag})${tgtBit}`;
    }
    return (
      `${inside ? "<b>INSIDE</b> " : ""}${r.date}<br>` +
      `F1=${Number(r.F1).toFixed(2)}  F2=${f2v.toFixed(2)}  F3=${Number(r.F3).toFixed(2)}<br>` +
      `funds−stock ${Number(r.funds_minus_stock).toFixed(3)} pp  (F1>0 ⇒ funds ≤ book)<br>` +
      `int/rec ${Number(r.int_rec_pct).toFixed(2)}%  int/tax ${Number(r.int_tax_pct).toFixed(2)}%<br>` +
      `primary/GDP ${Number(r.primary_deficit_pct_gdp).toFixed(2)}%<br>` +
      rateLine
    );
  });
  const last = rows[rows.length - 1];
  const w1 = winAll(rows.map((r) => r.F1));
  const w2 = winAll(f2);
  const w3 = winAll(rows.map((r) => r.F3));
  const lo = Math.min(w1[0], w2[0], w3[0]);
  const hi = Math.max(w1[1], w2[1], w3[1]);

  function kind(r) {
    if (!showRates) return "hold";
    const v = Number(r.rate_adjust);
    if (!Number.isFinite(v) || v === 0) return "hold";
    return v > 0 ? "hike" : "cut";
  }
  function isIn(r) {
    return r.F1 > 0 && Number(r[f2key]) > 0 && r.F3 > 0;
  }

  const traces = [
    wire(0, hi, 0, hi, 0, hi, "#ff2bd6", "Fiscal Dominance Zone", 4),
    {
      type: "scatter3d",
      x: rows.map((r) => r.F3), y: f2, z: rows.map((r) => r.F1),
      mode: "lines",
      line: { color: "rgba(0,240,255,0.35)", width: 3 },
      hoverinfo: "skip",
      name: "path",
    },
  ];

  // scatter3d has no triangle-up/down. diamond / x plus a text glyph.
  const groups = [
    { k: "hold", inn: false, symbol: "circle", color: "#00f0ff", line: "#00f0ff", size: 5, glyph: "", name: "path", legend: !showRates },
    { k: "hold", inn: true, symbol: "circle", color: "rgba(0,240,255,0.12)", line: "#ff2bd6", size: 7, glyph: "", name: "inside", legend: true },
    { k: "hike", inn: false, symbol: "diamond", color: "#39ff14", line: "#39ff14", size: 14, glyph: "▲", name: "hike", legend: showRates },
    { k: "hike", inn: true, symbol: "diamond", color: "rgba(57,255,20,0.2)", line: "#ff2bd6", size: 15, glyph: "▲", name: "hike inside", legend: false },
    { k: "cut", inn: false, symbol: "diamond", color: "#ff4d4d", line: "#ff4d4d", size: 14, glyph: "▼", name: "cut", legend: showRates },
    { k: "cut", inn: true, symbol: "diamond", color: "rgba(255,77,77,0.2)", line: "#ff2bd6", size: 15, glyph: "▼", name: "cut inside", legend: false },
  ];
  groups.forEach((g) => {
    if (!showRates && g.k !== "hold") return;
    const idx = [];
    rows.forEach((r, i) => {
      if (kind(r) === g.k && isIn(r) === g.inn) idx.push(i);
    });
    if (!idx.length) return;
    const useText = Boolean(g.glyph);
    traces.push({
      type: "scatter3d",
      x: idx.map((i) => rows[i].F3),
      y: idx.map((i) => Number(rows[i][f2key])),
      z: idx.map((i) => rows[i].F1),
      mode: useText ? "markers+text" : "markers",
      marker: {
        size: g.size,
        color: g.color,
        symbol: g.symbol,
        line: { color: g.line, width: g.inn ? 3 : 2 },
      },
      text: useText ? idx.map(() => g.glyph) : idx.map((i) => hover[i]),
      hovertext: idx.map((i) => hover[i]),
      hovertemplate: "%{hovertext}<extra></extra>",
      textfont: useText ? { size: 16, color: g.line, family: "IBM Plex Mono, sans-serif" } : undefined,
      name: g.name,
      showlegend: g.legend,
    });
  });

  traces.push({
    type: "scatter3d",
    x: [last.F3], y: [last[f2key]], z: [last.F1],
    mode: "markers",
    marker: {
      size: 11,
      color: "#00f0ff",
      symbol: "diamond",
      line: { color: isIn(last) ? "#ff2bd6" : "#00f0ff", width: isIn(last) ? 3 : 1 },
    },
    hovertext: [hover[hover.length - 1]],
    hovertemplate: "%{hovertext}<extra></extra>",
    name: `latest ${last.date}`,
  });
  return { traces, lo, hi, nAdj };
}

function drawDist(el, rows, tax) {
  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const traces = [
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_warn_tax), name: "Danger (tax)", line: { color: gold, width: 2.5 }, type: "scatter", mode: "lines", visible: tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_death_tax), name: "Restructuring (tax)", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_warn_rec), name: "Danger (receipts)", line: { color: gold, width: 2.5 }, type: "scatter", mode: "lines", visible: !tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_death_rec), name: "Restructuring (receipts)", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: !tax },
  ];
  const node = document.getElementById(el);
  const w = node ? Math.round(node.getBoundingClientRect().width) : 0;
  return Plotly.newPlot(el, traces, {
    title: { text: "Score-space distance. 1 = danger face, 2 = restructure face.", font: { size: 14, color: "#00f0ff" } },
    paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 48, r: 16, t: 44, b: 36 },
    autosize: true,
    height: 340,
    width: w || undefined,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(232,246,255,0.35)", width: 1, dash: "dot" } }],
    legend: {
      font: { size: 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.55)",
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: 0.95,
      yanchor: "bottom",
    },
  }, { responsive: true, displaylogo: false });
}

function signedDistOctant(f1, f2, f3) {
  const d = [Number(f1), Number(f2), Number(f3)];
  if (d.some((v) => !Number.isFinite(v))) return null;
  const short = d.map((v) => Math.max(0, -v));
  if (short.some((v) => v > 0)) return Math.hypot(short[0], short[1], short[2]);
  return -Math.min(d[0], d[1], d[2]);
}

function drawFdDist(el, rows, tax) {
  const mag = "#ff2bd6";
  const rec = rows.map((r) => signedDistOctant(r.F1, r.F2_rec, r.F3));
  const tx = rows.map((r) => signedDistOctant(r.F1, r.F2_tax, r.F3));
  const xs = rows.map((r) => r.date);
  const traces = [
    { x: xs, y: tx, name: "distance (tax)", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: tax },
    { x: xs, y: rec, name: "distance (receipts)", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: !tax },
  ];
  const node = document.getElementById(el);
  const w = node ? Math.round(node.getBoundingClientRect().width) : 0;
  return Plotly.newPlot(el, traces, {
    title: { text: "σ-space distance. 0 = face of the fiscal-dominance octant.", font: { size: 14, color: "#00f0ff" } },
    paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 48, r: 16, t: 44, b: 36 },
    autosize: true,
    height: 340,
    width: w || undefined,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: mag, width: 1, dash: "dot" } }],
    legend: {
      font: { size: 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.55)",
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: 0.95,
      yanchor: "bottom",
    },
  }, { responsive: true, displaylogo: false });
}


function hline(y, color) {
  return {
    type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
    line: { color, width: 1.5, dash: "dot" },
  };
}

function drawRawAxis(el, rows, col, title, color, wires) {
  const xs = [], ys = [];
  rows.forEach((r) => {
    const v = Number(r[col]);
    if (!Number.isFinite(v)) return;
    xs.push(r.date);
    ys.push(v);
  });
  const node = document.getElementById(el);
  if (!node) return;
  if (!xs.length) {
    node.innerHTML = `<p class="err">no ${col}</p>`;
    return;
  }
  const box = node;
  const cs = window.getComputedStyle(box);
  const w = Math.round(box.clientWidth || parseFloat(cs.width)) || 680;
  const h = Math.round(box.clientHeight || parseFloat(cs.height)) || 340;
  return Plotly.newPlot(el, [{
    type: "scatter", mode: "lines",
    x: xs, y: ys, name: col,
    line: { color, width: 2 },
  }], {
    title: { text: title, font: { color: "#00f0ff", size: 12 } },
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 10 },
    margin: { l: 44, r: 16, t: 36, b: 28 },
    autosize: true,
    height: h,
    width: w,
    showlegend: false,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    shapes: wires || [],
  }, { responsive: true, displaylogo: false, staticPlot: false });
}

function drawSixAxes(sus, fail, zone, tax) {
  fail = sus;
  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const tillCol = tax ? "int_tax_pct" : "int_rec_pct";
  const tillWarn = tax ? zone.int_tax_warn : zone.int_rec_warn;
  const tillDeath = tax ? zone.int_tax_death : zone.int_rec_death;
  const tillName = tax ? "int / tax (%)" : "int / receipts (%)";
  drawRawAxis("ax-1", sus, tillCol, `${tillName}`, "#00f0ff",
    [hline(tillWarn, gold), hline(tillDeath, mag)]);
  drawRawAxis("ax-2", sus, "refi_gap", "refi gap (pp)", "#ffbf00",
    [hline(zone.refi_gap_warn, gold), hline(zone.refi_gap_death, mag)]);
  drawRawAxis("ax-3", sus, "debt_gdp_pct", "debt public / GDP (%)", "#7aa2ff",
    [hline(zone.debt_gdp_warn, gold), hline(zone.debt_gdp_death, mag)]);
  const f2col = tax ? "F2_tax" : "F2_rec";
  const f2name = tax ? "F2  y(int/tax − 25%)" : "F2  y(int/receipts − 20%)";
  drawRawAxis("ax-4", sus, f2col, f2name, "#00f0ff",
    [hline(0, mag)]);
  drawRawAxis("ax-5", sus, "F1", "F1  y(funds − book)  flipped", "#39ff14",
    [hline(0, mag)]);
  drawRawAxis("ax-6", sus, "F3", "F3  y(primary / GDP)", "#ff6b4a",
    [hline(0, mag)]);
}

function $(id) {
  return document.getElementById(id);
}

async function main() {
  const stamp = $("stamp");
  const wantSus = Boolean($("cube-sustain"));
  const wantFail = Boolean($("cube-fail"));
  const res = await fetch(DATA);
  if (!res.ok) {
    if (stamp) stamp.innerHTML = `<span class="err">${res.status} cubes.json — run python scripts/build_site_data.py --process</span>`;
    return;
  }
  const pack = await res.json();
  const zone = pack.zone;
  const sus = (pack.sustain || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fail = (pack.fail || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if ((wantSus && !sus.length) || (wantFail && !fail.length) || (!wantSus && !wantFail && !sus.length)) {
    if (stamp) stamp.innerHTML = `<span class="err">cubes.json is empty — rerun --process after a fetch</span>`;
    return;
  }
  const ls = (sus.length ? sus : fail)[(sus.length ? sus : fail).length - 1];
  if (!zone) {
    if (stamp) stamp.innerHTML = `<span class="err">cubes.json missing zone — rerun --process</span>`;
    return;
  }
  if (stamp) {
    stamp.innerHTML =
        `<b>Latest data point: ${ls.date}</b><br>` +
        `New points become available when BEA prints quarterly GDP.`;
  }

  const opts = { responsive: true, displaylogo: false };
  let tax = false;
  let showRates = false;

  function sustainLayout(burden) {
    return layout3d(
      `Sustainability Cube`,
      "Debt held by public / GDP (%)",
      burden === "tax" ? "Interest / tax (%)" : "Interest / receipts (%)",
      "Refi gap  (marginal − stock, pp)"
    );
  }

  async function drawSustain() {
    if (!$("cube-sustain") || !sus.length) return;
    const drawn = sustainTraces(sus, zone, tax ? "tax" : "rec");
    const layout = keepCamera(
      "cube-sustain",
      layout3d(
        "Sustainability Cube",
        "Debt held by public / GDP (%)",
        tax ? "Interest / tax (%)" : "Interest / receipts (%)",
        "Refi gap  (marginal − stock, pp)",
        drawn.ranges
      )
    );
    await Plotly.react("cube-sustain", drawn.traces, layout, opts);
    armCubeScroll("cube-sustain");
  }

  async function drawFail() {
    if (!$("cube-fail") || !fail.length) return;
    const ft = failTraces(fail, tax, showRates);
    const note = $("rate-note");
    if (note) {
      if (showRates && !ft.nAdj) {
        note.innerHTML = `<span class="err">rate decisions on, but cubes.json has no rate_adjust — the published JSON is stale. Push src/cube_data.py + scripts/build_site_data.py and rerun nightly (fetch + process).</span>`;
      } else if (showRates) {
        note.textContent = `FOMC net Δ by quarter (${ft.nAdj} quarters with a print). Green ▲ hike, red ▼ cut, cyan hold. Magenta outline = inside the box.`;
      } else {
        note.textContent = "";
      }
    }
    const f2title = tax
        ? "F2  y(interest / tax − 25%)"
        : "F2  y(interest / receipts − 20%)";
    const layout = keepCamera("cube-fail", layout3d(
      "Fiscal Dominance Cube",
      "F3  y(primary / GDP)",
      f2title,
      "F1  y(funds − stock)",
      { x: [ft.lo, ft.hi], y: [ft.lo, ft.hi], z: [ft.lo, ft.hi] }
    ));
    // scatter3d + Plotly.react updates the legend but keeps the old WebGL points.
    Plotly.purge("cube-fail");
    await Plotly.newPlot("cube-fail", ft.traces, layout, opts);
    armCubeScroll("cube-fail");
  }

  await drawFail();
  await drawSustain();
  if ($("dist-plot") && sus.length) await drawDist("dist-plot", sus, tax);
  if ($("fd-dist-plot") && fail.length) await drawFdDist("fd-dist-plot", fail, tax);
  drawSixAxes(sus, fail, zone, tax);

  function setBurden(next) {
    tax = next;
    const btnTax = $("btn-tax");
    const btnRec = $("btn-rec");
    if (btnTax) btnTax.classList.toggle("active", tax);
    if (btnRec) btnRec.classList.toggle("active", !tax);
    drawSustain();
    drawFail();
    drawSixAxes(sus, fail, zone, tax);
    if ($("dist-plot")) {
      try {
        Plotly.restyle("dist-plot", { visible: tax ? [true, true, false, false] : [false, false, true, true] });
      } catch (e) { /* plot not on this page */ }
    }
    if ($("fd-dist-plot")) {
      try {
        Plotly.restyle("fd-dist-plot", { visible: tax ? [true, false] : [false, true] });
      } catch (e) { /* plot not on this page */ }
    }
  }
  if ($("btn-tax")) $("btn-tax").onclick = () => setBurden(true);
  if ($("btn-rec")) $("btn-rec").onclick = () => setBurden(false);
  const rateTog = $("tog-rates");
  if (rateTog) {
    showRates = Boolean(rateTog.checked);
    rateTog.addEventListener("change", () => {
      showRates = Boolean(rateTog.checked);
      drawFail();
    });
  }
}

main().catch((err) => {
  const stamp = document.getElementById("stamp");
  if (stamp) stamp.innerHTML = `<span class="err">${err.message}</span>`;
  else console.error(err);
});
