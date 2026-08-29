"""Targeted re-fetch: improve airdrop eligibility text quality.

After the JSON-LD cleanup, some entries still hold truncated fragments
(e.g. "or identity signal for the airdrop.") because the original scrape
window landed mid-array. This script re-fetches only the fragment entries
with the FIXED extractor (strip_noise + clean_text) so they get the full
visible requirements prose instead of a JSON-LD fragment.

Entries with a clean multi-line step list or a complete sentence are left
untouched. Only the eligibility field (+ updatedAt) is overwritten when the
re-fetched text is longer than what we have.
"""
import json
import os
import socket
import sys
import time

os.environ["USE_PROXY"] = "0"  # direct connection in this environment
os.environ["CI"] = "true"
socket.setdefaulttimeout(15)  # fail fast instead of hanging 30s × 3 retries
sys.path.insert(0, os.path.dirname(__file__))
from fetch_airdrops import fetch_airdrop_detail  # noqa: E402

PATH = "src/data/airdrops.json"
CONNECTORS = (
    "or ", "is ", "are ", "and ", "for ", "the ", "right now", "do it",
    "before ", "an ", "to ", "on ", "with ",
)


def is_fragment(e: str) -> bool:
    if not e:
        return True  # empty -> try to refill
    if "\n" in e:
        return False  # clean multi-line step list, keep
    if len(e.strip()) < 100:
        return True
    if e[:40].lower().startswith(CONNECTORS):
        return True
    return False


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    arr = data["airdrops"]

    cands = [a for a in arr if is_fragment(a.get("eligibility", ""))]
    print(f"Re-fetching {len(cands)} fragment entries: "
          f"{[a.get('project') for a in cands]}")

    changed = 0
    for a in cands:
        url = a.get("sourceUrl") or f"https://airdrops.io/{a.get('id', '')}/"
        try:
            detail = fetch_airdrop_detail(url)
        except Exception as e:
            print(f"  {a.get('project')}: EXCEPTION {e!r}", flush=True)
            time.sleep(1.0)
            continue
        new = detail.get("eligibility", "")
        old = a.get("eligibility", "") or ""
        if new and len(new) > len(old):
            a["eligibility"] = new
            a["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            changed += 1
            print(f"  {a.get('project')}: {len(old)} -> {len(new)} chars", flush=True)
            print("     ", repr(new[:90]), flush=True)
            # Save incrementally so a later hang/timeout loses no progress.
            with open(PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        else:
            print(f"  {a.get('project')}: no improvement "
                  f"(old={len(old)}, new={len(new)})", flush=True)
        time.sleep(1.2)

    print(f"Saved {changed} eligibility updates." if changed else "No improvements; file unchanged.")


if __name__ == "__main__":
    main()
