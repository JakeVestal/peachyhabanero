// The Overnight Clearing Desk — game engine.
//
// Pure functions only (no Firebase, no DOM) so the rules can be unit-tested
// and so the host page and the student page apply exactly the same logic.
//
// Units: balance-sheet amounts in $ billions, rates in percent (4.40 = 4.40%).
//
// Repo vocabulary used throughout ("price of cash" convention):
//   BID   = a bank wants to BORROW cash overnight. It pledges Treasuries
//           (it does a repo). Higher bid rate = more aggressive.
//   OFFER = a bank wants to LEND cash overnight. It receives Treasuries as
//           collateral (it does a reverse repo). Lower offer = more aggressive.
// A bid and an offer trade when bid rate >= offer rate. The trade prints at
// the rate of whichever order was resting in the book first.

export const STARTING_BS = {
  fixedLoans: 80, floatingAssets: 20, treasuries: 20, cash: 0, repoLent: 0,
  stickyDep: 90, volatile: 20, repoBorrowed: 0, equity: 10,
  pledged: 0,
};

export const FIXED_LOAN_RATE = 6.50;   // %
export const STICKY_DEP_RATE = 3.50;   // %
export const FLOAT_SPREAD = 1.00;      // SOFR + 100 bps
export const OVERDRAFT_PENALTY = 1.00; // unsecured Fed overdraft = SRF + 100 bps
export const DAY_COUNT = 360;
export const FED = "FED";
export const EPS = 0.005;              // $5M — anything smaller is treated as zero

const BS_FIELDS = Object.keys(STARTING_BS);

export const r2 = (x) => Math.round(x * 100) / 100;      // volumes, rates
export const r6 = (x) => Math.round(x * 1e6) / 1e6;      // balance-sheet values ($1k precision)

export const isExternal = (stub) => typeof stub === "string" && stub.startsWith("ext_");

export function newState(now = Date.now()) {
  return {
    created: now,
    day: 1,
    phase: "trading",              // "trading" | "closed"
    rates: { srf: 4.50, iorb: 4.40 },
    banks: {}, orders: {}, trades: {}, history: {},
    timerEnd: null,                // epoch ms; host sets this to open a timed session
    timerPaused: false,            // true while the countdown is paused
    timerRemainingMs: null,        // remaining ms while paused
    sofrHistory: [],               // [{day, sofr}] appended on each close
    closedBy: null,                // "timer" | "manual" | null
  };
}

// Inclusive range, rounded to 2 decimals. Used only for starting balance sheets.
function randBetween(rnd, lo, hi) {
  return lo + (hi - lo) * rnd();
}

// Build a starting balance sheet that still totals $120B of assets (and
// balances), but is not identical across banks. Cash is deliberately spread
// so some banks have surplus to lend and some have a funding need.
//
// Ranges are kept tight on purpose:
//   cash            −6 to +7    (~45% need cash, the rest can lend)
//   treasuries      14 to 26    (enough free collateral to repo against)
//   floatingAssets  12 to 26
//   fixedLoans      the residual of the non-cash assets (stays the bulk)
//   volatile        12 to 28    (sticky deposits take the rest of the 110 of funding)
//   equity          fixed at 10
export function randomStartingBS(rnd = Math.random) {
  const cash = r2(randBetween(rnd, -6, 7));
  const remaining = 120 - cash;
  let treasuries = r2(randBetween(rnd, 14, 26));
  let floatingAssets = r2(randBetween(rnd, 12, 26));
  let fixedLoans = r2(remaining - treasuries - floatingAssets);
  // If the residual lands outside a sane band, pull from the other two.
  if (fixedLoans < 55) {
    const need = r2(55 - fixedLoans);
    const cutT = r2(Math.min(treasuries - 14, need));
    treasuries = r2(treasuries - cutT);
    floatingAssets = r2(floatingAssets - (need - cutT));
    fixedLoans = r2(remaining - treasuries - floatingAssets);
  } else if (fixedLoans > 90) {
    const extra = r2(fixedLoans - 90);
    treasuries = r2(treasuries + extra / 2);
    floatingAssets = r2(floatingAssets + extra / 2);
    fixedLoans = r2(remaining - treasuries - floatingAssets);
  }
  const volatile = r2(randBetween(rnd, 12, 28));
  const stickyDep = r2(110 - volatile);
  return {
    fixedLoans, floatingAssets, treasuries, cash, repoLent: 0,
    stickyDep, volatile, repoBorrowed: 0, equity: 10,
    pledged: 0,
  };
}

