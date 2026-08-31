// Reports how every ad slot on the built site is filled:
//   direct  = ads.json (direct-sold, has data-ad-id)
//   promo   = ad-network.json mainstream-site promo (has data-promo-project)
//   network = raw ad-network html tag
//   empty   = "Your Ad Here" placeholder
import fs from 'node:fs';

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
})('dist');

const direct = new Set();
const promo = new Set();
let emptyPages = 0;
let adCount = 0;
let promoCount = 0;

for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  adCount += (h.match(/data-ad-id=/g) || []).length;
  promoCount += (h.match(/data-promo-project=/g) || []).length;
  for (const m of h.matchAll(/data-ad-id="([^"]*)"/g)) direct.add(m[1]);
  for (const m of h.matchAll(/data-promo-project="([^"]*)"/g)) promo.add(m[1]);
  if (h.includes('Your Ad Here')) {
    emptyPages++;
    console.log('  PLACEHOLDER:', f);
  }
}

console.log('html pages:            ', files.length);
console.log('direct-sold renders:   ', adCount, '->', [...direct].sort().join(', '));
console.log('promo renders:         ', promoCount, '->', [...promo].sort().join(', '));
console.log('pages w/ placeholder:  ', emptyPages);
