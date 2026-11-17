// The Overnight Clearing Desk — game engine.
//
// Pure functions only (no Firebase, no DOM) so the rules can be unit-tested
// and so the host page and the student page apply exactly the same logic.
//
// Units: balance-sheet amounts in $ billions, rates in percent (4.40 = 4.40%).

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