export function newBank(name, now = Date.now(), rnd = Math.random) {
  return { name, created: now, ...randomStartingBS(rnd) };
}

// Firebase drops empty objects and null values, so anything read back from
// the database has to be filled in before the engine touches it.
export function normalize(raw) {
  const s = raw ? JSON.parse(JSON.stringify(raw)) : newState();
  s.day = s.day || 1;
  s.phase = s.phase || "trading";
  s.rates = { srf: 4.50, iorb: 4.40, ...(s.rates || {}) };
  for (const k of ["banks", "orders", "trades", "history"]) s[k] = s[k] || {};
  if (s.sofr === undefined) s.sofr = null;
  if (s.lastSofr === undefined) s.lastSofr = null;
  if (s.timerEnd === undefined) s.timerEnd = null;
  if (s.timerPaused === undefined) s.timerPaused = false;
  if (s.timerRemainingMs === undefined) s.timerRemainingMs = null;
  if (!Array.isArray(s.sofrHistory)) s.sofrHistory = [];
  if (s.closedBy === undefined) s.closedBy = null;
  for (const b of Object.values(s.banks)) {
    for (const f of BS_FIELDS) if (typeof b[f] !== "number" || isNaN(b[f])) b[f] = 0;
  }
  for (const o of Object.values(s.orders)) {
    o.remaining = typeof o.remaining === "number" ? o.remaining : o.volume;
    o.ts = typeof o.ts === "number" ? o.ts : 0;
  }
  return s;
}

// Strip undefined so Firebase accepts the object.
export const clean = (s) => JSON.parse(JSON.stringify(s));

