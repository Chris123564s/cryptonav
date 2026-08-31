#!/usr/bin/env python3
"""
清理 public/logos/dex/ 下的垃圾文件，并同步修正 wins.json 里的引用。

为什么需要这个脚本
------------------
fetch_dex_wins.py 每天定时把 DexScreener 涨幅榜代币的 logo 下载到本地，
但只判断了 `len(img) > 200`（只设下限、不设上限），而且从来不删除旧文件。
结果：

  - DexScreener 的 header 图很多是**动画 GIF**，脚本一律存成 .png，
    单文件最大 7.46 MB —— 一个代币图标。
  - 每天新增几个、从不清理，攒到 106 个文件 / 45 MB，
    而 wins.json 实际只引用 7 个，其余 99 个全是孤儿。

最终后果：dist 从十几 MB 涨到 67 MB，Cloudflare Pages 构建能过、
但发布资源阶段报 "Failed to publish assets. an internal error occurred"，
整个站从 2026-08-31 起再也部署不上去。

这个脚本做三件事（可重复执行，幂等）：
  1. 删除 wins.json 未引用的孤儿文件
  2. 删除超过 SIZE_CAP 的文件，并把 wins.json 里对应的 logo 字段清空
     （UI 有首字母兜底，不会出现坏图）
  3. 打印清理前后的体积对比

用法：
  python scripts/prune-dex-logos.py          # 实际执行
  python scripts/prune-dex-logos.py --dry    # 只报告，不删
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_DIR = os.path.join(ROOT, 'public', 'logos', 'dex')

# 代币图标的体积上限。正常的代币 logo 通常在 5–50 KB；
# 超过这个数的几乎全是动画 GIF 或超高分辨率图，留着只会拖垮部署。
SIZE_CAP = 200 * 1024  # 200 KB

# wins.json 有两份：src/data 给构建用，public/data 给前端搜索用，必须同步改
WINS_FILES = [
    os.path.join(ROOT, 'src', 'data', 'wins.json'),
    os.path.join(ROOT, 'public', 'data', 'wins.json'),
]

DRY = '--dry' in sys.argv


def human(n):
    return f'{n / 1048576:.2f} MB' if n >= 1048576 else f'{n / 1024:.1f} KB'


def dir_size():
    total = 0
    for name in os.listdir(LOGO_DIR):
        p = os.path.join(LOGO_DIR, name)
        if os.path.isfile(p):
            total += os.path.getsize(p)
    return total


def main():
    if not os.path.isdir(LOGO_DIR):
        print(f'目录不存在，跳过：{LOGO_DIR}')
        return

    before_files = len(os.listdir(LOGO_DIR))
    before_size = dir_size()

    # --- 收集 wins.json 里引用的文件名 ---
    referenced = set()
    wins_data = {}
    for path in WINS_FILES:
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            wins_data[path] = json.load(f)
        for row in wins_data[path].get('wins', []):
            logo = row.get('logo') or ''
            if logo.startswith('/logos/dex/'):
                referenced.add(os.path.basename(logo))

    orphans, oversized, kept = [], [], []
    for name in sorted(os.listdir(LOGO_DIR)):
        p = os.path.join(LOGO_DIR, name)
        if not os.path.isfile(p):
            continue
        size = os.path.getsize(p)
        if name not in referenced:
            orphans.append((name, size))
        elif size > SIZE_CAP:
            oversized.append((name, size))
        else:
            kept.append((name, size))

    # --- 干跑：只报告 ---
    if DRY:
        print(f'当前：{before_files} 个文件 / {human(before_size)}')
        print(f'  保留（被引用且未超限）: {len(kept)} 个 / {human(sum(s for _, s in kept))}')
        print(f'  删除 · 孤儿文件        : {len(orphans)} 个 / {human(sum(s for _, s in orphans))}')
        print(f'  删除 · 超过 {human(SIZE_CAP)} : {len(oversized)} 个 / {human(sum(s for _, s in oversized))}')
        for n, s in oversized:
            print(f'      {n}  {human(s)}')
        print(f'\n清理后预计：{len(kept)} 个文件 / {human(sum(s for _, s in kept))}')
        print('（--dry 模式，未做任何改动）')
        return

    # --- 实际执行 ---
    removed_bytes = 0
    for name, size in orphans + oversized:
        os.remove(os.path.join(LOGO_DIR, name))
        removed_bytes += size

    # 超限文件被删了，必须同步清空引用，否则页面上会出现坏图
    dropped = {n for n, _ in oversized}
    if dropped:
        for path, data in wins_data.items():
            changed = False
            for row in data.get('wins', []):
                logo = row.get('logo') or ''
                if logo.startswith('/logos/dex/') and os.path.basename(logo) in dropped:
                    row['logo'] = ''
                    changed = True
            if changed:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    f.write('\n')
                print(f'已清空超限引用：{os.path.relpath(path, ROOT)}')

    after_files = len(os.listdir(LOGO_DIR))
    after_size = dir_size()

    print('清理完成')
    print(f'  孤儿文件删除: {len(orphans)} 个')
    print(f'  超限文件删除: {len(oversized)} 个')
    print(f'  保留        : {len(kept)} 个')
    print(f'  体积: {before_files} 个 / {human(before_size)}  ->  {after_files} 个 / {human(after_size)}')
    print(f'  节省: {human(removed_bytes)}')


if __name__ == '__main__':
    main()
