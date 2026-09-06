const DATA = "data/published/cubes.json";

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
  const zone = pack.zone;
  if (!zone || !Number.isFinite(Number(zone.refi_gap_death))) {
    stamp.innerHTML = `<span class="err">cubes.json missing zone — rerun --process</span>`;
    return;
  }
  const sus = (pack.sustain || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fail = (pack.fail || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  stamp.textContent = `zone refi death = ${zone.refi_gap_death} · ${pack.generated_at || ""}`;

  const gold = "#c4a35a";
  const mag = "#ff2bd6";
  const cyan = "#00f0ff";
  let tax = false;

  async function paint() {
    const tillCol = tax ? "int_tax_pct" : "int_rec_pct";
    const tillWarn = tax ? zone.int_tax_warn : zone.int_rec_warn;
    const tillDeath = tax ? zone.int_tax_death : zone.int_rec_death;
    const tillName = tax ? "tax" : "receipts";
    const f2key = tax ? "F2_tax" : "F2_rec";
    await draw("b-debt", sus, "debt_gdp_pct",
      "Debt held by public / GDP (%)", gold,
      [hline(zone.debt_gdp_warn, "#ffbf00"), hline(zone.debt_gdp_death, mag)]);
    await draw("b-int", sus, tillCol,
      `Interest / ${tillName} (%)`, cyan,
      [hline(tillWarn, "#ffbf00"), hline(tillDeath, mag)]);
    await draw("b-refi", sus, "refi_gap",
      "Refi gap  (marginal − stock, pp)", gold,
      [hline(zone.refi_gap_warn, "#ffbf00"), hline(zone.refi_gap_death, mag)]);
    await draw("b-f1x", fail, "funds_minus_stock",
      "F1 raw  funds − stock coupon (pp)  ·  plotted Z", cyan, [hline(0, mag)]);
    await draw("b-f2x", fail, tillCol,
      `F2 raw  interest / ${tillName} (%)`, gold, [hline(tillWarn, mag)]);
    await draw("b-f3x", fail, "primary_deficit_pct_gdp",
      "F3 raw  primary / GDP (%)  ·  plotted X", cyan, [hline(0, mag)]);
    await draw("b-f1y", fail, "F1", "F1  y(funds − stock)  ·  plotted Z", cyan, [hline(0, mag)]);
    await draw("b-f2y", fail, f2key, tax ? "F2  y(int/tax − 25%)" : "F2  y(int/rec − 20%)", gold, [hline(0, mag)]);
    await draw("b-f3y", fail, "F3", "F3  y(primary / GDP)  ·  plotted X", cyan, [hline(0, mag)]);
  }

  await paint();
  const rec = document.getElementById("btn-rec");
  const taxBtn = document.getElementById("btn-tax");
  if (rec && taxBtn) {
    rec.onclick = () => { tax = false; rec.classList.add("active"); taxBtn.classList.remove("active"); paint(); };
    taxBtn.onclick = () => { tax = true; taxBtn.classList.add("active"); rec.classList.remove("active"); paint(); };
  }
}

main().catch((err) => {
  document.getElementById("stamp").innerHTML = `<span class="err">${err.message}</span>`;
});
