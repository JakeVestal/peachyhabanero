// Shared rendering for the host page and the student bank page.
import * as E from "./overnight-engine.js";

export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// x is in $ billions.
// Large amounts stay in $B. Small non-zero residuals switch to $M (or $K)
// so a real $12M repo does not display as $0.00B.
export function fmtMoney(x) {
  const n = Number(x) || 0;
  const sign = n < -1e-12 ? "−" : "";
  const a = Math.abs(n);
  if (a < 1e-9) return "$0";
  if (a >= 0.05) return sign + "$" + a.toFixed(2) + "B";
  const millions = a * 1000;
  if (millions >= 0.05) return sign + "$" + millions.toFixed(millions >= 10 ? 1 : 2) + "M";
  const thousands = a * 1e6;
  return sign + "$" + thousands.toFixed(0) + "K";
}

export const fmtB = (x, d = 1) => (x < -1e-9 ? "−" : "") + "$" + Math.abs(x || 0).toFixed(d) + "B";
export const fmtM = (x) => (x < 0 ? "−" : "+") + "$" + Math.abs((x || 0) * 1000).toFixed(2) + "M";
export const fmtPct = (x) => (x == null || !isFinite(x) ? "—" : Number(x).toFixed(2) + "%");

// Shared plot config so instructor and student pages stay consistent.
export const PLOT_TENORS = E.TENORS || ["1M", "6M", "1Y", "2Y", "5Y", "10Y"];
export const PLOT_COLOR = "#4fc3f7";
export const PLOT_SURFACE_COLORS = "Viridis";

