#!/usr/bin/env python3
"""Next-quarter ghost point for the cubes.

Rate axes (refi, funds−coupon, F1) are arithmetic: last Table-3 remaining-
maturity weights × today's FRED CMTs, TIPS dropped, rest renormalized, minus
the last Fiscal Data book coupon. That is the same rule as the cube.

NIPA axes: Gemini searches for the next *prints* (GDP, A091, FGRECPT,
W006, W780, FGEXPND, debt held by the public). Python then builds every
ratio, refi gap, and F1/F2/F3. σ is the published sample plus the
nowcast row. Gemini never returns cube coordinates.

Writes site/data/published/nowcast.json. Never raises out of main: a dead
nowcast must not fail nightly.
"""
from __future__ import annotations

import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[1]
PUB = Path(os.environ.get("CUBE_DATA_DIR", ROOT / "site" / "data")) / "published"
CUBES = PUB / "cubes.json"
OUT = PUB / "nowcast.json"
FRED = "https://api.stlouisfed.org/fred/series/observations"
# 1.5-flash is gone. 2.0-flash is shut down. 2.5-flash 404s on new AI Studio keys.
# Prefer current Flash; if those 404 too, list live generateContent flash models.
DEFAULT_GEMINI_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
)
BUCKETS = (
    ("resid_w_0_1y", "TB3MS"),
    ("resid_w_1_3y", "DGS2"),
    ("resid_w_3_7y", "DGS5"),
    ("resid_w_7_10y", "DGS10"),
    ("resid_w_10yplus", "DGS30"),
    ("resid_w_frn", "FEDFUNDS"),
)


def log(msg: str) -> None:
    print(f"==> [nowcast {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}] {msg}")
    sys.stdout.flush()


def fnum(v):
    try:
        x = float(v)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def next_qe(date_s: str) -> str:
    d = datetime.fromisoformat(str(date_s)[:10])
    q = (d.month - 1) // 3 + 1
    if q == 4:
        return f"{d.year + 1}-03-31"
    last = {1: "06-30", 2: "09-30", 3: "12-31"}[q]
    return f"{d.year}-{last}"


def series_sigma(vals, extra=None):
    xs = [fnum(v) for v in vals]
    if extra is not None:
        xs.append(extra)
    a = np.array([x for x in xs if x is not None], dtype=float)
    a = a[np.isfinite(a)]
    if len(a) < 8:
        return None
    s = float(a.std(ddof=1))
    return s if np.isfinite(s) and s > 0 else None


def fred_last(sess: requests.Session, sid: str, key: str):
    r = sess.get(
        FRED,
        params={
            "series_id": sid,
            "api_key": key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 8,
        },
        timeout=30,
    )
    r.raise_for_status()
    for obs in r.json().get("observations") or []:
        v = fnum(obs.get("value"))
        if v is not None:
            return v, str(obs.get("date"))
    return None, None


def residual_marginal(row: dict, yields: dict) -> tuple[float | None, dict]:
    wsum = 0.0
    used = {}
    for wkey, sid in BUCKETS:
        w = fnum(row.get(wkey))
        y = fnum(yields.get(sid))
        if w is None or w <= 1e-12:
            continue
        if y is None:
            return None, {"error": f"weight {wkey} > 0 but no live {sid}"}
        used[wkey] = w
        used[sid] = y
        wsum += w
    if wsum <= 0:
        return None, {"error": "Table 3 residual weights empty"}
    m = 0.0
    shares = {}
    for wkey, sid in BUCKETS:
        w = fnum(row.get(wkey))
        if w is None or w <= 1e-12:
            continue
        sh = w / wsum
        shares[wkey] = sh
        m += sh * float(yields[sid])
    used["wsum_pre_tips_drop"] = wsum
    used["shares_renorm"] = shares
    return m, used


def extract_grounding(data: dict) -> dict:
    cands = data.get("candidates") or []
    gm = (cands[0].get("groundingMetadata") if cands else None) or {}
    queries = [str(q) for q in (gm.get("webSearchQueries") or []) if q]
    sources = []
    seen = set()
    for ch in gm.get("groundingChunks") or []:
        web = ch.get("web") or ch.get("retrievedContext") or {}
        uri = web.get("uri") or web.get("url")
        title = web.get("title") or uri
        if not uri or uri in seen:
            continue
        seen.add(uri)
        sources.append({"title": str(title), "uri": str(uri)})
    return {"search_queries": queries, "sources": sources}


