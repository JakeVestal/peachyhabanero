/* Who is financing the extra public debt. Used by financing.html and article-house.html. */
const RAW = "data/published/raw_inputs.json";

function isNarrow() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

function layout(title, opts) {
  const mobile = isNarrow();
  const o = opts || {};
  return {
    title: {
      text: title,
      font: { color: "#00f0ff", size: mobile ? 12 : 13 },
      x: 0,
      xanchor: "left",
    },
    paper_bgcolor: "#07080c",
    plot_bgcolor: "#0b0f16",
    font: { color: "#c8d6e5", family: "IBM Plex Mono, ui-monospace, monospace", size: 11 },
    margin: mobile
      ? { l: 44, r: 8, t: 52, b: 108 }
      : { l: 52, r: 16, t: 64, b: 52 },
    height: o.height || (mobile ? 460 : 400),
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
      y: mobile ? -0.32 : 1.18,
      xanchor: "left",
      yanchor: mobile ? "top" : "bottom",
      font: { size: 11, color: "#c8d6e5" },
      bgcolor: "rgba(7,8,12,0)",
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
  if (!Number.isFinite(block.pub) || Math.abs(block.pub) < 1) return "—";
  const fed = 100 * block.soma / block.pub;
  const fo = 100 * block.foreign / block.pub;
  const pr = 100 * block.resid / block.pub;
  const shares = `Fed ${fmt(fed, 0)}% · foreign ${fmt(fo, 0)}% · leftover ${fmt(pr, 0)}% of the extra public debt`;
  const officialNet = (block.soma || 0) + (block.foreign || 0);
  if (officialNet < 0) {
    return `${shares}. Leftover over 100% is not a bug: private buyers took the new debt <em>and</em> the bonds the Fed and foreigners were selling.`;
  }
  return `${shares}.`;
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
      <p class="stat">
        2022-Q1 → 2023-Q2 &nbsp; extra public debt ${fmt(s22.pub, 0)} $bn
        &nbsp; Fed ${fmt(s22.soma, 0)}
        &nbsp; foreign ${fmt(s22.foreign, 0)}
        &nbsp; leftover ${fmt(s22.resid, 0)}
      </p>
      <p>${ateLine(s22)} Overnight cash parked at the Fed (reverse repo) changed by ${fmt(s22.rrp, 0)} $bn — not part of the sum.</p>
      <p class="stat">
        last 4 quarters (${sNow.from || "—"} → ${sNow.to || "—"})
        &nbsp; extra public debt ${fmt(sNow.pub, 0)}
        &nbsp; Fed ${fmt(sNow.soma, 0)}
        &nbsp; foreign ${fmt(sNow.foreign, 0)}
        &nbsp; leftover ${fmt(sNow.resid, 0)}
      </p>
      <p>${ateLine(sNow)} Reverse repo changed by ${fmt(sNow.rrp, 0)} $bn.
        Leftover is U.S. private holders plus foreign buying that has not printed yet. It is a bucket, not a person.</p>`;
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
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.dSoma), name: "Fed Treasury holdings", marker: { color: "rgba(0,240,255,0.85)" } },
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.dFor), name: "foreign holders", marker: { color: "rgba(196,163,90,0.85)" } },
      { type: "bar", x: vis.map((r) => r.date), y: vis.map((r) => r.resid), name: "leftover (private + lag)", marker: { color: "rgba(255,43,214,0.45)" } },
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
}

main();
window.addEventListener("resize", () => {
  ["plot-who", "plot-bills", "plot-longs"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.data) Plotly.Plots.resize(el);
  });
});
