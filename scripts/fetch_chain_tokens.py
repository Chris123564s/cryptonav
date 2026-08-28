#!/usr/bin/env python3
"""
fetch_chain_tokens.py — Multi-source token data fetcher for CryptoNav chain pages.

Sources:
  1. CoinGecko API — prices, market cap, volume, 24h/7d change, logos, categories
  2. CoinCap API — fallback prices (no API key needed)
  3. DefiLlama API — TVL data for DeFi protocols

Output:
  - src/data/chain-tokens.json (token data)
  - public/logos/tokens/*.png (logos)

Runs locally with proxy or in GitHub Actions (direct).
Refresh frequency: every 6 hours via GitHub Actions.
"""

import urllib.request
import urllib.error
import json
import time
import datetime
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'src', 'data', 'chain-tokens.json')
LOGO_DIR = os.path.join(ROOT, 'public', 'logos', 'tokens')

# ─── Chain config: CoinGecko ecosystem category + platform ID ───
# category_id: used for /coins/markets?category= (fetches chain-specific tokens)
# platform_id: used for /coins/{platform}/contract (contract address lookup)
CHAIN_CONFIG = {
    'ethereum':   {'cat': 'ethereum-ecosystem',   'platform': 'ethereum'},
    'solana':     {'cat': 'solana-ecosystem',     'platform': 'solana'},
    'bsc':        {'cat': 'binance-smart-chain',  'platform': 'binance-smart-chain'},
    'arbitrum':   {'cat': 'arbitrum-ecosystem',   'platform': 'arbitrum-one'},
    'base':       {'cat': 'base-ecosystem',       'platform': 'base'},
    'polygon':    {'cat': 'polygon-ecosystem',     'platform': 'polygon-pos'},
    'avalanche':  {'cat': 'avalanche-ecosystem',  'platform': 'avalanche'},
    'optimism':   {'cat': 'optimism-ecosystem',   'platform': 'optimistic-ethereum'},
    'sui':        {'cat': 'sui-ecosystem',        'platform': 'sui'},
    'ton':        {'cat': 'ton-ecosystem',        'platform': 'the-open-network'},
}

# ─── Category keywords → our category labels (first match wins) ───
CATEGORY_RULES = [
    (['stablecoin'], 'Stablecoin'),
    (['meme', 'doge', 'shiba', 'pepe', 'wif', 'bonk'], 'Meme'),
    (['liquid-staking', 'lido', 'rocket pool', 'jito'], 'DeFi - Liquid Staking'),
    (['lending', 'borrow', 'aave', 'compound'], 'DeFi - Lending'),
    (['dex', 'uniswap', 'swap', 'amm', 'curve', '1inch'], 'DeFi - DEX'),
    (['derivative', 'perp', 'gmx', 'dydx'], 'DeFi - Derivatives'),
    (['bridge', 'wormhole', 'layerzero'], 'DeFi - Bridge'),
    (['yield', 'farm'], 'DeFi - Yield'),
    (['oracle', 'chainlink', 'pyth'], 'Oracle'),
    (['gaming', 'game', 'axie'], 'Gaming'),
    (['nft'], 'NFT'),
    (['depin', 'helium', 'filecoin'], 'DePIN'),
    (['artificial intelligence', 'ai ', 'render', 'bittensor'], 'AI'),
    (['storage', 'arweave', 'filecoin'], 'Storage'),
    (['layer 1', 'l1'], 'Layer 1'),
    (['layer 2', 'l2', 'rollup'], 'Layer 2'),
    (['wrapped'], 'Wrapped'),
    (['exchange', 'cex'], 'CEX'),
    (['infrastructure'], 'Infrastructure'),
    (['identity'], 'Identity'),
    (['governance', 'dao'], 'Governance'),
]


def get_category_label(coin_data):
    """Determine category from CoinGecko categories list + coin name/symbol."""
    categories = coin_data.get('categories', []) or []
    cat_text = ' '.join(str(c).lower() for c in categories)
    name = (coin_data.get('name') or '').lower()
    sym = (coin_data.get('symbol') or '').lower()

    for keywords, label in CATEGORY_RULES:
        for kw in keywords:
            if kw in cat_text:
                return label

    combined = f'{name} {sym} {cat_text}'
    for keywords, label in CATEGORY_RULES:
        for kw in keywords:
            if kw in combined:
                return label

    return 'Other'


# ─── Proxy setup ───
USE_PROXY = not os.environ.get('CI') and os.environ.get('USE_PROXY') != '0'
PROXY_URL = os.environ.get('CRYPTONAV_PROXY', 'http://127.0.0.1:10809')

if USE_PROXY:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({'http': PROXY_URL, 'https': PROXY_URL})
    )
