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

// ---------------------------------------------------------------- target reserve balance
// Risk-desk target set at the open of each day.
// Simplified educational formula (adjustable via game parameters):
//   target = k * (stickyDep + volatile) + fixedCushion
// k ≈ 0.11 means the bank wants to hold ~11% of its short-term funding as a reserve buffer.
// fixedCushion is a small absolute floor so even small banks keep a minimal comfort level.
export function calculateTargetReserveBalance(b, params = {}) {
  const k = typeof params.k === "number" ? params.k : 0.11;
  const cushion = typeof params.fixedCushion === "number" ? params.fixedCushion : 1.5;
  const funding = (b.stickyDep || 0) + (b.volatile || 0);
  return r6(Math.max(0.5, k * funding + cushion));
}


// Generate the full day's cash-flow plan for every bank the moment trading starts.
// Pre-computes jumps so the path is deterministic given the seed and parameters.
// Clustering: early ticks more likely positive (inflows), late ticks more likely negative (outflows).
export function generateReservePlans(s, rnd = Math.random, force = false) {
  const params = s.gameParams || {};
  const banks = Object.entries(s.banks);
  if (!banks.length) return;
  // If plans already exist for every current bank and we're not forcing, keep them
  if (!force && s.reservePlans && Object.keys(s.banks).every(stub => s.reservePlans[stub] && Array.isArray(s.reservePlans[stub].jumps))) {
    return;
  }
  const plans = {};
  const fractionShort = typeof params.fractionShort === "number" ? params.fractionShort : 0.40;

  // First compute targets and decide who is assigned a negative net flow
  const stubs = banks.map(([stub]) => stub);
  // Shuffle to pick the short cohort
  for (let i = stubs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [stubs[i], stubs[j]] = [stubs[j], stubs[i]];
  }
  const nShort = Math.round(stubs.length * fractionShort);
  const shortSet = new Set(stubs.slice(0, nShort));

  for (const [stub, b] of banks) {
    const target = calculateTargetReserveBalance(b, params);
    const startCash = b.cash || 0;
    let assignedNetCashFlow;
    if (shortSet.has(stub)) {
      // Will finish below target if idle
      const shortfall = 0.5 + rnd() * 2.5;          // 0.5 to 3.0 below
      assignedNetCashFlow = r6((target - shortfall) - startCash);
    } else {
      // Will finish above target if idle
      const surplus = 0.5 + rnd() * 2.5;            // 0.5 to 3.0 above
      assignedNetCashFlow = r6((target + surplus) - startCash);
    }
    plans[stub] = { target, assignedNetCashFlow, jumps: [], tape: [] };
  }

  // Build the random walk that sums to assignedNetCashFlow
  const totalTicks = 78;
  for (const [stub, plan] of Object.entries(plans)) {
    const jumps = [];
    let remaining = plan.assignedNetCashFlow;
    for (let t = 1; t <= totalTicks; t++) {
      const progress = t / totalTicks;
      let bias = 0;
      if (params.clustering !== false) {
        if (progress < 0.3) bias = 0.4;
        else if (progress > 0.7) bias = -0.5;
      }
      const prob = (params.volProb || 0.35) + bias * 0.2;
      if (rnd() < Math.max(0.05, Math.min(0.8, prob))) {
        const step = (params.volStep || 0.8) * (0.6 + rnd() * 0.8);
        const noiseSign = rnd() < 0.5 ? -1 : 1;
        const drift = remaining > 0 ? 0.35 : -0.35;
        const amount = r6(noiseSign * step * 0.65 + drift * step * 0.55);
        jumps.push({ tick: t, amount, note: amount > 0 ? "Inflow" : "Outflow" });
        remaining = r6(remaining - amount);
      }
    }
    // Force the jumps to sum exactly to assignedNetCashFlow
    const sumSoFar = jumps.reduce((a, j) => a + j.amount, 0);
    const residual = r6(plan.assignedNetCashFlow - sumSoFar);
    if (Math.abs(residual) > 0.001) {
      jumps.push({ tick: totalTicks, amount: residual, note: "Close adjustment" });
    }
    plan.jumps = jumps;
  }
  s.reservePlans = plans;
}



