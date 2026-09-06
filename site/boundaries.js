const DATA = "data/published/cubes.json";

const FALLBACK_ZONE = {
  debt_gdp_warn: 100, debt_gdp_death: 140,
  int_rec_warn: 20, int_rec_death: 30,
  int_tax_warn: 25, int_tax_death: 40,
  refi_gap_warn: 0.5, refi_gap_death: 1.0,
};

function layout(title) {
  return {
    title: { text: title, font: { color: "#00f0ff", size: 13 } },
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: { l: 52, r: 16, t: 40, b: 36 },
    height: 300,
    xaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    yaxis: { gridcolor: "rgba(196,163,90,0.12)", zeroline: false },
    showlegend: false,
  };
}

function hline(y, color) {
  return {
    type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
    line: { color, width: 1.5, dash: "dot" },
  };
}

function series(rows, xcol) {
  const xs = [], ys = [];
  rows.forEach((r) => {
    const v = Number(r[xcol]);
    if (!Number.isFinite(v)) return;
    xs.push(r.date);
    ys.push(v);
  });
  return { xs, ys };
}

function draw(el, rows, col, title, color, wires) {
  const { xs, ys } = series(rows, col);
  const node = document.getElementById(el);
  if (!xs.length) {
    node.innerHTML = `<p class="err">no ${col}</p>`;
    return;
  }
  return Plotly.newPlot(el, [{
    type: "scatter", mode: "lines",
    x: xs, y: ys, line: { color, width: 2 },
  }], Object.assign(layout(title), { shapes: wires }),
  { responsive: true, displaylogo: false });
}

async function main() {
  const stamp = document.getElementById("stamp");
  const res = await fetch(DATA);
  if (!res.ok) {
    stamp.innerHTML = `<span class="err">${res.status} cubes.json — run --process</span>`;
    return;
  }
  const pack = await res.json();
  const zone = Object.assign({}, FALLBACK_ZONE, pack.zone || {});
  const sus = (pack.sustain || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fail = (pack.fail || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  stamp.textContent = `zone refi death = ${zone.refi_gap_death} · ${pack.generated_at || ""}`;

  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const cyan = "#00f0ff";

  await draw("b-debt", sus, "debt_gdp_pct",
    "Debt held by public / GDP (%)", gold,
    [hline(zone.debt_gdp_warn, "#ffbf00"), hline(zone.debt_gdp_death, mag)]);
  await draw("b-int", sus, "int_rec_pct",
    "Interest / receipts (%)", cyan,
    [hline(zone.int_rec_warn, "#ffbf00"), hline(zone.int_rec_death, mag)]);
  await draw("b-refi", sus, "refi_gap",
    "Refi gap  (marginal − stock, pp)", gold,
    [hline(zone.refi_gap_warn, "#ffbf00"), hline(zone.refi_gap_death, mag)]);

  await draw("b-f1x", fail, "funds_minus_stock",
    "F1 raw  funds − stock coupon (pp)", cyan, [hline(0, mag)]);
  await draw("b-f2x", fail, "int_rec_pct",
    "F2 raw  interest / receipts (%)", gold, [hline(zone.int_rec_warn, mag)]);
  await draw("b-f3x", fail, "primary_deficit_pct_gdp",
    "F3 raw  primary / GDP (%)", cyan, [hline(0, mag)]);

  await draw("b-f1y", fail, "F1", "F1  y(funds − stock)", cyan, [hline(0, mag)]);
  await draw("b-f2y", fail, "F2_rec", "F2  y(int/rec − 20%)", gold, [hline(0, mag)]);
  await draw("b-f3y", fail, "F3", "F3  y(primary / GDP)", cyan, [hline(0, mag)]);
}

main().catch((err) => {
  document.getElementById("stamp").innerHTML = `<span class="err">${err.message}</span>`;
});
