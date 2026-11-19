// Unit tests for the Overnight Clearing Desk engine.
// Run with: node --test tests/engine.test.js
// (from the repo root, after the yield-curve patches are applied)

import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../site/overnight-engine.js";

function almost(a, b, eps = 0.02) {
  return Math.abs(a - b) < eps;
}

test("newState includes default curve and empty history", () => {
  const s = E.newState();
  assert.equal(s.day, 1);
  assert.equal(s.phase, "trading");
  assert.deepEqual(s.curve, E.DEFAULT_CURVE);
  assert.deepEqual(s.curveHistory, []);
});

test("newBank creates a treasuryBook that sums to starting treasuries", () => {
  const b = E.newBank("Test Bank", Date.now(), () => 0.5);
  assert.ok(b.treasuryBook);
  const face = Object.values(b.treasuryBook).reduce((a, x) => a + x, 0);
  assert.ok(almost(face, b.treasuries, 0.05), `face ${face} vs treasuries ${b.treasuries}`);
});

test("applyCurve updates the curve and marks books", () => {
  const s = E.newState();
  const b = E.newBank("A", Date.now(), () => 0.4);
  s.banks.a = b;
  const before = b.treasuries;
  E.applyCurve(s, { "1M": 5.0, "6M": 5.1, "1Y": 5.2, "2Y": 5.3, "5Y": 5.5, "10Y": 5.7 });
  assert.equal(s.curve["10Y"], 5.7);
  // Higher yields should lower the market value of a positive book.
  assert.ok(b.treasuries < before, `expected mark-down, got ${b.treasuries} from ${before}`);
});

test("markToMarket leaves face amounts unchanged", () => {
  const s = E.newState();
  const b = E.newBank("B", Date.now(), () => 0.3);
  s.banks.b = b;
  const faceBefore = { ...b.treasuryBook };
  E.markToMarket(s);
  assert.deepEqual(b.treasuryBook, faceBefore);
});

test("advanceDay snapshots the current curve into history", () => {
  const s = E.newState();
  s.banks.a = E.newBank("A", Date.now(), () => 0.5);
  E.applyCurve(s, { "1M": 4.0, "6M": 4.1, "1Y": 4.2, "2Y": 4.3, "5Y": 4.4, "10Y": 4.5 });
  s.phase = "closed";
  s.sofr = 4.45;
  E.advanceDay(s);
  assert.equal(s.curveHistory.length, 1);
  assert.equal(s.curveHistory[0].day, 1);
  assert.equal(s.curveHistory[0].curve["10Y"], 4.5);
  assert.equal(s.day, 2);
});

test("newGame clears curve history and resets the curve", () => {
  const s = E.newState();
  s.banks.a = E.newBank("A", Date.now(), () => 0.5);
  s.curveHistory = [{ day: 1, curve: { ...E.DEFAULT_CURVE } }];
  s.curve = { "1M": 9, "6M": 9, "1Y": 9, "2Y": 9, "5Y": 9, "10Y": 9 };
  E.newGame(s);
  assert.deepEqual(s.curveHistory, []);
  assert.deepEqual(s.curve, E.DEFAULT_CURVE);
  assert.equal(s.day, 1);
});

test("applySituationCard applies a curveShift and marks books", () => {
  const s = E.newState();
  const b = E.newBank("C", Date.now(), () => 0.5);
  s.banks.c = b;
  const before = b.treasuries;
  E.applySituationCard(s, "liqcrisis", () => 0.5);
  // 2019-style card raises the short end.
  assert.ok(s.curve["1M"] > E.DEFAULT_CURVE["1M"]);
  // Book should have been re-marked.
  assert.notEqual(b.treasuries, before);
});

test("free collateral uses the marked treasuries value", () => {
  const s = E.newState();
  const b = E.newBank("D", Date.now(), () => 0.5);
  s.banks.d = b;
  b.pledged = 2;
  const freeBefore = E.freeCollateral(b);
  E.applyCurve(s, { "1M": 8, "6M": 8, "1Y": 8, "2Y": 8, "5Y": 8, "10Y": 8 });
  const freeAfter = E.freeCollateral(b);
  assert.ok(freeAfter < freeBefore, "higher yields should reduce free collateral");
});

test("basic matching still works after curve changes", () => {
  const s = E.newState();
  s.banks.lend = E.newBank("Lender", Date.now(), () => 0.8);
  s.banks.borr = E.newBank("Borrower", Date.now(), () => 0.2);
  s.banks.lend.cash = 10;
  s.banks.borr.treasuries = 10;
  s.banks.borr.treasuryBook = E.defaultTreasuryBook(10);
  E.markToMarket(s);
  // Simple cross — bid is resting (ts 1), so trade prints at the bid rate
  s.orders.b1 = { stub: "borr", side: "bid", rate: 4.50, volume: 1, remaining: 1, status: "open", day: 1, ts: 1 };
  s.orders.o1 = { stub: "lend", side: "offer", rate: 4.40, volume: 1, remaining: 1, status: "open", day: 1, ts: 2 };
  const fills = E.matchOrders(s);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].rate, 4.50); // bid was resting (earlier ts)
  assert.equal(fills[0].volume, 1);
});

