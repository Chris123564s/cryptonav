#!/usr/bin/env python3
"""Fetch the live sitemap and write a grouped, human-readable page inventory.

Usage:
    python scripts/gen-sitemap-list.py [outfile]

Default outfile: CryptoNav-站点地图.md
"""

import re
import sys
import urllib.request
from collections import OrderedDict

INDEX = "https://cryptonav.site/sitemap-index.xml"
SITEMAP = "https://cryptonav.site/sitemap-0.xml"
DEFAULT_OUT = "CryptoNav-站点地图.md"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (sitemap-list)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "ignore")


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT

    # Follow the index to find child sitemaps (there may be >1 as the site grows).
    index_xml = fetch(INDEX)
    children = re.findall(r"<loc>(.*?)</loc>", index_xml)
    children = [c for c in children if c != INDEX] or [SITEMAP]

    urls = []
    for child in children:
        urls.extend(re.findall(r"<loc>(.*?)</loc>", fetch(child)))

    urls = sorted(set(urls))

    def group_of(u: str) -> str:
        path = u.replace("https://cryptonav.site", "").strip("/")
        return "/(home)" if path == "" else "/" + path.split("/")[0]

    groups = OrderedDict()
    for u in urls:
        groups.setdefault(group_of(u), []).append(u)

    lines = [
        "# CryptoNav 站点地图",
        "",
        f"- 站点：https://cryptonav.site",
        f"- 索引文件：{INDEX}",
        f"- 子地图：{', '.join(children)}",
        f"- 收录 URL 总数：**{len(urls)}**",
        "",
        "---",
        "",
    ]

    # Home first, then the rest alphabetically.
    order = sorted(groups, key=lambda k: (k != "/(home)", k))
    for key in order:
        items = sorted(groups[key])
        lines.append(f"## {key} （{len(items)}）")
        lines.append("")
        for u in items:
            lines.append(f"- {u}")
        lines.append("")

    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(f"wrote {out}: {len(urls)} URLs in {len(groups)} groups")
    for key in order:
        print(f"   {key}: {len(groups[key])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
