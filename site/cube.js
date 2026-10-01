const DATA = "data/published/cubes.json";
const ZONE_CSV = "data/zone.csv";
const NOWCAST = "data/published/nowcast.json";

const SUS_ZONE_KEYS = [
  "debt_gdp_warn", "debt_gdp_restruct",
  "int_rec_warn", "int_rec_restruct",
  "int_tax_warn", "int_tax_restruct",
  "refi_gap_warn", "refi_gap_restruct",
];
const FD_ZONE_KEYS = [
  "int_gf_warn", "int_gf_restruct",
];
const ZONE_KEYS = SUS_ZONE_KEYS.concat(FD_ZONE_KEYS);

function znum(zone, key) {
  const v = Number(zone && zone[key]);
  if (!Number.isFinite(v)) {
    throw new Error("zone." + key + " missing — refusing to draw a guessed wire");
  }
  return v;
}

function zoneMissing(zone, keys) {
  const need = keys || ZONE_KEYS;
  if (!zone) return need.slice();
  return need.filter((k) => !Number.isFinite(Number(zone[k])));
}

function parseZoneCsv(text) {
  const out = {};
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    if (i === 0 && /^key\s*,/i.test(t)) return;
    const comma = t.indexOf(",");
    if (comma < 0) return;
    const k = t.slice(0, comma).trim();
    const v = Number(t.slice(comma + 1).trim());
    if (k && Number.isFinite(v)) out[k] = v;
  });
  return out;
}

function fmtNow(v, n) {
  return Number.isFinite(v) ? v.toFixed(n) : "n/a";
}

function nowcastHover(nc) {
  if (!nc) return "";
  const src = nc.nipa_source || nc.model || "Gemini";
  return (
    `<b>Gemini guess ${nc.quarter_end}</b> — not a BEA print, not a trade<br>` +
    `An AI look at the next quarter. Often wrong. Sometimes amusing.<br>` +
    `nipa: ${src}<br>` +
    `debt/GDP ${fmtNow(Number(nc.debt_gdp_pct), 1)}%  ` +
    `int/rec ${fmtNow(Number(nc.int_rec_pct), 1)}%  int/tax ${fmtNow(Number(nc.int_tax_pct), 1)}%<br>` +
    `refi ${Number(nc.refi_gap) >= 0 ? "+" : ""}${fmtNow(Number(nc.refi_gap), 2)} pp  ` +
    `funds−coupon ${fmtNow(Number(nc.funds_minus_stock), 2)}<br>` +
    `F1 ${fmtNow(Number(nc.F1), 2)}  F2 ${fmtNow(Number(nc.F2), 2)}  F3 ${fmtNow(Number(nc.F3), 2)}`
  );
}

function glowDot3d(x, y, z, opt) {
  const hover = opt.hover || "";
  const tpl = opt.hovertemplate;
  return [
    {
      type: "scatter3d",
      x: [x], y: [y], z: [z],
      mode: "markers",
      marker: {
        size: opt.glow,
        color: opt.fill,
        symbol: "circle",
        opacity: opt.glowOpacity == null ? 0.2 : opt.glowOpacity,
        line: { width: 0 },
      },
      hoverinfo: "skip",
      showlegend: false,
      name: `${opt.name} glow`,
    },
    {
      type: "scatter3d",
      x: [x], y: [y], z: [z],
      mode: opt.label ? "markers+text" : "markers",
      marker: {
        size: opt.size,
        color: opt.fill,
        symbol: opt.symbol || "diamond",
        line: { color: opt.line, width: opt.lineWidth },
      },
      text: opt.label ? [opt.label] : undefined,
      textposition: "top center",
      textfont: { color: "#c4a35a", size: 11, family: "IBM Plex Mono, ui-monospace, monospace" },
      hoverinfo: "text",
      hovertext: [hover],
      hovertemplate: tpl || undefined,
      name: opt.name,
    },
  ];
}

function nowcastSusTrace(nc, tax) {
  if (!nc) return [];
  const y = Number(tax ? nc.int_tax_pct : nc.int_rec_pct);
  const x = Number(nc.debt_gdp_pct);
  const z = Number(nc.refi_gap);
  if (![x, y, z].every(Number.isFinite)) return [];
  return glowDot3d(x, y, z, {
    fill: "#c4a35a",
    line: "#ffbf00",
    lineWidth: 3,
    size: 8,
    glow: 16,
    glowOpacity: 0.28,
    hover: nowcastHover(nc),
    name: `Gemini guess ${nc.quarter_end}`,
    label: "Gemini guess",
    symbol: "diamond",
  });
}

function nowcastFailTrace(nc) {
  if (!nc) return [];
  const x = Number(nc.F3), y = Number(nc.F2), z = Number(nc.F1);
  if (![x, y, z].every(Number.isFinite)) return [];
  return glowDot3d(x, y, z, {
    fill: "#c4a35a",
    line: "#ffbf00",
    lineWidth: 3,
    size: 8,
    glow: 16,
    glowOpacity: 0.28,
    hover: nowcastHover(nc),
    hovertemplate: "%{hovertext}<extra></extra>",
    name: `Gemini guess ${nc.quarter_end}`,
    label: "Gemini guess",
    symbol: "diamond",
  });
}

function fdLatestFill(r, showRates) {
  if (!showRates) return "rgba(0,240,255,0.9)";
  const k = rateKind(r);
  if (k === "hike") return "rgba(57,255,20,0.9)";
  if (k === "cut") return "rgba(255,77,77,0.9)";
  if (k === "missing") return "rgba(127,147,166,0.9)";
  return "rgba(0,240,255,0.9)";
}

function octantDist(values, wires) {
  const v = values.map(Number);
  const w = wires.map(Number);
  if (v.some((x) => !Number.isFinite(x)) || w.some((x) => !Number.isFinite(x))) return null;
  const delta = v.map((x, i) => x - w[i]);
  const short = delta.map((x) => Math.max(0, -x));
  if (short.some((x) => x > 0)) return Math.hypot(short[0], short[1], short[2]);
  return -Math.min(delta[0], delta[1], delta[2]);
}

function boxDistScene(point, boxLo, boxHi, scene) {
  const u = point.map((v, i) => (Number(v) - scene.origin[i]) / scene.span[i]);
  const lo = boxLo.map((v, i) => (Number(v) - scene.origin[i]) / scene.span[i]);
  const hi = boxHi.map((v, i) => (Number(v) - scene.origin[i]) / scene.span[i]);
  if (u.some((v) => !Number.isFinite(v)) || lo.some((v) => !Number.isFinite(v)) || hi.some((v) => !Number.isFinite(v))) {
    return null;
  }
  const clamped = u.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  const outside = u.some((v, i) => v < lo[i] || v > hi[i]);
  if (outside) return Math.hypot(u[0] - clamped[0], u[1] - clamped[1], u[2] - clamped[2]);
  let face = Infinity;
  for (let i = 0; i < 3; i++) face = Math.min(face, u[i] - lo[i], hi[i] - u[i]);
  return -face;
}

