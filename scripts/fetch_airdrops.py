#!/usr/bin/env python3
"""
CryptoNav Airdrop Auto-Fetcher
===============================
Scrapes airdrops.io (latest + hot + homepage) for active airdrops,
enriches with CoinGecko trending data, and writes to src/data/airdrops.json.

airdrops.io HTML structure:
  <article class="...ongoing..." data-temperature="146" data-published="20260820120000">
    <a href=https://airdrops.io/SLUG/><h3>Project Name</h3></a>
    <div class="status-indicator ongoing">Ongoing</div>
    <div class="badge-confirmed">Confirmed</div>  (optional)
    Actions: <span>Follow on X, ...</span>
    <a href="/visit/49b3/" ...>CLAIM AIRDROP</a>
  </article>

Output: src/data/airdrops.json
"""

import json
import os
import re
import sys
import time
import hashlib
import urllib.request
import urllib.parse
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────────
OUTPUT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "data", "airdrops.json"
)

SOURCES = [
    ("https://airdrops.io/", "homepage"),
    ("https://airdrops.io/latest/", "latest"),
    ("https://airdrops.io/hot/", "hot"),
]

COINGECKO_TRENDING = "https://api.coingecko.com/api/v3/search/trending"

USE_PROXY = os.environ.get("USE_PROXY", "1") != "0"
PROXY_URL = "http://127.0.0.1:10809"
CI_MODE = os.environ.get("CI", "false").lower() == "true"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DELAY = 2  # seconds between requests

# Slugs that are not airdrop projects
EXCLUDE_SLUGS = {
    "latest", "hot", "categories", "tags", "exclusive", "past",
    "retroactive", "testnet", "holder", "about", "contact",
    "submit", "advertise", "visit", "premium", "partners",
    "feed", "wp-json", "telegram", "claims", "blog",
    "privacy-policy", "terms", "cookies", "disclaimer",
}


