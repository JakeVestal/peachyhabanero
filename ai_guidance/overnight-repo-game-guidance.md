# Overnight Clearing Desk — Game Guidance

If this thread is not working on the Overnight Clearing Desk game, ignore the rest of this file. Do not edit any of the files listed below; changing them can break the live classroom simulation.

---

You are working on the Overnight Clearing Desk classroom simulation in the peachyhabanero repo (https://github.com/JakeVestal/peachyhabanero).

**Allowed files (touch only these unless you add a new one and update this file):**
- site/overnight-engine.js
- site/overnight-ui.js
- site/overnight-db.js
- site/overnight-config.js
- site/overnight-clearing.html
- site/overnight-clearing-instructor-view.html
- site/bank.html
- site/overnight.css
- site/stylizations-caveats.html
- site/overnight-docs.html (under-the-hood reference for the game loop, balance sheets, curve, cards, ticks, and order book)
- site/how-to-play.html (student-facing how-to-play page with bonus rules and disclaimer)
- tests/engine.test.js

Do not modify style.css, index.html, or any other site page unless explicitly asked.

**Current state (as of late 2026):**
- Pure engine in overnight-engine.js (matching, SOFR, close, advanceDay with interest + repo unwind, yield curve + treasuryBook, day-to-day SOFR-linked drift).
- Reserve plans: `generateReservePlans` runs on bank join, on Start Trading, and at the end of `advanceDay`. It assigns each bank an `assignedNetCashFlow` (~40% finish short if idle) and a random-walk of jumps that sum exactly to that flow. Existing plans are not overwritten unless forced.
- Students see a live **Reserve shortfall / surplus vs target** line (cash − target). They start the day above target. The instructor page shows each bank’s assigned net cash flow; students do not.
- Cash-flow tape (open by default) and a fixed-axis reserve chart (09:30–16:00) on the bank page.
- Bonus: raw value (repo spread + IORB + small comfort credit if cash > 1.5× target − zone charges) × zone multiplier (Green 1.0, Yellow 0.7, Orange 0.3, Red 0.0), floored at zero. YTD is the sum.
- Firing: cash < –2.0, two red days total (not consecutive), or equity < 5. Formal warning letter on the first red day.
- Instructor toggle for order-book visibility (when off, students see only their own orders).
- Game mode toggle on the instructor page (default instructor-driven; continuous runs a set number of trading sessions automatically with after-hours countdowns between them, auto close/advance/SOFR/curve/plans, and final leaderboard + winner).
- Instructor view and student bank pages show 2-D curve + 3-D surface.
- Situation cards apply relative curve shifts.
- Stylizations & caveats page and how-to-play page exist and are linked.

**Adding new files**
It is fine to add a new file when the task requires it. If you do, update this file in the same change: list the new file’s path and a one-line description of what it does. That keeps future threads from missing it.

**Rules for game work**
- Prefer small, additive patches over full-file rewrites.
- Follow the patch-cutting guidance in ai_guidance/patch-cutting-guidance.md.
- After any change, keep the existing tests passing (node --test tests/engine.test.js).
- Do not invent new Firebase paths or change the session model unless asked.