let idCounter = 0;
export function makeId(prefix = "t", now = Date.now()) {
  idCounter = (idCounter + 1) % 1296;
  return `${prefix}${now.toString(36)}${idCounter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- bank math

export function freeCollateral(b) { return r6(b.treasuries - b.pledged); }

export function totals(b) {
  const assets = b.fixedLoans + b.floatingAssets + b.treasuries + b.cash + b.repoLent;
  const liabEq = b.stickyDep + b.volatile + b.repoBorrowed + b.equity;
  return { assets: r6(assets), liabEq: r6(liabEq), balanced: Math.abs(assets - liabEq) < 1e-4 };
}

export function openOrders(s, stub) {
  return Object.entries(s.orders)
    .filter(([, o]) => o.stub === stub && o.status === "open" && o.day === s.day)
    .map(([id, o]) => ({ id, ...o }));
}

// How much more a bank can bid for / offer, after its resting orders.
export function capacity(s, stub) {
  const b = s.banks[stub];
  if (!b) return { canBorrow: 0, canLend: 0 };
  const mine = openOrders(s, stub);
  const openBids = mine.filter((o) => o.side === "bid").reduce((a, o) => a + o.remaining, 0);
  const openOffers = mine.filter((o) => o.side === "offer").reduce((a, o) => a + o.remaining, 0);
  return {
    canBorrow: r2(Math.max(0, freeCollateral(b) - openBids)),
    canLend: r2(Math.max(0, b.cash - openOffers)),
  };
}

// Returns an error string, or null if the order is acceptable.
export function validateOrder(s, stub, side, rate, volume) {
  if (s.phase !== "trading") return "The market is closed for today. Wait for the next day.";
  if (!s.banks[stub] && !isExternal(stub)) return "This bank no longer exists in the session.";
  if (side !== "bid" && side !== "offer") return "Unknown order side.";
  if (!isFinite(rate) || rate < 0 || rate > 25) return "Enter a rate between 0% and 25%.";
  if (!isFinite(volume) || volume < 0.01) return "Enter a volume of at least $0.01B.";
  if (volume > 200) return "Volume is too large.";
  if (isExternal(stub)) return null;
  const cap = capacity(s, stub);
  if (side === "bid" && volume > cap.canBorrow + 1e-9) {
    return `You can only borrow up to $${cap.canBorrow.toFixed(2)}B: that is how many Treasuries you have left to pledge as collateral.`;
  }
  if (side === "offer" && volume > cap.canLend + 1e-9) {
    return `You can only lend up to $${cap.canLend.toFixed(2)}B: that is the cash you have left after your other offers.`;
  }
  return null;
}

// Soft warnings that teach the Fed corridor; the student may still proceed.
export function corridorWarning(s, side, rate) {
  const { srf, iorb } = s.rates;
  if (side === "bid" && rate > srf) {
    return `You are bidding ${rate.toFixed(2)}%, above the Fed's Standing Repo Facility rate (${srf.toFixed(2)}%). Any shortfall left at the close is funded at the SRF rate automatically, so this costs you more than the Fed would charge.`;
  }
  if (side === "offer" && rate < iorb) {
    return `You are offering ${rate.toFixed(2)}%, below Interest on Reserve Balances (${iorb.toFixed(2)}%). Cash you leave at the Fed earns IORB, so lending below it loses money.`;
  }
  return null;
}

export function orderName(s, o) {
  return o.name || s.banks[o.stub]?.name || o.stub;
}

// ---------------------------------------------------------------- matching

function cancelOrder(o, note) { o.status = "cancelled"; o.note = note; }

// Continuous double-auction matching (price-time priority).
// Mutates s; returns the list of trades created.
export function matchOrders(s, now = Date.now(), idFn = makeId) {
  const fills = [];
  if (s.phase !== "trading") return fills;
  const open = Object.entries(s.orders)
    .filter(([, o]) => o.status === "open" && o.day === s.day && o.remaining > EPS);
  const bids = open.filter(([, o]) => o.side === "bid").sort((a, b) => b[1].rate - a[1].rate || a[1].ts - b[1].ts);
  const offers = open.filter(([, o]) => o.side === "offer").sort((a, b) => a[1].rate - b[1].rate || a[1].ts - b[1].ts);

  for (const [bidId, bid] of bids) {
    for (const [offerId, offer] of offers) {
      if (bid.status !== "open" || bid.remaining <= EPS) break;
      if (offer.status !== "open" || offer.remaining <= EPS) continue;
      if (offer.rate > bid.rate + 1e-9) break;          // offers are sorted cheapest first
      if (offer.stub === bid.stub) continue;            // no self-trades

      const lender = s.banks[offer.stub];
      const borrower = s.banks[bid.stub];
      if (!isExternal(offer.stub) && !lender) { cancelOrder(offer, "Bank removed"); continue; }
      if (!isExternal(bid.stub) && !borrower) { cancelOrder(bid, "Bank removed"); break; }

      const cashAvail = isExternal(offer.stub) ? Infinity : lender.cash;
      const collAvail = isExternal(bid.stub) ? Infinity : freeCollateral(borrower);
      if (cashAvail < 0.01) { cancelOrder(offer, "Cancelled: no cash left to lend"); continue; }
      if (collAvail < 0.01) { cancelOrder(bid, "Cancelled: no free Treasuries left to pledge"); break; }

      const volume = r2(Math.min(bid.remaining, offer.remaining, cashAvail, collAvail));
      if (volume < 0.01) continue;
      const resting = offer.ts <= bid.ts ? offer : bid;
      const rate = r2(resting.rate);

      if (lender) { lender.cash = r6(lender.cash - volume); lender.repoLent = r6(lender.repoLent + volume); }
      if (borrower) {
        borrower.cash = r6(borrower.cash + volume);
        borrower.repoBorrowed = r6(borrower.repoBorrowed + volume);
        borrower.pledged = r6(borrower.pledged + volume);
      }
      const trade = {
        day: s.day, kind: "private", ts: now, rate, volume,
        lender: offer.stub, lenderName: orderName(s, offer),
        borrower: bid.stub, borrowerName: orderName(s, bid),
        bidId, offerId,
      };
      s.trades[idFn("t", now)] = trade;
      fills.push(trade);

      bid.remaining = r2(bid.remaining - volume);
      offer.remaining = r2(offer.remaining - volume);
      bid.filled = r2((bid.filled || 0) + volume);
      offer.filled = r2((offer.filled || 0) + volume);
      if (bid.remaining <= EPS) { bid.remaining = 0; bid.status = "filled"; }
      if (offer.remaining <= EPS) { offer.remaining = 0; offer.status = "filled"; }
    }
  }
  return fills;
}