export const TENORS = ["1M", "6M", "1Y", "2Y", "5Y", "10Y"];
export const TENOR_YEARS = { "1M": 1/12, "6M": 0.5, "1Y": 1, "2Y": 2, "5Y": 5, "10Y": 10 };
export const DEFAULT_CURVE = { "1M": 4.45, "6M": 4.50, "1Y": 4.55, "2Y": 4.60, "5Y": 4.70, "10Y": 4.85 };


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
    timerStart: null,              // epoch ms when the current timed session started (or resumed)
    timerDurationMs: null,         // total real-time duration of the trading day in ms
    timerPaused: false,            // true while the countdown is paused
    timerRemainingMs: null,        // remaining ms while paused
    tick: 0,                       // number of 5-minute in-game ticks that have occurred (0 at 09:30)
    orderBookVisible: true,        // if false, students see only their own orders
    sofrHistory: [],               // [{day, sofr}] appended on each close
    curve: { ...DEFAULT_CURVE },
    curveHistory: [],
    // Game parameters for the reserve-target / cash-flow system (instructor adjustable)
    gameParams: {
      k: 0.11,
      fixedCushion: 1.5,
      clustering: true,            // true = time-of-day clustered flows; false = uniform
      systemSurplus: 5,           // aggregate true-EOD surplus target ($B); negative = deficit
      volStep: 0.8,               // typical jump size ($B)
      volProb: 0.35,              // probability a bank gets a flow on a given tick
      fractionShort: 0.40,         // fraction of banks that finish below target if idle
    },
    // Per-bank plans for the current trading day (generated when trading starts)
    // { [stub]: { target, assignedNetCashFlow, jumps: [{tick, amount, note}], tape: [] } }
    reservePlans: {},
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
//   cash             4 to 12    (ample positive starting reserves)
//   treasuries      14 to 26    (enough free collateral to repo against)
//   floatingAssets  12 to 26
//   fixedLoans      the residual of the non-cash assets (stays the bulk)
//   volatile        12 to 28    (sticky deposits take the rest of the 110 of funding)
//   equity          fixed at 10
export function randomStartingBS(rnd = Math.random) {
  const cash = r2(randBetween(rnd, 4, 12));   // ample positive starting reserves
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
  const treasuryBook = defaultTreasuryBook(treasuries);
  return {
    fixedLoans, floatingAssets, treasuries, cash, repoLent: 0,
    stickyDep, volatile, repoBorrowed: 0, equity: 10,
    pledged: 0,
    treasuryBook,
  };
}

