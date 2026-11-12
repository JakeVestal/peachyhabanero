"""
Reservation rates and SOFR calculation for the overnight repo game.

Builds on the shocked bank positions from bank_repo_setup.py.
Banks with excess reserves lend cash; banks with shortfalls borrow
against their securities. The Fed's administered rates (IORB floor,
SRF ceiling) set each bank's reservation rate. The volume-weighted
median of the resulting trades is SOFR.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, List, Tuple


def get_reservation_rates(
    shocked_banks: Dict[str, Dict[str, Any]],
    iorb: float,
    srf_rate: float,
    rng: Optional[np.random.Generator] = None,
    lender_spread_bp: Tuple[float, float] = (0.0, 3.0),
    borrower_spread_bp: Tuple[float, float] = (0.0, 5.0),
) -> Dict[str, Dict[str, Any]]:
    """
    Assign each bank a reservation rate based on its liquidity position
    and the Fed's administered rates.

    Lenders (projected_shortfall_or_excess < 0) will not lend cash below
    IORB — that is their opportunity cost of holding reserves at the Fed.
    A small idiosyncratic spread (a few basis points) reflects desk
    preferences or relationship considerations.

    Borrowers (projected_shortfall_or_excess > 0) will not pay more than
    the SRF rate — that is the standing facility ceiling. Their willingness
    to pay is reduced by a small idiosyncratic amount that reflects urgency
    or alternative funding options.

    Parameters
    ----------
    shocked_banks : dict
        Output of liquidity_shock().
    iorb : float
        Interest on reserve balances (percent). Floor for lenders.
    srf_rate : float
        Standing Repo Facility rate (percent). Ceiling for borrowers.
        Must be >= iorb.
    rng : np.random.Generator, optional
    lender_spread_bp : tuple
        (min, max) basis-point spread lenders add above IORB.
    borrower_spread_bp : tuple
        (min, max) basis-point amount borrowers shade below SRF.

    Returns
    -------
    dict
        Same structure as input, plus keys:
        'side': 'lend' | 'borrow' | 'flat'
        'reservation_rate': float  (percent)
        'max_volume': float        ($B they are willing to trade)
    """
    if rng is None:
        rng = np.random.default_rng()
    if srf_rate < iorb:
        raise ValueError("srf_rate must be >= iorb")

    results = {}
    for name, data in shocked_banks.items():
        shortfall = data["projected_shortfall_or_excess"]
        entry = dict(data)  # shallow copy

        if shortfall < -0.05:  # meaningful excess
            entry["side"] = "lend"
            spread = rng.uniform(*lender_spread_bp) / 100.0
            entry["reservation_rate"] = round(iorb + spread, 4)
            entry["max_volume"] = round(abs(shortfall), 2)
        elif shortfall > 0.05:  # meaningful shortfall
            entry["side"] = "borrow"
            shade = rng.uniform(*borrower_spread_bp) / 100.0
            entry["reservation_rate"] = round(srf_rate - shade, 4)
            entry["max_volume"] = round(shortfall, 2)
        else:
            entry["side"] = "flat"
            entry["reservation_rate"] = None
            entry["max_volume"] = 0.0

        results[name] = entry
    return results


def match_repo_trades(
    banks_with_rates: Dict[str, Dict[str, Any]],
    rng: Optional[np.random.Generator] = None,
) -> List[Dict[str, Any]]:
    """
    Simple greedy matching of borrowers and lenders.

    Borrowers are sorted by willingness to pay (highest reservation rate first).
    Lenders are sorted by reservation rate (lowest first — cheapest cash).
    Trades occur at the midpoint of the two reservation rates when they overlap.
    Volume is the minimum of the two remaining capacities.

    This is deliberately transparent so students can see why a given trade
    clears at a particular rate.

    Returns
    -------
    list of trade dicts:
        {'lender', 'borrower', 'rate', 'volume', 'lender_res', 'borrower_res'}
    """
    if rng is None:
        rng = np.random.default_rng()

    lenders = [
        (name, d) for name, d in banks_with_rates.items()
        if d["side"] == "lend" and d["max_volume"] > 0
    ]
    borrowers = [
        (name, d) for name, d in banks_with_rates.items()
        if d["side"] == "borrow" and d["max_volume"] > 0
    ]

    # Sort: cheapest lenders first, most eager borrowers first
    lenders.sort(key=lambda x: x[1]["reservation_rate"])
    borrowers.sort(key=lambda x: -x[1]["reservation_rate"])

    # Remaining capacity
    lend_cap = {name: d["max_volume"] for name, d in lenders}
    borrow_cap = {name: d["max_volume"] for name, d in borrowers}

    trades = []
    for b_name, b_data in borrowers:
        b_rate = b_data["reservation_rate"]
        for l_name, l_data in lenders:
            if borrow_cap[b_name] <= 0.01:
                break
            if lend_cap[l_name] <= 0.01:
                continue
            l_rate = l_data["reservation_rate"]
            # Only trade if borrower is willing to pay at least the lender's reservation
            if b_rate + 1e-6 < l_rate:
                continue
            vol = min(borrow_cap[b_name], lend_cap[l_name])
            # Clear at midpoint (or lender's rate if you prefer a different convention)
            clear_rate = round((l_rate + b_rate) / 2.0, 4)
            trades.append({
                "lender": l_name,
                "borrower": b_name,
                "rate": clear_rate,
                "volume": round(vol, 2),
                "lender_res": l_rate,
                "borrower_res": b_rate,
            })
            lend_cap[l_name] -= vol
            borrow_cap[b_name] -= vol

    return trades


def calculate_sofr(trades: List[Dict[str, Any]]) -> Optional[float]:
    """
    Volume-weighted median of the trade rates.

    This is the classroom analog of the New York Fed's SOFR methodology
    (volume-weighted median of overnight Treasury-collateralized repo).

    Returns None if there are no trades.
    """
    if not trades:
        return None

    # Expand into (rate, volume) pairs and sort by rate
    pairs = sorted(
        [(t["rate"], t["volume"]) for t in trades],
        key=lambda x: x[0]
    )
    total_vol = sum(v for _, v in pairs)
    if total_vol <= 0:
        return None

    cum = 0.0
    half = total_vol / 2.0
    for rate, vol in pairs:
        cum += vol
        if cum >= half:
            return round(rate, 4)
    return round(pairs[-1][0], 4)


def summarize_round(
    banks_with_rates: Dict[str, Dict[str, Any]],
    trades: List[Dict[str, Any]],
    sofr: Optional[float],
    iorb: float,
    srf_rate: float,
) -> None:
    """Print a compact classroom summary of one trading round."""
    print(f"\n=== Round summary  |  IORB {iorb:.2f}%  |  SRF {srf_rate:.2f}% ===")
    print(f"SOFR (VW median): {sofr if sofr is not None else 'no trades'}")
    print(f"Trades: {len(trades)}  |  Volume: {sum(t['volume'] for t in trades):.2f}B")
    if trades:
        rates = [t["rate"] for t in trades]
        print(f"Trade rate range: {min(rates):.4f}% – {max(rates):.4f}%")
    print("\nPositions:")
    for name, d in sorted(banks_with_rates.items()):
        side = d["side"]
        res = f"{d['reservation_rate']:.4f}%" if d["reservation_rate"] is not None else "—"
        print(f"  {name:8}  {side:6}  res={res}  max_vol={d['max_volume']:6.2f}B  "
              f"shortfall={d['projected_shortfall_or_excess']:7.2f}B")


if __name__ == "__main__":
    # Demo that can be run after importing the setup functions
    # (or copy the shocked banks in)
    print("Reservation-rate + SOFR module loaded.")
    print("Typical use:")
    print("  from bank_repo_setup import create_bank, liquidity_shock")
    print("  from bank_repo_trading import get_reservation_rates, match_repo_trades, calculate_sofr")
    print("  rates = get_reservation_rates(shocked, iorb=4.40, srf_rate=4.50)")
    print("  trades = match_repo_trades(rates)")
    print("  sofr = calculate_sofr(trades)")
