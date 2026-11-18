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
- tests/engine.test.js

Do not modify style.css, index.html, or any other site page unless explicitly asked.

**Current state (as of late 2026):**
- Pure engine in overnight-engine.js (matching, SOFR, close, advanceDay with interest + repo unwind, yield curve + treasuryBook, day-to-day SOFR-linked drift).
- Instructor view and student bank pages show 2-D curve + 3-D surface.
- Situation cards apply relative curve shifts.
- Stylizations & caveats page exists and is linked from the footers.

**Adding new files**
It is fine to add a new file when the task requires it. If you do, update this file in the same change: list the new file’s path and a one-line description of what it does. That keeps future threads from missing it.

**Rules for game work**
- Prefer small, additive patches over full-file rewrites.
- Follow the patch-cutting guidance in ai_guidance/patch-cutting-guidance.md.
- After any change, keep the existing tests passing (node --test tests/engine.test.js).
- Do not invent new Firebase paths or change the session model unless asked.
