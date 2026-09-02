const DATA = "../data/published";

const TABS = ["story", "thresholds", "quarterly", "metrics", "raw", "catalog"];

const PENNY_COLS = new Set([
  "DEBT_HELD_PUBLIC",
  "DEBT_INTRAGOV",
  "DEBT_TOTAL",
]);

function fmtPenny(v) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const cents = Math.round(n * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  return sign + dollars.toLocaleString("en-US") + "." + String(rem).padStart(2, "0");
}

function fmt(v, col) {
  if (v === null || v === undefined || v === "") return "";
  if (col && PENNY_COLS.has(col)) return fmtPenny(v);
  if (typeof v === "number") {
    const a = Math.abs(v);
    if (a >= 1e6) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (a >= 100) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(v);
}

function downloadCsv(id, filename) {
  const table = document.getElementById(id);
  const csv = [...table.querySelectorAll("tr")].map((row) =>
      [...row.querySelectorAll("th,td")]
          .map((td) => `"${td.innerText.replaceAll('"', '""')}"`)
          .join(",")
  );
  const blob = new Blob([csv.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderTable(mount, table, tableId) {
  if (!table || !table.rows || !table.rows.length) {
    mount.innerHTML = `<p class="err">no rows</p>`;
    return;
  }
  const cols = table.columns || Object.keys(table.rows[0]);
  const head = cols.map((c) => `<th>${c}</th>`).join("");
  const body = table.rows
      .map((row) => `<tr>${cols.map((c) => `<td>${fmt(row[c], c)}</td>`).join("")}</tr>`)
      .join("");
  const meta = `${table.n_rows ?? table.rows.length} rows` +
      (table.start ? ` · ${table.start} → ${table.end}` : "");
  mount.innerHTML = `
    <div class="table-wrap">
      <div class="table-bar">
        <span>${meta}</span>
        <button class="neon-btn" type="button" onclick="downloadCsv('${tableId}','${tableId}.csv')">download csv</button>
      </div>
      <div class="table-scroll">
        <table id="${tableId}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </div>
    </div>`;
}

function showTab(name) {
  TABS.forEach((t) => {
    document.getElementById(`panel-${t}`).classList.toggle("hidden", t !== name);
    document.querySelector(`[data-tab="${t}"]`).classList.toggle("active", t === name);
  });
}

function renderColumnNotes(mount, table) {
  const notes = window.COLUMN_NOTES || {};
  const cols = (table.columns || []).filter((c) => c !== "date" && c !== "quarter_end");
  if (!cols.length) {
    mount.innerHTML = "";
    return;
  }
  mount.innerHTML = cols.map((col) => {
    const n = notes[col];
    if (!n) {
      return `<article class="col-card"><h3>${col}</h3><p class="sub">No note on file yet.</p></article>`;
    }
    return `<article class="col-card">
      <h3><span class="col-id">${col}</span>  ${n.title}</h3>
      <p class="sub">${n.source}${n.units ? " · " + n.units : ""}</p>
      <p><a href="${n.url}" target="_blank" rel="noopener">${n.url}</a></p>
      <p>${n.official}</p>
      <p class="why"><b>Why it is here.</b> ${n.why}</p>
    </article>`;
  }).join("");
}

const X_COLS = {
  1: "funds_minus_stock",
  2: "interest_pct_receipts",
  3: "primary_deficit_pct_gdp",
  4: "acm_10y_term_premium",
  5: "r_minus_g",
  6: "NFCI",
};

function sampleStd(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (xs.length < 2) return 1;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const var_ = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(var_) || 1;
}

function asOf(table, date) {
  if (!table || !table.rows) return null;
  const cols = table.columns || (table.rows[0] ? Object.keys(table.rows[0]) : []);
  const key = cols.includes("quarter_end") ? "quarter_end" : "date";
  const hit = table.rows
      .filter((r) => r[key] && r[key] <= date)
      .sort((a, b) => (a[key] < b[key] ? 1 : -1));
  return hit[0] || null;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtN(v, d = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function pickRow(rows) {
  return rows[Math.floor(Math.random() * rows.length)];
}

function threshById(thresholds, id) {
  return (thresholds || []).find((t) => Number(t.metric_id) === id);
}

function shiftIso(iso, years) {
  const p = String(iso).split("-");
  if (p.length < 3) return iso;
  return `${String(Number(p[0]) + years).padStart(4, "0")}-${p[1]}-${p[2]}`;
}

function recipeX(id, date, metrics, raw, qrow) {
  const M = metrics.tables || {};
  const R = raw.tables || {};
  const m1 = asOf(M["01_funds_equals_fiscal_rate"], date);
  const m2 = asOf(M["02_interest_share_of_receipts"], date);
  const m3 = asOf(M["03_primary_deficit_not_in_hole"], date);
  const m4 = asOf(M["04_duration_demand_term_premium"], date);
  const m5 = asOf(M["05_r_minus_g"], date);
  const m6 = asOf(M["06_financial_conditions"], date);
  const nipa = asOf(R.fred_fiscal_nipa, date);
  const policy = asOf(R.fred_policy_rates, date);
  const labor = asOf(R.fred_labor_output, date);
  const penny = asOf(R.fiscal_debt_to_penny, date);
  const term = asOf(R.fred_term_premium, date);
  const fci = asOf(R.fred_financial_conditions, date);

  if (id === 1) {
    const funds = num(policy && policy.FEDFUNDS) ?? num(m1 && m1.FEDFUNDS);
    const coupon = num(m1 && m1.effective_avg_coupon_pct);
    const interest = num(nipa && nipa.A091RC1Q027SBEA) ?? num(m2 && m2.interest_bn_saar);
    const debt = num(penny && penny.DEBT_TOTAL);
    const debtBn = debt != null ? debt / 1e9 : null;
    const rebuilt = funds != null && coupon != null ? funds - coupon : null;
    return [
      `Last policy print on or before ${date}: FEDFUNDS = ${fmtN(funds, 4)}.`,
      `Effective coupon on the stock = 100 × NIPA interest (A091RC1Q027SBEA = ${fmtN(interest, 3)} $bn SAAR) ÷ debt stock.`,
      `Debt-to-the-penny DEBT_TOTAL = ${debt != null ? fmtPenny(debt) : "—"} → ${fmtN(debtBn, 3)} $bn.`,
      `Coupon stored on metric 1: effective_avg_coupon_pct = ${fmtN(coupon, 4)}.`,
      `x1 = FEDFUNDS − coupon = ${fmtN(funds, 4)} − ${fmtN(coupon, 4)} = ${fmtN(rebuilt, 4)} (table: funds_minus_stock).`,
    ];
  }
  if (id === 2) {
    const interest = num(nipa && nipa.A091RC1Q027SBEA) ?? num(m2 && m2.interest_bn_saar);
    const receipts = num(nipa && nipa.FGRECPT) ?? num(m2 && m2.current_receipts_bn_saar);
    const rebuilt = interest != null && receipts ? (100 * interest) / receipts : null;
    return [
      `NIPA interest A091RC1Q027SBEA = ${fmtN(interest, 3)} $bn SAAR.`,
      `NIPA current receipts FGRECPT = ${fmtN(receipts, 3)} $bn SAAR.`,
      `x2 = 100 × interest / receipts = 100 × ${fmtN(interest, 3)} / ${fmtN(receipts, 3)} = ${fmtN(rebuilt, 4)}.`,
    ];
  }
  if (id === 3) {
    const interest = num(nipa && nipa.A091RC1Q027SBEA) ?? num(m2 && m2.interest_bn_saar);
    const receipts = num(nipa && nipa.FGRECPT) ?? num(m2 && m2.current_receipts_bn_saar);
    const exp = num(nipa && nipa.FGEXPND);
    const gdp = num(labor && labor.GDP);
    const primary = num(m3 && m3.primary_deficit_bn_saar);
    const rebuilt =
        exp != null && interest != null && receipts != null && gdp
            ? (100 * (exp - interest - receipts)) / gdp
            : num(m3 && m3.primary_deficit_pct_gdp);
    return [
      `Outlays FGEXPND = ${fmtN(exp, 3)} $bn SAAR.`,
      `Interest A091RC1Q027SBEA = ${fmtN(interest, 3)} $bn SAAR.`,
      `Receipts FGRECPT = ${fmtN(receipts, 3)} $bn SAAR.`,
      `Primary deficit $bn = (outlays − interest) − receipts = ${fmtN(primary, 3)}.`,
      `Nominal GDP = ${fmtN(gdp, 3)} $bn SAAR.`,
      `x3 = 100 × primary / GDP = ${fmtN(rebuilt, 4)}.`,
    ];
  }
  if (id === 4) {
    const tp = num(term && term.THREEFYTP10) ?? num(m4 && m4.acm_10y_term_premium_pp);
    return [
      `Raw FRED THREEFYTP10 (Kim–Wright 10y zero term premium) last print ≤ ${date}: ${fmtN(tp, 4)}.`,
      `x4 is that print. No transformation other than last-in-quarter.`,
    ];
  }
  if (id === 5) {
    const x5 = num(qrow && qrow.r_minus_g) ?? num(m5 && m5.r_minus_g_pp);
    let coupon = num(m1 && m1.effective_avg_coupon_pct) ?? num(m5 && m5.effective_avg_coupon_pct);
    let g = num(m5 && m5.nominal_gdp_yoy_pct);
    const gdpNow = num(labor && labor.GDP);
    const laborYearAgo = asOf(R.fred_labor_output, shiftIso(date, -1));
    const gdpLag = num(laborYearAgo && laborYearAgo.GDP);
    if (g == null && gdpNow && gdpLag) g = 100 * (gdpNow / gdpLag - 1);
    if (g == null && coupon != null && x5 != null) g = coupon - x5;
    if (coupon == null && g != null && x5 != null) coupon = x5 + g;
    const rebuilt = coupon != null && g != null ? coupon - g : x5;
    const lines = [
      `r = effective coupon on the stock = 100 × NIPA interest ÷ debt stock = ${fmtN(coupon, 4)}.`,
    ];
    if (gdpNow != null && gdpLag != null) {
      lines.push(
          `Nominal GDP at ${date} = ${fmtN(gdpNow, 3)} $bn. GDP four quarters earlier (${laborYearAgo && laborYearAgo.date}) = ${fmtN(gdpLag, 3)} $bn.`
      );
      lines.push(`g = 100 × (GDP / GDP_lag − 1) = 100 × (${fmtN(gdpNow, 3)} / ${fmtN(gdpLag, 3)} − 1) = ${fmtN(g, 4)}.`);
    } else if (g != null && coupon != null && x5 != null && num(m5 && m5.nominal_gdp_yoy_pct) == null) {
      lines.push(
          `Four-quarter GDP growth was not on the metric-5 row for this date. Backed out of the identity g = r − x5 = ${fmtN(coupon, 4)} − ${fmtN(x5, 4)} = ${fmtN(g, 4)}.`
      );
    } else {
      lines.push(`g = 100 × four-quarter percent change in nominal GDP = ${fmtN(g, 4)}.`);
    }
    lines.push(`x5 = r − g = ${fmtN(coupon, 4)} − ${fmtN(g, 4)} = ${fmtN(rebuilt, 4)}. Table r_minus_g = ${fmtN(x5, 4)}.`);
    return lines;
  }
  if (id === 6) {
    const nfci = num(fci && fci.NFCI) ?? num(m6 && m6.NFCI);
    return [
      `Raw Chicago Fed NFCI last print ≤ ${date}: ${fmtN(nfci, 4)}.`,
      `x6 is that print. No transformation other than last-in-quarter.`,
    ];
  }
  return [];
}

function recipeY(id, row, rows, thresholds) {
  const xName = X_COLS[id];
  const t = threshById(thresholds, id);
  const c = t ? Number(t.critical_value) : 0;
  const dir = t ? String(t.direction_unthinkable) : "at_or_above";
  const sigma = sampleStd(rows.map((r) => r[xName]));
  const x = num(row[xName]);
  const rawY = x != null ? (x - c) / sigma : null;
  const y = rawY != null && dir === "at_or_below" ? -rawY : rawY;
  return [
    `Headline x${id} (${xName}) = ${fmtN(x, 4)}.`,
    `Threshold c = ${fmtN(c, 4)} (${dir}).`,
    `σ = sample standard deviation of quarterly ${xName} across the complete-case panel = ${fmtN(sigma, 4)}.`,
    dir === "at_or_below"
        ? `y${id} = −(x − c) / σ = −(${fmtN(x, 4)} − ${fmtN(c, 4)}) / ${fmtN(sigma, 4)} = ${fmtN(y, 4)}.`
        : `y${id} = (x − c) / σ = (${fmtN(x, 4)} − ${fmtN(c, 4)}) / ${fmtN(sigma, 4)} = ${fmtN(y, 4)}.`,
    `Table y${id} = ${fmtN(row["y" + id], 4)}.`,
  ];
}

function renderQuarterlyExamples(mount, rows, thresholds, metrics, raw) {
  if (!mount) return;
  if (!rows || !rows.length) {
    mount.innerHTML = "";
    return;
  }
  const cols = Object.keys(rows[0]).filter((c) => c !== "quarter_end");
  mount.innerHTML = cols.map((col) => {
    try {
      const row = pickRow(rows);
      const date = row.quarter_end;
      const val = row[col];
      const shown = PENNY_COLS.has(col) ? fmtPenny(val) : fmt(val, col);
      const steps = explainQuarterlyCol(col, row, rows, thresholds, metrics, raw);
      return `<article class="col-card">
        <h3><span class="col-id">${col}</span>  worked example</h3>
        <p class="sub">Random quarter <b>${date}</b> · table value <b class="stat">${shown}</b></p>
        ${steps.map((s) => `<p>${s}</p>`).join("")}
      </article>`;
    } catch (err) {
      return `<article class="col-card"><h3><span class="col-id">${col}</span></h3><p class="err">${err.message}</p></article>`;
    }
  }).join("");
}

function explainQuarterlyCol(col, row, rows, thresholds, metrics, raw) {
  const date = row.quarter_end;
  if (/^y[1-6]$/.test(col)) {
    return recipeY(Number(col.slice(1)), row, rows, thresholds);
  }
  if (/^s[1-6]$/.test(col)) {
    const i = Number(col.slice(1));
    return [
      `s${i} is the unthinkable bit on wire ${i}.`,
      `y${i} = ${fmtN(row["y" + i], 4)}.`,
      `s${i} = 1 if y${i} > 0, else 0 → ${row[col]}.`,
    ];
  }
  if (col === "F1" || col === "F2" || col === "F3") {
    const i = Number(col.slice(1));
    return [
      `${col} is the failure-mode embedding of wire ${i}: ${col} = y${i}.`,
      ...recipeY(i, row, rows, thresholds),
      `That y starts from raw x${i}:`,
      ...recipeX(i, date, metrics, raw, row),
    ];
  }
  if (col === "n_fiscal") {
    return [
      `n_fiscal = s1 + s2 + s3 = ${row.s1} + ${row.s2} + ${row.s3} = ${row.n_fiscal}.`,
      `Each s is 1 when that fiscal wire’s y is positive (see y/s cards).`,
    ];
  }
  if (col === "n_amp") {
    return [
      `n_amp = s4 + s5 + s6 = ${row.s4} + ${row.s5} + ${row.s6} = ${row.n_amp}.`,
      `Amplifiers only. They color the cube; they do not define fail.`,
    ];
  }
  if (col === "fail") {
    return [
      `fail = s1 ∧ s2 ∧ s3 = ${row.s1} ∧ ${row.s2} ∧ ${row.s3} = ${row.fail}.`,
      `All three fiscal wires on. Magenta octant.`,
    ];
  }
  if (col === "rate_adjust") {
    return [
      `FOMC target change over the quarter, percentage points.`,
      `Daily target is DFEDTAR through 2008-12-15, then DFEDTARU (upper bound of the range).`,
      `Take last print in the quarter, then first difference vs the previous quarter-end.`,
      `Table value this quarter: ${fmtN(row.rate_adjust, 2)}.`,
    ];
  }
  const xid = Object.entries(X_COLS).find(([, name]) => name === col);
  if (xid) return recipeX(Number(xid[0]), date, metrics, raw, row);
  return [`Value copied from the quarterly embed. No further raw recipe on file.`];
}

function picker(mount, names, onPick) {
  mount.innerHTML = names
      .map((n, i) => `<button class="neon-btn${i === 0 ? " active" : ""}" data-name="${n}">${n}</button>`)
      .join("");
  mount.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      mount.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onPick(btn.dataset.name);
    };
  });
  if (names[0]) onPick(names[0]);
}

async function load() {
  const stamp = document.getElementById("stamp");
  try {
    const [quarterly, metrics, raw, thresholds] = await Promise.all([
      fetch(`${DATA}/quarterly.json`).then((r) => {
        if (!r.ok) throw new Error(`${r.status} quarterly.json`);
        return r.json();
      }),
      fetch(`${DATA}/calculated_metrics.json`).then((r) => r.json()),
      fetch(`${DATA}/raw_inputs.json`).then((r) => r.json()),
      fetch(`${DATA}/thresholds.json`).then((r) => r.json()),
    ]);

    stamp.textContent = `generated ${quarterly.generated_at || metrics.generated_at || "?"} · ${
        quarterly.quarters?.length ?? 0
    } quarters`;

    renderTable(
        document.getElementById("tbl-thresholds"),
        { columns: Object.keys(thresholds[0] || {}), rows: thresholds },
        "thresholds"
    );

    const qrows = (quarterly.quarters || []).slice().reverse();
    renderTable(
        document.getElementById("tbl-quarterly"),
        {
          columns: qrows[0] ? Object.keys(qrows[0]) : [],
          rows: qrows,
          n_rows: qrows.length,
        },
        "quarterly"
    );
    let examplesMount = document.getElementById("quarterly-examples");
    if (!examplesMount) {
      const panel = document.getElementById("panel-quarterly");
      examplesMount = document.createElement("div");
      examplesMount.id = "quarterly-examples";
      if (panel) panel.appendChild(examplesMount);
    }
    const drawExamples = () => {
      try {
        renderQuarterlyExamples(examplesMount, qrows, thresholds, metrics, raw);
        if (examplesMount && !examplesMount.innerHTML.trim()) {
          examplesMount.innerHTML =
              `<article class="col-card"><p class="err">examples ran but produced no cards. first row keys: ${
                  qrows[0] ? Object.keys(qrows[0]).join(", ") : "(no rows)"
              }</p></article>`;
        }
      } catch (err) {
        if (examplesMount) {
          examplesMount.innerHTML = `<article class="col-card"><p class="err">${err.message}</p></article>`;
        }
        throw err;
      }
    };
    window.reshuffleExamples = drawExamples;
    drawExamples();
    const reshuffle = document.getElementById("btn-reshuffle");
    if (reshuffle) {
      reshuffle.onclick = (e) => {
        e.preventDefault();
        drawExamples();
      };
    }

    const metricNames = Object.keys(metrics.tables || {});
    picker(document.getElementById("metric-picker"), metricNames, (name) => {
      renderTable(document.getElementById("tbl-metrics"), metrics.tables[name], name);
    });

    const rawNames = Object.keys(raw.tables || {});
    picker(document.getElementById("raw-picker"), rawNames, (name) => {
      renderTable(document.getElementById("tbl-raw"), raw.tables[name], name);
      renderColumnNotes(document.getElementById("raw-col-notes"), raw.tables[name]);
    });

    document.getElementById("raw-note").textContent = raw.note || "";
    const catRows = raw.catalog || [];
    renderTable(
        document.getElementById("tbl-catalog"),
        {
          columns: catRows[0] ? Object.keys(catRows[0]) : [],
          rows: catRows.map((r) => ({
            ...r,
            columns: Array.isArray(r.columns) ? r.columns.join(", ") : r.columns,
          })),
        },
        "catalog"
    );
  } catch (err) {
    stamp.innerHTML = `<span class="err">${err.message}. Run the build script, then serve the repo root over http.</span>`;
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) showTab(btn.dataset.tab);
});

load();