// Same axis limits the sustainability cube draws. aspectmode "cube" stretches
// those three spans to one length, so distance has to be measured there.
function susScene(rows, zone, burden, nc) {
  const ycol = burden === "tax" ? "int_tax_pct" : "int_rec_pct";
  const ydeath = znum(zone, burden === "tax" ? "int_tax_restruct" : "int_rec_restruct");
  const xdeath = znum(zone, "debt_gdp_restruct");
  const zdeath = znum(zone, "refi_gap_restruct");
  const xs = rows.map((r) => Number(r.debt_gdp_pct)).filter(Number.isFinite);
  const ys = rows.map((r) => Number(r[ycol])).filter(Number.isFinite);
  const zs = rows.map((r) => Number(r.refi_gap)).filter(Number.isFinite);
  let xmin = Math.min(0, ...xs);
  let xmax = Math.max(200, xdeath || 0, ...xs, 0) + 8;
  let ymin = Math.min(10, ...ys);
  let ymax = Math.max((ydeath || 0) + 8, ...ys, 0) + 3;
  let zmax = Math.max(5, zdeath || 0, ...zs, 0) + 0.4;
  let zmin = Math.min(-2, ...zs, 0) - 0.3;
  if (nc) {
    const nx = Number(nc.debt_gdp_pct);
    const ny = Number(burden === "tax" ? nc.int_tax_pct : nc.int_rec_pct);
    const nz = Number(nc.refi_gap);
    if (Number.isFinite(nx)) { xmin = Math.min(xmin, nx); xmax = Math.max(xmax, nx); }
    if (Number.isFinite(ny)) { ymin = Math.min(ymin, ny); ymax = Math.max(ymax, ny); }
    if (Number.isFinite(nz)) { zmin = Math.min(zmin, nz); zmax = Math.max(zmax, nz); }
  }
  const span = [xmax - xmin, ymax - ymin, zmax - zmin];
  if (span.some((s) => !Number.isFinite(s) || s <= 0)) return null;
  return { origin: [xmin, ymin, zmin], span, max: [xmax, ymax, zmax], ycol };
}

function susDist(r, zone, burden, face, scene) {
  if (!r || !zone || !scene) return null;
  const till = Number(burden === "tax" ? r.int_tax_pct : r.int_rec_pct);
  const re = face === "restruct";
  const wTill = burden === "tax"
    ? (re ? zone.int_tax_restruct : zone.int_tax_warn)
    : (re ? zone.int_rec_restruct : zone.int_rec_warn);
  return boxDistScene(
    [r.debt_gdp_pct, till, r.refi_gap],
    [
      re ? zone.debt_gdp_restruct : zone.debt_gdp_warn,
      wTill,
      re ? zone.refi_gap_restruct : zone.refi_gap_warn,
    ],
    scene.max,
    scene
  );
}

function fdScene(rows, nc) {
  const w1 = winAll((rows || []).map((r) => Number(r.F1)));
  const w2 = winAll((rows || []).map((r) => Number(r.F2)));
  const w3 = winAll((rows || []).map((r) => Number(r.F3)));
  let lo = Math.min(w1[0], w2[0], w3[0]);
  let hi = Math.max(w1[1], w2[1], w3[1]);
  if (nc) {
    [nc.F1, nc.F2, nc.F3].forEach((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    });
  }
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return null;
  // Plot axes are x = F3, y = F2, z = F1, and all three share [lo, hi].
  return {
    origin: [lo, lo, lo],
    span: [span, span, span],
    max: [hi, hi, hi],
    lo,
    hi,
  };
}

function fdDist(r, scene) {
  if (!r || !scene) return null;
  const f1 = num(r, "F1");
  const f2 = num(r, "F2");
  const f3 = num(r, "F3");
  if (f1 == null || f2 == null || f3 == null) return null;
  return boxDistScene([f3, f2, f1], [0, 0, 0], scene.max, scene);
}

function deepestHike(rows, scene) {
  let best = null;
  (rows || []).forEach((r) => {
    if (rateKind(r) !== "hike") return;
    const d = fdDist(r, scene);
    if (!Number.isFinite(d)) return;
    if (!best || d < best.d) best = { row: r, d, date: String(r.date).slice(0, 10) };
  });
  return best;
}

function nowcastGhost1d(nc, x, y, extra, color, opt) {
  if (!nc || x == null || x === "" || !Number.isFinite(Number(y))) return [];
  opt = opt || {};
  const fill = color || "#c4a35a";
  const vis = opt.visible == null ? true : opt.visible;
  const group = opt.legendgroup || undefined;
  const hover = nowcastHover(nc) + (extra ? `<br>${extra}` : "");
  return [
    {
      type: "scatter",
      mode: "markers",
      x: [x], y: [y],
      name: `Gemini guess ${nc.quarter_end} glow`,
      hoverinfo: "skip",
      showlegend: false,
      legendgroup: group,
      visible: vis,
      marker: { size: 22, color: fill, symbol: "diamond", opacity: 0.22, line: { width: 0 } },
    },
    {
      type: "scatter",
      mode: "markers+text",
      x: [x], y: [y],
      name: opt.legendName || `Gemini guess ${nc.quarter_end}`,
      text: ["Gemini guess"],
      textposition: "top center",
      textfont: { color: "#c4a35a", size: 10, family: "IBM Plex Mono, ui-monospace, monospace" },
      hovertext: [hover],
      hoverinfo: "text",
      showlegend: opt.showLegend !== false,
      legendgroup: group,
      visible: vis,
      marker: { size: 9, color: fill, symbol: "diamond", line: { color: "#ffbf00", width: 3 } },
    },
  ];
}

function flagMissing(el, msg) {
  if (!el) return;
  el.innerHTML = `<p class="err" style="border:2px solid #ff2bd6;padding:12px;color:#ff2bd6;font-size:15px">${msg}</p>`;
}

// Number(null) === 0 in JS — missing FOMC Δ must never look like a hold.
function rateAdj(r) {
  if (r == null || r.rate_adjust == null || r.rate_adjust === "") return null;
  const v = Number(r.rate_adjust);
  return Number.isFinite(v) ? v : null;
}
function rateKind(r) {
  const v = rateAdj(r);
  if (v == null) return "missing";
  if (v === 0) return "hold";
  return v > 0 ? "hike" : "cut";
}

function num(r, key) {
  const v = Number(r && r[key]);
  return Number.isFinite(v) ? v : null;
}

// Same test the cube, the path color, and the tally card must all use.
function isInside(r, f2key) {
  const a = num(r, "F1");
  const b = num(r, f2key);
  const c = num(r, "F3");
  if (a == null || b == null || c == null) return false;
  return a > 0 && b > 0 && c > 0;
}

