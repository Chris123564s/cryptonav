import urllib.request, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'data', 'recommended.json')
PUB = os.path.join(ROOT, 'public', 'data', 'recommended.json')
LOGO_DIR = os.path.join(ROOT, 'public', 'logos', 'rec')

PROXY = os.environ.get('CRYPTONAV_PROXY', 'http://127.0.0.1:10809')
if os.environ.get('USE_PROXY') == '0' or os.environ.get('CI'):
    op = urllib.request.build_opener()
else:
    op = urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}))


def slugify(s):
    return re.sub(r'[^a-z0-9]', '-', s.lower()).strip('-')


def main():
    os.makedirs(LOGO_DIR, exist_ok=True)
    with open(SRC, encoding='utf-8') as f:
        raw = json.load(f)
    # 兼容对象格式 {"recommended": [...]} 和纯数组格式 [...]
    if isinstance(raw, dict) and 'recommended' in raw:
        items = raw['recommended']
        wrapper_key = 'recommended'
    else:
        items = raw
        wrapper_key = None
    changed = False
    for it in items:
        remote = it.get('logo', '')
        if remote and remote.startswith('http'):
            ext = '.png'
            if '.jpg' in remote or '.jpeg' in remote:
                ext = '.jpg'
            fname = f"{slugify(it.get('id') or it.get('symbol') or 'token')}{ext}"
            ok = False
            # 1) 直接下载原始远程地址
            try:
                req = urllib.request.Request(remote, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.coingecko.com/'})
                img = op.open(req, timeout=20).read()
                if len(img) > 1000:
                    ok = True
            except Exception:
                pass
            # 2) 兜底：Google Favicon（coin-images.coingecko 被墙时用）
            if not ok:
                try:
                    dom = it.get('link', '').split('//')[-1].split('/')[0]
                    furl = f'https://www.google.com/s2/favicons?domain={dom}&sz=128'
                    req = urllib.request.Request(furl, headers={'User-Agent': 'Mozilla/5.0'})
                    img = op.open(req, timeout=15).read()
                    if len(img) > 200:
                        ok = True
                except Exception:
                    pass
            if ok:
                with open(os.path.join(LOGO_DIR, fname), 'wb') as f:
                    f.write(img)
                it['logo'] = f'/logos/rec/{fname}'
                changed = True
                print(f"Saved {fname} ({len(img)} bytes)")
            else:
                print(f"Failed all sources: {it.get('symbol')}")
        else:
            print(f"Keep local: {it.get('symbol')} -> {it.get('logo')}")
    # 保存时保持对象格式
    out_data = {wrapper_key: items} if wrapper_key else items
    with open(SRC, 'w', encoding='utf-8') as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)
    os.makedirs(os.path.dirname(PUB), exist_ok=True)
    with open(PUB, 'w', encoding='utf-8') as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)
    print('Done' if changed else 'No changes')


if __name__ == '__main__':
    main()