export function newBank(name, now = Date.now(), rnd = Math.random, params = {}) {
  const bs = randomStartingBS(rnd);
  const target = calculateTargetReserveBalance(bs, params);
  const cushion = r2(0.5 + rnd() * 1.5);          // start 0.5–2.0 above target
  bs.cash = r6(target + cushion);
  return { name, created: now, ...bs };
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
  if (s.timerStart === undefined) s.timerStart = null;
  if (s.timerDurationMs === undefined) s.timerDurationMs = null;
  if (s.timerPaused === undefined) s.timerPaused = false;
  if (s.timerRemainingMs === undefined) s.timerRemainingMs = null;
  if (s.tick === undefined) s.tick = 0;
  if (s.orderBookVisible === undefined) s.orderBookVisible = true;
  if (!Array.isArray(s.sofrHistory)) s.sofrHistory = [];
  if (s.closedBy === undefined) s.closedBy = null;
  if (!s.gameParams || typeof s.gameParams !== "object") {
    s.gameParams = { k: 0.11, fixedCushion: 1.5, clustering: true, systemSurplus: 5, volStep: 0.8, volProb: 0.35, fractionShort: 0.40 };
  }
  if (!s.reservePlans || typeof s.reservePlans !== "object") s.reservePlans = {};
  if (!s.curve || typeof s.curve !== "object") s.curve = { ...DEFAULT_CURVE };
  for (const t of TENORS) if (typeof s.curve[t] !== "number") s.curve[t] = DEFAULT_CURVE[t];
  if (!Array.isArray(s.curveHistory)) s.curveHistory = [];
  for (const b of Object.values(s.banks)) {
    for (const f of BS_FIELDS) if (typeof b[f] !== "number" || isNaN(b[f])) b[f] = 0;
    if (!b.treasuryBook || typeof b.treasuryBook !== "object") b.treasuryBook = defaultTreasuryBook(b.treasuries || 0);
    for (const t of TENORS) if (typeof b.treasuryBook[t] !== "number") b.treasuryBook[t] = 0;
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
export function capacity(s, stub, excludeId = null) {
  const b = s.banks[stub];
  if (!b) return { canBorrow: 0, canLend: 0 };
  const mine = openOrders(s, stub).filter((o) => o.id !== excludeId);
  const openBids = mine.filter((o) => o.side === "bid").reduce((a, o) => a + o.remaining, 0);
  const openOffers = mine.filter((o) => o.side === "offer").reduce((a, o) => a + o.remaining, 0);
  return {
    canBorrow: r2(Math.max(0, freeCollateral(b) - openBids)),
    canLend: r2(Math.max(0, b.cash - openOffers)),
  };
}

// Returns an error string, or null if the order is acceptable.
export function validateOrder(s, stub, side, rate, volume, excludeId = null) {
  if (s.phase !== "trading") return "The market is closed for today. Wait for the next day.";
  if (!s.banks[stub] && !isExternal(stub)) return "This bank no longer exists in the session.";
  if (side !== "bid" && side !== "offer") return "Unknown order side.";
  if (!isFinite(rate) || rate < 0 || rate > 25) return "Enter a rate between 0% and 25%.";
  if (!isFinite(volume) || volume < 0.01) return "Enter a volume of at least $0.01B.";
  if (volume > 200) return "Volume is too large.";
  if (isExternal(stub)) return null;
  const cap = capacity(s, stub, excludeId);
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
export function marketSnapshot(s) {
  const banks = Object.values(s.banks || {});
  const grossCash = r6(banks.reduce((a, b) => a + (b.cash || 0), 0));
  const pledged = r6(banks.reduce((a, b) => a + (b.pledged || 0), 0));
  const privateVol = r2(tradesForDay(s).filter((t) => t.kind === "private").reduce((a, t) => a + (t.volume || 0), 0));
  return { grossCash, pledged, available: r6(grossCash - pledged), volume: privateVol };
}


// ---------------------------------------------------------------- day bonus & zones
// Educational bonus: economic value created by the desk, reduced by risk breaches.
// Not a real-world compensation formula.
export function calculateDayBonus(s, stub) {
  const b = s.banks[stub];
  if (!b) return { raw: 0, multiplier: 0, bonus: 0, zone: "unknown" };
  const plan = s.reservePlans?.[stub];
  const target = plan?.target || 0;
  const cash = b.cash || 0;

  // Zone
  let zone = "green", multiplier = 1.0, equityCharge = 0;
  if (cash < 0) {
    zone = "red"; multiplier = 0;
  } else if (cash < 0.5 * target) {
    zone = "orange"; multiplier = 0.3; equityCharge = 0.15;
  } else if (cash < target) {
    zone = "yellow"; multiplier = 0.7; equityCharge = 0.05;
  }

  // Small comfort credit for finishing well above target (kept modest)
  let comfort = 0;
  if (cash > target * 1.5) comfort = r6(0.02 * (cash - target));

  // Repo spread income / cost from today's private trades
  let repoNet = 0;
  for (const t of tradesForDay(s)) {
    if (t.kind !== "private") continue;
    const interest = t.volume * t.rate / 100;
    if (t.lender === stub) repoNet += interest;
    if (t.borrower === stub) repoNet -= interest;
  }
  const iorb = (s.rates.iorb || 4.4) / 100;
  const iorbIncome = Math.max(0, cash) * iorb;

  const raw = r6(repoNet + iorbIncome + comfort - equityCharge);
  const bonus = r6(Math.max(0, raw) * multiplier);

  // Apply equity charge immediately
  if (equityCharge > 0) b.equity = r6(b.equity - equityCharge);

  // Track total red days (not consecutive)
  if (zone === "red") b.redCount = (b.redCount || 0) + 1;

  // Firing check: any of cash < -2, two red days total, or equity < 5
  const fired = cash < -2.0 || (b.redCount || 0) >= 2 || b.equity < 5;
  if (fired) b.fired = true;

  b.dayBonus = bonus;
  b.bonusYTD = r6((b.bonusYTD || 0) + bonus);
  b.zone = zone;

  return { raw, multiplier, bonus, zone, fired, comfort, equityCharge };
}

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
  s.timerStart = null;
  s.timerDurationMs = null;
  s.timerPaused = false;
  s.timerRemainingMs = null;
  s.tick = 0;
  if (!Array.isArray(s.sofrHistory)) s.sofrHistory = [];
  if (!s.sofrHistory.some((h) => h.day === s.day)) {
    const snap = marketSnapshot(s);
    s.sofrHistory.push({
      day: s.day,
      sofr: s.sofr,
      volume: snap.volume,
      grossCash: snap.grossCash,
      pledged: snap.pledged,
      available: snap.available,
    });
  }
  // Calculate bonuses and apply zone/firing logic
  for (const stub of Object.keys(s.banks)) {
    calculateDayBonus(s, stub);
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

  s.lastSofr = s.sofr ?? s.lastSofr ?? null;
  // Snapshot the curve that was in force for the day just finished.
  if (!Array.isArray(s.curveHistory)) s.curveHistory = [];
  if (!s.curveHistory.some((h) => h.day === s.day)) {
    s.curveHistory.push({ day: s.day, curve: { ...(s.curve || DEFAULT_CURVE) } });
  }

  // Small day-to-day curve evolution: short end tracks the day's SOFR change,
  // plus modest noise. Not a card-sized move.
  const daySofr = s.sofr;
  const prevSofr = s.lastSofr;
  if (isFinite(daySofr)) {
    const dSofr = isFinite(prevSofr) ? (daySofr - prevSofr) : 0;
    const next = {};
    const weights = { "1M": 0.75, "6M": 0.45, "1Y": 0.25, "2Y": 0.12, "5Y": 0.05, "10Y": 0.02 };
    for (const t of TENORS) {
      const base = (s.curve && s.curve[t]) || DEFAULT_CURVE[t];
      const noise = (Math.random() - 0.5) * 0.08; // roughly ±4 bps
      next[t] = r2(base + dSofr * (weights[t] || 0) + noise);
    }
    applyCurve(s, next);
  }

  s.day += 1;
  s.sofr = null;
  s.phase = "trading";
  s.shock = null;
  s.timerEnd = null;
  s.timerStart = null;
  s.timerDurationMs = null;
  s.timerPaused = false;
  s.timerRemainingMs = null;
  s.tick = 0;
  s.closedBy = null;
  for (const [id, o] of Object.entries(s.orders)) if (o.day < s.day) delete s.orders[id];

  // Fresh assigned net cash flows and walks for the new day.
  // Resamples which banks will finish short if idle (~fractionShort).
  generateReservePlans(s);

  return { finishedDay: s.day - 1, sofrRef };
}

// ---------------------------------------------------------------- situation cards
//
// Named scenarios for the instructor. Each card sets the corridor and
// assigns a non-uniform liquidity shock from a fixed pool so the
// distribution is simple and explainable.
//
// mode:
//   "shuffle"     — shuffle the pool and assign (most cards).
//   "byCashAsc"   — sort banks by cash ascending; lowest cash gets the
//                   first (usually most negative) pool value.
//   "bySizeDesc"  — sort banks by total assets descending, then by
//                   volatile funding; largest / more levered gets the
//                   first (usually most negative) pool value.
//
// Pool values are $ billions of volatile funding (and matching cash).
// Positive = inflow, negative = runoff.

export const SITUATION_CARDS = [
  {
    id: "pandemic",
    title: "Pandemic shock",
    story: "A sudden global health emergency freezes risk appetite. The Fed cuts the corridor hard to keep markets open. Wholesale funding runs off at most banks; a handful with strong deposit franchises see inflows.",
    rates: { iorb: 0.15, srf: 0.25 },
    field: "volatile",
    pool: [-10, -8, -7, -6, -5, -4, -3, -2, 2, 4],
    mode: "shuffle",
    curveShift: { "1M": -1.50, "6M": -1.25, "1Y": -1.00, "2Y": -0.75, "5Y": -0.50, "10Y": -0.40 },
    note: "Most banks lose volatile funding; a few gain. Fixed pool is shuffled and assigned. Yields fall sharply, front end most.",
  },
  {
    id: "inflation",
    title: "Hot inflation print",
    story: "A hotter-than-expected CPI print forces the Fed to hike. Funding tightens mildly to moderately, and the pressure falls hardest on banks that are already short cash.",
    rates: { iorb: 5.40, srf: 5.50 },
    field: "volatile",
    pool: [-6, -5, -4, -3, -2, -2, -1, 0, 1],
    mode: "byCashAsc",
    curveShift: { "1M": 0.25, "6M": 0.25, "1Y": 0.20, "2Y": 0.15, "5Y": 0.10, "10Y": 0.05 },
    note: "Mild-to-moderate tightening. Banks sorted by cash (lowest first) and given the more negative shocks from the pool. Curve steepens at the front.",
  },
  {
    id: "liqcrisis",
    title: "Liquidity crisis (2019-style)",
    story: "A sharp, concentrated liquidity squeeze hits a few banks hard while most feel only mild pressure. The corridor widens as the Fed emphasizes the standing repo facility as a backstop.",
    rates: { iorb: 4.40, srf: 5.00 },
    field: "volatile",
    pool: [-12, -9, -6, -2, -1, 0, 0, 1],
    mode: "shuffle",
    curveShift: { "1M": 0.40, "6M": 0.30, "1Y": 0.15, "2Y": 0.05, "5Y": 0.0, "10Y": -0.05 },
    note: "Sharp, concentrated outflows for some banks; mild for the rest. SRF is raised to emphasize the facility. Short-end yields rise.",
  },
  {
    id: "flight",
    title: "Flight to safety",
    story: "Risk aversion drives deposits and cash into the banking system. Most banks gain funding; a couple see modest outflows as counterparties rebalance.",
    rates: { iorb: 4.25, srf: 4.35 },
    field: "volatile",
    pool: [8, 6, 5, 4, 3, 2, -1, -2],
    mode: "shuffle",
    curveShift: { "1M": 0.0, "6M": -0.05, "1Y": -0.10, "2Y": -0.20, "5Y": -0.30, "10Y": -0.35 },
    note: "Most banks gain volatile funding; a couple see modest outflows. Longer yields fall on the flight to quality.",
  },
  {
    id: "quarterend",
    title: "Quarter-end turn",
    story: "Window-dressing and balance-sheet constraints create mild, fairly even funding pressure into the turn. Larger banks feel a slight extra squeeze.",
    rates: { iorb: 4.40, srf: 4.55 },
    field: "volatile",
    pool: [-4, -3, -3, -2, -2, -1, -1, 0],
    mode: "bySizeDesc",
    curveShift: { "1M": 0.15, "6M": 0.10, "1Y": 0.05, "2Y": 0.0, "5Y": 0.0, "10Y": 0.0 },
    note: "Mild, fairly even pressure. Banks sorted by total assets, then by volatile funding (more wholesale-funded first), and given the more negative shocks from the pool. Short-end yields rise into the turn.",
  },
];

function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// Take n values from a fixed pool. Repeats the pool if there are more banks
// than values, then shuffles so assignment is not tied to list order.
function drawFromPool(pool, n, rnd) {
  if (!pool || !pool.length || n <= 0) return [];
  const repeated = [];
  while (repeated.length < n) repeated.push(...pool);
  return shuffleInPlace(repeated.slice(0, Math.max(n, pool.length)), rnd).slice(0, n);
}

// Apply a situation card: set the corridor, assign a non-uniform liquidity
// shock via shockBank, and write the story into s.shock so every page can
// display it. Returns the per-bank summary.
export function applySituationCard(s, cardOrId, rnd = Math.random) {
  const card = typeof cardOrId === "string"
    ? SITUATION_CARDS.find((c) => c.id === cardOrId)
    : cardOrId;
  if (!card) throw new Error("Unknown situation card");

  if (card.rates && isFinite(card.rates.iorb) && isFinite(card.rates.srf)) {
    s.rates = { iorb: card.rates.iorb, srf: card.rates.srf };
  }

  // Optional yield-curve move (absolute curve or per-tenor shift in percent).
  if (card.curve) {
    applyCurve(s, card.curve);
  } else if (card.curveShift) {
    const shift = card.curveShift;
    const next = {};
    for (const t of TENORS) {
      const base = (s.curve && s.curve[t]) || DEFAULT_CURVE[t];
      const delta = typeof shift === "number" ? shift : (shift[t] || 0);
      next[t] = r2(base + delta);
    }
    applyCurve(s, next);
  }

  const field = card.field || "volatile";
  const stubs = Object.keys(s.banks);
  let ordered = stubs.slice();

  if (card.mode === "byCashAsc") {
    ordered.sort((a, b) => (s.banks[a].cash || 0) - (s.banks[b].cash || 0));
  } else if (card.mode === "bySizeDesc") {
    // Largest assets first; when sizes match (common on day 1), more
    // wholesale-funded banks are treated as more levered and go first.
    ordered.sort((a, b) => {
      const ba = s.banks[b], aa = s.banks[a];
      const sizeDiff = totals(ba).assets - totals(aa).assets;
      if (Math.abs(sizeDiff) > 0.01) return sizeDiff;
      return (ba.volatile || 0) - (aa.volatile || 0);
    });
  } else {
    ordered = shuffleInPlace(ordered, rnd);
  }

  let amounts;
  if (card.mode === "byCashAsc" || card.mode === "bySizeDesc") {
    // Pool is ordered worst-to-best; assign in that order after the sort.
    const pool = card.pool || [];
    amounts = ordered.map((_, i) => pool[i % pool.length]);
  } else {
    amounts = drawFromPool(card.pool || [], ordered.length, rnd);
  }

  const summary = [];
  for (let i = 0; i < ordered.length; i++) {
    const stub = ordered[i];
    shockBank(s.banks[stub], field, amounts[i]);
    summary.push({ stub, name: s.banks[stub].name, amount: amounts[i] });
  }

  s.shock = {
    title: card.title,
    text: card.story,
    note: card.note || "",
    cardId: card.id,
    field,
    perBank: Object.fromEntries(summary.map((x) => [x.stub, x.amount])),
  };
  return summary;
}

// ---------------------------------------------------------------- shocks

// field: "volatile" (wholesale funding runs off / flows in),
//        "stickyDep" (deposit outflow such as tax payments),
//        "treasuries" (bank buys / receives Treasuries and pays cash).
// Subtract (or add) the same amount from every bank. Default is a 5B
// runoff of volatile funding — cash falls by the same amount.
// Re-draw every bank's cash so about `negShare` of them are short and the
// rest have surplus. The change is offset against volatile funding so the
// balance sheet stays balanced. Returns the number of banks now short cash.
export function rerollCash(s, rnd = Math.random, negShare = 0.4) {
  const stubs = Object.keys(s.banks);
  const nNeg = Math.round(stubs.length * negShare);
  const shuffled = stubs.slice().sort(() => rnd() - 0.5);
  const neg = new Set(shuffled.slice(0, nNeg));
  for (const stub of stubs) {
    const b = s.banks[stub];
    const cash = neg.has(stub)
      ? r2(randBetween(rnd, -8, -0.5))
      : r2(randBetween(rnd, 0.5, 10));
    const delta = r6(cash - (b.cash || 0));
    b.cash = cash;
    b.volatile = r6((b.volatile || 0) + delta);
  }
  s.shock = {
    title: "Cash reshuffle",
    text: `${nNeg} of ${stubs.length} banks need cash; the rest have surplus.`,
    note: "Cash was redrawn. Volatile funding moved by the same amount so the sheet still balances.",
  };
  return nNeg;
}

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

export function newGame(s, now = Date.now(), rnd = Math.random) {
  const kept = {};
  for (const [stub, b] of Object.entries(s.banks || {})) {
    kept[stub] = { name: b.name, created: now, ...randomStartingBS(rnd) };
  }
  const hostToken = s.hostToken;
  const fresh = newState(now);
  fresh.hostToken = hostToken;
  fresh.banks = kept;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, fresh);
  return s;
}

// ---------------------------------------------------------------- yield curve / Treasury book

// Split a face total into a simple default mix (mostly intermediate/long).
export function defaultTreasuryBook(face) {
  const f = r2(Math.max(0, face || 0));
  if (f < 0.01) return Object.fromEntries(TENORS.map((t) => [t, 0]));
  // Rough weights: light short end, bulk in 2Y/5Y/10Y.
  const weights = { "1M": 0.05, "6M": 0.05, "1Y": 0.10, "2Y": 0.25, "5Y": 0.30, "10Y": 0.25 };
  const book = {};
  let allocated = 0;
  for (const t of TENORS.slice(0, -1)) {
    book[t] = r2(f * weights[t]);
    allocated = r2(allocated + book[t]);
  }
  book["10Y"] = r2(f - allocated);
  return book;
}

// Simple price of a zero / bullet: face / (1 + y)^t
export function priceFromYield(face, yPercent, years) {
  if (!face || years <= 0) return 0;
  const y = (yPercent || 0) / 100;
  return r6(face / Math.pow(1 + y, years));
}

export function duration(book, curve) {
  if (!book) return 0;
  let wSum = 0, dSum = 0;
  for (const t of TENORS) {
    const face = book[t] || 0;
    if (face <= 0) continue;
    const years = TENOR_YEARS[t];
    const y = (curve && curve[t]) || DEFAULT_CURVE[t];
    const px = priceFromYield(face, y, years);
    wSum += px;
    dSum += px * years;
  }
  return wSum > 0 ? r2(dSum / wSum) : 0;
}

// Mark every bank's Treasury book to the current curve.
// Updates b.treasuries (market value). Face amounts in treasuryBook stay unchanged.
// Free collateral continues to use the marked treasuries value.
export function markToMarket(s) {
  const curve = s.curve || DEFAULT_CURVE;
  for (const b of Object.values(s.banks || {})) {
    if (!b.treasuryBook) b.treasuryBook = defaultTreasuryBook(b.treasuries || 0);
    let mtm = 0;
    for (const t of TENORS) {
      const face = b.treasuryBook[t] || 0;
      mtm += priceFromYield(face, curve[t], TENOR_YEARS[t]);
    }
    b.treasuries = r6(mtm);
  }
  return s;
}

// Set a new curve and immediately mark all books.
export function applyCurve(s, newCurve) {
  s.curve = { ...DEFAULT_CURVE, ...(newCurve || {}) };
  for (const t of TENORS) {
    if (!isFinite(s.curve[t])) s.curve[t] = DEFAULT_CURVE[t];
  }
  markToMarket(s);
  return s;
}
