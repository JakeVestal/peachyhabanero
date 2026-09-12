/* Who is financing the extra public debt. Used by financing.html and article-house.html. */
const RAW = "data/published/raw_inputs.json";
const CUBES = "data/published/cubes.json";
const D_BILL = 0.25;
const D_10 = 8;
const D_20 = 14;
const CHUNK_BN = 6;

function isNarrow() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

function layout(title, opts) {
  const mobile = isNarrow();
  const o = opts || {};
  return {
    title: title
      ? {
          text: title,
          font: { color: "#00f0ff", size: mobile ? 12 : 13 },
          x: 0,
          xanchor: "left",
          y: 1,
          yanchor: "bottom",
          pad: { t: 0, b: 8 },
        }
      : false,
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: mobile
      ? { l: 44, r: 8, t: title ? 44 : 16, b: 112 }
      : { l: 52, r: 16, t: title ? 48 : 20, b: 92 },
    height: o.height || (mobile ? 480 : 420),
    xaxis: {
      gridcolor: "rgba(196,163,90,0.12)",
      zerolinecolor: "rgba(255,43,214,0.25)",
      automargin: true,
    },
    yaxis: {
      gridcolor: "rgba(196,163,90,0.12)",
      zerolinecolor: "rgba(255,43,214,0.25)",
      automargin: true,
      title: o.ytitle || undefined,
    },
    legend: {
      orientation: "h",
      x: 0,
      y: -0.16,
      xanchor: "left",
      yanchor: "top",
      font: { size: 11, color: "#c8d6e5" },
      bgcolor: "rgba(7,8,12,0)",
      traceorder: "normal",
    },
    showlegend: o.showlegend !== false,
    hovermode: "x unified",
    autosize: true,
  };
}

function hingeShapes() {
  const marks = ["2018-03-31", "2021-12-15", "2022-03-16"];
  const colors = ["rgba(255,43,214,0.45)", "rgba(196,163,90,0.7)", "rgba(0,240,255,0.45)"];
  return marks.map((d, i) => ({
    type: "line", x0: d, x1: d, y0: 0, y1: 1, yref: "paper",
    line: { color: colors[i], width: 1, dash: "dot" },
  }));
}

