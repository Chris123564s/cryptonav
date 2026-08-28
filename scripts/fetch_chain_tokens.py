#!/usr/bin/env python3
"""
fetch_chain_tokens.py — 从 CoinGecko API 采集每条链的真实代币数据
输出: src/data/chain-tokens.json + public/logos/tokens/*.png

数据字段: id, name, symbol, logo, chainId, price, marketCap, marketCapRank,
          volume24h, priceChange24h, priceChange7d, tvl, category,
          contractAddress, website, verified, addedAt

运行环境: GitHub Actions (CI=true, USE_PROXY=0) 或本地 (走代理)
刷新频率: 每 6 小时
"""

import urllib.request, json, time, datetime, os, sys, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'src', 'data', 'chain-tokens.json')
LOGO_DIR = os.path.join(ROOT, 'public', 'logos', 'tokens')

# CoinGecko asset platform IDs for each chain
# Map our chain id -> CoinGecko platform id
CHAIN_PLATFORM_MAP = {
    'ethereum': 'ethereum',
    'solana': 'solana',
    'bsc': 'binance-smart-chain',
    'arbitrum': 'arbitrum-one',
    'base': 'base',
    'polygon': 'polygon-pos',
    'avalanche': 'avalanche',
    'optimism': 'optimistic-ethereum',
    'sui': 'sui',
    'ton': 'the-open-network',
}

# CoinGecko category IDs for richer categorization
# We'll use the platform's token categories where available
CATEGORY_MAP = {
    'ethereum-ecosystem': 'Ecosystem',
    'solana-ecosystem': 'Ecosystem',
    'binance-smart-chain': 'Ecosystem',
    'arbitrum-ecosystem': 'Ecosystem',
    'base-ecosystem': 'Ecosystem',
    'polygon-ecosystem': 'Ecosystem',
    'avalanche-ecosystem': 'Ecosystem',
    'optimism-ecosystem': 'Ecosystem',
    'sui-ecosystem': 'Ecosystem',
    'the-open-network-ecosystem': 'Ecosystem',
}

# DeFi/Lending/Derivatives/etc categories from CoinGecko
DEFI_CATEGORIES = {
    'decentralized-exchange', 'dex', 'amm': 'DeFi - DEX',
    'lending-and-borrowing': 'DeFi - Lending',
    'liquid-staking': 'DeFi - Liquid Staking',
    'yield-farming': 'DeFi - Yield',
    'derivatives': 'DeFi - Derivatives',
    'bridge': 'DeFi - Bridge',
    'stablecoin': 'Stablecoin',
    'meme-token': 'Meme',
    'memes': 'Meme',
    'gaming': 'Gaming',
    'metaverse': 'Gaming',
    'nft': 'NFT',
    'oracle': 'Oracle',
    'depin': 'DePIN',
    'ai': 'AI',
    'identity': 'Identity',
    'storage': 'Storage',
    'layer-1': 'Layer 1',
    'layer-2': 'Layer 2',
    'wrapped-tokens': 'Wrapped',
    'centralized-exchange': 'CEX',
    'infrastructure': 'Infrastructure',
}

# Proxy setup
PROXY = os.environ.get('CRYPTONAV_PROXY', 'http://127.0.0.1:10809')
if os.environ.get('USE_PROXY') == '0' or os.environ.get('CI'):
    opener = urllib.request.build_opener()
else:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}))

op = opener
RATE_LIMIT_DELAY = 1.2  # seconds between API calls (free tier: ~50 calls/min)


def api_get(url, retries=3):
    """Fetch JSON from API with retry"""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'CryptoNav/1.0',
                'Accept': 'application/json'
            })
            resp = op.open(req, timeout=30)
            return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Rate limited — wait longer
                wait = 30 * (attempt + 1)
                print(f'  Rate limited, waiting {wait}s...')
                time.sleep(wait)
                continue
            print(f'  HTTP {e.code} on {url[:80]}')
            if attempt < retries - 1:
                time.sleep(5)
                continue
            return None
        except Exception as e:
            print(f'  Error: {e}')
            if attempt < retries - 1:
                time.sleep(5)
                continue
            return None
    return None


def download_image(url, filepath):
    """Download an image to local path"""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CryptoNav/1.0'})
        data = op.open(req, timeout=15).read()
        if len(data) < 100:  # too small, probably error
            return False
        with open(filepath, 'wb') as f:
            f.write(data)
        return True
    except Exception:
        return False