export function fmtTreasuryMix(book) {
  if (!book) return "";
  const parts = [];
  for (const t of PLOT_TENORS) {
    const v = Number(book[t]) || 0;
    if (v > 0.05) parts.push(`${t} ${v.toFixed(1)}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

export function fmtDuration(book, curve) {
  if (!book) return "—";
  const d = E.duration(book, curve);
  return isFinite(d) ? d.toFixed(2) + "y" : "—";
}

// If a situation card carries a curve or curveShift, apply it and mark books.
export function applyCardCurve(s, card) {
  if (!card) return s;
  if (card.curve) {
    E.applyCurve(s, card.curve);
  } else if (card.curveShift) {
    const shift = card.curveShift;
    const next = {};
    for (const t of PLOT_TENORS) {
      const base = (s.curve && s.curve[t]) || E.DEFAULT_CURVE[t];
      const delta = typeof shift === "number" ? shift : (shift[t] || 0);
      next[t] = E.r2(base + delta);
    }
    E.applyCurve(s, next);
  }
  return s;
}

const TIP = {
  fixedLoans: "Fixed-rate corporate loans earning a constant 6.50%. They do not reprice with SOFR.",
  floatingAssets: "Floating-rate assets that reprice daily to SOFR + 100 bps. A higher SOFR raises the yield on this book.",
  treasuries: "US Treasuries (HQLA). You pledge them as collateral when you borrow cash in repo. Pledged Treasuries stay on your balance sheet but can't be pledged twice.",
  repoLent: "Reverse repo: cash you lent overnight against Treasury collateral. It comes back tomorrow with interest.",
  cash: "Reserves at the Fed: the residual balancing item. Negative = a funding need you must cover today. Positive = surplus you can lend or leave at the Fed earning IORB.",
  stickyDep: "Wholesale corporate deposits: stable funding that costs a fixed 3.50%.",
  volatile: "Institutional short-term funding that can run off quickly. Liquidity shocks usually hit this line.",
  repoBorrowed: "Overnight repo borrowing (from other banks or the Fed SRF). You repay it tomorrow with interest.",
  equity: "Shareholders' equity. It grows or shrinks each night by your net interest income.",
};

function row(label, key, value, cls = "") {
  const tip = esc(TIP[key] || "");
  return `<tr title="${tip}"><td title="${tip}">${label}</td><td class="num ${cls}" title="${tip}">${value}</td></tr>`;
}

export function orderLine(o) {
  const verb = o.side === "bid" ? "BID · borrow" : "OFFER · lend";
  const part = o.filled ? ` <span class="muted">(${o.filled.toFixed(2)} of ${o.volume.toFixed(2)} filled)</span>` : "";
  return `<span class="${o.side}">${verb}</span> ${fmtMoney(o.remaining)} @ ${fmtPct(o.rate)}${part}`;
}

export function balanceSheetHTML(s, stub) {
  const b = s.banks[stub];
  if (!b) return "<p class='muted'>Bank not found.</p>";
  const t = E.totals(b);
  const plan = s.reservePlans && s.reservePlans[stub];
  const target = plan ? (plan.target || 0) : 0;
  const gap = E.r6((b.cash || 0) - target);
  const free = E.freeCollateral(b);
  const { srf, iorb } = s.rates;
  const pledgedNote = b.pledged > E.EPS ? ` <span class="muted">(${fmtMoney(b.pledged)} pledged)</span>` : "";
  let status;
  if (gap < -E.EPS) {
    status = s.phase === "trading"
      ? `<span class="neg">Shortfall vs target ${fmtMoney(gap)}</span>: bid for cash. Anything still short at the close is funded by the Fed SRF at ${fmtPct(srf)}.`
      : `<span class="neg">Shortfall vs target ${fmtMoney(gap)}</span>`;
  } else if (gap > E.EPS) {
    status = s.phase === "trading"
      ? `<span class="pos">Surplus vs target ${fmtMoney(gap)}</span>: you can lend this much and still meet the risk-desk target, or leave it at the Fed earning IORB ${fmtPct(iorb)}.`
      : `<span class="pos">Surplus vs target ${fmtMoney(gap)}</span> at the Fed earning IORB ${fmtPct(iorb)}.`;
  } else {
    status = `<span class="pos">At target</span>: no surplus or shortfall.`;
  }

  const orders = E.openOrders(s, stub).sort((a, c) => a.ts - c.ts);
  const ordersHTML = orders.length
    ? `<div class="pending"><div class="pending-h">Pending orders (in the book)</div>${orders.map((o) => `<div>${orderLine(o)}</div>`).join("")}</div>`
    : "";

  const pnl = b.dayPnL != null && s.day > 1
    ? `<div class="muted small">Last night's net interest: <span class="${b.dayPnL < 0 ? "neg" : "pos"}">${fmtM(b.dayPnL)}</span></div>`
    : "";

  return `
    <table class="bs-table">
      <tr class="bs-h"><td colspan="2">Assets</td></tr>
      ${row("Fixed loans (6.50%)", "fixedLoans", fmtMoney(b.fixedLoans))}
      ${row("Floating (SOFR+100)", "floatingAssets", fmtMoney(b.floatingAssets))}
      ${row("Treasuries (HQLA)" + pledgedNote, "treasuries", fmtMoney(b.treasuries))}
      ${b.treasuryBook ? `<tr><td colspan="2" class="muted small" style="padding-left:1.2em">Mix: ${esc(fmtTreasuryMix(b.treasuryBook))} · Dur ${fmtDuration(b.treasuryBook, s.curve)}</td></tr>` : ""}
      ${row("Reverse repo (cash lent)", "repoLent", fmtMoney(b.repoLent), b.repoLent > E.EPS ? "hl" : "")}
      ${row("<strong>Current reserve balance</strong>", "cash", fmtMoney(gap), gap < -E.EPS ? "neg" : "pos")}
      <tr class="bs-total"><td>Total assets</td><td class="num">${fmtMoney(t.assets)}</td></tr>
      <tr class="bs-h"><td colspan="2">Liabilities & equity</td></tr>
      ${row("Sticky deposits (3.50%)", "stickyDep", fmtMoney(b.stickyDep))}
      ${row("Volatile ST funding", "volatile", fmtMoney(b.volatile))}
      ${row("Repo borrowings", "repoBorrowed", fmtMoney(b.repoBorrowed), b.repoBorrowed > E.EPS ? "hl" : "")}
      ${row("Equity", "equity", fmtMoney(b.equity))}
      <tr class="bs-total"><td>Total liab. + equity</td><td class="num">${fmtMoney(t.liabEq)}</td></tr>
    </table>
    <div class="small">${status}</div>
    <div class="muted small">Free collateral: ${fmtMoney(free)} of Treasuries left to pledge</div>
    ${pnl}
    ${ordersHTML}`;
}

export function tradeLineFor(t, stub) {
  const v = fmtMoney(t.volume), r = fmtPct(t.rate);
  if (t.kind === "iorb") return `<span class="k-iorb">Left ${v} at the Fed earning IORB ${r}</span>`;
  if (t.borrower === stub) {
    const cls = t.kind === "private" ? "k-private" : t.kind === "srf" ? "k-srf" : "k-od";
    return `<span class="${cls}">Borrowed ${v} from ${esc(t.lenderName)} @ ${r}</span>`;
  }
  return `<span class="k-private">Lent ${v} to ${esc(t.borrowerName)} @ ${r}</span>`;
}

// Cash-flow tape for a single bank (inflows/outflows applied on ticks).
export function cashFlowTapeHTML(s, stub) {
  const plan = s.reservePlans && s.reservePlans[stub];
  if (!plan || !plan.tape || !plan.tape.length) {
    return `<div class="muted small">No cash flows yet this day.</div>`;
  }
  const lines = plan.tape.slice().reverse().map(entry => {
    const sign = entry.amount > 0 ? "+" : "";
    const cls = entry.amount > 0 ? "pos" : "neg";
    const totalMin = 9 * 60 + 30 + (entry.tick || 0) * 5;
    let h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + " " + ampm;
    return `<div class="tape-row"><span class="tape-t">${time}</span><span class="${cls}">${sign}${fmtMoney(entry.amount)}</span> <span class="muted">${esc(entry.note || "")}</span></div>`;
  }).join("");
  return `<div class="tape" style="max-height:180px">${lines}</div>`;
}

export function tapeLine(t) {
  const v = fmtMoney(t.volume), r = fmtPct(t.rate);
  const time = new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const label = { private: "REPO", srf: "SRF", overdraft: "OVERDRAFT", iorb: "IORB" }[t.kind] || t.kind;
  return `<div class="tape-row k-${t.kind === "overdraft" ? "od" : t.kind}"><span class="tape-t">${time}</span>`
    + `<span class="tape-k">${label}</span> ${esc(t.lenderName)} → ${esc(t.borrowerName)} ${v} @ ${r}</div>`;
}

// Order book: bids (want cash) on the left, offers (have cash) on the right.
export function orderBookHTML(s, { highlightStub = null } = {}) {
  const open = Object.values(s.orders).filter((o) => o.status === "open" && o.day === s.day && o.remaining > E.EPS);
  const bids = open.filter((o) => o.side === "bid").sort((a, b) => b.rate - a.rate || a.ts - b.ts);
  const offers = open.filter((o) => o.side === "offer").sort((a, b) => a.rate - b.rate || a.ts - b.ts);
  const line = (o) => `<tr class="${o.stub === highlightStub ? "mine" : ""}"><td>${esc(E.orderName(s, o))}${o.stub === highlightStub ? " (you)" : ""}</td><td class="num">${fmtMoney(o.remaining)}</td><td class="num">${fmtPct(o.rate)}</td></tr>`;
  const side = (title, list, cls, empty) => `
    <div class="book-side">
      <div class="book-h ${cls}">${title}</div>
      <table class="book-table">${list.length ? list.map(line).join("") : `<tr><td class="muted">${empty}</td></tr>`}</table>
    </div>`;
  return `<div class="book">
    ${side("BIDS: want to borrow cash", bids, "bid", "No bids")}
    ${side("OFFERS: want to lend cash", offers, "offer", "No offers")}
  </div>`;
}

export function bestQuotes(s) {
  const open = Object.values(s.orders).filter((o) => o.status === "open" && o.day === s.day && o.remaining > E.EPS);
  const bids = open.filter((o) => o.side === "bid").map((o) => o.rate);
  const offers = open.filter((o) => o.side === "offer").map((o) => o.rate);
  return { bestBid: bids.length ? Math.max(...bids) : null, bestOffer: offers.length ? Math.min(...offers) : null };
}

// Overnight results for a bank on a finished day.
// Uses the same interest math as advanceDay (volume * rate / 100 / DAY_COUNT).
// Principals are unwound at advance, so the net cash change from the overnight
// market is exactly the net interest on these flows.
export function overnightResultsHTML(s, stub, day) {
  if (!day || day < 1) return "";
  const trades = E.tradesForDay(s, day).filter(t => t.lender === stub || t.borrower === stub);
  if (!trades.length) return `<div class="muted small">No overnight activity on day ${day}.</div>`;

  const interestOf = (t) => E.r6(t.volume * t.rate / 100 / E.DAY_COUNT);

  const borrowed = [];
  const lent = [];
  let net = 0;

  for (const t of trades) {
    const int = interestOf(t);
    if (t.borrower === stub) {
      borrowed.push({ t, int });
      net = E.r6(net - int);
    } else if (t.lender === stub) {
      lent.push({ t, int });
      net = E.r6(net + int);
    }
  }

  const line = (t, int, verb) => {
    const who = verb === "Borrowed" ? esc(t.lenderName) : esc(t.borrowerName);
    const kind = t.kind === "srf" ? " (SRF)" : t.kind === "overdraft" ? " (overdraft)" : t.kind === "iorb" ? " (IORB)" : "";
    return `<div>${verb} ${fmtMoney(t.volume)} ${verb === "Borrowed" ? "from" : "to"} ${who}${kind} @ ${fmtPct(t.rate)} — interest ${verb === "Borrowed" ? "paid" : "earned"} ${fmtM(int)}</div>`;
  };

  let html = `<div class="overnight-results">`;
  html += `<div class="pending-h">Overnight results · Day ${day}</div>`;
  if (borrowed.length) {
    html += borrowed.map(({t, int}) => line(t, int, "Borrowed")).join("");
  } else {
    html += `<div class="muted">No borrowings.</div>`;
  }
  if (lent.length) {
    html += lent.map(({t, int}) => line(t, int, "Lent")).join("");
  } else {
    html += `<div class="muted">No lending / IORB.</div>`;
  }
  const netCls = net < 0 ? "neg" : "pos";
  html += `<div class="small" style="margin-top:6px">Net cash change from overnight: <span class="${netCls}">${fmtM(net)}</span></div>`;
  html += `</div>`;
  return html;
}

// Full history of overnight results for a bank (most recent first).
export function overnightHistoryHTML(s, stub) {
  if (!s.day || s.day <= 1) return `<div class="muted small">No completed nights yet.</div>`;
  let html = "";
  for (let d = s.day - 1; d >= 1; d--) {
    html += overnightResultsHTML(s, stub, d);
  }
  return html || `<div class="muted small">No overnight activity recorded.</div>`;
}


const EDIT_FIELDS = [
  ["fixedLoans", "Fixed loans"],
  ["floatingAssets", "Floating"],
  ["treasuries", "Treasuries"],
  ["repoLent", "Reverse repo"],
  ["cash", "Cash / reserves"],
  ["stickyDep", "Sticky deposits"],
  ["volatile", "Volatile ST"],
  ["repoBorrowed", "Repo borrowings"],
  ["equity", "Equity"],
  ["pledged", "Pledged Treasuries"],
];

export function editableBalanceSheetHTML(s, stub) {
  const b = s.banks[stub];
  if (!b) return "";
  const rows = EDIT_FIELDS.map(([key, label]) =>
    `<div class="row" style="gap:8px;margin:4px 0">
      <label class="muted" style="min-width:140px">${label}</label>
      <input class="field bs-edit" data-stub="${esc(stub)}" data-field="${key}" type="number" step="0.01" value="${Number(b[key] || 0)}" style="width:110px">
    </div>`
  ).join("");
  return `<div class="bs-edit-box" data-stub="${esc(stub)}">
    <div class="small muted" style="margin:6px 0">Live balances. Edit any field to freeze this card.</div>
    ${rows}
    <div class="bs-actions" data-stub="${esc(stub)}" style="display:none;margin-top:8px">
      <button class="neon-btn bs-write" data-stub="${esc(stub)}">Write new balance sheet</button>
      <button class="neon-btn bs-cancel" data-stub="${esc(stub)}">Cancel</button>
    </div>
  </div>`;
}


export function marketTableHTML(rows) {
  if (!rows || !rows.length) return "<p class='muted'>No days yet.</p>";
  const cell = (v, kind) => {
    if (v == null || (typeof v === "number" && !isFinite(v))) return "—";
    if (kind === "pct") return fmtPct(v);
    return fmtMoney(v);
  };
  const body = rows.map((r) => `<tr>
    <td>Day ${r.day}${r.live ? " <span class='muted'>(live)</span>" : ""}</td>
    <td class="num">${cell(r.sofr, "pct")}</td>
    <td class="num">${cell(r.volume)}</td>
    <td class="num">${cell(r.grossCash)}</td>
    <td class="num">${cell(r.pledged)}</td>
    <td class="num">${cell(r.available)}</td>
  </tr>`).join("");
  return `<table class="ref" style="width:100%;border-collapse:collapse;font-size:14px">
    <thead><tr>
      <th>Day</th><th>SOFR</th><th>Repo Volume</th>
      <th>Total Reserves</th><th>Pledged Treasuries</th><th>Available Reserves</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <p class="small muted">Available Reserves = Total Reserves − Pledged Treasuries. Repo Volume is private interbank deals only.</p>`;
}

export function historyRows(s, { live = false } = {}) {
  const hist = Array.isArray(s.sofrHistory) ? s.sofrHistory.slice() : [];
  const rows = hist.map((h) => ({
    day: h.day,
    sofr: h.sofr,
    volume: h.volume,
    grossCash: h.grossCash,
    pledged: h.pledged,
    available: h.available,
  }));
  if (live && s.phase === "trading") {
    const snap = E.marketSnapshot(s);
    const privateTrades = E.tradesForDay(s).filter((t) => t.kind === "private");
    rows.push({
      day: s.day,
      sofr: E.volumeWeightedMedian(privateTrades),
      volume: snap.volume,
      grossCash: snap.grossCash,
      pledged: snap.pledged,
      available: snap.available,
      live: true,
    });
  }
  return rows;
}