function rawNum(row, col) {
  const x = row[col];
  if (x === null || x === undefined || x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function points(table, col) {
  const xs = [];
  const ys = [];
  ((table && table.rows) || []).slice().reverse().forEach((r) => {
    const v = rawNum(r, col);
    if (v === null) return;
    xs.push(r.date);
    ys.push(v);
  });
  return { xs, ys };
}

function toBn(p) {
  const ys = p.ys || [];
  if (!ys.length) return p;
  const mid = ys.slice().sort((a, b) => a - b)[Math.floor(ys.length / 2)];
  const scale = mid > 20000 ? 1 / 1000 : 1;
  return { xs: p.xs, ys: ys.map((v) => v * scale) };
}

function qid(d) {
  const y = Number(String(d).slice(0, 4));
  const m = Number(String(d).slice(5, 7));
  if (!y || !m) return null;
  return y + "Q" + Math.ceil(m / 3);
}

function lastQFromPoints(p) {
  const m = new Map();
  (p.xs || []).forEach((d, i) => {
    const q = qid(d);
    const v = p.ys[i];
    if (!q || !Number.isFinite(v)) return;
    m.set(q, { date: String(d).slice(0, 10), v });
  });
  return m;
}

function fmt(v, d) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function fmtSigned(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v > 0.5) return "+" + n;
  if (v < -0.5) return "−" + n;
  return "0";
}

function sumWin(rows, key, a, b) {
  return rows.filter((r) => r.date >= a && r.date <= b && Number.isFinite(r[key]))
    .reduce((s, r) => s + r[key], 0);
}

function buyerRows(tables) {
  const pub = toBn(points(tables.fred_debt_stocks, "FYGFDPUN"));
  const soma = toBn(points(tables.fred_official_holdings, "WSHOTSL"));
  const foreign = toBn(points(tables.fred_official_holdings, "FDHBFIN"));
  const rrp = points(tables.fred_policy_rates, "RRPONTSYD");
  const pubQ = lastQFromPoints(pub);
  const somaQ = lastQFromPoints(soma);
  const forQ = lastQFromPoints(foreign);
  const rrpQ = lastQFromPoints(rrp);
  const qs = Array.from(new Set([...pubQ.keys(), ...somaQ.keys(), ...forQ.keys()])).sort();
  const rows = [];
  qs.forEach((q) => {
    const p = pubQ.get(q), s = somaQ.get(q), f = forQ.get(q), r = rrpQ.get(q);
    rows.push({
      q,
      date: (p || s || f || r || {}).date || q,
      pub: p ? p.v : null,
      soma: s ? s.v : null,
      foreign: f ? f.v : null,
      rrp: r ? r.v : null,
    });
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i], b = rows[i - 1];
    a.dPub = (a.pub != null && b.pub != null) ? a.pub - b.pub : null;
    a.dSoma = (a.soma != null && b.soma != null) ? a.soma - b.soma : null;
    a.dFor = (a.foreign != null && b.foreign != null) ? a.foreign - b.foreign : null;
    a.dRrp = (a.rrp != null && b.rrp != null) ? a.rrp - b.rrp : null;
    a.resid = (a.dPub != null && a.dSoma != null && a.dFor != null)
      ? a.dPub - a.dSoma - a.dFor : null;
  }
  return { rows, pub, soma, foreign, rrp };
}

function ateLine(block) {
  if (!Number.isFinite(block.pub) || Math.abs(block.pub) < 1) return "";
  const fed = 100 * block.soma / block.pub;
  const fo = 100 * block.foreign / block.pub;
  const pr = 100 * block.resid / block.pub;
  const shares = `Of that extra debt: Fed ${fmt(fed, 0)}% · foreign ${fmt(fo, 0)}% · leftover ${fmt(pr, 0)}%.`;
  const officialNet = (block.soma || 0) + (block.foreign || 0);
  if (officialNet < 0) {
    return `${shares} Leftover over 100% is not a bug: private buyers took the new issuance <em>and</em> what the Fed and foreigners sold.`;
  }
  return shares;
}

function whoWindow(label, range, block, rrpNote) {
  return `
    <div class="who-window">
      <p class="who-label">${label}</p>
      <p class="who-dates">${range}</p>
      <div class="who-figures">
        <div class="who-fig">
          <span class="k">extra public debt</span>
          <span class="v">${fmtSigned(block.pub)}</span>
        </div>
        <div class="who-fig">
          <span class="k">Fed</span>
          <span class="v">${fmtSigned(block.soma)}</span>
        </div>
        <div class="who-fig">
          <span class="k">foreign</span>
          <span class="v">${fmtSigned(block.foreign)}</span>
        </div>
        <div class="who-fig">
          <span class="k">leftover</span>
          <span class="v">${fmtSigned(block.resid)}</span>
        </div>
      </div>
      <p class="who-unit">$ billion, sum of quarter-to-quarter changes</p>
      <p>${ateLine(block)} ${rrpNote}</p>
    </div>`;
}

async function drawWho(tables) {
  const card = document.getElementById("who-card");
  const tb = document.querySelector("#who-table tbody");
  const el = document.getElementById("plot-who");
  if (!card && !el) return;
  const { rows } = buyerRows(tables);
  const vis = rows.filter((r) => r.date >= "2010-01-01" && r.dPub != null);
  if (!vis.length) {
    if (card) card.innerHTML = `<p class="err">Need debt held by the public and Fed Treasury holdings in the published data. Run the nightly refresh.</p>`;
    if (el) el.innerHTML = `<p class="err">FYGFDPUN / WSHOTSL missing</p>`;
    return;
  }
  const w22 = { a: "2022-01-01", b: "2023-06-30" };
  const wNow = vis.slice(-4);
  const s22 = {
    pub: sumWin(rows, "dPub", w22.a, w22.b),
    soma: sumWin(rows, "dSoma", w22.a, w22.b),
    foreign: sumWin(rows, "dFor", w22.a, w22.b),
    resid: sumWin(rows, "resid", w22.a, w22.b),
    rrp: sumWin(rows, "dRrp", w22.a, w22.b),
  };
  const sNow = {
    pub: wNow.reduce((s, r) => s + (r.dPub || 0), 0),
    soma: wNow.reduce((s, r) => s + (r.dSoma || 0), 0),
    foreign: wNow.reduce((s, r) => s + (r.dFor || 0), 0),
    resid: wNow.reduce((s, r) => s + (r.resid || 0), 0),
    rrp: wNow.reduce((s, r) => s + (r.dRrp || 0), 0),
    from: wNow[0] && wNow[0].date,
    to: wNow[wNow.length - 1] && wNow[wNow.length - 1].date,
  };
  if (card) {
    card.innerHTML = `
      <h3>Who took the extra public debt</h3>
      ${whoWindow(
        "QT window",
        "2022-Q1 → 2023-Q2",
        s22,
        `Overnight cash parked at the Fed (reverse repo) changed by ${fmtSigned(s22.rrp)} — not part of the four-way split.`
      )}
      ${whoWindow(
        "Last four quarters",
        `${sNow.from || "—"} → ${sNow.to || "—"}`,
        sNow,
        `Reverse repo changed by ${fmtSigned(sNow.rrp)}.`
      )}
      <p class="who-foot">Leftover is U.S. private holders plus foreign buying that has not printed yet. It is a bucket, not a person. Figures in $ billion.</p>`;
  }
  if (tb) {
    const show = vis.filter((r) => r.date >= "2021-01-01");
    tb.innerHTML = show.map((r) => `
      <tr>
        <td>${r.date}</td>
        <td>${fmt(r.dPub, 0)}</td>
        <td>${fmt(r.dSoma, 0)}</td>
        <td>${fmt(r.dFor, 0)}</td>
        <td>${fmt(r.resid, 0)}</td>
        <td>${fmt(r.dRrp, 0)}</td>
      </tr>`).join("");
  }
  if (el) {
    await Plotly.newPlot("plot-who", [
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.dSoma), name: "Fed", marker: { color: "rgba(0,240,255,0.85)" } },
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.dFor), name: "foreign", marker: { color: "rgba(196,163,90,0.85)" } },
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.resid), name: "leftover", marker: { color: "rgba(255,43,214,0.45)" } },
      { type: "scatter", mode: "lines+markers", x: vis.map((r) => r.date), y: vis.map((r) => r.dPub), name: "extra public debt", line: { color: "#e8f6ff", width: 2 }, marker: { size: 5 } },
    ], Object.assign(layout("Extra public debt, who took it ($bn, quarter to quarter)"), {
      barmode: "relative",
      shapes: hingeShapes(),
    }), { responsive: true, displaylogo: false });
  }
}