function wire(xmin, xmax, ymin, ymax, zmin, zmax, color, name, width, dashed) {
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
  // scatter3d ignores line.dash — break each edge into on/off segments.
  const segs = dashed ? 10 : 1;
  edges.forEach(([a, b]) => {
    for (let i = 0; i < segs; i++) {
      if (dashed && i % 2) continue;
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      xs.push(a[0] + (b[0] - a[0]) * t0, a[0] + (b[0] - a[0]) * t1, null);
      ys.push(a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1, null);
      zs.push(a[2] + (b[2] - a[2]) * t0, a[2] + (b[2] - a[2]) * t1, null);
    }
  });
  return {
    type: "scatter3d", mode: "lines",
    x: xs, y: ys, z: zs,
    line: { color, width: width || 4 },
    name, hoverinfo: "skip",
  };
}

function isNarrow() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

function axis3d(title) {
  const narrow = isNarrow();
  return {
    title: { text: title, font: { size: narrow ? 10 : 12 } },
    tickfont: { size: narrow ? 9 : 11 },
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
  const narrow = isNarrow();
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
    title: { text: title, font: { color: "#00f0ff", size: narrow ? 13 : 14 } },
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#07080c",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace" },
    scene,
    legend: {
      font: { size: narrow ? 9 : 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.72)",
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: narrow ? -0.08 : 1.12,
      yanchor: narrow ? "top" : "bottom",
    },
    margin: narrow ? { l: 0, r: 0, t: 36, b: 118 } : { l: 0, r: 0, t: 48, b: 72 },
    height: narrow ? 460 : 720,
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

function sustainTraces(rows, zone, burden, nc) {
  const scene = susScene(rows, zone, burden, nc);
  const ycol = scene.ycol;
  const ywarn = znum(zone, burden === "tax" ? "int_tax_warn" : "int_rec_warn");
  const ydeath = znum(zone, burden === "tax" ? "int_tax_restruct" : "int_rec_restruct");
  const xwarn = znum(zone, "debt_gdp_warn");
  const xdeath = znum(zone, "debt_gdp_restruct");
  const zwarn = znum(zone, "refi_gap_warn");
  const zdeath = znum(zone, "refi_gap_restruct");
  const stressCol = burden === "tax" ? "stress_tax" : "stress_rec";
  const [xmin, ymin, zmin] = scene.origin;
  const [xmax, ymax, zmax] = scene.max;
  const hover = rows.map((r) => {
    const dw = susDist(r, zone, burden, "warn", scene);
    const dd = susDist(r, zone, burden, "restruct", scene);
    const fmt = (v) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
    return (
      `${r.date}<br>` +
      `debt/GDP ${Number(r.debt_gdp_pct).toFixed(1)}%<br>` +
      `int/rec ${Number(r.int_rec_pct).toFixed(1)}%  int/tax ${Number(r.int_tax_pct).toFixed(1)}%<br>` +
      `refi gap ${Number(r.refi_gap) >= 0 ? "+" : ""}${Number(r.refi_gap).toFixed(2)} pp<br>` +
      `dist_warn ${fmt(dw)}  dist_restruct ${fmt(dd)}<br>` +
      `stress ${Number(r[stressCol]).toFixed(2)} (color only; int/GDP sleeve is not an axis)`
    );
  });
  const last = rows[rows.length - 1];
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
      connectgaps: false,
    },
  ];
  traces.push.apply(traces, glowDot3d(last.debt_gdp_pct, last[ycol], last.refi_gap, {
    fill: "#00f0ff",
    line: "#ffbf00",
    lineWidth: 4,
    size: 8,
    glow: 13,
    glowOpacity: 0.18,
    hover: hover[hover.length - 1],
    name: `latest ${last.date}`,
  }));
  traces.push.apply(traces, nowcastSusTrace(nc, burden === "tax"));
  return {
    traces,
    ranges: {
      x: [xmin, xmax],
      y: [ymin, ymax],
      z: [zmin, zmax],
    },
  };
}

