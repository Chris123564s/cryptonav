#!/usr/bin/env python3
"""
CryptoNav Token Unlocks — keyless maintenance
=============================================
No external API, no API key. This keeps src/data/unlocks.json tidy on a
schedule so the /unlocks page stays fresh without manual cleanup:

  1. Re-sorts all entries by unlock date (ascending).
  2. Prunes entries whose unlock date is older than PRUNE_PAST_DAYS days
     (default 365 — keeps ~1 year of history; lower it to declutter sooner,
     e.g. 90 to drop events older than ~3 months).

The curated unlock data itself is still hand-maintained: add new entries to
unlocks.json whenever you like. This job only orders and trims it.

Idempotent: it rewrites the file ONLY when pruning actually removes entries,
so CI commits are meaningful (no daily no-op commits).

Why keyless? Every real unlock data API we checked (Tokenomist, CryptoRank,
Apify, oanor) requires an account / API key. Since the unlocks page works
perfectly from hand-curated data, the pragmatic automation is scheduled
maintenance rather than a paid feed.
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

OUTPUT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "data", "unlocks.json"
)

PRUNE_PAST_DAYS = int(os.environ.get("PRUNE_PAST_DAYS", "365"))


def parse_date(s):
    """'2026-03-16' -> date, or None if invalid/empty."""
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def load_existing() -> list:
    if not os.path.exists(OUTPUT_FILE):
        return []
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data.get("unlocks", [])
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def main():
    print("=" * 60)
    print("CryptoNav Token Unlocks — keyless maintenance")
    print("=" * 60)
    print(f"Prune window: {PRUNE_PAST_DAYS} days "
          f"(events older than this are removed)")
    print()

    existing = load_existing()
    print(f"Loaded unlocks: {len(existing)}")

    if not existing:
        print("Nothing to maintain.")
        return

    # Sort by date ascending; entries without a parseable date go last.
    sorted_u = sorted(
        existing,
        key=lambda u: (parse_date(u.get("date", "")) or datetime.max.date())
    )

    today = datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=PRUNE_PAST_DAYS)
    kept = [
        u for u in sorted_u
        if (parse_date(u.get("date", "")) or today) >= cutoff
    ]
    removed = len(sorted_u) - len(kept)

    if removed == 0:
        print("No entries past the prune window — unlocks.json unchanged.")
        return

    output = {"unlocks": kept}
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Pruned {removed} stale unlock event(s); {len(kept)} remain.")
    print(f"Cutoff date was {cutoff.isoformat()} (today {today.isoformat()}).")
    print(f"Written {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
