# The Overnight Clearing Desk — Supporting Materials

## Market Condition Cards (Historical Scenarios)

### 1. September 17, 2019 — Repo Spike
- **Type**: Systemic liquidity drain
- **Historical**: SOFR printed at 5.25% (from ~2.43% prior day). Intraday rates reached ~10% in some segments. EFFR briefly above the top of the target range.
- **Drivers**: Corporate tax payments (~$100B+ out of bank and MMF accounts into Treasury General Account) + large Treasury settlement. Reserves at multi-year lows (~$1.4T). Dealer balance-sheet constraints and repo market segmentation amplified the spike.
- **Game shock**: Systemic –$12B volatile funding outflow (scaled). Forces most banks into the repo market. High demand, elevated rates.
- **Teaching point**: Confluence of factors + internal frictions > any single cause. Fed later provided emergency repo support.

### 2. Quarter-End Turn
- **Type**: Balance sheet window dressing
- **Description**: Banks and dealers reduce repo activity and balance-sheet usage into quarter-end. Cash is pulled; funding rates rise (the "turn").
- **Game shock**: Milder systemic outflow (–$5B volatile) + higher willingness to pay for secured funding.
- **Teaching point**: Recurring calendar effects in money markets.

### 3. Flight to Safety
- **Type**: Liquidity surge
- **Description**: Geopolitical or market stress drives institutional cash into bank deposits and government MMFs. Excess cash pushes repo rates lower. ON RRP absorbs surplus.
- **Game shock**: Systemic +$8B into volatile deposits (cash surplus). Banks become lenders.
- **Teaching point**: Asymmetric response of rates to surplus vs deficit; role of the floor.

### 4. Large Treasury Auction Settlement
- **Type**: Collateral supply spike
- **Description**: Primary dealers must finance a large new issuance. Collateral abundance relative to available cash pushes GC repo rates higher until the paper is distributed.
- **Game shock**: Banks receive +$5B Treasuries that must be funded (cash falls, collateral rises).
- **Teaching point**: Collateral supply vs cash demand.

### 5. Sponsored Repo Demand (Hedge Fund)
- **Type**: Non-bank leverage (introduce Day 3+)
- **Description**: Large hedge fund (via sponsored repo / clearing bank) wants to lever a long Treasury basis or cash-futures trade. Absorbs excess cash and can drive SOFR higher.
- **Game**: Instructor adds a large external borrower demand ($15–25B) at competitive rates. Banks with surplus can lend into it.
- **Teaching point**: Non-bank demand and the role of sponsored/cleared repo in expanding the market.

### 6. Collateral Specials
- **Type**: Specific CUSIP scarcity
- **Description**: A particular Treasury (on-the-run, CTD, etc.) goes special. Holders can lend it at a much lower rate. GC remains higher. Structural shortages can pull the overall SOFR print down.
- **Game**: Designate one bank as holding the special. Other teams will accept a lower rate to borrow that specific bond.
- **Teaching point**: GC vs specials; how scarcity in one segment affects the benchmark.

---

## Technical Quiz — SOFR & Repo Market Forces

**1.** How is the official SOFR calculated by the New York Fed?  
a) Simple average of all overnight Treasury repo rates  
b) Volume-weighted median of eligible overnight Treasury repo transactions  
c) The rate at the 25th percentile after trimming extremes  
d) A survey of primary dealer quotes (like LIBOR)  
**Answer: b** — Volume-weighted median (50th percentile of volume) across tri-party, GCF, and FICC DVP.

**2.** On September 17, 2019, SOFR printed approximately:  
a) 2.25% b) 2.43% c) 5.25% d) 10%  
**Answer: c**

**3.** In the game (and real markets), a bank with a cash deficit typically funds it by:  
a) Issuing unsecured commercial paper only  
b) Pledging Treasury securities as collateral in the overnight repo market  
c) Calling the Fed for a free advance  
d) Reducing equity capital  
**Answer: b**

**4.** Floating-rate assets priced at SOFR + 100 bps create what kind of risk relative to fixed-rate liabilities?  
a) Credit risk only  
b) Basis / interest-rate mismatch risk  
c) Operational risk  
d) None — they are perfectly matched  
**Answer: b** — Spike in SOFR improves NIM immediately; drop compresses it.

**5.** High-Quality Liquid Assets (HQLA) such as Treasuries are constrained because:  
a) They earn the highest yields  
b) Regulatory liquidity ratios (e.g., LCR) limit how much of the balance sheet can be funded by short-term liabilities relative to HQLA  
c) The Fed forbids banks from owning them  
d) They cannot be pledged in repo  
**Answer: b**

**6.** What is the difference between General Collateral (GC) repo and a “special”?  
a) GC is unsecured; specials are secured  
b) In GC the collateral is interchangeable Treasuries; in a special a specific CUSIP is demanded and trades at a lower rate  
c) Specials are only available to hedge funds  
d) There is no difference  
**Answer: b**

**7.** The Fed’s Standing Repo Facility (SRF) and Overnight Reverse Repo (ON RRP) act as:  
a) The only places banks can trade  
b) Ceiling and floor, respectively, for overnight rates in many regimes  
c) Long-term funding sources  
d) Equity capital injections  
**Answer: b**

**8.** Why did the confluence of factors in September 2019 matter more than any single one?  
a) Because the Fed had already raised rates to 5%  
b) Reserves were already low, dealers were balance-sheet constrained, and information/segmentation across repo segments limited elastic supply of cash  
c) LIBOR was being discontinued that week  
d) There was a bank holiday  
**Answer: b**

---

## Suggested Classroom Flow

1. **Pre-game**: Run the technical quiz (or assign it). Review SOFR methodology and the 2019 episode.
2. **Setup**: Divide into 3–5 bank teams. Project the game page. Add/name banks.
3. **Day 1**: Mild or no shock. Let teams negotiate a few trades. Calculate SOFR. Observe NIM.
4. **Day 2–3**: Draw a Market Condition Card (start with September 2019 or quarter-end). Teams manage gaps, negotiate, use Fed backstop if needed.
5. **Day 4+**: Introduce sponsored repo or specials.
6. **Debrief**: Export history. Discuss how SOFR moved, who won on NIM, role of collateral and constraints.
7. **Post-game**: Quiz again or short write-up on basis risk and liquidity management.

The interactive page (`overnight-clearing.html`) automates balance-sheet tracking, SOFR volume-weighted median calculation, and provides the cards + quiz in one place. State persists in the browser (localStorage). Export to CSV/JSON for shared spreadsheets or grading.