function failTraces(rows, tax, showRates, nc, zone) {
  const f2key = "F2";
  const f2 = rows.map((r) => r[f2key]);
  const nAdj = rows.filter((r) => rateAdj(r) != null).length;
  const scene = fdScene(rows, nc);
  const lo = scene ? scene.lo : -0.2;
  const hi = scene ? scene.hi : 1;
  const hover = rows.map((r) => {
    const f2v = num(r, f2key);
    const inside = isInside(r, f2key);
    const adj = rateAdj(r);
    const tgt = Number(r.target_end);
    const d = fdDist(r, scene);
    const dBit = Number.isFinite(d) ? ((d >= 0 ? "+" : "") + d.toFixed(2)) : "n/a";
    let rateLine;
    if (adj == null) {
      rateLine = "FOMC Δ this quarter: missing — no print, not a hold";
    } else {
      const tag = adj > 0 ? "hike" : adj < 0 ? "cut" : "hold";
      const sign = adj > 0 ? "+" : "";
      const tgtBit = Number.isFinite(tgt) ? `  target ${tgt.toFixed(2)}%` : "";
      rateLine = `FOMC Δ this quarter: ${sign}${adj.toFixed(2)} pp (${tag})${tgtBit}`;
    }
    return (
      `${inside ? "<b>INSIDE</b> " : ""}${r.date}<br>` +
      `F1=${num(r, "F1") == null ? "n/a" : num(r, "F1").toFixed(2)}  F2=${f2v == null ? "n/a" : f2v.toFixed(2)}  F3=${num(r, "F3") == null ? "n/a" : num(r, "F3").toFixed(2)}<br>` +
      `distance ${dBit}<br>` +
      `funds−stock ${Number(r.funds_minus_stock).toFixed(3)} pp  (F1>0 ⇒ funds ≤ book)<br>` +
      `int/gf ${Number(r.int_gf_pct).toFixed(2)}%  int/rec ${Number(r.int_rec_pct).toFixed(2)}%  int/tax ${Number(r.int_tax_pct).toFixed(2)}%<br>` +
      `primary/GDP ${Number(r.primary_deficit_pct_gdp).toFixed(2)}%<br>` +
      rateLine
    );
  });
  const last = rows[rows.length - 1];

  function kind(r) {
    // Rates off: every finite F-space point is a location, not an FOMC claim.
    if (!showRates) return "hold";
    return rateKind(r);
  }

  const traces = [
    wire(0, hi, 0, hi, 0, hi, "#ff2bd6", "Fiscal Dominance Zone", 4),
  ];
  const recHit = deepestHike(rows, scene);
  const rec = recHit ? recHit.row : null;
  const recF1 = rec ? num(rec, "F1") : null;
  const recF2 = rec ? num(rec, f2key) : null;
  const recF3 = rec ? num(rec, "F3") : null;
  if (recF1 != null && recF2 != null && recF3 != null) {
    const recLabel = `${recHit.date} hike record`;
    traces.push(wire(recF3, hi, recF2, hi, recF1, hi, "#ff9ad8", recLabel, 5, true));
    traces.push({
      type: "scatter3d",
      x: [recF3], y: [recF2], z: [recF1],
      mode: "markers",
      marker: {
        size: 10,
        color: "#ff9ad8",
        symbol: "diamond",
        line: { color: "#ff2bd6", width: 2 },
      },
      hovertext: [
        `${recHit.date} — hike-record corner<br>` +
        `distance ${recHit.d.toFixed(2)}<br>` +
        `F1=${recF1.toFixed(2)}  F2=${recF2.toFixed(2)}  F3=${recF3.toFixed(2)}<br>` +
        `Lowest hike on the distance line. Not a wire.`
      ],
      hovertemplate: "%{hovertext}<extra></extra>",
      name: recLabel,
      showlegend: false,
    });
  }
  traces.push({
    type: "scatter3d",
    x: rows.map((r) => r.F3), y: f2, z: rows.map((r) => r.F1),
    mode: "lines",
    line: { color: "rgba(0,240,255,0.35)", width: 3 },
    hoverinfo: "skip",
    name: "path",
    connectgaps: false,
  });

  // scatter3d: circle only (diamonds read as slabs on WebGL/mobile).
  // Fill is the action color, ~50% opacity. Inside = magenta outline, never a magenta fill.
  const groups = [
    { k: "hold", inn: false, color: "rgba(0,240,255,0.45)", line: "rgba(0,240,255,0.25)", size: 4, name: "outside", legend: !showRates },
    { k: "hold", inn: true, color: "rgba(0,240,255,0.45)", line: "#ff2bd6", size: 5, name: "inside (hold)", legend: true },
    { k: "hike", inn: false, color: "rgba(57,255,20,0.50)", line: "rgba(57,255,20,0.25)", size: 4, name: "hike", legend: showRates },
    { k: "hike", inn: true, color: "rgba(57,255,20,0.50)", line: "#ff2bd6", size: 5, name: "hike inside", legend: false },
    { k: "cut", inn: false, color: "rgba(255,77,77,0.50)", line: "rgba(255,77,77,0.25)", size: 4, name: "cut", legend: showRates },
    { k: "cut", inn: true, color: "rgba(255,77,77,0.50)", line: "#ff2bd6", size: 5, name: "cut inside", legend: false },
    { k: "missing", inn: false, color: "rgba(127,147,166,0.45)", line: "rgba(127,147,166,0.25)", size: 4, name: "no FOMC print", legend: showRates },
    { k: "missing", inn: true, color: "rgba(127,147,166,0.45)", line: "#ff2bd6", size: 5, name: "no FOMC print inside", legend: false },
  ];
  const lastIdx = rows.length - 1;
  groups.forEach((g) => {
    if (!showRates && g.k !== "hold") return;
    const idx = [];
    rows.forEach((r, i) => {
      if (i === lastIdx) return;
      if (kind(r) === g.k && isInside(r, f2key) === g.inn) idx.push(i);
    });
    if (!idx.length) return;
    traces.push({
      type: "scatter3d",
      x: idx.map((i) => rows[i].F3),
      y: idx.map((i) => num(rows[i], f2key)),
      z: idx.map((i) => rows[i].F1),
      mode: "markers",
      marker: {
        size: g.size,
        color: g.color,
        symbol: "circle",
        opacity: 0.85,
        line: { color: g.line, width: g.inn ? 2 : 0.5 },
      },
      hovertext: idx.map((i) => hover[i]),
      hovertemplate: "%{hovertext}<extra></extra>",
      name: g.name,
      showlegend: g.legend,
    });
  });

  traces.push.apply(traces, glowDot3d(last.F3, last[f2key], last.F1, {
    fill: fdLatestFill(last, showRates),
    line: "#ffbf00",
    lineWidth: 4,
    size: 8,
    glow: 13,
    glowOpacity: 0.18,
    hover: hover[hover.length - 1],
    hovertemplate: "%{hovertext}<extra></extra>",
    name: `latest ${last.date}`,
  }));
  traces.push.apply(traces, nowcastFailTrace(nc));
  return { traces, lo, hi, nAdj, record: recHit, scene };
}

function insideCensus(rows, tax) {
  const f2key = "F2";
  const inside = rows.filter((r) => isInside(r, f2key));
  const hike = [];
  const cut = [];
  const hold = [];
  const missing = [];
  inside.forEach((r) => {
    const k = rateKind(r);
    if (k === "hike") hike.push(r);
    else if (k === "cut") cut.push(r);
    else if (k === "hold") hold.push(r);
    else missing.push(r);
  });
  return { n: inside.length, inside, hike, cut, hold, missing, last: inside[inside.length - 1] || null };
}