async function drawBills(tables) {
  const el = document.getElementById("plot-bills");
  if (!el) return;
  const w = points(tables.fiscal_mspd_residual, "RESID_W_0_1Y");
  const share = points(tables.fiscal_mspd_composition, "MSPD_BILLS_SHARE_MARKETABLE");
  const traces = [];
  if (w.xs.length) {
    traces.push({
      type: "scatter", mode: "lines", x: w.xs, y: w.ys.map((v) => v * 100),
      name: "share maturing inside 1 year", line: { color: "#c4a35a", width: 2 },
    });
  }
  if (share.xs.length) {
    traces.push({
      type: "scatter", mode: "lines", x: share.xs, y: share.ys.map((v) => v * 100),
      name: "bills share of marketable (original class)", line: { color: "#00f0ff", width: 2, dash: "dot" },
    });
  }
  if (!traces.length) {
    el.innerHTML = `<p class="err">Need MSPD remaining-maturity weights</p>`;
    return;
  }
  await Plotly.newPlot("plot-bills", traces, Object.assign(layout("Share of the book due inside a year (%)", { ytitle: "%" }), {
    shapes: hingeShapes(),
  }), { responsive: true, displaylogo: false });
}

async function drawLongs(tables) {
  const el = document.getElementById("plot-longs");
  if (!el) return;
  const d10 = points(tables.fred_policy_rates, "DGS10");
  const d30 = points(tables.fred_policy_rates, "DGS30");
  if (!d10.xs.length) {
    el.innerHTML = `<p class="err">DGS10 missing</p>`;
    return;
  }
  const traces = [
    { type: "scatter", mode: "lines", x: d10.xs, y: d10.ys, name: "10-year yield", line: { color: "#c4a35a", width: 2 } },
  ];
  if (d30.xs.length) {
    traces.push({ type: "scatter", mode: "lines", x: d30.xs, y: d30.ys, name: "30-year yield", line: { color: "#ff2bd6", width: 2 } });
  }
  await Plotly.newPlot("plot-longs", traces, Object.assign(layout("10-year and 30-year Treasury yields (%)", { ytitle: "%" }), {
    shapes: hingeShapes(),
  }), { responsive: true, displaylogo: false });
}

