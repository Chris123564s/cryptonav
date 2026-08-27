import urllib.request, json, time, datetime, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'wins.json')

# 本地开发走代理；CI(如 GitHub Actions)直连
PROXY = os.environ.get('CRYPTONAV_PROXY', 'http://127.0.0.1:10809')
if os.environ.get('USE_PROXY') == '0' or os.environ.get('CI'):
    opener = urllib.request.build_opener()
else:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}))

op = opener


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    return json.loads(op.open(req, timeout=25).read())


def fetch_top(limit=8, min_liq=20000):
    boosts = get('https://api.dexscreener.com/token-boosts/top/v1')
    rows = []
    for b in boosts:
        addr = b['tokenAddress']
        chain = b['chainId']
        try:
            j = get(f'https://api.dexscreener.com/latest/dex/tokens/{addr}')
            pairs = j.get('pairs', []) or []
            pairs = sorted(pairs, key=lambda p: (p.get('liquidity', {}).get('usd') or 0), reverse=True)
            p = pairs[0] if pairs else None
            if not p:
                continue
            pc = p.get('priceChange', {})
            h24 = pc.get('h24')
            if h24 is None:
                continue
            bt = p.get('baseToken', {})
            sym = bt.get('symbol', '?')
            name = bt.get('name', sym)
            price = p.get('priceUsd')
            liq = p.get('liquidity', {}).get('usd') or 0
            # logo: 优先用 boost 的 header 图，否则空（前端兜底首字母）
            logo = b.get('header') or ''
            rows.append({
                'symbol': sym, 'name': name, 'logo': logo, 'address': addr,
                'chain': chain, 'change24h': round(float(h24), 1),
                'price': price, 'liquidity': liq,
            })
            time.sleep(0.6)
        except Exception as e:
            continue

    rows = [r for r in rows if r['liquidity'] > min_liq]
    rows.sort(key=lambda r: r['change24h'], reverse=True)
    top = rows[:limit]
    today = datetime.date.today().isoformat()
    out = []
    for r in top:
        out.append({
            'symbol': r['symbol'],
            'name': r['name'],
            'logo': r['logo'],
            'address': r['address'],
            'chain': r['chain'],
            'change24h': r['change24h'],
            'price': float(r['price']) if r['price'] else 0,
            'date': today,
        })
    return out


if __name__ == '__main__':
    top = fetch_top()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(top, f, ensure_ascii=False, indent=2)
    print(f'Wrote {len(top)} tokens to {OUT}')
    for r in top:
        print(f"  {r['symbol']:10} {r['change24h']:+.1f}%")
