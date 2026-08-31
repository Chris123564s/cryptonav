import urllib.request, json, time, datetime, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'wins.json')
LOGO_DIR = os.path.join(ROOT, 'public', 'logos', 'dex')

# 代币图标体积上限。正常 logo 一般 5–50 KB；超过这个数的基本都是动画 GIF
# 或超高分辨率图。别放宽这个值：2026-08-31 就是因为 dex logo 攒到 45 MB，
# dist 涨到 67 MB，Cloudflare Pages 构建能过但 "Failed to publish assets"，
# 整个站部署不上去。
MAX_LOGO_BYTES = 200 * 1024

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


def image_ext(data):
    """按魔数判断真实图片格式，返回扩展名；不是已知图片则返回 None。

    DexScreener 的 header 图有相当比例是动画 GIF（单文件实测最大 7.46 MB），
    以前一律存成 .png，既掩盖了真实体积，也让按大小排查时看不出问题。
    """
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if b'<svg' in data[:512]:
        return 'svg'
    return None


def prune_logos(keep):
    """删掉本次没用上的旧 logo。

    每天刷新都会往 LOGO_DIR 加新文件，不清理的话几个月就能攒到上百个 /
    几十 MB —— 这就是部署挂掉的直接原因。所以每次采集完顺手清一遍。
    """
    keep = {os.path.basename(k) for k in keep if k}
    removed = 0
    freed = 0
    for name in os.listdir(LOGO_DIR):
        if name in keep:
            continue
        p = os.path.join(LOGO_DIR, name)
        if not os.path.isfile(p):
            continue
        try:
            freed += os.path.getsize(p)
            os.remove(p)
            removed += 1
        except OSError:
            pass
    if removed:
        print(f'pruned {removed} stale dex logo(s), freed {freed / 1024:.0f} KB')


def fetch_top(limit=8, min_liq=20000):
    logo_dir = LOGO_DIR
    os.makedirs(logo_dir, exist_ok=True)
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
            h6 = pc.get('h6')
            if h6 is None:
                # 兜底：个别 pair 无 h6 时退回 h24，保证不丢数据
                h6 = pc.get('h24')
            if h6 is None:
                continue
            bt = p.get('baseToken', {})
            sym = bt.get('symbol', '?')
            name = bt.get('name', sym)
            price = p.get('priceUsd')
            liq = p.get('liquidity', {}).get('usd') or 0
            # 下载 logo 到本地（避免 cdn.dexscreener.com 在部分地区被墙），失败则留空走首字母兜底
            logo = ''
            remote = b.get('header') or ''
            if remote:
                try:
                    req = urllib.request.Request(remote, headers={'User-Agent': 'Mozilla/5.0'})
                    img = op.open(req, timeout=20).read()
                    ext = image_ext(img)
                    # 只收真正是图片、且体积正常的。超限的一律丢弃，
                    # 页面会退回首字母兜底，比拖垮整个部署划算得多。
                    if ext and 200 < len(img) <= MAX_LOGO_BYTES:
                        fname = f"{addr[:10]}.{ext}"
                        with open(os.path.join(logo_dir, fname), 'wb') as f:
                            f.write(img)
                        logo = f'/logos/dex/{fname}'
                except Exception:
                    logo = ''
            rows.append({
                'symbol': sym, 'name': name, 'logo': logo, 'address': addr,
                'chain': chain, 'change6h': round(float(h6), 1),
                'price': price, 'liquidity': liq,
            })
            time.sleep(0.6)
        except Exception as e:
            continue

    rows = [r for r in rows if r['liquidity'] > min_liq]
    rows.sort(key=lambda r: r['change6h'], reverse=True)
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
            'change6h': r['change6h'],
            'price': float(r['price']) if r['price'] else 0,
            'date': today,
        })
    return out


if __name__ == '__main__':
    top = fetch_top()
    wrapped = {'wins': top}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(wrapped, f, ensure_ascii=False, indent=2)
    # 同步到 public/data/wins.json（供 CMS / 静态引用）
    PUB = os.path.join(ROOT, 'public', 'data', 'wins.json')
    os.makedirs(os.path.dirname(PUB), exist_ok=True)
    with open(PUB, 'w', encoding='utf-8') as f:
        json.dump(wrapped, f, ensure_ascii=False, indent=2)
    print(f'Wrote {len(top)} tokens to {OUT} and {PUB}')
    for r in top:
        print(f"  {r['symbol']:10} {r['change6h']:+.1f}%")
    # 清掉本轮没用上的旧 logo，避免 dist 逐日膨胀
    prune_logos([r['logo'] for r in top])
