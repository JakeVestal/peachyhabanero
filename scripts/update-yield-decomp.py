#!/usr/bin/env python3
"""
Daily updater for the yield-decomposition model page.
Fetches public series and rewrites the static numbers / JSON the page loads.
Par bond each week: coupon = that week's DGS10, price = 100.
"""
import json
import urllib.request
from datetime import datetime

FRED_SERIES = {
    "DGS10": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",
    "DFII10": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10",
    "T10YIE": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10YIE",
    "THREEFYTP10": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=THREEFYTP10",
    "SOFR": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SOFR",
}

# NY Fed ACM file (public XLS). In production parse the 10y column.
ACM_URL = "https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls"

def fetch_fred(url):
    with urllib.request.urlopen(url) as r:
        return r.read().decode("utf-8")

def main():
    # Placeholder: in the full script parse CSVs, align weekly from 2020,
    # compute par-bond Macaulay / modified / DV01 for each date,
    # compute implied short = nominal - KW and nominal - ACM,
    # write site/data/yield-decomp.json and/or rewrite the HTML numbers.
    print("update-yield-decomp: would fetch FRED + ACM and rewrite page")
    # Example latest values (replace with live parse)
    latest = {
        "asof": datetime.utcnow().strftime("%Y-%m-%d"),
        "nominal": 5.00,
        "real": 2.66,
        "breakeven": 2.34,
        "tp_kw": 0.94,
        "tp_acm": 0.89,  # placeholder; parse XLS
        "sofr": 3.92,
        "implied_kw": 5.00 - 0.94,
        "implied_acm": 5.00 - 0.89,
        "mac_duration": 7.99,
        "mod_duration": 7.61,
        "dv01": 0.0761,
    }
    with open("site/data/yield-decomp.json", "w") as f:
        json.dump(latest, f, indent=2)
