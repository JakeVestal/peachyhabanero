// Shared rendering for the host page and the student bank page.
import * as E from "./overnight-engine.js";

export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtB = (x, d = 1) => (x < -1e-9 ? "−" : "") + "$" + Math.abs(x || 0).toFixed(d) + "B";
export const fmtM = (x) => (x < 0 ? "−" : "+") + "$" + Math.abs((x || 0) * 1000).toFixed(2) + "M";
export const fmtPct = (x) => (x == null || !isFinite(x) ? "—" : Number(x).toFixed(2) + "%");

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
  return `<tr title="${esc(TIP[key] || "")}"><td>${label}</td><td class="num ${cls}">${value}</td></tr>`;
}

export function orderLine(o) {
  const verb = o.side === "bid" ? "BID · borrow" : "OFFER · lend";
  const part = o.filled ? ` <span class="muted">(${o.filled.toFixed(2)} of ${o.volume.toFixed(2)} filled)</span>` : "";
  return `<span class="${o.side}">${verb}</span> ${fmtB(o.remaining, 2)} @ ${fmtPct(o.rate)}${part}`;
}

export function balanceSheetHTML(s, stub) {
  const b = s.banks[stub];
  if (!b) return "<p class='muted'>Bank not found.</p>";
  const t = E.totals(b);
  const gap = b.cash;
  const free = E.freeCollateral(b);
  const { srf, iorb } = s.rates;
  const pledgedNote = b.pledged > E.EPS ? ` <span class="muted">(${fmtB(b.pledged)} pledged)</span>` : "";
  let status;
  if (gap < -E.EPS) {
    status = s.phase === "trading"
      ? `<span class="neg">Funding need ${fmtB(gap, 2)}</span>: bid for cash. Anything still short at the close is funded by the Fed SRF at ${fmtPct(srf)}.`
      : `<span class="neg">Funding need ${fmtB(gap, 2)}</span>`;
  } else if (gap > E.EPS) {
    status = s.phase === "trading"
      ? `<span class="pos">Surplus ${fmtB(gap, 2)}</span>: offer it to banks that need cash, or leave it at the Fed earning IORB ${fmtPct(iorb)}.`
      : `<span class="pos">Surplus ${fmtB(gap, 2)}</span> at the Fed earning IORB ${fmtPct(iorb)}.`;
  } else {
    status = `<span class="pos">Flat</span>: no funding gap.`;
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
      ${row("Fixed loans (6.50%)", "fixedLoans", fmtB(b.fixedLoans))}
      ${row("Floating (SOFR+100)", "floatingAssets", fmtB(b.floatingAssets))}
      ${row("Treasuries (HQLA)" + pledgedNote, "treasuries", fmtB(b.treasuries))}
      ${row("Reverse repo (cash lent)", "repoLent", fmtB(b.repoLent, 2), b.repoLent > E.EPS ? "hl" : "")}
      ${row("<strong>Cash / reserves</strong>", "cash", fmtB(gap, 2), gap < -E.EPS ? "neg" : "pos")}
      <tr class="bs-total"><td>Total assets</td><td class="num">${fmtB(t.assets, 2)}</td></tr>
      <tr class="bs-h"><td colspan="2">Liabilities &amp; equity</td></tr>
      ${row("Sticky deposits (3.50%)", "stickyDep", fmtB(b.stickyDep))}
      ${row("Volatile ST funding", "volatile", fmtB(b.volatile))}
      ${row("Repo borrowings", "repoBorrowed", fmtB(b.repoBorrowed, 2), b.repoBorrowed > E.EPS ? "hl" : "")}
      ${row("Equity", "equity", "$" + b.equity.toFixed(3) + "B")}
      <tr class="bs-total"><td>Total liab. + equity</td><td class="num">${fmtB(t.liabEq, 2)}</td></tr>
    </table>
    <div class="small">${status}</div>
    <div class="muted small">Free collateral: ${fmtB(free, 2)} of Treasuries left to pledge</div>
    ${pnl}
    ${ordersHTML}`;
}

export function tradeLineFor(t, stub) {
  const v = fmtB(t.volume, 2), r = fmtPct(t.rate);
  if (t.kind === "iorb") return `<span class="k-iorb">Left ${v} at the Fed earning IORB ${r}</span>`;
  if (t.borrower === stub) {
    const cls = t.kind === "private" ? "k-private" : t.kind === "srf" ? "k-srf" : "k-od";
    return `<span class="${cls}">Borrowed ${v} from ${esc(t.lenderName)} @ ${r}</span>`;
  }
  return `<span class="k-private">Lent ${v} to ${esc(t.borrowerName)} @ ${r}</span>`;
}

export function tapeLine(t) {
  const v = fmtB(t.volume, 2), r = fmtPct(t.rate);
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
  const line = (o) => `<tr class="${o.stub === highlightStub ? "mine" : ""}"><td>${esc(E.orderName(s, o))}${o.stub === highlightStub ? " (you)" : ""}</td><td class="num">${fmtB(o.remaining, 2)}</td><td class="num">${fmtPct(o.rate)}</td></tr>`;
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