function rhoBp(gPp, dLong) {
  const den = dLong - D_BILL;
  if (!Number.isFinite(gPp) || den <= 0) return null;
  return (100 * gPp) / den;
}

function extraCouponMn(gPp, bBn) {
  if (!Number.isFinite(gPp) || !Number.isFinite(bBn)) return null;
  return gPp * 10 * bBn;
}

function readChunkB() {
  const inp = document.getElementById("rho-b");
  let v = inp ? Number(inp.value) : CHUNK_BN;
  if (!Number.isFinite(v) || v <= 0) v = CHUNK_BN;
  if (v > 2000) v = 2000;
  return v;
}

function mnLabel(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "−") + fmt(Math.abs(v), 0) + " mn";
}

let rhoVis = null;

function fillRhoMath(last, bBn) {
  const box = document.getElementById("rho-math");
  const head = document.getElementById("rho-head");
  if (head) head.textContent = "Price of a $" + fmt(bBn, bBn < 10 ? 1 : 0) + " bn switch, latest print";
  if (!box || !last) return;
  const g = Number(last.refi_gap);
  const r10 = rhoBp(g, D_10);
  const r20 = rhoBp(g, D_20);
  const i = extraCouponMn(g, bBn);
  const d10 = bBn * (D_10 - D_BILL);
  const d20 = bBn * (D_20 - D_BILL);
  box.innerHTML = `
      <div class="who-window">
        <p class="who-label">g from the cube</p>
        <p class="who-dates">${last.date}</p>
        <div class="who-figures">
          <div class="who-fig">
            <span class="k">refi gap g</span>
            <span class="v">${g >= 0 ? "+" : ""}${fmt(g, 2)} pp</span>
          </div>
          <div class="who-fig">
            <span class="k">chunk B</span>
            <span class="v">$${fmt(bBn, bBn < 10 ? 1 : 0)} bn</span>
          </div>
          <div class="who-fig">
            <span class="k">ΔI<sub>1y</sub></span>
            <span class="v">${mnLabel(i)}</span>
          </div>
          <div class="who-fig">
            <span class="k">ρ vs B</span>
            <span class="v">unchanged</span>
          </div>
        </div>
      </div>
      <div class="who-window">
        <p class="who-label">10s vs bills &nbsp; D<sub>long</sub>=${D_10}, D<sub>bill</sub>=${D_BILL}</p>
        <div class="who-figures">
          <div class="who-fig">
            <span class="k">ΔD extracted</span>
            <span class="v">${fmt(d10, 1)} bn-years</span>
          </div>
          <div class="who-fig">
            <span class="k">ρ</span>
            <span class="v">${r10 == null ? "—" : fmt(r10, 1)} bp / year of D</span>
          </div>
        </div>
      </div>
      <div class="who-window">
        <p class="who-label">20s vs bills &nbsp; D<sub>long</sub>=${D_20}, D<sub>bill</sub>=${D_BILL}</p>
        <div class="who-figures">
          <div class="who-fig">
            <span class="k">ΔD extracted</span>
            <span class="v">${fmt(d20, 1)} bn-years</span>
          </div>
          <div class="who-fig">
            <span class="k">ρ</span>
            <span class="v">${r20 == null ? "—" : fmt(r20, 1)} bp / year of D</span>
          </div>
        </div>
      </div>
      <p class="who-foot">
        ΔI<sub>1y</sub> = (g/100) × B. ΔD = B × (D<sub>long</sub> − D<sub>bill</sub>).
        ρ = g / (D<sub>long</sub> − D<sub>bill</sub>) does not depend on B.
        Duration is a labeled Macaulay mix, not each CUSIP.
      </p>`;
}

