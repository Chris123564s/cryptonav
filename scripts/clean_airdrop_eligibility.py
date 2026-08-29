"""One-off cleanup (v3): fully sanitise eligibility text.

Handles three layers of residue left by the broken scraper:
  1. JSON-LD structural signatures ("step":[, "@type", "position":, etc.)
     -> cut there, or rebuild a clean step list from "step":[ array.
  2. Literal \\uXXXX unicode escapes (JSON-LD escapes quotes/apostrophes)
     -> decode to real characters.
  3. Trailing/leading HTML+JSON fragments ("./", '"}', ',"', etc.)
     -> peel off.
Only the eligibility field is touched.
"""
import json
import re

PATH = "src/data/airdrops.json"

SIGNATURES = (
    '"step":[',
    '{"@context',
    '"@type"',
    '"@graph"',
    "schema.org",
    '"position":',
    '","name":',
    '","text":',
    '{"name":',
    '"}',
)

UNICODE_ESC = re.compile(r"\\u([0-9a-fA-F]{4})")
TRAIL_JUNK = '\'",/<>{}[]'


def decode_escapes(s: str) -> str:
    return UNICODE_ESC.sub(lambda m: chr(int(m.group(1), 16)), s)


def extract_steps(frag: str) -> list:
    pairs = re.findall(r'"name":"([^"]*)"(?:,"text":"([^"]*)")?', frag)
    lines = []
    for i, (name, text) in enumerate(pairs, 1):
        name = re.sub(r"^\s*step\s*\d+[\:\-\.]?\s*", "", name.strip(), flags=re.IGNORECASE)
        if not name:
            continue
        name = decode_escapes(name)
        text = decode_escapes((text or "").strip())
        line = f"{i}. {name}: {text}" if (text and text != name) else f"{i}. {name}"
        lines.append(line)
    return lines


def peel(v: str) -> str:
    v = v.strip()
    for _ in range(4):
        new = v.strip().strip(TRAIL_JUNK).strip()
        if new == v:
            break
        v = new
    return v


def clean_eligibility(v: str) -> str:
    if not isinstance(v, str) or not v.strip():
        return v

    # Case 1: rebuild from a HowTo "step":[...] array if present.
    m = re.search(r'"step":\[(.*)', v)
    if m:
        lines = extract_steps(m.group(1))
        if lines:
            return "\n".join(lines)[:600]

    # Case 2: cut at the first JSON-LD signature.
    cut = len(v)
    hit = False
    for sig in SIGNATURES:
        idx = v.find(sig)
        if idx != -1:
            cut = min(cut, idx)
            hit = True
    if hit:
        v = v[:cut]

    v = decode_escapes(v)
    v = peel(v)
    return v[:500]


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    arr = data["airdrops"]
    cleaned = emptied = 0
    for a in arr:
        if not isinstance(a, dict):
            continue
        orig = a.get("eligibility", "")
        new = clean_eligibility(orig)
        if new != orig:
            a["eligibility"] = new
            cleaned += 1
            if not new:
                emptied += 1
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Cleaned {cleaned} entries ({emptied} emptied).")


if __name__ == "__main__":
    main()
