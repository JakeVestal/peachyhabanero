"""
Classroom setup for the overnight repo / SOFR game.

Creates stylized commercial-bank balance sheets and applies a liquidity
shock so that roughly half the banks need cash (and can therefore borrow
against their securities in the repo market) while the others have excess
reserves they can lend.

All figures are in billions of dollars. The soft cap inside the reserve-
target function is left as-is for "normal times"; reserve-scarcity mechanics
will be added later.
"""

import pandas as pd
import numpy as np


def create_bank(total_liabilities_and_equity=250.0, rng=None):
    """
    Create a randomly generated typical balance sheet for a commercial bank
    that participates in the repo market.

    Assets and liabilities are forced to sum exactly to the given total
    (rounding differences are absorbed in the residual lines).

    Parameters
    ----------
    total_liabilities_and_equity : float
        Total size of the bank (assets = liabilities + equity).
    rng : np.random.Generator, optional
        Random number generator for reproducibility.

    Returns
    -------
    pd.DataFrame
        Balance sheet with columns Item and Amount ($B).
    """
    if rng is None:
        rng = np.random.default_rng()

    tle = float(total_liabilities_and_equity)

    # Equity: 9–13% of assets
    equity_pct = rng.uniform(0.09, 0.13)
    equity = round(tle * equity_pct, 1)
    total_liabilities = tle - equity

    # Liabilities
    deposits_pct = rng.uniform(0.72, 0.85)
    deposits = round(total_liabilities * deposits_pct, 1)

    ltd_pct = rng.uniform(0.06, 0.12)
    long_term_debt = round(total_liabilities * ltd_pct, 1)

    other_liab = round(rng.uniform(1.0, 5.0), 1)
    short_term_borrowings = round(
        total_liabilities - deposits - long_term_debt - other_liab, 1
    )

    if short_term_borrowings < 0:
        short_term_borrowings = 0.0
        other_liab = round(total_liabilities - deposits - long_term_debt, 1)

    # Force exact liability total
    liab_sum = deposits + short_term_borrowings + long_term_debt + other_liab
    if abs(liab_sum - total_liabilities) > 1e-6:
        other_liab = round(total_liabilities - (deposits + short_term_borrowings + long_term_debt), 1)

    # Assets
    loans_pct = rng.uniform(0.55, 0.68)
    loans = round(tle * loans_pct, 1)

    securities_pct = rng.uniform(0.18, 0.28)
    securities = round(tle * securities_pct, 1)

    cash_pct = rng.uniform(0.06, 0.12)
    cash_reserves = round(tle * cash_pct, 1)

    other_assets = round(tle - loans - securities - cash_reserves, 1)
    if other_assets < 0:
        securities = round(securities + other_assets, 1)
        other_assets = 0.0

    # Force exact asset total
    asset_sum = cash_reserves + securities + loans + other_assets
    if abs(asset_sum - tle) > 1e-6:
        other_assets = round(tle - (cash_reserves + securities + loans), 1)
        if other_assets < 0:
            securities = round(securities + other_assets, 1)
            other_assets = 0.0

    data = {
        "Item": [
            "Cash + Reserves at Fed",
            "Securities (Treasuries + Agency MBS)",
            "Loans (net)",
            "Other assets",
            "Total Assets",
            "",
            "Deposits",
            "Short-term borrowings",
            "Long-term debt",
            "Other liabilities",
            "Equity",
            "Total Liabilities & Equity",
        ],
        "Amount ($B)": [
            cash_reserves,
            securities,
            loans,
            other_assets,
            tle,
            np.nan,
            deposits,
            short_term_borrowings,
            long_term_debt,
            other_liab,
            equity,
            tle,
        ],
    }
    return pd.DataFrame(data)


def calculate_eod_reserves_target(balance_sheet, rng=None):
    """
    Calculate a bank's internal target for comfortable end-of-day reserve balances.

    Design rationale (based on typical post-2008 industry practice):
    - Formal reserve requirements no longer exist.
    - Banks set internal targets primarily to:
      * Cover expected payment volatility and avoid daylight overdrafts.
      * Satisfy internal liquidity stress tests (ILSTs) and support LCR-style HQLA buffers.
      * Maintain operational capacity for Fedwire/ACH settlement.
    - A practical rule of thumb used by many treasury desks is a target in the
      range of roughly 5-7% of deposits (reflecting deposit stability and payment intensity),
      plus a modest additive component for overall balance-sheet scale/complexity.
    - Securities holdings can imply some additional financing-related buffer, but
      deposit-driven payment flows dominate the target.
    - The model also applies a soft floor and soft cap so the target stays realistic
      relative to current cash holdings under normal conditions.

    Parameters
    ----------
    balance_sheet : pd.DataFrame
        Output of create_bank().
    rng : np.random.Generator, optional

    Returns
    -------
    float
        Target end-of-day reserves in $ billions.
    """
    if rng is None:
        rng = np.random.default_rng()

    deposits = balance_sheet.loc[
        balance_sheet["Item"] == "Deposits", "Amount ($B)"
    ].values[0]
    total_assets = balance_sheet.loc[
        balance_sheet["Item"] == "Total Assets", "Amount ($B)"
    ].values[0]
    current_cash = balance_sheet.loc[
        balance_sheet["Item"] == "Cash + Reserves at Fed", "Amount ($B)"
    ].values[0]

    # Base: 5-7% of deposits
    deposit_buffer_pct = rng.uniform(0.05, 0.07)
    target = deposits * deposit_buffer_pct

    # Scale component for operational complexity
    scale_add = total_assets * rng.uniform(0.005, 0.015)
    target += scale_add

    # Floor
    min_floor = max(2.0, total_assets * 0.02)
    target = max(target, min_floor)

    # Soft cap relative to current cash (normal-times realism)
    soft_cap = current_cash * 1.5
    if soft_cap > min_floor:
        target = min(target, soft_cap)

    return round(target, 2)