else:
    opener = urllib.request.build_opener()

op = opener
RATE_LIMIT_DELAY = 2.0  # seconds between API calls (free tier: ~10-30 calls/min)


def api_get(url, retries=3):
    """Fetch JSON from API with retry and rate-limit handling."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'CryptoNav/1.0',
                'Accept': 'application/json',
            })
            resp = op.open(req, timeout=30)
            return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 30 * (attempt + 1)
                print(f'  Rate limited (429), waiting {wait}s...')
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
    """Download an image to local path."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CryptoNav/1.0'})
        data = op.open(req, timeout=15).read()
        if len(data) < 100:
            return False
        with open(filepath, 'wb') as f:
            f.write(data)
        return True
    except Exception:
        return False


def fetch_coingecko_tokens(chain_id, category_id, platform_id, per_page=50):
    """Fetch top tokens for a chain from CoinGecko markets endpoint."""
    print(f'\n=== CoinGecko: {chain_id} (cat: {category_id}) ===')
    all_tokens = []

    url = (
        f'https://api.coingecko.com/api/v3/coins/markets'
        f'?vs_currency=usd'
        f'&category={category_id}'
        f'&order=market_cap_desc'
        f'&per_page={per_page}'
        f'&page=1'
        f'&sparkline=false'
        f'&price_change_percentage=24h,7d'
    )

    print(f'  Fetching {per_page} tokens...')
    data = api_get(url)

    if not data or not isinstance(data, list) or len(data) == 0:
        # Fallback: use asset_platform_id
        print(f'  Category failed, trying asset_platform_id={platform_id}...')
        url2 = (
            f'https://api.coingecko.com/api/v3/coins/markets'
            f'?vs_currency=usd'
            f'&order=market_cap_desc'
            f'&per_page={per_page}'
            f'&page=1'
            f'&sparkline=false'
            f'&price_change_percentage=24h,7d'
            f'&asset_platform_id={platform_id}'
        )
        data = api_get(url2)
        if not data or not isinstance(data, list) or len(data) == 0:
            print(f'  No data for {chain_id}, skipping')
            return []

    for coin in data:
        if not coin.get('symbol'):
            continue

        # Get contract address for this chain
        platforms = coin.get('platforms', {}) or {}
        contract_addr = platforms.get(platform_id, '') or ''

        # Get image URL (CoinGecko returns image as a string URL)
        image_url = ''
        img = coin.get('image', '')
        if isinstance(img, str) and img:
            image_url = img
        elif isinstance(img, dict):
            image_url = img.get('large', '') or img.get('small', '') or img.get('thumb', '')

        # Download logo
        logo_path = ''
        if image_url:
            safe_id = ''.join(c if c.isalnum() or c in '-_' else '_' for c in (coin.get('id') or ''))
            logo_filename = f'{safe_id}.png'
            logo_fullpath = os.path.join(LOGO_DIR, logo_filename)
            logo_path = f'/logos/tokens/{logo_filename}'
            if not os.path.exists(logo_fullpath):
                if not download_image(image_url, logo_fullpath):
                    logo_path = ''

        token = {
            'id': f'{chain_id}-{coin.get("id", coin.get("symbol", "").lower())}',
            'name': coin.get('name', coin.get('symbol', '?')),
            'symbol': (coin.get('symbol') or '?').upper(),
            'logo': logo_path,
            'chainId': chain_id,
            'price': coin.get('current_price') or 0,
            'marketCap': coin.get('market_cap') or 0,
            'marketCapRank': coin.get('market_cap_rank') or 0,
            'volume24h': coin.get('total_volume') or 0,
            'priceChange24h': coin.get('price_change_percentage_24h') or 0,
            'priceChange7d': coin.get('price_change_percentage_7d_in_currency') or 0,
            'tvl': 0,
            'category': get_category_label(coin),
            'contractAddress': contract_addr,
            'website': '',
            'verified': True,
            'addedAt': datetime.date.today().isoformat(),
        }
        all_tokens.append(token)

    print(f'  Got {len(all_tokens)} tokens')
    return all_tokens