def get_category_label(coin):
    """Determine category from CoinGecko categories list"""
    categories = coin.get('categories', []) or []

    # Check each category against our mapping
    for cat in categories:
        cat_lower = cat.lower().strip()
        # Direct match
        for key, label in DEFI_CATEGORIES.items():
            if key in cat_lower:
                return label

    # Fallback: check coin type
    if coin.get('stablecoin'):
        return 'Stablecoin'

    # Default categories
    for cat in categories:
        if 'meme' in cat.lower():
            return 'Meme'
        if 'gaming' in cat.lower() or 'game' in cat.lower():
            return 'Gaming'
        if 'depin' in cat.lower():
            return 'DePIN'
        if 'ai' in cat.lower() and 'ai' in cat.lower().split():
            return 'AI'
        if 'nft' in cat.lower():
            return 'NFT'
        if 'staking' in cat.lower():
            return 'DeFi - Liquid Staking'
        if 'lending' in cat.lower() or 'borrow' in cat.lower():
            return 'DeFi - Lending'
        if 'dex' in cat.lower() or 'exchange' in cat.lower() or 'amm' in cat.lower():
            return 'DeFi - DEX'
        if 'derivative' in cat.lower() or 'perp' in cat.lower():
            return 'DeFi - Derivatives'
        if 'bridge' in cat.lower() or 'cross-chain' in cat.lower():
            return 'DeFi - Bridge'
        if 'yield' in cat.lower():
            return 'DeFi - Yield'
        if 'oracle' in cat.lower():
            return 'Oracle'
        if 'storage' in cat.lower():
            return 'Storage'
        if 'layer 1' in cat.lower() or 'l1' in cat.lower():
            return 'Layer 1'
        if 'layer 2' in cat.lower() or 'l2' in cat.lower():
            return 'Layer 2'

    return 'Other'


def fetch_chain_tokens(chain_id, platform_id, per_page=50, max_pages=2):
    """Fetch top tokens for a specific chain from CoinGecko"""
    print(f'\n=== Fetching tokens for {chain_id} (platform: {platform_id}) ===')

    # Use the /coins/{platform}/contract endpoint approach via markets
    # CoinGecko: /coins/markets?vs_currency=usd&category={platform}-ecosystem
    # Or use: /coins/markets?vs_currency=usd&ids=... with platform filter

    all_tokens = []

    # Method 1: Use ecosystem category (most reliable for chain-specific tokens)
    category = f'{platform_id}-ecosystem' if platform_id != 'binance-smart-chain' else 'binance-ecosystem'

    for page in range(1, max_pages + 1):
        url = (
            f'https://api.coingecko.com/api/v3/coins/markets'
            f'?vs_currency=usd'
            f'&category={category}'
            f'&order=market_cap_desc'
            f'&per_page={per_page}'
            f'&page={page}'
            f'&sparkline=false'
            f'&price_change_percentage=24h,7d'
        )

        print(f'  Fetching page {page} ({per_page} per page)...')
        data = api_get(url)

        if not data or not isinstance(data, list):
            # Fallback: try platform filter directly
            print(f'  Category failed, trying platform filter...')
            url2 = (
                f'https://api.coingecko.com/api/v3/coins/markets'
                f'?vs_currency=usd'
                f'&vs_currency=usd'
                f'&order=market_cap_desc'
                f'&per_page={per_page}'
                f'&page={page}'
                f'&sparkline=false'
                f'&price_change_percentage=24h,7d'
                f'&asset_platform_id={platform_id}'
            )
            data = api_get(url2)
            if not data or not isinstance(data, list):
                print(f'  No data for page {page}, stopping')
                break

        if len(data) == 0:
            print(f'  Empty page {page}, stopping')
            break

        for coin in data:
            # Skip stable coins with no symbol
            if not coin.get('symbol'):
                continue

            # Get contract address
            platforms = coin.get('platforms', {}) or {}
            contract_addr = platforms.get(platform_id, '') or ''

            # Get image
            image_url = ''
            img = coin.get('image', {}) or {}
            if isinstance(img, dict):
                image_url = img.get('large', '') or img.get('thumb', '') or img.get('small', '')

            # Download logo
            logo_path = ''
            if image_url:
                # Use coin id for filename
                safe_id = ''.join(c if c.isalnum() or c in '-_' else '_' for c in coin.get('id', ''))
                logo_filename = f'{safe_id}.png'
                logo_fullpath = os.path.join(LOGO_DIR, logo_filename)
                logo_path = f'/logos/tokens/{logo_filename}'

                # Only download if not already cached
                if not os.path.exists(logo_fullpath):
                    if download_image(image_url, logo_fullpath):
                        pass  # success
                    else:
                        logo_path = ''  # fallback to colored circle

            # Determine category
            category_label = get_category_label(coin)

            token = {
                'id': f'{chain_id}-{coin.get("id", coin.get("symbol","").lower())}',
                'name': coin.get('name', coin.get('symbol', '?')),
                'symbol': (coin.get('symbol') or '?').upper(),
                'logo': logo_path,
                'chainId': chain_id,
                'price': coin.get('current_price') or 0,
                'marketCap': coin.get('market_cap') or 0,
                'marketCapRank': coin.get('market_cap_rank') or 0,
                'volume24h': coin.get('total_volume') or 0,
                'priceChange24h': coin.get('price_change_percentage_24h') or 0,
                'priceChange7d': coin.get('price_change_percentage_7d') or 0,
                'tvl': 0,  # Not available from markets endpoint; would need DefiLlama
                'category': category_label,
                'contractAddress': contract_addr,
                'website': '',
                'verified': True,
                'addedAt': datetime.date.today().isoformat(),
            }

            # Preserve sponsored status from existing data
            all_tokens.append(token)

        print(f'  Got {len(data)} tokens from page {page}')
        time.sleep(RATE_LIMIT_DELAY)

    # Method 2: For chains that don't have an ecosystem category, try direct platform
    if len(all_tokens) < 10:
        print(f'  Only got {len(all_tokens)} tokens, trying direct platform query...')
        url = (
            f'https://api.coingecko.com/api/v3/coins/markets'
            f'?vs_currency=usd'
            f'&order=market_cap_desc'
            f'&per_page={per_page}'
            f'&page=1'
            f'&sparkline=false'
            f'&price_change_percentage=24h,7d'
            f'&asset_platform_id={platform_id}'
        )
        data = api_get(url)
        if data and isinstance(data, list):
            for coin in data:
                if not coin.get('symbol'):
                    continue
                platforms = coin.get('platforms', {}) or {}
                contract_addr = platforms.get(platform_id, '') or ''
                if not contract_addr:
                    continue  # skip tokens not actually on this chain

                image_url = ''
                img = coin.get('image', {}) or {}
                if isinstance(img, dict):
                    image_url = img.get('large', '') or img.get('thumb', '')

                logo_path = ''
                if image_url:
                    safe_id = ''.join(c if c.isalnum() or c in '-_' else '_' for c in coin.get('id', ''))
                    logo_filename = f'{safe_id}.png'
                    logo_fullpath = os.path.join(LOGO_DIR, logo_filename)
                    logo_path = f'/logos/tokens/{logo_filename}'
                    if not os.path.exists(logo_fullpath):
                        if not download_image(image_url, logo_fullpath):
                            logo_path = ''

                token = {
                    'id': f'{chain_id}-{coin.get("id", coin.get("symbol","").lower())}',
                    'name': coin.get('name', coin.get('symbol', '?')),
                    'symbol': (coin.get('symbol') or '?').upper(),
                    'logo': logo_path,
                    'chainId': chain_id,
                    'price': coin.get('current_price') or 0,
                    'marketCap': coin.get('market_cap') or 0,
                    'marketCapRank': coin.get('market_cap_rank') or 0,
                    'volume24h': coin.get('total_volume') or 0,
                    'priceChange24h': coin.get('price_change_percentage_24h') or 0,
                    'priceChange7d': coin.get('price_change_percentage_7d') or 0,
                    'tvl': 0,
                    'category': get_category_label(coin),
                    'contractAddress': contract_addr,
                    'website': '',
                    'verified': True,
                    'addedAt': datetime.date.today().isoformat(),
                }
                # Check if already exists
                existing_ids = {t['id'] for t in all_tokens}
                if token['id'] not in existing_ids:
                    all_tokens.append(token)
            print(f'  After platform query: {len(all_tokens)} tokens total')

    print(f'  Total for {chain_id}: {len(all_tokens)} tokens')
    return all_tokens


