// Cloudflare Pages Function: catch-all middleware (runs on EVERY request,
// in front of static assets and other Functions, regardless of custom domain).
//
// Purpose: enforce a single canonical host. Any request arriving on
// www.cryptonav.site returns a 301 to the apex https://cryptonav.site<path><query>.
//
// Why here and not in the zone / a Single Redirect rule / an Astro redirect:
//   - Cloudflare Single Redirect (zone-level) rules do NOT fire for Pages
//     custom domains. The www host is CNAME-flattened to *.pages.dev and is
//     served by the Pages platform, not the cryptonav.site zone. Verified: the
//     apex carries the zone's HSTS header; www does not -- proof the zone's
//     rules never see www traffic.
//   - Astro `Astro.redirect()` is a no-op under static (SSG) output, which is
//     how this site is built. Removed that attempt already.
//   - Pages Functions run inside the Pages request chain for every host, so
//     this is the only place a host-level 301 is actually honoured.
//
// Non-www requests fall straight through to context.next() (static asset or
// the matching /api/* Function), at zero added latency for the normal path.

const APEX_HOST = 'cryptonav.site';

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Only redirect the bare www host; leave subdomains and apex untouched.
  if (url.host.toLowerCase() === `www.${APEX_HOST}`) {
    const target = `https://${APEX_HOST}${url.pathname}${url.search}`;
    return new Response(null, {
      status: 301,
      headers: {
        'Location': target,
        // Let the redirected response be cached briefly at the edge.
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return next();
}
