const DATA = "data/published/cubes.json";

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
    // --- ADD CAMERA CENTER SHIFT BELOW ---
    camera: {
      center: { x: 0, y: 0, z: -0.18 }, // Shifts the cube position upward in the frame
      eye: { x: 1.25, y: 1.25, z: 1.25 }  // Preserves default zoom/perspective angle
    }
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
  };
}

function win(vals) {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return [-0.2, 1];
  const lo = Math.min(s[Math.floor(s.length * 0.02)], 0);
  const hi = Math.max(s[Math.min(s.length - 1, Math.floor(s.length * 0.98))], 0.6);
  const room = hi > lo ? hi - lo : 1;
  return [lo - 0.15 * room, hi + 0.15 * room];
}

function sustainTraces(rows, zone, burden) {
  const ycol = burden === "tax" ? "int_tax_pct" : "int_rec_pct";
  const ywarn = burden === "tax" ? zone.int_tax_warn : zone.int_rec_warn;
  const ydeath = burden === "tax" ? zone.int_tax_death : zone.int_rec_death;
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
      `stress ${Number(r[stressCol]).toFixed(2)}`
  );
  const last = rows[rows.length - 1];
  const xmax = Math.max(200, ...rows.map((r) => r.debt_gdp_pct), 0) + 5;
  const ymax = Math.max(ydeath + 8, ...rows.map((r) => r[ycol]), 0) + 3;
  const zmax = Math.max(5, ...rows.map((r) => r.refi_gap), 0) + 0.3;
  const zmin = Math.min(-1, ...rows.map((r) => r.refi_gap), 0) - 0.2;
  return [
    wire(zone.debt_gdp_warn, xmax, ywarn, ymax, zone.refi_gap_warn, zmax, "#ffbf00", "Danger Zone", 3),
    wire(zone.debt_gdp_death, xmax, ydeath, ymax, zone.refi_gap_death, zmax, "#ff2bd6", "Death Zone", 4),
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
}

function failTraces(rows) {
  const f2 = rows.map((r) => r.F2_rec);
  const hover = rows.map((r) => {
    const inside = r.F1 > 0 && r.F2_rec > 0 && r.F3 > 0;
    return (
        `${inside ? "<b>INSIDE</b> " : ""}${r.date}<br>` +
        `F1=${Number(r.F1).toFixed(2)}  F2=${Number(r.F2_rec).toFixed(2)}  F3=${Number(r.F3).toFixed(2)}<br>` +
        `funds−stock ${Number(r.funds_minus_stock).toFixed(3)} pp<br>` +
        `int/rec ${Number(r.int_rec_pct).toFixed(2)}%  int/tax ${Number(r.int_tax_pct).toFixed(2)}%<br>` +
        `primary/GDP ${Number(r.primary_deficit_pct_gdp).toFixed(2)}%`
    );
  });
  const last = rows[rows.length - 1];
  const w1 = win(rows.map((r) => r.F1));
  const w2 = win(f2);
  const w3 = win(rows.map((r) => r.F3));
  const lo = Math.min(w1[0], w2[0], w3[0]);
  const hi = Math.max(w1[1], w2[1], w3[1]);
  const inside = rows.filter((r) => r.F1 > 0 && r.F2_rec > 0 && r.F3 > 0);
  const traces = [
    wire(0, hi, 0, hi, 0, hi, "#ff2bd6", "Fiscal Dominance Zone", 4),
    {
      type: "scatter3d",
      x: rows.map((r) => r.F3), y: f2, z: rows.map((r) => r.F1),
      mode: "lines+markers",
      marker: { size: 5, color: "#00f0ff" },
      line: { color: "rgba(0,240,255,0.35)", width: 3 },
      text: hover, hoverinfo: "text", name: "path",
    },
  ];
  if (inside.length) {
    traces.push({
      type: "scatter3d",
      x: inside.map((r) => r.F3),
      y: inside.map((r) => r.F2_rec),
      z: inside.map((r) => r.F1),
      mode: "markers",
      marker: { size: 8, color: "#ff2bd6", symbol: "diamond" },
      text: hover.filter((_, i) => rows[i].F1 > 0 && rows[i].F2_rec > 0 && rows[i].F3 > 0),
      hoverinfo: "text",
      name: `inside (${inside.length})`,
    });
  }
  traces.push({
    type: "scatter3d",
    x: [last.F3], y: [last.F2_rec], z: [last.F1],
    mode: "markers",
    marker: { size: 10, color: "#00f0ff", symbol: "diamond" },
    text: [hover[hover.length - 1]], hoverinfo: "text",
    name: `latest ${last.date}`,
  });
  return { traces, lo, hi };
}