function renderFdIndicator(rows, tax) {
  const el = $("fd-indicator");
  if (!el || !rows.length) return;
  const cur = insideCensus(rows, tax);
  const f2key = "F2";
  const hikeDates = cur.hike.map((r) => {
    const v = rateAdj(r);
    const sign = v > 0 ? "+" : "";
    return `${r.date} (${sign}${Number(v).toFixed(2)} pp)`;
  });
  const cols = ["date","action","rate_adjust_pp","target_end","F1","F2","F3","funds_minus_stock","int_gf_pct","int_rec_pct","int_tax_pct","primary_deficit_pct_gdp"];
  const csvLines = [cols.join(",")];
  cur.inside.forEach((r) => {
    const adj = rateAdj(r);
    const cell = (v) => {
      if (v == null || v === "") return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    csvLines.push([
      r.date, rateKind(r),
      adj == null ? "" : adj,
      r.target_end == null ? "" : r.target_end,
      num(r, "F1"), num(r, f2key), num(r, "F3"),
      r.funds_minus_stock, r.int_gf_pct, r.int_rec_pct, r.int_tax_pct, r.primary_deficit_pct_gdp,
    ].map(cell).join(","));
  });
  if (el._csvUrl) URL.revokeObjectURL(el._csvUrl);
  el._csvUrl = URL.createObjectURL(new Blob([csvLines.join("\n")], { type: "text/csv" }));
  el.innerHTML =
    `<h3>Did they hike from inside?</h3>` +
    `<p class="punch"><b class="hike">${cur.hike.length}</b> hike${cur.hike.length === 1 ? "" : "s"}` +
    ` from <b class="n">${cur.n}</b> interior quarter${cur.n === 1 ? "" : "s"}` +
    ` <span style="color:#9fb3c8">(general-fund till)</span></p>` +
    `<p class="breakdown">` +
    `<span class="hike">${cur.hike.length} hike</span> · ` +
    `<span class="cut">${cur.cut.length} cut</span> · ` +
    `${cur.hold.length} hold` +
    `${cur.missing.length ? ` · <span style="color:#7f93a6">${cur.missing.length} no FOMC print</span>` : ""}` +
    `${cur.last ? ` · last inside ${cur.last.date}` : ""}` +
    `</p>` +
    (hikeDates.length ? `<p class="dates">inside hikes: ${hikeDates.join(" · ")}</p>` : "") +
    `<p class="dl"><a download="fd-interior-gf.csv" href="${el._csvUrl}">download interior quarters (csv)</a></p>`;
}

function drawDist(el, rows, tax, nc, zone) {
  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const sceneRec = susScene(rows, zone, "rec", nc);
  const sceneTax = susScene(rows, zone, "tax", nc);
  // Inactive till is hidden. Restructuring starts off; the legend turns it on.
  function seriesVis(active, on) {
    if (!active) return false;
    return on ? true : "legendonly";
  }
  const traces = [
    { x: rows.map((r) => r.date), y: rows.map((r) => susDist(r, zone, "tax", "warn", sceneTax)), name: "Danger (tax)", legendgroup: "danger-tax", line: { color: gold, width: 2.5 }, type: "scatter", mode: "lines", visible: seriesVis(tax, true) },
    { x: rows.map((r) => r.date), y: rows.map((r) => susDist(r, zone, "tax", "restruct", sceneTax)), name: "Restructuring (tax)", legendgroup: "restruct-tax", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: seriesVis(tax, false) },
    { x: rows.map((r) => r.date), y: rows.map((r) => susDist(r, zone, "rec", "warn", sceneRec)), name: "Danger (receipts)", legendgroup: "danger-rec", line: { color: gold, width: 2.5 }, type: "scatter", mode: "lines", visible: seriesVis(!tax, true) },
    { x: rows.map((r) => r.date), y: rows.map((r) => susDist(r, zone, "rec", "restruct", sceneRec)), name: "Restructuring (receipts)", legendgroup: "restruct-rec", line: { color: mag, width: 2.5 }, type: "scatter", mode: "lines", visible: seriesVis(!tax, false) },
  ];
  const burden = tax ? "tax" : "rec";
  const scene = tax ? sceneTax : sceneRec;
  const d = nc && zone && scene ? { warn: susDist(nc, zone, burden, "warn", scene), restruct: susDist(nc, zone, burden, "restruct", scene) } : null;
  const qe = nc && nc.quarter_end;
  if (d && qe) {
    const dangerGroup = tax ? "danger-tax" : "danger-rec";
    const restructGroup = tax ? "restruct-tax" : "restruct-rec";
    traces.push.apply(traces, nowcastGhost1d(
      nc, qe, d.warn,
      `AI forecast · distance ${Number.isFinite(d.warn) ? d.warn.toFixed(2) : "n/a"}`,
      gold,
      { legendgroup: dangerGroup, visible: true, legendName: `Gemini · danger ${qe}` }
    ));
    traces.push.apply(traces, nowcastGhost1d(
      nc, qe, d.restruct,
      `AI forecast · distance ${Number.isFinite(d.restruct) ? d.restruct.toFixed(2) : "n/a"}`,
      mag,
      { legendgroup: restructGroup, visible: "legendonly", legendName: `Gemini · restructuring ${qe}` }
    ));
  }
  const node = document.getElementById(el);
  const w = node ? Math.round(node.getBoundingClientRect().width) : 0;
  return Plotly.newPlot(el, traces, {
    title: { text: "Distance to the cube, as drawn. Up = farther. 0 = on it. Below 0 = inside.", font: { size: 14, color: "#00f0ff" } },
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

function drawFdDist(el, rows, tax, nc, zone) {
  const mag = "#ff2bd6";
  const scene = fdScene(rows, nc);
  const ys = rows.map((r) => fdDist(r, scene));
  const xs = rows.map((r) => r.date);
  const lineTips = rows.map((r, i) => {
    const d = ys[i];
    const dBit = Number.isFinite(d) ? d.toFixed(2) : "n/a";
    const where = Number.isFinite(d) && d < 0 ? "INSIDE" : "outside";
    return `${r.date}  ${where}<br>distance ${dBit}<br>funds−stock ${Number(r.funds_minus_stock).toFixed(3)} pp<br>int/gf ${Number(r.int_gf_pct).toFixed(2)}%<br>primary/GDP ${Number(r.primary_deficit_pct_gdp).toFixed(2)}%`;
  });

  function kindOf(r) {
    return rateKind(r);
  }
  function tip(r, i, tag) {
    const adj = rateAdj(r);
    const tgt = Number(r.target_end);
    const d = ys[i];
    const dBit = Number.isFinite(d) ? d.toFixed(2) : "n/a";
    const where = Number.isFinite(d) && d < 0 ? "INSIDE" : "outside";
    let rateLine;
    if (adj == null) rateLine = "FOMC Δ this quarter: missing — DFEDTAR not in published stitch";
    else {
      const sign = adj > 0 ? "+" : "";
      const tgtBit = Number.isFinite(tgt) ? `  target ${tgt.toFixed(2)}%` : "";
      rateLine = `FOMC Δ this quarter: ${sign}${adj.toFixed(2)} pp (${tag})${tgtBit}`;
    }
    return (
      `<b>${tag.toUpperCase()}</b> ${r.date}  ${where}<br>` +
      `${rateLine}<br>` +
      `distance ${dBit}<br>` +
      `funds−stock ${Number(r.funds_minus_stock).toFixed(3)} pp<br>` +
      `int/gf ${Number(r.int_gf_pct).toFixed(2)}%  primary/GDP ${Number(r.primary_deficit_pct_gdp).toFixed(2)}%`
    );
  }
  function marks(tag, color, symbol, size) {
    const mx = [];
    const my = [];
    const mt = [];
    rows.forEach((r, i) => {
      if (kindOf(r) !== tag) return;
      if (!Number.isFinite(ys[i])) return;
      mx.push(r.date);
      my.push(ys[i]);
      mt.push(tip(r, i, tag));
    });
    return {
      type: "scatter",
      mode: "markers",
      x: mx, y: my, name: tag,
      text: mt, hoverinfo: "text",
      marker: { color, size, symbol, line: { color, width: 1 } },
    };
  }

  const traces = [
    {
      x: xs, y: ys,
      name: "distance (general-fund)",
      line: { color: mag, width: 2.5 },
      type: "scatter", mode: "lines",
      text: lineTips, hoverinfo: "text",
      connectgaps: false,
    },
    marks("hold", "#00f0ff", "circle", 5),
    marks("hike", "#39ff14", "triangle-up", 8),
    marks("cut", "#ff4d4d", "triangle-down", 8),
    marks("missing", "#7f93a6", "x", 7),
  ];
  const recHit = deepestHike(rows, scene);
  const recDate = recHit ? recHit.date : null;
  const recD = recHit ? recHit.d : null;
  const recPink = "#ff9ad8";
  const shapes = [
    { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: mag, width: 1, dash: "dot" } },
  ];
  const annotations = [];
  if (Number.isFinite(recD) && recDate != null) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: [recDate], y: [recD],
      name: `${recDate} hike record`,
      text: [`${recDate} — lowest hike on this line<br>distance ${recD.toFixed(2)}<br>Furthest into the zone the Fed has hiked in this sample. Not a wire.`],
      hoverinfo: "text",
      marker: { color: recPink, size: 11, symbol: "diamond", line: { color: mag, width: 1.5 } },
    });
    annotations.push({
      x: recDate,
      y: recD,
      text: `${recDate} hike record`,
      showarrow: true,
      arrowhead: 3,
      arrowsize: 1,
      arrowwidth: 1.2,
      arrowcolor: recPink,
      ax: -88,
      ay: 42,
      font: { color: recPink, size: 11, family: "IBM Plex Mono, ui-monospace, monospace" },
      bgcolor: "rgba(7,8,12,0.82)",
      bordercolor: recPink,
      borderwidth: 1,
      borderpad: 4,
    });
  }
  if (nc && nc.quarter_end) {
    const nd = fdDist(nc, scene);
    traces.push.apply(traces, nowcastGhost1d(
      nc,
      nc.quarter_end,
      nd,
      Number.isFinite(nd)
        ? `AI forecast · distance ${nd.toFixed(2)} (0 = surface)`
        : "AI forecast · distance n/a"
    ));
  }
  const node = document.getElementById(el);
  const w = node ? Math.round(node.getBoundingClientRect().width) : 0;
  return Plotly.newPlot(el, traces, {
    title: { text: "Distance to the cube, as drawn. Up = farther. 0 = on it. Below 0 = inside.", font: { size: 14, color: "#00f0ff" } },
    paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 48, r: 16, t: 44, b: 36 },
    autosize: true,
    height: 340,
    width: w || undefined,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    shapes,
    annotations,
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

function drawFdDeltaVsDist(el, rows, zone, nc) {
  const mag = "#ff2bd6";
  const scene = fdScene(rows, nc);
  const f2key = "F2";
  const groups = [
    { k: "hold", color: "#00f0ff", symbol: "circle", size: 8, name: "hold" },
    { k: "hike", color: "#39ff14", symbol: "triangle-up", size: 12, name: "hike" },
    { k: "cut", color: "#ff4d4d", symbol: "triangle-down", size: 12, name: "cut" },
  ];
  const traces = groups.map((g) => {
    const xs = [];
    const ys = [];
    const tips = [];
    rows.forEach((r) => {
      if (rateKind(r) !== g.k) return;
      const d = fdDist(r, scene);
      const adj = rateAdj(r);
      if (!Number.isFinite(d) || adj == null) return;
      xs.push(d);
      ys.push(adj);
      const inn = isInside(r, f2key);
      const tgt = Number(r.target_end);
      const tgtBit = Number.isFinite(tgt) ? `  target ${tgt.toFixed(2)}%` : "";
      tips.push(
        `${inn ? "<b>INSIDE</b> " : ""}${r.date}<br>` +
        `distance ${d.toFixed(2)}  (0 = face, same as 01)<br>` +
        `FOMC Δ ${adj > 0 ? "+" : ""}${adj.toFixed(2)} pp (${g.k})${tgtBit}<br>` +
        `F1=${num(r, "F1").toFixed(2)}  F2=${num(r, f2key).toFixed(2)}  F3=${num(r, "F3").toFixed(2)}`
      );
    });
    return {
      type: "scatter",
      mode: "markers",
      x: xs, y: ys, name: g.name,
      text: tips, hoverinfo: "text",
      marker: { color: g.color, size: g.size, symbol: g.symbol, line: { color: g.color, width: 1 } },
    };
  });
  const ix = [];
  const iy = [];
  rows.forEach((r) => {
    if (rateKind(r) === "missing") return;
    if (!isInside(r, f2key)) return;
    const d = fdDist(r, scene);
    const adj = rateAdj(r);
    if (!Number.isFinite(d) || adj == null) return;
    ix.push(d);
    iy.push(adj);
  });
  if (ix.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: ix, y: iy, name: "inside",
      hoverinfo: "skip",
      marker: {
        color: "rgba(0,0,0,0)",
        size: 14,
        symbol: "circle",
        line: { color: mag, width: 2 },
      },
    });
  }
  const node = document.getElementById(el);
  const w = node ? Math.round(node.getBoundingClientRect().width) : 0;
  return Plotly.newPlot(el, traces, {
    title: {
      text: "FOMC Δ vs signed distance (01). Left of 0 = inside.",
      font: { size: 14, color: "#00f0ff" },
    },
    paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 56, r: 16, t: 52, b: 48 },
    autosize: true,
    height: 420,
    width: w || undefined,
    xaxis: {
      title: { text: "distance to the cube, as drawn. Same as 01.  0 = face", font: { size: 11, color: "#9fb3c8" } },
      gridcolor: "rgba(196,163,90,0.12)",
      zeroline: false,
    },
    yaxis: {
      title: { text: "quarterly net FOMC Δ (pp)", font: { size: 11, color: "#9fb3c8" } },
      gridcolor: "rgba(196,163,90,0.12)",
      zeroline: false,
    },
    shapes: [
      { type: "line", yref: "paper", y0: 0, y1: 1, x0: 0, x1: 0, line: { color: mag, width: 1.5, dash: "dot" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(232,246,255,0.35)", width: 1, dash: "dot" } },
    ],
    legend: {
      font: { size: 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.55)",
      orientation: "h",
      x: 0.5, xanchor: "center", y: 1.02, yanchor: "bottom",
    },
  }, { responsive: true, displaylogo: false });
}


function hline(y, color) {
  return {
    type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
    line: { color, width: 1.5, dash: "dot" },
  };
}

function drawRawAxis(el, rows, col, title, color, wires, nc, ncVal, partials) {
  const xs = [], ys = [];
  rows.forEach((r) => {
    const v = Number(r[col]);
    if (!Number.isFinite(v)) return;
    xs.push(r.date);
    ys.push(v);
  });
  const have = new Set(xs.map((d) => String(d).slice(0, 10)));
  const measured = (partials || []).filter((p) => {
    return p && p.column === col && !have.has(String(p.quarter).slice(0, 10)) && Number.isFinite(Number(p.value));
  });
  measured.forEach((p) => {
    xs.push(p.quarter);
    ys.push(Number(p.value));
  });
  const order = xs.map((x, i) => ({ x, y: ys[i] })).sort((a, b) => String(a.x).localeCompare(String(b.x)));
  const node = document.getElementById(el);
  if (!node) return;
  if (!order.length) {
    node.innerHTML = `<p class="err">no ${col}</p>`;
    return;
  }
  const box = node;
  const cs = window.getComputedStyle(box);
  const w = Math.round(box.clientWidth || parseFloat(cs.width)) || 680;
  const h = Math.round(box.clientHeight || parseFloat(cs.height)) || 340;
  const lineX = [];
  const lineY = [];
  order.forEach((p, i) => {
    if (i > 0) {
      const days = (new Date(p.x) - new Date(order[i - 1].x)) / 86400000;
      if (days > 100) {
        lineX.push(p.x);
        lineY.push(null);
      }
    }
    lineX.push(p.x);
    lineY.push(p.y);
  });
  const traces = [{
    type: "scatter", mode: "lines",
    x: lineX, y: lineY, name: col,
    line: { color, width: 2 },
    connectgaps: false,
  }];
  if (measured.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: measured.map((p) => p.quarter),
      y: measured.map((p) => Number(p.value)),
      name: "measured",
      hoverinfo: "text",
      text: measured.map((p) => {
        const src = p.source === "treasury"
          ? "Treasury print, not FRED"
          : "Measured print";
        return (
          `${p.quarter}<br>${src} · ${p.axis}<br>` +
          `${p.series || ""}<br>` +
          `Not a Gemini guess. This axis is in. The cube point waits on the others.`
        );
      }),
      marker: { color, size: 9, symbol: "circle", line: { color: "#e8f6ff", width: 1.5 } },
    });
  }
  const ghostQ = nc && String(nc.quarter_end).slice(0, 10);
  const replaced = measured.some((p) => String(p.quarter).slice(0, 10) === ghostQ);
  if (!replaced) {
    const ncv = Number(ncVal);
    traces.push.apply(traces, nowcastGhost1d(
      nc,
      nc && nc.quarter_end,
      ncv,
      `AI forecast · ${col} ${Number.isFinite(ncv) ? ncv.toFixed(2) : "n/a"}`,
      color
    ));
  }
  return Plotly.newPlot(el, traces, {
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

function drawSixAxes(sus, failRows, zone, tax, nc, partials) {
  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const fd = failRows && failRows.length ? failRows : sus;
  const tillCol = tax ? "int_tax_pct" : "int_rec_pct";
  const tillWarn = tax ? zone.int_tax_warn : zone.int_rec_warn;
  const tillDeath = tax ? zone.int_tax_restruct : zone.int_rec_restruct;
  const tillName = tax ? "int / tax (%)" : "int / receipts (%)";
  const tillVal = tax ? (nc && nc.int_tax_pct) : (nc && nc.int_rec_pct);
  drawRawAxis("ax-1", sus, tillCol, `${tillName}`, "#00f0ff",
    [hline(tillWarn, gold), hline(tillDeath, mag)], nc, tillVal, partials);
  drawRawAxis("ax-2", sus, "refi_gap", "refi gap (pp)", "#ffbf00",
    [hline(zone.refi_gap_warn, gold), hline(zone.refi_gap_restruct, mag)], nc, nc && nc.refi_gap, partials);
  drawRawAxis("ax-3", sus, "debt_gdp_pct", "debt public / GDP (%)", "#7aa2ff",
    [hline(zone.debt_gdp_warn, gold), hline(zone.debt_gdp_restruct, mag)], nc, nc && nc.debt_gdp_pct, partials);
  drawRawAxis("ax-4", fd, "F2", "F2  y(int / general-fund − 20%)", "#00f0ff",
    [hline(0, mag)], nc, nc && nc.F2, partials);
  drawRawAxis("ax-5", fd, "F1", "F1  y(funds − book)  flipped", "#39ff14",
    [hline(0, mag)], nc, nc && nc.F1, partials);
  drawRawAxis("ax-6", fd, "F3", "F3  y(primary / GDP)", "#ff6b4a",
    [hline(0, mag)], nc, nc && nc.F3, partials);
}

function $(id) {
  return document.getElementById(id);
}

function fetchFresh(url) {
  const u = url + (url.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
  return fetch(u, { cache: "no-store" });
}

function fmtNum(v, digits) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function renderNextPoint(block) {
  const el = document.getElementById("next-point-card");
  if (!el) return;
  const slot = (key) => el.querySelector(`[data-next="${key}"]`);
  // Labels and headings live in the page HTML. This only fills slots.
  if (!slot("label")) {
    el.innerHTML = "<p>Next-point card is missing its data-next slots.</p>";
    return;
  }
  const set = (key, text, blank) => {
    const n = slot(key);
    if (!n) return;
    const empty = text == null || text === "";
    n.textContent = empty ? (blank == null ? "—" : blank) : String(text);
  };
  const row = (r) => {
    const digits = r.units === "pp" ? 3 : 2;
    const val = r.value == null ? "not in yet" : `${fmtNum(r.value, digits)} ${r.units || ""}`;
    const asof = r.asof ? ` <span class="why">as of ${r.asof}</span>` : "";
    const note = r.note ? ` <span class="why">${r.note}</span>` : "";
    return `<li><b>${r.name}</b> — ${val}${asof}${note}<br><span class="why">${r.series || ""}</span></li>`;
  };
  const fill = (key, rows, empty) => {
    const ul = slot(key);
    if (!ul) return;
    const head = slot(key + "-head");
    if (!rows || !rows.length) {
      ul.innerHTML = empty || "";
      ul.hidden = !empty;
      if (head) head.hidden = true;
      return;
    }
    ul.hidden = false;
    if (head) head.hidden = false;
    ul.innerHTML = rows.map(row).join("");
  };
  if (!block || !block.label) {
    set("label", null);
    set("release", null);
    set("pickup", null);
    set("note", (block && block.note) || "Next quarter is not known yet.", "");
    fill("have", [], "");
    fill("partial", [], "");
    fill("waiting", [], "");
    return;
  }
  set("label", block.label);
  set("release", block.release);
  set("pickup", block.pickup || "the morning after FRED has every series");
  set("note", block.note || "", "");
  fill("have", block.have, "<li>Nothing for that quarter yet.</li>");
  fill("partial", block.partial, "");
  fill("waiting", block.waiting, "<li>Nothing. The quarter can be plotted.</li>");
}

function renderDebtBridge(rows) {
  const el = document.getElementById("debt-bridge-note");
  if (!el) return;
  const last = rows && rows.length ? rows[rows.length - 1] : null;
  if (!last || last.debt_gdp_source !== "treasury") {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const asof = last.debt_gdp_debt_asof || last.date;
  const bn = Number(last.debt_gdp_debt_bn);
  const stock = Number.isFinite(bn) ? ` Stock ${fmtNum(bn / 1000, 3)} trillion.` : "";
  el.hidden = false;
  el.innerHTML =
    `This quarter on the plot (${last.date}) is a <b>Treasury print</b>, not FRED: ` +
    `Debt to the Penny on ${asof}, divided by GDP. ` +
    `${fmtNum(last.debt_gdp_pct, 2)}%.${stock}`;
}

function renderCubeLog(events, cubeName, note) {
  const host = document.getElementById("cube-log-table");
  const noteEl = document.getElementById("cube-log-note");
  if (noteEl) noteEl.textContent = note || "";
  if (!host) return;
  const rows = (events || []).filter((e) => e.cube === cubeName).slice().reverse();
  if (!rows.length) {
    host.innerHTML = "<p>No adds or revisions logged yet.</p>";
    return;
  }
  const body = rows.map((e) => {
    const axes = (e.axes || []).map((a) => {
      const digits = a.units === "pp" ? 3 : 2;
      const coord = (a.coordinate_old != null || a.coordinate_new != null)
        ? ` <span class="why">coordinate ${fmtNum(a.coordinate_old, 3)} → ${fmtNum(a.coordinate_new, 3)}</span>`
        : "";
      return `<div><b>${a.axis}</b> ${fmtNum(a.old, digits)} → ${fmtNum(a.new, digits)} ${a.units || ""}${coord}<br><span class="why">${a.series || ""}</span></div>`;
    }).join("");
    return `<tr><td>${(e.logged_at || "").slice(0, 10)}</td><td>${e.kind}</td><td>${e.quarter}</td><td>${axes}</td></tr>`;
  }).join("");
  host.innerHTML =
    `<table class="cube-log"><thead><tr><th>Logged</th><th>Kind</th><th>Quarter</th><th>Axis</th></tr></thead><tbody>${body}</tbody></table>`;
}

async function main() {
  const stamp = $("stamp");
  const wantSus = Boolean($("cube-sustain"));
  const wantFail = Boolean($("cube-fail"));
  const res = await fetchFresh(DATA);
  if (!res.ok) {
    if (stamp) stamp.innerHTML = `<span class="err">${res.status} cubes.json — run python scripts/build_site_data.py --process</span>`;
    return;
  }
  const pack = await res.json();
  const partials = pack.partial_axes || [];
  let nowcast = null;
  try {
    const nr = await fetchFresh(NOWCAST);
    if (nr.ok) nowcast = await nr.json();
  } catch (e) { /* optional */ }
  if (nowcast && nowcast.not_a_print !== true) nowcast = null;
  let zoneFile = {};
  try {
    const zr = await fetchFresh(ZONE_CSV);
    if (zr.ok) zoneFile = parseZoneCsv(await zr.text());
  } catch (e) { /* committed csv missing — pack.zone only */ }
  // Git zone.csv wins. cubes.json zone is a snapshot and goes stale on HTML-only deploys.
  const zone = Object.assign({}, pack.zone || {}, zoneFile);
  const sus = (pack.sustain || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fail = (pack.fail || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if ((wantSus && !sus.length) || (wantFail && !fail.length) || (!wantSus && !wantFail && !sus.length)) {
    if (stamp) stamp.innerHTML = `<span class="err">cubes.json is empty — rerun --process after a fetch</span>`;
    return;
  }
  const ls = (sus.length ? sus : fail)[(sus.length ? sus : fail).length - 1];
  const need = [];
  if (wantSus) need.push.apply(need, SUS_ZONE_KEYS);
  if (wantFail) need.push.apply(need, FD_ZONE_KEYS);
  if (!need.length) need.push.apply(need, ZONE_KEYS);
  const missZ = zoneMissing(zone, need);
  if (missZ.length) {
    const msg = `zone missing ${missZ.join(", ")} — not drawing guessed wires`;
    if (stamp) stamp.innerHTML = `<span class="err">${msg}</span>`;
    flagMissing($("cube-sustain"), msg);
    flagMissing($("cube-fail"), msg);
    return;
  }
  const onFd = wantFail && !wantSus;
  const pageRows = onFd ? fail : sus;
  const latest = pageRows.length ? pageRows[pageRows.length - 1] : ls;
  const nMissAdj = pageRows.filter((r) => rateKind(r) === "missing").length;
  const nxt = pack.next && (onFd ? pack.next.fail : pack.next.sustain);
  renderNextPoint(nxt);
  if (!onFd) renderDebtBridge(sus);
  renderCubeLog(
    pack.changelog,
    onFd ? "fiscal dominance" : "sustainability",
    pack.changelog_note || ""
  );

  const opts = { responsive: true, displaylogo: false, displayModeBar: !isNarrow() };
  let tax = Boolean($("btn-tax") && $("btn-tax").classList.contains("active"));
  let showRates = Boolean($("tog-rates") && $("tog-rates").checked);

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
    const drawn = sustainTraces(sus, zone, tax ? "tax" : "rec", nowcast);
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
    if (fail.every((r) => num(r, "F2") == null)) {
      flagMissing($("cube-fail"), "cubes.json has no F2 (A091 / (FGRECPT − W780)). Fetch W780RC1Q027SBEA and rerun --process.");
      return;
    }
    const ft = failTraces(fail, tax, showRates, nowcast, zone);
    const note = $("rate-note");
    const rec = ft.record;
    const recOk = rec && num(rec.row, "F1") != null && num(rec.row, "F2") != null && num(rec.row, "F3") != null;
    if (note) {
      if (showRates && !ft.nAdj) {
        note.innerHTML = `<span class="err">rate decisions on, but cubes.json has no rate_adjust — the published JSON is stale. Push src/cube_data.py + scripts/build_site_data.py and rerun nightly (fetch + process).</span>`;
      } else if (showRates && recOk) {
        note.textContent = `FOMC net Δ by quarter (${ft.nAdj} quarters with a print). Green ▲ hike, red ▼ cut, cyan hold. Magenta outline = inside the box. Light dashed magenta = ${rec.date} hike record (lowest hike on the distance line).`;
      } else if (recOk) {
        note.textContent = `Light dashed magenta cube: ${rec.date}, lowest hike on the distance line.`;
      } else {
        note.textContent = "";
      }
      if (!recOk) {
        note.innerHTML = (note.innerHTML || note.textContent || "") +
          ` <span class="err">No hike quarter with a finite distance — no record cube.</span>`;
      }
    }
    const f2title = "F2  y(interest / general-fund receipts − 20%)";
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
    renderFdIndicator(fail, tax);
  }

  await drawFail();
  await drawSustain();
  if ($("dist-plot") && sus.length) await drawDist("dist-plot", sus, tax, nowcast, zone);
  if ($("fd-dist-plot") && fail.length) await drawFdDist("fd-dist-plot", fail, tax, nowcast, zone);
  if ($("fd-delta-plot") && fail.length) await drawFdDeltaVsDist("fd-delta-plot", fail, zone, nowcast);
  drawSixAxes(sus, fail, zone, tax, nowcast, partials);

  function setBurden(next) {
    tax = next;
    const btnTax = $("btn-tax");
    const btnRec = $("btn-rec");
    if (btnTax) btnTax.classList.toggle("active", tax);
    if (btnRec) btnRec.classList.toggle("active", !tax);
    drawSustain();
    drawFail();
    drawSixAxes(sus, fail, zone, tax, nowcast, partials);
    if ($("dist-plot") && sus.length) drawDist("dist-plot", sus, tax, nowcast, zone);
    if ($("fd-dist-plot") && fail.length) drawFdDist("fd-dist-plot", fail, tax, nowcast, zone);
    if ($("fd-delta-plot") && fail.length) drawFdDeltaVsDist("fd-delta-plot", fail, zone, nowcast);
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