export function hasCross(s) {
  const open = Object.values(s.orders).filter((o) => o.status === "open" && o.day === s.day && o.remaining > EPS);
  const bids = open.filter((o) => o.side === "bid");
  const offers = open.filter((o) => o.side === "offer");
  return bids.some((b) => offers.some((o) => o.stub !== b.stub && o.rate <= b.rate + 1e-9));
}

// ---------------------------------------------------------------- SOFR & close

export function volumeWeightedMedian(trades) {
  const valid = trades.filter((t) => t.volume > 0 && isFinite(t.rate)).sort((a, b) => a.rate - b.rate);
  if (!valid.length) return null;
  const half = valid.reduce((a, t) => a + t.volume, 0) / 2;
  let cum = 0;
  for (const t of valid) { cum += t.volume; if (cum >= half - 1e-9) return t.rate; }
  return valid[valid.length - 1].rate;
}

export function tradesForDay(s, day = s.day) {
  return Object.entries(s.trades)
    .filter(([, t]) => t.day === day)
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
}

// Close the interbank market for the day:
//  1. expire every open order,
//  2. print SOFR = volume-weighted median of today's PRIVATE trades
//     (Fed operations are excluded, as with the real SOFR),
//  3. fund any remaining shortfall at the Fed SRF (secured by free Treasuries),
//     anything beyond the collateral as an unsecured overdraft at SRF + 100 bps,
//  4. record surplus cash as parked at the Fed earning IORB.
export function closeMarket(s, now = Date.now(), idFn = makeId) {
  if (s.phase === "closed") return { sofr: s.sofr, already: true };
  for (const o of Object.values(s.orders)) {
    if (o.status === "open") { o.status = "expired"; o.note = "Market closed"; }
  }
  const privateTrades = tradesForDay(s).filter((t) => t.kind === "private");
  s.sofr = volumeWeightedMedian(privateTrades);

  const { srf, iorb } = s.rates;
  let srfCount = 0, overdraftCount = 0, parkedCount = 0;
  for (const [stub, b] of Object.entries(s.banks)) {
    if (b.cash < -EPS) {
      const need = r6(-b.cash);
      const secured = r2(Math.min(need, Math.max(0, freeCollateral(b))));
      if (secured >= 0.01) {
        b.cash = r6(b.cash + secured);
        b.repoBorrowed = r6(b.repoBorrowed + secured);
        b.pledged = r6(b.pledged + secured);
        s.trades[idFn("f", now)] = { day: s.day, kind: "srf", ts: now, rate: srf, volume: secured,
          lender: FED, lenderName: "Fed SRF", borrower: stub, borrowerName: b.name };
        srfCount++;
      }
      const rest = r6(-b.cash);
      if (rest > EPS) {
        b.cash = r6(b.cash + rest);
        b.repoBorrowed = r6(b.repoBorrowed + rest);
        s.trades[idFn("f", now)] = { day: s.day, kind: "overdraft", ts: now, rate: r2(srf + OVERDRAFT_PENALTY), volume: r2(rest),
          lender: FED, lenderName: "Fed overdraft", borrower: stub, borrowerName: b.name };
        overdraftCount++;
      }
    } else if (b.cash > EPS) {
      s.trades[idFn("f", now)] = { day: s.day, kind: "iorb", ts: now, rate: iorb, volume: r2(b.cash),
        lender: stub, lenderName: b.name, borrower: FED, borrowerName: "Fed (IORB)" };
      parkedCount++;
    }
  }
  s.phase = "closed";
  s.closedAt = now;
  s.timerEnd = null;                 // countdown is over
  s.timerPaused = false;
  s.timerRemainingMs = null;
  if (!Array.isArray(s.sofrHistory)) s.sofrHistory = [];
  if (!s.sofrHistory.some((h) => h.day === s.day)) {
    s.sofrHistory.push({ day: s.day, sofr: s.sofr });
  }
  return { sofr: s.sofr, privateCount: privateTrades.length, srfCount, overdraftCount, parkedCount };
}

