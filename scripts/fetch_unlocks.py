#!/usr/bin/env python3
"""
CryptoNav Token Unlocks Auto-Fetcher
====================================
Pulls upcoming token-unlock events from the Tokenomist API and merges them
into src/data/unlocks.json.

Tokenomist (https://tokenomist.ai) is the authoritative source for vesting /
unlock schedules. The v1 "upcoming unlock events" endpoint is kept for
existing integrations and returns, per token:

    {
      "tokenId": "layerzero",
      "tokenName": "LayerZero",
      "tokenSymbol": "ZRO",
      "marketCap": 278811255,
      "releasedPercentage": 35.28,
      "upcomingEvent": {
        "unlockDate": "2025-11-20T11:00:00Z",
        "cliffUnlocks": {
          "totalCliffAmount": 25708332.666,
          "totalCliffValue": 35991665.73,
          "valueToMarketCap": 12.9
        }
      }
    }

IMPORTANT — auth:
  The endpoint requires an `x-api-key` header. Tokenomist API access needs a
  paid plan (Pro / API / Enterprise) OR a free trial requested via their form
  (https://tokenomist.ai/pricing → request free trial). There is NO always-free
  tier. Provide the key via the TOKENOMIST_API_KEY environment variable
  (GitHub Actions: a repo secret of the same name).

SAFE FALLBACK:
  If no API key is set, or the request fails, or the API returns no data,
  the script does NOT touch unlocks.json — the curated data stays intact and
  CI remains green (git sees no diff, so nothing is committed). This means the
  page works from day one with hand-curated unlocks, and "switches on" the
  moment a key is configured.

What the API does NOT provide (so we preserve it from curated data):
  - logo image                    -> kept by token symbol
  - percentSupply                 -> kept from curated entry
  - chain / website / note        -> kept from curated entry
New tokens discovered via the API get real date/amount/value but empty
chain/logo/percentSupply (they can be enriched later).
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────────
OUTPUT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "data", "unlocks.json"
)

# v1 endpoint (kept for existing integrations). Current is v5; switch the
# URL if you migrate and adjust the field mapping below accordingly.
TOKENOMIST_URL = "https://api.tokenomist.ai/v1/unlock/events/upcoming"

API_KEY = os.environ.get("TOKENOMIST_API_KEY", "").strip()

USE_PROXY = os.environ.get("USE_PROXY", "1") != "0"
PROXY_URL = "http://127.0.0.1:10809"
CI_MODE = os.environ.get("CI", "false").lower() == "true"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CryptoNavBot/1.0)",
    "Accept": "application/json",
}


# ── Helpers ───────────────────────────────────────────────────────────────
def make_request(url: str, headers: dict, max_retries: int = 3) -> str:
    """GET with optional proxy + x-api-key header, with retries."""
    proxy_handler = None
    if USE_PROXY and not CI_MODE:
        proxy_handler = urllib.request.ProxyHandler({
            "http": PROXY_URL,
            "https": PROXY_URL,
        })
    handlers = [urllib.request.HTTPHandler()]
    if proxy_handler:
        handlers.append(proxy_handler)
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(max_retries):
        try:
            with opener.open(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            if attempt < max_retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  Retry {attempt+1}/{max_retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"  FAILED: {url} -- {e}")
                return ""
    return ""


def fmt_amount(num, symbol: str) -> str:
    """25708332.666, 'ZRO' -> '25.7M ZRO'."""
    try:
        n = float(num)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    if n >= 1e9:
        s = f"{n/1e9:.1f}B"
    elif n >= 1e6:
        s = f"{n/1e6:.1f}M"
    elif n >= 1e3:
        s = f"{n/1e3:.1f}K"
    else:
        s = f"{n:.0f}"
    return f"{s} {symbol}".strip()


def fmt_usd(num) -> str:
    """35991665.73 -> '$36.0M'."""
    try:
        n = float(num)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    if n >= 1e9:
        return f"${n/1e9:.2f}B"
    if n >= 1e6:
        return f"${n/1e6:.1f}M"
    if n >= 1e3:
        return f"${n/1e3:.1f}K"
    return f"${n:.0f}"


def parse_date(iso: str) -> str:
    """'2025-11-20T11:00:00Z' -> '2025-11-20' (empty on failure)."""
    if not iso:
        return ""
    return iso[:10]


def load_existing() -> list:
    if not os.path.exists(OUTPUT_FILE):
        return []
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("unlocks", [])
    except (json.JSONDecodeError, IOError):
        return []


def fetch_tokenomist() -> list:
    """Return the raw `data` list from Tokenomist, or [] on any failure."""
    if not API_KEY:
        print("  No TOKENOMIST_API_KEY set — skipping live fetch.")
        return []
    headers = dict(HEADERS)
    headers["x-api-key"] = API_KEY
    raw = make_request(TOKENOMIST_URL, headers)
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  FAILED: invalid JSON from Tokenomist: {e}")
        return []
    if not payload.get("status", True):
        print("  Tokenomist returned status=false — check API key / credits.")
        return []
    return payload.get("data", []) or []


def merge(curated: list, api_data: list) -> list:
    """
    Union of curated + API entries keyed by token symbol.
    API refreshes date/amount/value/project; curated supplies
    logo/percentSupply/chain/website/note (fields the API lacks).
    """
    by_sym = {u.get("token", ""): u for u in curated if u.get("token")}
    out = []
    for d in api_data:
        sym = (d.get("tokenSymbol") or "").strip()
        if not sym:
            continue
        ue = d.get("upcomingEvent") or {}
        cu = ue.get("cliffUnlocks") or {}
        date = parse_date(ue.get("unlockDate") or "")
        if not date:
            continue  # skip entries without a usable date
        amount = fmt_amount(cu.get("totalCliffAmount"), sym)
        value = fmt_usd(cu.get("totalCliffValue"))
        cur = by_sym.get(sym, {})
        entry = {
            "token": sym,
            "project": d.get("tokenName") or cur.get("project", ""),
            "logo": cur.get("logo", "") or "",
            "date": date,
            "amount": amount or cur.get("amount", ""),
            "percentSupply": cur.get("percentSupply", "") or "",
            "value": value or cur.get("value", ""),
            "chain": cur.get("chain", "") or "",
            "website": cur.get("website", "") or "",
            "note": cur.get("note", "") or "",
        }
        out.append(entry)
        by_sym.pop(sym, None)  # consumed; don't re-add below

    # Append curated entries not present in the API feed (preserve as-is).
    for sym, cur in by_sym.items():
        out.append(cur)

    out.sort(key=lambda x: x.get("date", ""))
    return out


def main():
    print("=" * 60)
    print("CryptoNav Token Unlocks Auto-Fetcher")
    print("=" * 60)
    print(f"Mode: {'CI' if CI_MODE else 'Local'} | "
          f"Proxy: {'On' if USE_PROXY and not CI_MODE else 'Off'} | "
          f"API key: {'set' if API_KEY else 'MISSING'}")
    print()

    curated = load_existing()
    print(f"Curated unlocks: {len(curated)}")

    api_data = fetch_tokenomist()
    if not api_data:
        print("\nNo live data fetched — preserving curated unlocks.json unchanged.")
        print("Configure TOKENOMIST_API_KEY to enable automatic refresh.")
        return  # exit 0, do NOT overwrite

    print(f"Tokenomist returned: {len(api_data)} upcoming unlock events")

    merged = merge(curated, api_data)
    print(f"Merged total: {len(merged)} unlocks")

    now = datetime.now(timezone.utc).isoformat()
    output = {
        "unlocks": merged,
        "lastFetched": now,
        "source": "Tokenomist API + curated",
        "totalTracked": len(merged),
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n Written {len(merged)} unlocks to {OUTPUT_FILE}")
    print(f"   Last fetched: {now}")

    # Summary
    future = [u for u in merged if u.get("date", "") >= now[:10]]
    print(f"   Upcoming (>= today): {len(future)}")
    print("\nNext 10 by date:")
    for u in merged[:10]:
        print(f"  {u.get('date','?'):<12} | {u.get('token','?'):<7} | "
              f"{u.get('amount','?'):<12} | {u.get('value','?'):<8} | {u.get('chain','?')}")


if __name__ == "__main__":
    main()