test("closeMarket still produces SOFR and does not touch the curve", () => {
  const s = E.newState();
  s.banks.a = E.newBank("A", Date.now(), () => 0.5);
  const curveBefore = { ...s.curve };
  // One private trade so SOFR is defined
  s.trades.t1 = { day: 1, kind: "private", ts: 1, rate: 4.45, volume: 2,
    lender: "a", lenderName: "A", borrower: "a", borrowerName: "A" };
  const res = E.closeMarket(s);
  assert.equal(res.sofr, 4.45);
  assert.deepEqual(s.curve, curveBefore);
  assert.equal(s.phase, "closed");
});

test("duration is positive for a normal book", () => {
  const book = E.defaultTreasuryBook(20);
  const d = E.duration(book, E.DEFAULT_CURVE);
  assert.ok(d > 0 && d < 10, `duration ${d}`);
});


test("calculateTargetReserveBalance uses kSticky, kVolatile and cushion", () => {
  const b = { stickyDep: 80, volatile: 20 };
  const t = E.calculateTargetReserveBalance(b, { kSticky: 0.05, kVolatile: 0.25, fixedCushion: 2 });
  // 0.05*80 + 0.25*20 + 2 = 4 + 5 + 2 = 11
  assert.ok(almost(t, 11, 0.01), `expected ~11, got ${t}`);
});

test("calculateTargetReserveBalance applies minimum floor", () => {
  const b = { stickyDep: 1, volatile: 1 };
  const t = E.calculateTargetReserveBalance(b, { kSticky: 0.01, kVolatile: 0.01, fixedCushion: 0 });
  assert.ok(t >= 0.5, `floor not applied, got ${t}`);
});

test("generateReservePlans assigns net flows and jumps sum to assignedNetCashFlow", () => {
  const s = E.newState();
  s.banks.a = E.newBank("A", Date.now(), () => 0.4);
  s.banks.b = E.newBank("B", Date.now(), () => 0.6);
  let seed = 0.1;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  E.generateReservePlans(s, rnd);
  assert.ok(s.reservePlans.a && s.reservePlans.b, "plans missing");
  for (const [stub, plan] of Object.entries(s.reservePlans)) {
    const netJumps = plan.jumps.reduce((a, j) => a + j.amount, 0);
    assert.ok(almost(netJumps, plan.assignedNetCashFlow, 0.15),
      `${stub}: jumps sum ${netJumps} vs assigned ${plan.assignedNetCashFlow}`);
    assert.ok(plan.target > 0, "target should be positive");
    // Starting cash should be above target
    assert.ok(s.banks[stub].cash >= plan.target - 0.1, "should start near or above target");
  }
});

test("normalize supplies default gameParams and reservePlans", () => {
  const raw = { day: 2, banks: {} };
  const s = E.normalize(raw);
  assert.ok(s.gameParams);
  assert.equal(s.gameParams.kSticky, 0.05);
  assert.equal(s.gameParams.kVolatile, 0.28);
  assert.equal(s.gameParams.fixedCushion, 1.5);
  assert.equal(s.gameParams.fractionShort, 0.40);
  assert.deepEqual(s.reservePlans, {});
  // Continuous-mode defaults are also filled in
  assert.equal(s.gameMode, "instructor-driven");
  assert.equal(s.continuousActive, false);
  assert.equal(s.continuousTotalSessions, 5);
  assert.equal(s.winner, null);
});

test("newState includes continuous-mode fields with defaults", () => {
  const s = E.newState();
  assert.equal(s.gameMode, "instructor-driven");
  assert.equal(s.continuousActive, false);
  assert.equal(s.continuousTotalSessions, 5);
  assert.equal(s.continuousAfterHoursMs, 60 * 1000);
  assert.equal(s.continuousCurrentSession, 0);
  assert.equal(s.afterHoursEnd, null);
  assert.equal(s.winner, null);
});


test("advanceDay force-regenerates reserve plans", () => {
  const s = E.newState();
  s.banks.a = E.newBank("A", Date.now(), () => 0.4);
  s.banks.b = E.newBank("B", Date.now(), () => 0.6);
  let seed = 0.2;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  E.generateReservePlans(s, rnd);
  // Mark one jump as applied so we can verify the old plan is discarded
  const stub = Object.keys(s.reservePlans)[0];
  if (s.reservePlans[stub].jumps.length) {
    s.reservePlans[stub].jumps[0].applied = true;
  }
  // Close so advanceDay can proceed
  s.phase = "closed";
  s.sofr = 4.45;
  E.advanceDay(s);
  assert.equal(s.day, 2);
  assert.ok(s.reservePlans.a && s.reservePlans.b, "plans should exist after advance");
  for (const [id, plan] of Object.entries(s.reservePlans)) {
    // No leftover applied flags from the previous day
    assert.ok(!plan.jumps.some(j => j.applied), `${id} still has applied flags`);
    const netJumps = plan.jumps.reduce((a, j) => a + j.amount, 0);
    assert.ok(almost(netJumps, plan.assignedNetCashFlow, 0.15),
      `${id}: jumps sum ${netJumps} vs assigned ${plan.assignedNetCashFlow}`);
  }
});

test("newBank has no fixedLoans and still balances near 120", () => {
  const b = E.newBank("NoFixed", Date.now(), () => 0.5);
  assert.ok(b.fixedLoans === undefined || b.fixedLoans === 0, "fixedLoans should be absent");
  const t = E.totals(b);
  assert.ok(t.balanced, "sheet should balance");
  assert.ok(almost(t.assets, 120, 1.0), `assets ${t.assets} should be near 120`);
  // Cash is still set above target
  const target = E.calculateTargetReserveBalance(b);
  assert.ok(b.cash >= target - 0.1, "cash should start at or above target");
});
