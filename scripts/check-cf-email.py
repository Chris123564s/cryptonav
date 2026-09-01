#!/usr/bin/env python3
"""Decode Cloudflare Email Obfuscation on live CryptoNav pages.

WHY THIS EXISTS
---------------
Cloudflare's "Email Address Obfuscation" rewrites every email address in served
HTML into an encrypted hex blob, in two shapes:

    <a href="/cdn-cgi/l/email-protection#<hex>">
    <span class="__cf_email__" data-cfemail="<hex>">[email&#160;protected]</span>

So `curl <page> | grep contact@cryptonav.site` returns **0 matches even when the
page is correct**. Grepping plaintext to verify an email change is a false
negative and will send you chasing a deployment that actually succeeded.

DECODING
--------
First byte of <hex> is the XOR key. Every following byte XOR key = one plaintext char.

USAGE
-----
    python scripts/check-cf-email.py                       # default page set
    python scripts/check-cf-email.py https://cryptonav.site/foo/
    python scripts/check-cf-email.py --expect contact@cryptonav.site <urls...>

Exit code is 1 if any decoded address differs from --expected (default
contact@cryptonav.site), so it can be wired into CI or a post-deploy check.
"""

import collections
import re
import sys
import urllib.request

DEFAULT_PAGES = [
    "https://cryptonav.site/",
    "https://cryptonav.site/about/",
    "https://cryptonav.site/advertise/",
    "https://cryptonav.site/faq/",
    "https://cryptonav.site/privacy/",
    "https://cryptonav.site/terms/",
]

# Matches both obfuscation shapes.
PAT = re.compile(r'(?:email-protection#|data-cfemail=")([0-9a-fA-F]+)')


def decode(hex_blob: str) -> str:
    key = int(hex_blob[0:2], 16)
    return "".join(
        chr(int(hex_blob[i:i + 2], 16) ^ key) for i in range(2, len(hex_blob), 2)
    )


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (cf-email-check)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "ignore")


def main() -> int:
    args = sys.argv[1:]
    expected = "contact@cryptonav.site"
    if args and args[0] == "--expect":
        expected = args[1]
        args = args[2:]

    urls = args or DEFAULT_PAGES
    failed = False

    for url in urls:
        try:
            html = fetch(url)
        except Exception as exc:  # network/DNS/timeout
            print(f"{url}\n    FETCH FAILED: {exc}")
            failed = True
            continue

        decoded = [decode(h) for h in PAT.findall(html)]
        counts = collections.Counter(decoded)

        # The newsletter mailto carries a ?subject=... suffix; strip query for comparison.
        def base(addr: str) -> str:
            return addr.split("?")[0]

        bad = {a: c for a, c in counts.items() if base(a) != expected}

        print(f"{url}")
        if not counts:
            print("    (no obfuscated email found on this page)")
        for addr, cnt in counts.most_common():
            flag = "OK " if base(addr) == expected else "BAD"
            print(f"    [{flag}] {addr}  x{cnt}")
        if bad:
            failed = True

    print("\nRESULT:", "FAIL - unexpected address(es) above" if failed else f"PASS - all addresses are {expected}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
