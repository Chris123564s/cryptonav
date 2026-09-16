#!/usr/bin/env python3
"""
One-time in-place logo downscale.

Why in-place PNG (not WebP):
  - 330/409 logos are 250x250 detail PNGs from CoinGecko (50-100KB each) but are
    displayed at 8-48px. Downscaling to 96px (2x retina headroom for a 48px slot)
    cuts ~83% of bytes.
  - The logo files are written by three GitHub Actions bots
    (fetch_chain_tokens / fetch_dex_wins / fetch_recommended_logos). They only
    download when the target file is MISSING. Changing the extension to .webp
    would make every run re-download all 500 logos and rewrite the JSON back to
    .png. Keeping the SAME filename and format means the bots see the file
    present, skip the download, and the optimisation sticks with no JSON edits
    and no workflow changes.
  - This deliberately does not touch src/data/*.json (bot-owned data).

Idempotent: re-running only shrinks files that are still larger than the cap.
"""
import os, glob
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGOS = os.path.join(ROOT, 'public', 'logos')
MAX_SIDE = 96          # px; 2x the largest display slot (w-12 = 48px)
JPEG_QUALITY = 85
CONVERTIBLE = ('.png', '.jpg', '.jpeg')

def before_after():
    png = jpg = 0
    for f in glob.glob(os.path.join(LOGOS, '**', '*'), recursive=True):
        if f.lower().endswith('.png'):
            png += os.path.getsize(f)
        elif f.lower().endswith(('.jpg', '.jpeg')):
            jpg += os.path.getsize(f)
    return png, jpg

def main():
    p0, j0 = before_after()
    done = skipped = failed = 0
    saved = 0

    for f in sorted(glob.glob(os.path.join(LOGOS, '**', '*'), recursive=True)):
        if not f.lower().endswith(CONVERTIBLE):
            continue
        ext = os.path.splitext(f)[1].lower()
        orig = os.path.getsize(f)
        try:
            im = Image.open(f)
            im.load()
        except Exception as e:
            print(f'  SKIP (unreadable) {os.path.relpath(f, ROOT)}: {e}')
            failed += 1
            continue

        w, h = im.size
        needs_resize = max(w, h) > MAX_SIDE
        if not needs_resize and orig < 8000:
            skipped += 1
            continue

        try:
            if ext == '.png':
                out = im.convert('RGBA') if im.mode in ('P', 'LA', 'RGBA') else im.convert('RGB')
            else:
                out = im.convert('RGB')
            if needs_resize:
                s = MAX_SIDE / max(w, h)
                out = out.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)
            if ext == '.png':
                out.save(f, 'PNG', optimize=True)
            else:
                out.save(f, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
            new = os.path.getsize(f)
            if new < orig:
                saved += orig - new
                done += 1
            else:
                skipped += 1
        except Exception as e:
            print(f'  FAIL {os.path.relpath(f, ROOT)}: {e}')
            failed += 1

    p1, j1 = before_after()
    print(f"\nresized: {done}   skipped(already small): {skipped}   failed: {failed}")
    print(f"logos total: {(p0+j0)/1048576:.2f} MB  ->  {(p1+j1)/1048576:.2f} MB  "
          f"({(1-(p1+j1)/(p0+j0))*100:.0f}% smaller, {saved/1048576:.2f} MB freed)")

if __name__ == '__main__':
    main()