def make_request(url: str, max_retries: int = 3) -> str:
    """Make HTTP GET request with optional proxy and retries."""
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
    req = urllib.request.Request(url, headers=HEADERS)

    for attempt in range(max_retries):
        try:
            with opener.open(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  Retry {attempt+1}/{max_retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"  FAILED: {url} -- {e}")
                return ""
    return ""


def slugify(name: str) -> str:
    """Convert project name to URL slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or hashlib.md5(name.encode()).hexdigest()[:8]


# Tags whose entire inner content must be removed before parsing.
# <script> holds JSON-LD (HowTo schema etc.) that otherwise leaks into
# scraped text fields as raw code. See bug: eligibility field captured
# `"step":[{"@type":"HowToStep",...`
NOISE_TAGS = ("script", "style", "noscript", "svg", "iframe")

# Leftover markers that indicate a field swallowed structured data.
JSONLD_MARKERS = ('"@type"', '"@context"', '"@graph"', '"HowToStep"', "schema.org")

# airdrops.io page boilerplate that leaks into scraped prose (promo banners,
# unterminated tag fragments). Cut the field at the first occurrence.
BOILERPLATE_MARKERS = (
    "The $125,000 Airdrop",
    "JOIN NOW",
    "Is Almost Here",
    '"><script',
    '"><',
    '"/>',
    "/>",
    '">',
)


def strip_noise(html: str) -> str:
    """Remove script/style/JSON-LD blocks so regex extraction sees only content."""
    for tag in NOISE_TAGS:
        html = re.sub(
            r"<" + tag + r"\b[^>]*>.*?</" + tag + r">",
            " ",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
    # Safety net: cut anything after a JSON-LD marker inside a text run.
    return html


def clean_text(raw: str, limit: int = 500) -> str:
    """
    Normalise a scraped text fragment: collapse tags/whitespace and
    truncate at the first sign of embedded structured data (JSON-LD) or
    airdrops.io boilerplate (promo banners, tag fragments).
    """
    text = re.sub(r"<[^>]+>", " ", raw)
    text = re.sub(r"&nbsp;?", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Truncate at first JSON-LD or boilerplate marker.
    cut = len(text)
    for marker in JSONLD_MARKERS + BOILERPLATE_MARKERS:
        idx = text.find(marker)
        if idx != -1:
            cut = min(cut, idx)
    if cut < len(text):
        text = text[:cut]

    # Trim dangling fragments left by the cut (open quotes/braces/commas/tags).
    text = re.sub(r'[\s,>"{\[/]+$', "", text).strip()
    if len(text) > limit:
        text = text[:limit].rstrip()
    return text


def extract_airdrops_from_html(html: str, source_type: str) -> list:
    """
    Parse airdrops.io HTML to extract airdrop entries.
    
    airdrops.io uses <article> elements with data-temperature attribute.
    Inside each article:
      - <a href=https://airdrops.io/SLUG/> (note: href may have no quotes!)
      - <h3>Project Name</h3>
      - <div class="status-indicator ongoing/ended">Status</div>
      - <div class="badge-confirmed">Confirmed</div> (optional)
      - Actions: <span>action text</span>
      - data-temperature="146"
      - data-published="20260820120000"
      - class includes "ongoing"/"ended" and category like "categories-rwa"
    """
    airdrops = []

    # Drop script/style/JSON-LD first — otherwise regexes can start a match
    # inside a <script> block and swallow raw structured data.
    html = strip_noise(html)

    # Find all <article> blocks that contain airdrop data
    # They have class like "airdrop-click" and data-temperature
    article_pattern = re.compile(
        r'<article[^>]*class="[^"]*airdrop-click[^"]*"[^>]*>',
        re.IGNORECASE
    )

    for article_match in article_pattern.finditer(html):
        # Find the article start position, then extract a chunk of HTML after it
        start = article_match.start()
        # Find the next </article> after this one
        end_match = re.search(r"</article>", html[start:], re.IGNORECASE)
        if not end_match:
            continue
        article_html = html[start:start + end_match.end()]

        # Extract slug from href (may have quotes or not)
        # Pattern: href=https://airdrops.io/SLUG/ or href="https://airdrops.io/SLUG/"
        slug_match = re.search(
            r'href=["\']?https://airdrops\.io/([a-z0-9-]+)/?["\']?',
            article_html,
            re.IGNORECASE
        )
        if not slug_match:
            continue
        slug = slug_match.group(1).lower()
        if slug in EXCLUDE_SLUGS:
            continue

        # Extract project name from <h3>
        name_match = re.search(r"<h3[^>]*>(.*?)</h3>", article_html, re.DOTALL | re.IGNORECASE)
        if not name_match:
            continue
        project_name = re.sub(r"<[^>]+>", "", name_match.group(1)).strip()
        if not project_name or len(project_name) < 2:
            continue

        # Extract status from article class or status-indicator div
        status = "ongoing"
        if re.search(r"\bended\b", article_html, re.IGNORECASE):
            status = "ended"
        elif re.search(r"\bongoing\b", article_html, re.IGNORECASE):
            status = "ongoing"

        # Check for "Confirmed" badge
        is_confirmed = bool(re.search(r"badge-confirmed", article_html, re.IGNORECASE))
        if is_confirmed:
            status = "confirmed"

        # Extract actions text
        actions = ""
        actions_match = re.search(
            r"Actions:\s*<span[^>]*>(.*?)</span>",
            article_html,
            re.DOTALL | re.IGNORECASE
        )
        if actions_match:
            actions = re.sub(r"<[^>]+>", "", actions_match.group(1)).strip()
            actions = re.sub(r"\s+", " ", actions)

        # Extract temperature/votes
        temp_match = re.search(r'data-temperature="(\d+)"', article_html, re.IGNORECASE)
        votes = int(temp_match.group(1)) if temp_match else 0

        # Extract publish date
        pub_match = re.search(r'data-published="(\d{14})"', article_html, re.IGNORECASE)
        published = ""
        if pub_match:
            d = pub_match.group(1)
            published = f"{d[:4]}-{d[4:6]}-{d[6:8]}"

        # Extract claim URL
        claim_url = ""
        claim_match = re.search(r'href="(/visit/[^"]+)"', article_html, re.IGNORECASE)
        if claim_match:
            claim_url = f"https://airdrops.io{claim_match.group(1)}"

        # Extract category from article class
        category = ""
        cat_match = re.search(r"categories-([a-z]+)", article_html, re.IGNORECASE)
        if cat_match:
            category = cat_match.group(1).capitalize()

        # Extract logo image
        logo = ""
        img_match = re.search(r'data-src="(https://airdrops\.io/wp-content/uploads/[^"]+)"', article_html, re.IGNORECASE)
        if img_match:
            logo = img_match.group(1)
        else:
            img_match = re.search(r'src="(https://airdrops\.io/wp-content/uploads/[^"]+)"', article_html, re.IGNORECASE)
            if img_match:
                logo = img_match.group(1)

        airdrops.append({
            "id": slug,
            "project": project_name,
            "slug": slug,
            "status": status,
            "actions": actions,
            "votes": votes,
            "published": published,
            "claimUrl": claim_url,
            "sourceUrl": f"https://airdrops.io/{slug}/",
            "sourceType": source_type,
            "logo": logo,
            "category": category,
        })

    # Fallback: if no articles found, try simpler pattern (href + h3)
    if not airdrops:
        # Pattern: href=https://airdrops.io/SLUG/ ... <h3>Name</h3>
        simple_pattern = re.compile(
            r'href=["\']?https://airdrops\.io/([a-z0-9-]+)/?["\']?[^>]*>.*?<h3[^>]*>(.*?)</h3>',
            re.DOTALL | re.IGNORECASE
        )
        for match in simple_pattern.finditer(html):
            slug = match.group(1).lower()
            if slug in EXCLUDE_SLUGS:
                continue
            name = re.sub(r"<[^>]+>", "", match.group(2)).strip()
            if not name or len(name) < 2:
                continue
            airdrops.append({
                "id": slug,
                "project": name,
                "slug": slug,
                "status": "ongoing",
                "actions": "",
                "votes": 0,
                "published": "",
                "claimUrl": "",
                "sourceUrl": f"https://airdrops.io/{slug}/",
                "sourceType": source_type,
                "logo": "",
                "category": "",
            })

    return airdrops


def fetch_airdrop_detail(url: str) -> dict:
    """
    Fetch individual airdrop page for detailed info.
    Extract: chain, symbol, eligibility, amount, dates, website, funding.
    """
    html = make_request(url)
    if not html:
        return {}

    # Drop <script>/<style>/JSON-LD first — otherwise the eligibility regex can
    # start a match inside a <script type="application/ld+json"> HowTo block and
    # swallow raw structured data (bug: eligibility showed `"step":[{"@type":...`).
    html = strip_noise(html)

    detail = {}

    # Extract symbol/ticker — usually in format $TOKEN or (TOKEN)
    symbol_match = re.search(r"\$([A-Z]{2,10})\b", html)
    if symbol_match:
        detail["symbol"] = symbol_match.group(1)
    else:
        paren_match = re.search(r"<td[^>]*>\s*\(([A-Z]{2,10})\)\s*</td>", html)
        if paren_match:
            detail["symbol"] = paren_match.group(1)

    # Extract website — collect all data-outbound-host values, skip known ad/sponsor domains
    AD_DOMAINS = {"getminted.io", "bridge.airdrops.io"}
    outbound_matches = re.findall(r'data-outbound-host="([^"]+)"', html)
    for host in outbound_matches:
        # Skip ad domains and airdrops.io internal links
        if host in AD_DOMAINS or host.endswith(".airdrops.io") or host == "airdrops.io":
            continue
        # This should be the real project website
        if not host.startswith("http"):
            host = "https://" + host
        detail["website"] = host
        break

    # Fallback: if no outbound-host found, try href links excluding known domains
    if "website" not in detail:
        EXCLUDED_DOMAINS = (
            "airdrops.io", "twitter.com", "x.com", "t.me", "discord.gg",
            "discord.com", "facebook.com", "youtube.com", "github.com",
            "medium.com", "reddit.com", "gmpg.org", "wordpress.org",
            "wp.com", "getminted.io", "googletagmanager.com",
            "google-analytics.com", "onesignal.com", "googletagservices.com",
            "pagead2.googlesyndication.com", "cdn.ampproject.org",
            "fonts.googleapis.com", "fonts.gstatic.com",
        )
        website_match = re.search(
            r'href="(https?://(?:www\.)?(?!' + "|".join(d.replace(".", r"\.") for d in EXCLUDED_DOMAINS) + r')[^"]+)"',
            html
        )
        if website_match:
            detail["website"] = website_match.group(1)

    # Extract chain — look for chain/network label in info table
    chain_patterns = [
        r"<td[^>]*>\s*(?:Blockchain|Chain|Network)\s*</td>\s*<td[^>]*>(.*?)</td>",
        r"(?:Blockchain|Chain|Network)\s*[:</]+[^>]*>\s*([A-Za-z ,]+?)(?:<|,)",
    ]
    for pat in chain_patterns:
        cm = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if cm:
            detail["chain"] = re.sub(r"<[^>]+>", "", cm.group(1)).strip()
            break

    # Extract eligibility / requirements
    elig_match = re.search(
        r"(?:eligibility|requirements|how to (?:participate|qualify|get|claim|join))(.*?)(?:</div>|</section>|</article>|<h[23]|<footer)",
        html, re.DOTALL | re.IGNORECASE
    )
    if elig_match:
        detail["eligibility"] = clean_text(elig_match.group(1), limit=500)

    # Extract amount
    amount_patterns = [
        r"(?:total supply|airdrop (?:size|amount|pool|allocation)|reward|distribution value).*?([\d,.]+\s*%|\$[\d,.]+\s*[MBK]?)",
        r"([\d,.]+\s*(?:%|tokens?|USD|USDT))\s*(?:airdrop|distribution|reward)",
    ]
    for pat in amount_patterns:
        am = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if am:
            detail["amount"] = am.group(1).strip()
            break

    # Extract snapshot date
    snapshot_patterns = [
        r"snapshot.*?(\d{4}-\d{2}-\d{2})",
        r"snapshot.*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})",
    ]
    for pat in snapshot_patterns:
        sm = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if sm:
            detail["snapshot"] = sm.group(1).strip()
            break

    # Extract distribution date / TGE
    dist_patterns = [
        r"(?:distribution|TGE|listing|launch).*?(\d{4}-\d{2}-\d{2})",
        r"(?:distribution|TGE|listing|launch).*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})",
        r"(?:distribution|TGE|listing|launch).*?(Q[1-4]\s+\d{4})",
    ]
    for pat in dist_patterns:
        dm = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if dm:
            detail["distribution"] = dm.group(1).strip()
            break

    # Extract funding amount
    funding_match = re.search(
        r"\$(\d+(?:\.\d+)?)\s*([MBK])?\s*(?:raised|funding|funded|backed|total)",
        html, re.IGNORECASE
    )
    if funding_match:
        amount_num = funding_match.group(1)
        suffix = funding_match.group(2) or ""
        detail["funding"] = f"${amount_num}{suffix}"

    return detail


def fetch_coingecko_trending() -> list:
    """Fetch trending coins from CoinGecko for cross-reference."""
    html = make_request(COINGECKO_TRENDING)
    if not html:
        return []
    try:
        data = json.loads(html)
        coins = data.get("coins", [])
        return [
            {
                "id": c.get("item", {}).get("id", ""),
                "name": c.get("item", {}).get("name", ""),
                "symbol": c.get("item", {}).get("symbol", ""),
                "market_cap_rank": c.get("item", {}).get("market_cap_rank"),
                "thumb": c.get("item", {}).get("thumb", ""),
            }
            for c in coins
        ]
    except (json.JSONDecodeError, KeyError, TypeError):
        return []


def merge_and_dedup(airdrops: list) -> list:
    """Merge airdrops from multiple sources, dedup by slug/id."""
    seen = {}
    for a in airdrops:
        slug = a["id"]
        if slug in seen:
            existing = seen[slug]
            if a.get("votes", 0) > existing.get("votes", 0):
                existing["votes"] = a["votes"]
            if a.get("actions") and not existing.get("actions"):
                existing["actions"] = a["actions"]
            if a["status"] == "confirmed" and existing["status"] != "confirmed":
                existing["status"] = "confirmed"
            if a.get("logo") and not existing.get("logo"):
                existing["logo"] = a["logo"]
            if a.get("category") and not existing.get("category"):
                existing["category"] = a["category"]
        else:
            seen[slug] = a
    return list(seen.values())


def load_existing() -> dict:
    """Load existing airdrops.json."""
    if not os.path.exists(OUTPUT_FILE):
        return {}
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def main():
    print("=" * 60)
    print("CryptoNav Airdrop Auto-Fetcher")
    print("=" * 60)
    print(f"Mode: {'CI' if CI_MODE else 'Local'} | Proxy: {'On' if USE_PROXY and not CI_MODE else 'Off'}")
    print()

    # Load existing data to preserve manually curated entries
    existing_data = load_existing()
    existing_airdrops = existing_data.get("airdrops", [])
    existing_map = {a["id"]: a for a in existing_airdrops}
    print(f"Existing airdrops: {len(existing_airdrops)}")

    # Phase 1: Scrape all source pages
    all_airdrops = []
    for url, source_type in SOURCES:
        print(f"\nFetching {source_type}: {url}")
        time.sleep(DELAY)
        html = make_request(url)
        if not html:
            print(f"  WARNING: No HTML returned, skipping")
            continue

        items = extract_airdrops_from_html(html, source_type)
        print(f"  Found {len(items)} airdrops")
        all_airdrops.extend(items)

    # Dedup across sources
    merged = merge_and_dedup(all_airdrops)
    print(f"\nMerged (deduped): {len(merged)} unique airdrops")

    # Sort by votes (hottest first)
    merged.sort(key=lambda x: (-x.get("votes", 0), x.get("project", "")))

    # Phase 2: Fetch details for top items
    DETAIL_LIMIT = 30 if CI_MODE else 50
    detail_count = 0

    for airdrop in merged:
        if detail_count >= DETAIL_LIMIT:
            print(f"\n  Detail limit reached ({DETAIL_LIMIT}), skipping remaining")
            break

        # Skip if we already have good data from existing manual entries
        # "Good" means: has a real website URL (not empty, not gmpg.org)
        existing = existing_map.get(airdrop["id"])
        if existing:
            existing_web = existing.get("website", "")
            has_good_website = existing_web and not existing_web.startswith("https://gmpg.org") and not existing_web.startswith("https://getminted.io")
            has_good_chain = existing.get("chain") and existing.get("chain") != "Multi-chain"
            if has_good_website and has_good_chain:
                # Preserve stable identifiers from existing curated data,
                # but still refresh volatile content (eligibility/amount/dates)
                # from the live detail page so text quality self-heals over time.
                airdrop.update({
                    "symbol": existing.get("symbol", airdrop.get("symbol", "")),
                    "chain": existing.get("chain", ""),
                    "website": existing.get("website", ""),
                    "category": existing.get("category", airdrop.get("category", "")),
                    "note": existing.get("note", ""),
                })
                slug = airdrop["id"]
                detail_url = f"https://airdrops.io/{slug}/"
                print(f"  [{detail_count+1}/{DETAIL_LIMIT}] Refresh content: {airdrop['project']}")
                time.sleep(DELAY)
                detail = fetch_airdrop_detail(detail_url)
                airdrop.update({
                    "eligibility": detail.get("eligibility", "") or existing.get("eligibility", ""),
                    "amount": detail.get("amount", "") or existing.get("amount", "TBA"),
                    "snapshot": detail.get("snapshot", "") or existing.get("snapshot", "TBA"),
                    "distribution": detail.get("distribution", "") or existing.get("distribution", "TBA"),
                    "funding": detail.get("funding", "") or existing.get("funding", ""),
                })
                detail_count += 1
                continue

        # Fetch detail page
        slug = airdrop["id"]
        detail_url = f"https://airdrops.io/{slug}/"
        print(f"  [{detail_count+1}/{DETAIL_LIMIT}] Detail: {airdrop['project']}")

        time.sleep(DELAY)
        detail = fetch_airdrop_detail(detail_url)

        airdrop.update({
            "symbol": detail.get("symbol", ""),
            "chain": detail.get("chain", "Multi-chain"),
            "eligibility": detail.get("eligibility", ""),
            "amount": detail.get("amount", "TBA"),
            "snapshot": detail.get("snapshot", "TBA"),
            "distribution": detail.get("distribution", "TBA"),
            "website": detail.get("website", airdrop.get("sourceUrl", "")),
            "funding": detail.get("funding", ""),
        })
        detail_count += 1

    # Fill defaults for items without details
    for airdrop in merged:
        airdrop.setdefault("symbol", "")
        airdrop.setdefault("chain", "Multi-chain")
        airdrop.setdefault("eligibility", "")
        airdrop.setdefault("amount", "TBA")
        airdrop.setdefault("snapshot", "TBA")
        airdrop.setdefault("distribution", "TBA")
        airdrop.setdefault("website", airdrop.get("sourceUrl", ""))
        airdrop.setdefault("funding", "")
        airdrop.setdefault("note", "")

        # Map phase
        status = airdrop.get("status", "ongoing")
        if status == "ended":
            airdrop["phase"] = "ended"
        elif status == "confirmed":
            airdrop["phase"] = "confirmed"
        else:
            airdrop["phase"] = "ongoing"

    # Phase 3: Cross-reference with CoinGecko trending
    print("\nFetching CoinGecko trending for cross-reference...")
    time.sleep(DELAY)
    trending = fetch_coingecko_trending()
    if trending:
        print(f"  Trending coins: {len(trending)}")
        trending_names = {t["name"].lower(): t for t in trending}
        for airdrop in merged:
            name_lower = airdrop.get("project", "").lower()
            if name_lower in trending_names:
                tc = trending_names[name_lower]
                if not airdrop.get("symbol"):
                    airdrop["symbol"] = tc.get("symbol", "")
                if not airdrop.get("logo"):
                    airdrop["logo"] = tc.get("thumb", "")
                airdrop["trending"] = True
                print(f"  Cross-referenced: {airdrop['project']} -> {tc['symbol']}")

    # Build final output
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]
    for airdrop in merged:
        airdrop["updatedAt"] = today

    output = {
        "airdrops": merged,
        "lastFetched": now,
        "source": "airdrops.io + CoinGecko",
        "totalTracked": len(merged),
    }

    # Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n Written {len(merged)} airdrops to {OUTPUT_FILE}")
    print(f"   Last fetched: {now}")
    print(f"   Sources: airdrops.io (latest+hot+homepage) + CoinGecko trending")

    # Summary
    by_status = {}
    for a in merged:
        s = a.get("status", "ongoing")
        by_status[s] = by_status.get(s, 0) + 1
    print("\nSummary by status:")
    for s, c in sorted(by_status.items()):
        print(f"  {s}: {c}")

    print("\nTop 10 by votes:")
    for a in merged[:10]:
        sym = a.get("symbol") or "?"
        print(f"  {a.get('votes',0):>4} | {a['project']:<25} ({sym:<6}) | {a.get('chain','?'):<15} | {a.get('status')}")


if __name__ == "__main__":
    main()