function drawDist(el, rows, tax) {
  const traces = [
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_warn_tax), name: "dist_warn (tax)", line: { color: "#ffbf00", width: 2 }, type: "scatter", mode: "lines", visible: tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_death_tax), name: "dist_death (tax)", line: { color: "#ff2bd6", width: 2 }, type: "scatter", mode: "lines", visible: tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_warn_rec), name: "dist_warn (receipts)", line: { color: "#00f0ff", width: 2 }, type: "scatter", mode: "lines", visible: !tax },
    { x: rows.map((r) => r.date), y: rows.map((r) => r.dist_death_rec), name: "dist_death (receipts)", line: { color: "#7aa2ff", width: 2 }, type: "scatter", mode: "lines", visible: !tax },
  ];
  return Plotly.newPlot(el, traces, {
    title: { text: "Score-space distance. 1 = warn face, 2 = death face.", font: { size: 14, color: "#00f0ff" } },
    paper_bgcolor: "#07080c", plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 48, r: 16, t: 44, b: 36 }, height: 300,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zerolinecolor: "rgba(255,43,214,0.25)" },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(232,246,255,0.35)", width: 1, dash: "dot" } }],
    legend: {
      font: { size: 10, color: "#9fb3c8" },
      bgcolor: "rgba(7,8,12,0.55)",
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 0.95,
      yanchor: 'bottom'
    },
  }, { responsive: true, displaylogo: false });
}

async function main() {
  const stamp = document.getElementById("stamp");
  const res = await fetch(DATA);
  if (!res.ok) {
    stamp.innerHTML = `<span class="err">${res.status} cubes.json — run python scripts/build_site_data.py --process</span>`;
    return;
  }
  const pack = await res.json();
  const zone = pack.zone;
  const sus = (pack.sustain || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fail = (pack.fail || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!sus.length || !fail.length) {
    stamp.innerHTML = `<span class="err">cubes.json is empty — rerun --process after a fetch</span>`;
    return;
  }
  const ls = sus[sus.length - 1];
  const lf = fail[fail.length - 1];
  stamp.innerHTML =
      `<b>Latest data point: ${ls.date}</b><br>` +
      `<p style="font-size: 0.85em;text-indent: 40px;">` +
      `New points are added quarterly when the US Bureau of Economic ` +
      `Analysis prints GDP numbers` +
      `</p>`;

  const opts = { responsive: true, displaylogo: false };
  let tax = true;

  function sustainLayout(burden) {
    return layout3d(
        `Sustainability Cube`,
        "Debt held by public / GDP (%)",
        burden === "tax" ? "Interest / tax (%)" : "Interest / receipts (%)",
        "Refi gap  (marginal − stock, pp)"
    );
  }

  async function drawSustain() {
    await Plotly.react("cube-sustain", sustainTraces(sus, zone, tax ? "tax" : "rec"), sustainLayout(tax ? "tax" : "rec"), opts);
  }

  const ft = failTraces(fail);
  await Plotly.newPlot("cube-fail", ft.traces, Object.assign(
      layout3d(
          "Fiscal Dominance Cube",
          "F3  y(primary / GDP)",
          "F2  y(interest / receipts − 20%)",
          "F1  y(funds − stock)",
          { x: [ft.lo, ft.hi], y: [ft.lo, ft.hi], z: [ft.lo, ft.hi] }
      ),
      {}
  ), opts);
  await drawSustain();
  await drawDist("dist-plot", sus, tax);

  function setBurden(next) {
    tax = next;
    document.getElementById("btn-tax").classList.toggle("active", tax);
    document.getElementById("btn-rec").classList.toggle("active", !tax);
    drawSustain();
    Plotly.restyle("dist-plot", { visible: tax ? [true, true, false, false] : [false, false, true, true] });
  }
  document.getElementById("btn-tax").onclick = () => setBurden(true);
  document.getElementById("btn-rec").onclick = () => setBurden(false);
}

main().catch((err) => {
  document.getElementById("stamp").innerHTML = `<span class="err">${err.message}</span>`;
});