def fetch_defillama_tvl(tokens):
    """Fetch TVL data from DefiLlama for DeFi protocols."""
    print('\n=== DefiLlama: Fetching TVL data ===')
    url = 'https://api.llama.fi/protocols'
    data = api_get(url)

    if not data or not isinstance(data, list):
        print('  DefiLlama API failed, TVL will be 0')
        return

    tvl_map = {}
    for proto in data:
        name = (proto.get('name') or '').lower()
        tvl = proto.get('tvl') or 0
        if name and tvl:
            tvl_map[name] = tvl

    matched = 0
    for token in tokens:
        token_name = (token.get('name') or '').lower()
        token_symbol = (token.get('symbol') or '').lower()

        if token_name in tvl_map:
            token['tvl'] = tvl_map[token_name]
            matched += 1
        elif token_symbol in ['uni', 'aave', 'curve', 'lido', 'mkr', 'comp', 'gmx', 'rdnt', 'jup', 'ray']:
            for proto_name, proto_tvl in tvl_map.items():
                if token_symbol in proto_name or token_name in proto_name:
                    token['tvl'] = proto_tvl
                    matched += 1
                    break

    print(f'  Matched TVL for {matched}/{len(tokens)} tokens')


def fetch_coincap_fallback(tokens):
    """Use CoinCap as a fallback for price data if CoinGecko returned 0 prices."""
    print('\n=== CoinCap: Fallback price check ===')
    zero_price = [t for t in tokens if t['price'] == 0]
    if not zero_price:
        print('  No zero-price tokens, skipping')
        return

    url = 'https://api.coincap.io/v2/assets?limit=200'
    data = api_get(url)

    if not data or not isinstance(data, dict):
        print('  CoinCap API failed')
        return

    coin_list = data.get('data', [])
    price_map = {}
    for coin in coin_list:
        sym = (coin.get('symbol') or '').upper()
        price = float(coin.get('priceUsd') or 0)
        if sym and price:
            price_map[sym] = {
                'price': price,
                'marketCap': float(coin.get('marketCapUsd') or 0),
                'volume24h': float(coin.get('volumeUsd24Hr') or 0),
                'priceChange24h': float(coin.get('changePercent24Hr') or 0),
            }

    updated = 0
    for token in zero_price:
        sym = token['symbol'].upper()
        if sym in price_map:
            fb = price_map[sym]
            token['price'] = fb['price']
            token['marketCap'] = fb['marketCap']
            token['volume24h'] = fb['volume24h']
            token['priceChange24h'] = fb['priceChange24h']
            updated += 1

    print(f'  Filled {updated}/{len(zero_price)} tokens with CoinCap data')


def main():
    os.makedirs(LOGO_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

    # Load existing data to preserve sponsored status
    existing_data = {}
    if os.path.exists(OUT_JSON):
        try:
            with open(OUT_JSON, 'r', encoding='utf-8') as f:
                old = json.load(f)
                if isinstance(old, list):
                    for t in old:
                        if t.get('sponsored'):
                            existing_data[t['id']] = t
        except Exception:
            pass

    all_tokens = []

    for chain_id, cfg in CHAIN_CONFIG.items():
        try:
            tokens = fetch_coingecko_tokens(
                chain_id, cfg['cat'], cfg['platform'], per_page=50
            )

            # Restore sponsored status from existing data
            for t in tokens:
                if t['id'] in existing_data:
                    old_t = existing_data[t['id']]
                    t['sponsored'] = old_t.get('sponsored', False)
                    t['sponsoredUntil'] = old_t.get('sponsoredUntil', '')
                    if old_t.get('website'):
                        t['website'] = old_t['website']

            all_tokens.extend(tokens)
            time.sleep(RATE_LIMIT_DELAY)
        except Exception as e:
            print(f'  ERROR fetching {chain_id}: {e}')
            continue

    # CoinCap fallback for zero-price tokens
    fetch_coincap_fallback(all_tokens)
    time.sleep(RATE_LIMIT_DELAY)

    # DefiLlama TVL data
    fetch_defillama_tvl(all_tokens)

    # Sort by market cap globally
    all_tokens.sort(key=lambda t: (t.get('marketCap') or 0), reverse=True)

    # Deduplicate by id
    seen_ids = set()
    deduped = []
    for t in all_tokens:
        if t['id'] not in seen_ids:
            seen_ids.add(t['id'])
            deduped.append(t)
    all_tokens = deduped

    # Write output
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(all_tokens, f, indent=2, ensure_ascii=False)

    print(f'\n{"="*50}')
    print(f'✅ Done! Total tokens: {len(all_tokens)}')
    print(f'Chains: {", ".join(set(t["chainId"] for t in all_tokens))}')

    for chain_id in CHAIN_CONFIG:
        count = sum(1 for t in all_tokens if t['chainId'] == chain_id)
        logos = sum(1 for t in all_tokens if t['chainId'] == chain_id and t.get('logo'))
        print(f'  {chain_id}: {count} tokens, {logos} with logos')

    no_logo = sum(1 for t in all_tokens if not t.get('logo'))
    print(f'\nTokens without logos: {no_logo}/{len(all_tokens)}')


if __name__ == '__main__':
    main()