def resolve_gemini_models(sess: requests.Session, key: str) -> list[str]:
    pinned = (os.environ.get("GEMINI_MODEL") or "").strip()
    out: list[str] = []
    if pinned:
        out.append(pinned)
    for m in DEFAULT_GEMINI_MODELS:
        if m not in out:
            out.append(m)
    try:
        r = sess.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": key, "pageSize": 100},
            timeout=30,
        )
        if r.status_code != 200:
            log(f"models.list {r.status_code} {r.text[:160]}")
            return out
        live = []
        for m in r.json().get("models") or []:
            name = (m.get("name") or "").split("/")[-1]
            methods = m.get("supportedGenerationMethods") or []
            if "generateContent" not in methods:
                continue
            low = name.lower()
            if "flash" not in low:
                continue
            if any(x in low for x in ("image", "tts", "live", "exp")):
                continue
            if name not in out:
                live.append(name)
        out.extend(live)
        log("gemini catalog: " + ", ".join(out))
    except Exception as e:
        log(f"models.list {type(e).__name__}: {e}")
    return out


def gemini_nipa(target: str, last_rows: list, yields: dict, coupon: float) -> tuple[dict | None, str, dict]:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    empty_meta = {"search_queries": [], "sources": [], "prompt_rows": last_rows[-6:], "grounded": False}
    if not key:
        return None, "no GEMINI_API_KEY", empty_meta
    slim = []
    for r in last_rows[-6:]:
        slim.append({
            "date": r.get("date"),
            "interest_bn": r.get("interest_bn"),
            "receipts_bn": r.get("receipts_bn"),
            "tax_bn": r.get("tax_bn"),
            "gdp_bn": r.get("gdp_bn"),
            "int_rec_pct": r.get("int_rec_pct"),
            "int_tax_pct": r.get("int_tax_pct"),
            "int_gf_pct": r.get("int_gf_pct"),
            "primary_deficit_pct_gdp": r.get("primary_deficit_pct_gdp"),
            "debt_gdp_pct": r.get("debt_gdp_pct"),
        })
    empty_meta["prompt_rows"] = slim
    prompt = f"""You estimate the NEXT US quarterly NIPA/fiscal PRINTS. You do not score cubes.

Today (UTC): {datetime.now(timezone.utc).strftime("%Y-%m-%d")}.
Target quarter-end: {target}.
Last complete cube rows, same units (oldest to newest):
{json.dumps(slim, indent=2)}
Live Treasury / Fed market rates (Python owns refi; do not overwrite):
{json.dumps(yields, indent=2)}
Last book coupon (Fiscal Data Total Marketable, %): {coupon}

Search the open web. Prefer official statistical agencies, then institutions, then market press, then blogs:
  BEA, Atlanta Fed GDPNow, CBO, Treasury Fiscal Data, Monthly Treasury Statement, FRED,
  Reuters, Bloomberg, WSJ, Seeking Alpha, Calculated Risk, respectable financial blogs.
Weigh credibility. Name what you used.

Return ONLY JSON, numbers not strings:
  gdp_bn                 # NIPA GDP, current $, SAAR, billions (same unit as last rows)
  interest_bn_saar       # A091RC1Q027SBEA
  receipts_bn_saar       # FGRECPT
  tax_bn_saar            # W006RC1Q027SBEA
  w780_bn_saar           # W780RC1Q027SBEA (contributions for gov social insurance)
  fgexpnd_bn_saar        # FGEXPND current expenditures, SAAR, billions
  debt_held_public_bn    # debt held by the public, billions, same unit as GDP
  rationale              # <= 50 words, name sources; say if a number is a last-print copy

Do NOT return F1, F2, F3, refi, funds, int/receipts, primary/GDP, or debt/GDP. Python computes those from the prints.
If you cannot beat the last print for a series, copy the last print and say so in rationale.
"""
    headers = {"Content-Type": "application/json"}
    sess = requests.Session()
    models = resolve_gemini_models(sess, key)
    errors = []
    for model in models:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            f"?key={key}"
        )
        for tools in ([{"google_search": {}}], None):
            body = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            }
            if tools:
                body["tools"] = tools
            try:
                r = sess.post(url, headers=headers, json=body, timeout=90)
                if r.status_code >= 400:
                    last_err = f"{model} {r.status_code} {r.text[:240]}"
                    log(last_err)
                    errors.append(last_err)
                    if r.status_code == 404:
                        break
                    continue
                data = r.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                text = text.strip()
                if text.startswith("```"):
                    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
                parsed = json.loads(text)
                parsed["_model"] = model
                parsed["_grounded"] = bool(tools)
                g = extract_grounding(data)
                meta = {
                    "search_queries": g["search_queries"],
                    "sources": g["sources"],
                    "prompt_rows": slim,
                    "grounded": bool(tools) and bool(g["sources"] or g["search_queries"]),
                    "model": model,
                }
                log(f"gemini {model} grounded={meta['grounded']} sources={len(meta['sources'])}")
                return parsed, f"{model}", meta
            except Exception as e:
                last_err = f"{model} {type(e).__name__}: {e}"
                log(last_err)
                errors.append(last_err)
                continue
    return None, " | ".join(errors[-6:]) or "no model", empty_meta