def liquidity_shock(banks, needs_cash=0.5, shortfall_limit=0.25, rng=None):
    """
    Apply a liquidity shock to a dictionary of banks.

    For each bank:
    - Compute its EOD reserves target.
    - Generate random projected outflows scaled to bank size.
    - Compute projected_shortfall_or_excess = target - (current_reserves - projected_outflows).
      Positive values mean the bank needs cash (shortfall).

    Approximately `needs_cash` fraction of banks are forced into a positive shortfall.
    No bank's shortfall is allowed to exceed (1 + shortfall_limit) * current_reserves.
    Outflows are kept non-negative.

    Parameters
    ----------
    banks : dict
        {bank_name: balance_sheet_df}
    needs_cash : float
        Target fraction of banks that should have a shortfall (default 0.5).
    shortfall_limit : float
        Maximum shortfall as a multiple of current reserves (default 0.25 → max = 1.25× reserves).
    rng : np.random.Generator, optional

    Returns
    -------
    dict
        {bank_name: {
            'balance_sheet': df,
            'target_reserves': float,
            'projected_outflows': float,
            'projected_shortfall_or_excess': float   # >0 = shortfall (needs repo cash)
        }}
    """
    if rng is None:
        rng = np.random.default_rng()

    results = {}
    bank_names = list(banks.keys())
    n_banks = len(bank_names)
    n_need_cash = max(0, min(n_banks, int(round(needs_cash * n_banks))))
    need_cash_banks = (
        set(rng.choice(bank_names, size=n_need_cash, replace=False))
        if n_need_cash > 0
        else set()
    )

    for name, bs in banks.items():
        current_reserves = bs.loc[
            bs["Item"] == "Cash + Reserves at Fed", "Amount ($B)"
        ].values[0]
        target = calculate_eod_reserves_target(bs, rng=rng)
        total_assets = bs.loc[bs["Item"] == "Total Assets", "Amount ($B)"].values[0]

        # Random outflows scaled to bank size
        base_outflow_scale = total_assets * rng.uniform(0.005, 0.02)
        corp_payments = rng.uniform(0.3, 1.2) * base_outflow_scale
        maturing_st = rng.uniform(0.1, 0.8) * base_outflow_scale
        loan_fundings = rng.uniform(0.2, 1.0) * base_outflow_scale
        projected_outflows = corp_payments + maturing_st + loan_fundings

        max_allowed_shortfall = (1 + shortfall_limit) * current_reserves

        if name in need_cash_banks:
            # Ensure a positive shortfall, capped
            projected_ending = current_reserves - projected_outflows
            shortfall = target - projected_ending
            if shortfall <= 0:
                desired = rng.uniform(0.05 * current_reserves, max_allowed_shortfall)
                projected_outflows += desired - shortfall
            # Recompute and enforce cap
            projected_ending = current_reserves - projected_outflows
            shortfall = target - projected_ending
            if shortfall > max_allowed_shortfall:
                shortfall = max_allowed_shortfall
                projected_outflows = current_reserves - (target - shortfall)
        else:
            # Prefer excess or only a tiny shortfall
            projected_ending = current_reserves - projected_outflows
            shortfall = target - projected_ending
            if shortfall > 0:
                # Reduce outflows enough to eliminate most or all of the shortfall
                reduction = shortfall + rng.uniform(0, 0.4 * current_reserves)
                projected_outflows = max(0.0, projected_outflows - reduction)
                projected_ending = current_reserves - projected_outflows
                shortfall = target - projected_ending

        # Final non-negativity and hard cap
        projected_outflows = max(0.0, projected_outflows)
        projected_ending = current_reserves - projected_outflows
        shortfall = target - projected_ending
        if shortfall > max_allowed_shortfall:
            shortfall = max_allowed_shortfall
            projected_outflows = max(0.0, current_reserves - (target - shortfall))

        results[name] = {
            "balance_sheet": bs,
            "target_reserves": target,
            "projected_outflows": round(projected_outflows, 2),
            "projected_shortfall_or_excess": round(shortfall, 2),
        }

    return results


if __name__ == "__main__":
    # Reproducible demo
    rng = np.random.default_rng(42)

    players = {
        "Joe": create_bank(250, rng=rng),
        "Jill": create_bank(250, rng=rng),
        "Bob": create_bank(180, rng=rng),
        "Alice": create_bank(320, rng=rng),
        "George": create_bank(180, rng=rng),
        "John": create_bank(320, rng=rng),
        "Ringo": create_bank(180, rng=rng),
        "Paul": create_bank(320, rng=rng),
        "Cletus": create_bank(180, rng=rng),
    }

    shocked = liquidity_shock(players, needs_cash=0.5, shortfall_limit=0.25, rng=rng)

    print("Day-1 liquidity positions after shock\n")
    for name, data in shocked.items():
        status = "NEEDS CASH" if data["projected_shortfall_or_excess"] > 0 else "has excess"
        print(
            f"{name:8}  shortfall/excess = {data['projected_shortfall_or_excess']:7.2f}B  ({status})"
        )
        print(f"         target reserves = {data['target_reserves']:.2f}B, "
              f"outflows = {data['projected_outflows']:.2f}B")
        print()