function rhoLayout(bBn) {
  const L = layout(
    "rho (left) and extra coupon dI for this B (right)",
    { ytitle: "rho, bp / year of D" }
  );
  L.yaxis2 = {
    overlaying: "y",
    side: "right",
    title: { text: "ΔI₁y, $ mn  (B = $" + fmt(bBn, bBn < 10 ? 1 : 0) + " bn)" },
    gridcolor: "rgba(0,240,255,0.08)",
    zerolinecolor: "rgba(255,43,214,0.25)",
    automargin: true,
    tickfont: { color: "#7fdfff" },
  };
  L.shapes = hingeShapes();
  L.margin = Object.assign({}, L.margin, { r: isNarrow() ? 44 : 64 });
  return L;
}

function rhoTraces(vis, bBn) {
  const xs = vis.map((r) => r.date);
  return [
    {
      type: "scatter", mode: "lines", x: xs,
      y: vis.map((r) => rhoBp(Number(r.refi_gap), D_10)),
      name: "ρ · 10s vs bills", line: { color: "#c4a35a", width: 2 },
    },
    {
      type: "scatter", mode: "lines", x: xs,
      y: vis.map((r) => rhoBp(Number(r.refi_gap), D_20)),
      name: "ρ · 20s vs bills", line: { color: "#ff2bd6", width: 2 },
    },
    {
      type: "scatter", mode: "lines", x: xs,
      y: vis.map((r) => extraCouponMn(Number(r.refi_gap), bBn)),
      name: "ΔI₁y at this B", yaxis: "y2",
      line: { color: "#7fdfff", width: 1.5, dash: "dash" },
    },
  ];
}

async function paintRho() {
  if (!rhoVis || !rhoVis.length) return;
  const bBn = readChunkB();
  const last = rhoVis[rhoVis.length - 1];
  fillRhoMath(last, bBn);
  const el = document.getElementById("plot-rho");
  if (!el) return;
  await Plotly.react("plot-rho", rhoTraces(rhoVis, bBn), rhoLayout(bBn), {
    responsive: true, displaylogo: false,
  });
}

async function drawRho(pack) {
  const el = document.getElementById("plot-rho");
  const card = document.getElementById("rho-card");
  if (!el && !card) return;
  const rows = ((pack && pack.sustain) || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const vis = rows.filter((r) => r.date >= "2010-01-01" && Number.isFinite(Number(r.refi_gap)));
  if (!vis.length) {
    const msg = "cubes.json missing sustain.refi_gap — run the nightly refresh.";
    if (card) card.innerHTML = `<p class="err">${msg}</p>`;
    if (el) el.innerHTML = `<p class="err">${msg}</p>`;
    return;
  }
  rhoVis = vis;
  if (card && !document.getElementById("rho-b")) {
    card.innerHTML = `
      <h3 id="rho-head">Price of a $6 bn switch, latest print</h3>
      <label class="rho-b-lab">
        chunk B
        <input id="rho-b" type="number" min="0.1" max="2000" step="0.5" value="6"/>
        <span>$ billion</span>
      </label>
      <p class="who-unit">ρ does not move with B. The dashed line and ΔI<sub>1y</sub> / ΔD do — they scale one-for-one with the chunk.</p>
      <div id="rho-math"></div>`;
    const inp = document.getElementById("rho-b");
    const onB = () => { paintRho(); };
    inp.addEventListener("input", onB);
    inp.addEventListener("change", onB);
  }
  await paintRho();
}

async function main() {
  const stamp = document.getElementById("stamp");
  let raw;
  try {
    const res = await fetch(RAW, { cache: "no-store" });
    if (!res.ok) throw new Error("raw_inputs.json missing — run the nightly refresh");
    raw = await res.json();
  } catch (e) {
    if (stamp) stamp.innerHTML = `<span class="err">${e.message}</span>`;
    return;
  }
  const tables = raw.tables || {};
  if (stamp) {
    stamp.textContent = `published ${raw.generated_at || raw.as_of || "—"}`;
  }
  await drawWho(tables);
  await drawBills(tables);
  await drawLongs(tables);
  let pack = null;
  try {
    const cr = await fetch(CUBES, { cache: "no-store" });
    if (cr.ok) pack = await cr.json();
  } catch (e) { /* rho is optional on pages without cubes */ }
  await drawRho(pack);
}

main();
window.addEventListener("resize", () => {
  ["plot-who", "plot-bills", "plot-longs", "plot-rho"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.data) Plotly.Plots.resize(el);
  });
});