def main() -> int:
    if not CUBES.exists():
        log("cubes.json missing — skip")
        return 0
    pack = json.loads(CUBES.read_text())
    # cubes.json is oldest → newest. Do not reverse.
    fail = sorted(pack.get("fail") or [], key=lambda r: str(r.get("date") or ""))
    sustain = sorted(pack.get("sustain") or [], key=lambda r: str(r.get("date") or ""))
    rows = fail or sustain
    if not rows:
        log("empty cubes — skip")
        return 0
    last = rows[-1]
    target = next_qe(last.get("date") or "2000-03-31")
    zone = pack.get("zone") or {}
    sig_gf = fnum((pack.get("sigma") or {}).get("int_gf"))

    fred_key = (os.environ.get("FRED_API_KEY") or "").strip()
    yields = {}
    yield_dates = {}
    sess = requests.Session()
    if fred_key:
        for _w, sid in BUCKETS:
            try:
                v, d = fred_last(sess, sid, fred_key)
                if v is not None:
                    yields[sid] = v
                    yield_dates[sid] = d
            except Exception as e:
                log(f"FRED {sid} {e}")
    else:
        log("no FRED_API_KEY — using last cube yields")
    # fill holes from last cube row so arithmetic still runs
    fallback = {
        "TB3MS": last.get("tb3m"),
        "DGS2": last.get("y2"),
        "DGS5": None,
        "DGS10": last.get("y10"),
        "DGS30": None,
        "FEDFUNDS": last.get("FEDFUNDS"),
    }
    for sid, v in fallback.items():
        if sid not in yields and fnum(v) is not None:
            yields[sid] = fnum(v)
            yield_dates[sid] = f"cube:{last.get('date')}"

    coupon = fnum(last.get("stock_avg_coupon"))
    marg, how = residual_marginal(last, yields)
    refi = (marg - coupon) if (marg is not None and coupon is not None) else None
    funds = fnum(yields.get("FEDFUNDS"))
    fms = (funds - coupon) if (funds is not None and coupon is not None) else None

    last_interest = fnum(last.get("interest_bn"))
    last_receipts = fnum(last.get("receipts_bn"))
    last_tax = fnum(last.get("tax_bn"))
    last_gdp = fnum(last.get("gdp_bn"))
    last_gf_pct = fnum(last.get("int_gf_pct"))
    last_gf = (last_interest / (last_gf_pct / 100.0)) if (last_interest and last_gf_pct) else None
    last_w780 = (last_receipts - last_gf) if (last_receipts is not None and last_gf is not None) else None
    last_primary = fnum(last.get("primary_deficit_pct_gdp"))
    last_expnd = None
    if last_primary is not None and last_gdp and last_interest is not None and last_receipts is not None:
        last_expnd = last_primary / 100.0 * last_gdp + last_interest + last_receipts

    nipa, nipa_src, gemini_meta = gemini_nipa(target, rows, {**yields, "dates": yield_dates}, coupon)
    gemini_block = {
        "ran": False,
        "skip": nipa_src,
        "model": None,
        "grounded": False,
        "rationale": None,
        "search_queries": [],
        "sources": [],
        "prompt_rows": gemini_meta.get("prompt_rows") or [],
        "estimates": None,
    }
    if nipa:
        interest = fnum(nipa.get("interest_bn_saar")) or last_interest
        receipts = fnum(nipa.get("receipts_bn_saar")) or last_receipts
        tax = fnum(nipa.get("tax_bn_saar")) or last_tax
        w780 = fnum(nipa.get("w780_bn_saar"))
        if w780 is None:
            w780 = last_w780
        gf = (receipts - w780) if (receipts is not None and w780 is not None) else last_gf
        gdp = fnum(nipa.get("gdp_bn")) or last_gdp
        expnd = fnum(nipa.get("fgexpnd_bn_saar"))
        if expnd is None:
            expnd = last_expnd
        primary = None
        if expnd is not None and interest is not None and receipts is not None and gdp:
            primary = 100.0 * (expnd - interest - receipts) / gdp
        if primary is None:
            primary = last_primary
        debt_bn = fnum(nipa.get("debt_held_public_bn"))
        debt_gdp = (100.0 * debt_bn / gdp) if (debt_bn is not None and gdp) else None
        if debt_gdp is None:
            debt_gdp = fnum(last.get("debt_gdp_pct"))
        rationale = str(nipa.get("rationale") or "")
        model = nipa.get("_model")
        nipa_label = f"gemini:{nipa_src}"
        gemini_block.update({
            "ran": True,
            "skip": None,
            "model": model,
            "grounded": bool(gemini_meta.get("grounded")),
            "rationale": rationale,
            "search_queries": gemini_meta.get("search_queries") or [],
            "sources": gemini_meta.get("sources") or [],
            "estimates": {
                "gdp_bn": fnum(nipa.get("gdp_bn")),
                "interest_bn_saar": fnum(nipa.get("interest_bn_saar")),
                "receipts_bn_saar": fnum(nipa.get("receipts_bn_saar")),
                "tax_bn_saar": fnum(nipa.get("tax_bn_saar")),
                "w780_bn_saar": fnum(nipa.get("w780_bn_saar")),
                "fgexpnd_bn_saar": fnum(nipa.get("fgexpnd_bn_saar")),
                "debt_held_public_bn": fnum(nipa.get("debt_held_public_bn")),
            },
        })
    else:
        log(f"gemini skipped: {nipa_src}")
        interest = last_interest
        receipts = last_receipts
        tax = last_tax
        gf = last_gf
        gdp = last_gdp
        expnd = last_expnd
        primary = last_primary
        debt_gdp = fnum(last.get("debt_gdp_pct"))
        rationale = "NIPA held at last print (no Gemini). Refi/F1 from live CMTs."
        model = None
        nipa_label = "last_print"
        gemini_block["rationale"] = rationale

    int_rec = (100.0 * interest / receipts) if (interest and receipts) else fnum(last.get("int_rec_pct"))
    int_tax = (100.0 * interest / tax) if (interest and tax) else fnum(last.get("int_tax_pct"))
    int_gf = (100.0 * interest / gf) if (interest and gf) else fnum(last.get("int_gf_pct"))
    f2_raw = zone.get("int_gf_warn")
    if f2_raw is None:
        f2_raw = zone.get("f2_raw", 20.0)

    sig_fms = series_sigma([r.get("funds_minus_stock") for r in fail], fms)
    sig_pri = series_sigma([r.get("primary_deficit_pct_gdp") for r in fail], primary)
    sig_gf_ext = series_sigma([r.get("int_gf_pct") for r in fail], int_gf) or sig_gf
    # Same rule as cube_visualize.standardize: F1 flips (at_or_below 0), F3 is (x-0)/σ.
    f1 = (-(fms) / sig_fms) if (fms is not None and sig_fms) else None
    f2 = ((int_gf - f2_raw) / sig_gf_ext) if (int_gf is not None and sig_gf_ext and f2_raw is not None) else None
    f3 = (primary / sig_pri) if (primary is not None and sig_pri) else None

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "not_a_print": True,
        "quarter_end": target,
        "from_date": last.get("date"),
        "model": model,
        "nipa_source": nipa_label,
        "rationale": rationale,
        "gemini": gemini_block,
        "rates": {
            "yields": yields,
            "yield_dates": yield_dates,
            "coupon": coupon,
            "marginal": marg,
            "refi_rule": "Table 3 remaining-maturity (TIPS dropped, rest renormalized) × live CMT/FEDFUNDS − last book coupon",
            "weights": how,
        },
        "int_rec_pct": int_rec,
        "int_tax_pct": int_tax,
        "int_gf_pct": int_gf,
        "refi_gap": refi,
        "debt_gdp_pct": debt_gdp,
        "funds_minus_stock": fms,
        "FEDFUNDS": funds,
        "stock_avg_coupon": coupon,
        "primary_deficit_pct_gdp": primary,
        "interest_bn": interest,
        "receipts_bn": receipts,
        "F1": f1,
        "F2": f2,
        "F3": f3,
        "sigma_used": {
            "funds_minus_stock": sig_fms,
            "int_gf": sig_gf_ext,
            "primary_deficit_pct_gdp": sig_pri,
            "includes_nowcast_row": True,
        },
        "note": (
            "Gold ghost on the cubes is this object. Gemini estimates prints only. "
            "Python computes ratios, refi, and F1/F2/F3. σ is the published sample "
            "plus this nowcast row. Not a BEA print."
        ),
    }
    PUB.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    log(
        f"wrote {OUT}  {target}  refi={refi if refi is None else f'{refi:+.2f}'}  "
        f"int/rec={int_rec if int_rec is None else f'{int_rec:.1f}'}  "
        f"debt/gdp={debt_gdp}  nipa={nipa_label}"
    )
    # keep manifest honest if it exists
    man = PUB / "manifest.json"
    if man.exists():
        try:
            m = json.loads(man.read_text())
            files = list(m.get("files") or [])
            if "nowcast.json" not in files:
                files.append("nowcast.json")
                m["files"] = files
                man.write_text(json.dumps(m, indent=2) + "\n")
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        log("nowcast failed open — cubes unchanged")
        raise SystemExit(0)