// ---------------------------------------------------------------- end of day

// Accrue one night of interest, unwind every overnight repo, archive the day.
export function advanceDay(s, now = Date.now(), idFn = makeId) {
  if (s.phase !== "closed") closeMarket(s, now, idFn);
  const { iorb } = s.rates;
  const sofrRef = s.sofr ?? s.lastSofr ?? iorb;   // floating assets reset to SOFR + 100 bps
  const today = tradesForDay(s);
  const flows = today.filter((t) => t.kind !== "iorb");

  for (const [stub, b] of Object.entries(s.banks)) {
    const p = {
      fixedLoans: b.fixedLoans * FIXED_LOAN_RATE / 100,
      floating: b.floatingAssets * (sofrRef + FLOAT_SPREAD) / 100,
      reserves: Math.max(0, b.cash) * iorb / 100,
      repoIncome: 0,
      deposits: -b.stickyDep * STICKY_DEP_RATE / 100,
      repoExpense: 0,
    };
    for (const t of flows) {
      const interest = t.volume * t.rate / 100;
      if (t.lender === stub) p.repoIncome += interest;
      if (t.borrower === stub) p.repoExpense -= interest;
    }
    for (const k of Object.keys(p)) p[k] = r6(p[k] / DAY_COUNT);
    const net = r6(Object.values(p).reduce((a, x) => a + x, 0));
    b.equity = r6(b.equity + net);
    b.cash = r6(b.cash + net);
    b.dayPnL = net;
    b.pnl = p;
  }

  // Overnight repos mature: cash goes back to lenders, collateral is released.
  for (const t of flows) {
    const lender = s.banks[t.lender];
    const borrower = s.banks[t.borrower];
    if (lender) { lender.cash = r6(lender.cash + t.volume); lender.repoLent = r6(lender.repoLent - t.volume); }
    if (borrower) {
      borrower.cash = r6(borrower.cash - t.volume);
      borrower.repoBorrowed = r6(borrower.repoBorrowed - t.volume);
      if (t.kind !== "overdraft") borrower.pledged = r6(borrower.pledged - t.volume);
    }
  }
  for (const b of Object.values(s.banks)) {
    if (Math.abs(b.repoLent) < 1e-6) b.repoLent = 0;
    if (Math.abs(b.repoBorrowed) < 1e-6) b.repoBorrowed = 0;
    if (Math.abs(b.pledged) < 1e-6) b.pledged = 0;
  }

  const privateTrades = today.filter((t) => t.kind === "private");
  s.history["d" + s.day] = {
    day: s.day,
    sofr: s.sofr,
    floatRate: r2(sofrRef + FLOAT_SPREAD),
    volume: r2(privateTrades.reduce((a, t) => a + t.volume, 0)),
    trades: privateTrades.length,
    banks: Object.fromEntries(Object.entries(s.banks).map(([stub, b]) =>
      [stub, { name: b.name, equity: b.equity, dayPnL: b.dayPnL, cash: b.cash }])),
  };

  const finishedDay = s.day;
  s.lastSofr = s.sofr ?? s.lastSofr ?? null;
  s.day += 1;
  s.sofr = null;
  s.phase = "trading";
  s.shock = null;
  s.timerEnd = null;
  s.timerPaused = false;
  s.timerRemainingMs = null;
  s.closedBy = null;
  for (const [id, o] of Object.entries(s.orders)) if (o.day < s.day) delete s.orders[id];
  return { finishedDay, sofrRef };
}