def main():
    os.makedirs(LOGO_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

    # Load existing data to preserve sponsored status
    existing_data = {}
    if os.path.exists(OUT_JSON):
        try:
            with open(OUT_JSON, 'r', encoding='utf-8') as f:
                old = json.load(f)
                for t in old:
                    if t.get('sponsored'):
                        existing_data[t['id']] = t
        except Exception:
            pass

    all_tokens = []

    for chain_id, platform_id in CHAIN_PLATFORM_MAP.items():
        try:
            tokens = fetch_chain_tokens(chain_id, platform_id, per_page=50, max_pages=2)

            # Restore sponsored status from existing data
            for t in tokens:
                if t['id'] in existing_data:
                    old_t = existing_data[t['id']]
                    t['sponsored'] = old_t.get('sponsored', False)
                    t['sponsoredUntil'] = old_t.get('sponsoredUntil', '')
                    t['website'] = old_t.get('website', '')
                # Ensure website has a fallback
                if not t['website'] and t.get('contractAddress'):
                    t['website'] = f'https://coinmarketcap.com/dotnet/'

            all_tokens.extend(tokens)
            time.sleep(RATE_LIMIT_DELAY)
        except Exception as e:
            print(f'  ERROR fetching {chain_id}: {e}')
            continue

    # Sort by market cap globally
    all_tokens.sort(key=lambda t: (t.get('marketCap', 0)), reverse=True)

    # Write output
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(all_tokens, f, indent=2, ensure_ascii=False)

    print(f'\n=== Done! ===')
    print(f'Total tokens: {len(all_tokens)}')
    print(f'Chains: {", ".join(set(t["chainId"] for t in all_tokens))}')
    print(f'Logos downloaded to: {LOGO_DIR}')
    print(f'Data written to: {OUT_JSON}')

    # Print summary per chain
    for chain_id in CHAIN_PLATFORM_MAP:
        count = sum(1 for t in all_tokens if t['chainId'] == chain_id)
        print(f'  {chain_id}: {count} tokens')


if __name__ == '__main__':
    main()