// ---------------------------------------------------------------- shocks

// field: "volatile" (wholesale funding runs off / flows in),
//        "stickyDep" (deposit outflow such as tax payments),
//        "treasuries" (bank buys / receives Treasuries and pays cash).
// Subtract (or add) the same amount from every bank. Default is a 5B
// runoff of volatile funding — cash falls by the same amount.
export function systemicShock(s, amount = -5, field = "volatile") {
  const n = Object.keys(s.banks).length;
  for (const b of Object.values(s.banks)) shockBank(b, field, amount);
  s.shock = {
    title: "Systemic Shock",
    text: `Every bank: ${amount > 0 ? "+" : ""}${amount}B ${field}`,
    note: "Volatile funding runoff. Cash falls by the same amount.",
  };
  return n;
}

export function shockBank(b, field, amount) {
  const a = Number(amount) || 0;
  if (field === "volatile") { b.volatile = r6(b.volatile + a); b.cash = r6(b.cash + a); }
  else if (field === "stickyDep") { b.stickyDep = r6(b.stickyDep + a); b.cash = r6(b.cash + a); }
  else if (field === "treasuries") { b.treasuries = r6(b.treasuries + a); b.cash = r6(b.cash - a); }
  else throw new Error("Unknown shock field " + field);
}

export function applyCard(s, card) {
  if (card.shock && card.shock.type === "systemic") {
    for (const b of Object.values(s.banks)) shockBank(b, card.shock.field, card.shock.amount);
  }
  s.shock = { title: card.title, text: card.description, note: card.shock?.note || "" };
}

export function randomizeShocks(s, rnd = Math.random) {
  const stubs = Object.keys(s.banks);
  if (!stubs.length) return [];
  const options = [-9, -7, -5, -3, -1, 2, 4, 6, 8];
  let shocks, attempts = 0;
  do {
    shocks = stubs.map(() => options[Math.floor(rnd() * options.length)]);
    attempts++;
  } while (stubs.length > 1 && (!shocks.some((x) => x > 0) || !shocks.some((x) => x < 0)) && attempts < 50);
  const summary = stubs.map((stub, i) => {
    shockBank(s.banks[stub], "volatile", shocks[i]);
    return { stub, name: s.banks[stub].name, amount: shocks[i] };
  });
  s.shock = {
    title: "Random liquidity shocks",
    text: summary.map((x) => `${x.name}: ${x.amount > 0 ? "+" : ""}${x.amount}B`).join(" · "),
    note: "Positive = surplus cash to lend; negative = funding need.",
    perBank: Object.fromEntries(summary.map((x) => [x.stub, x.amount])),   // students only see their own line
  };
  return summary;
}

export function removeBank(s, stub) {
  delete s.banks[stub];
  for (const o of Object.values(s.orders)) {
    if (o.stub === stub && o.status === "open") cancelOrder(o, "Bank removed");
  }
}
