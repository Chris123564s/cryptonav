/**
 * Central factory for schema.org (JSON-LD) structured data.
 *
 * Every helper returns a plain object so it can be unit-tested without Astro,
 * and so pages can compose several nodes into one @graph via <JsonLd>.
 *
 * IMPORTANT: do not hand-roll JSON-LD strings in pages — use these helpers so
 * escaping and @context handling stay consistent site-wide.
 */

export const SITE_URL = 'https://cryptonav.site';
export const SITE_NAME = 'CryptoNav';
export const SITE_LOGO = `${SITE_URL}/og-image.png`;

/** Breadcrumb item. `url` is omitted for the trailing (current) page. */
export interface Crumb {
  name: string;
  url?: string;
}

/** A single entry of an ItemList. */
export interface ListEntry {
  name: string;
  url: string;
  description?: string;
}

/** Turn a site-relative path into an absolute URL. */
export function abs(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return SITE_URL + (path.startsWith('/') ? path : `/${path}`);
}

/** Shared Organization node (used standalone on the homepage). */
export function organization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: SITE_LOGO,
      width: 1200,
      height: 630,
    },
    description:
      'CryptoNav is a curated crypto directory for global users, aggregating exchanges, wallets, market tools, DeFi, NFT and chain resources.',
    sameAs: ['https://github.com/Chris123564s/cryptonav'],
  };
}

/**
 * WebSite node.
 *
 * NOTE: no `SearchAction` on purpose. The header search is client-side
 * (Fuse.js over a static JSON index) and there is no server-rendered search
 * results URL — pointing potentialAction at a URL that cannot answer the query
 * is a structured-data violation. Add it back once /search?q= exists.
 */
export function webSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description:
      'Crypto navigation directory: exchanges, wallets, DeFi protocols, NFT marketplaces, market tools and per-chain token data.',
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en',
  };
}

/** BreadcrumbList. The last crumb is the current page and carries no `item`. */
export function breadcrumbList(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      ...(crumb.url ? { item: abs(crumb.url) } : {}),
    })),
  };
}

/** ItemList of links (projects, tokens, airdrops, articles...). */
export function itemList(opts: { name: string; url?: string; description?: string; items: ListEntry[] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: opts.name,
    ...(opts.url ? { url: abs(opts.url) } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    numberOfItems: opts.items.length,
    itemListElement: opts.items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: abs(it.url),
      ...(it.description ? { description: it.description } : {}),
    })),
  };
}

/** CollectionPage (category / index style pages listing many things). */
export function collectionPage(opts: { name: string; description?: string; url: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    url: abs(opts.url),
    isPartOf: { '@id': `${SITE_URL}/#website` },
    inLanguage: 'en',
  };
}

export interface ArticleInput {
  headline: string;
  description?: string;
  url: string;
  /** ISO date, e.g. 2026-01-15 */
  datePublished: string;
  /** ISO date; falls back to datePublished */
  dateModified?: string;
  authorName?: string;
  image?: string;
  keywords?: string[];
}

/** Article (used for learn guides and head-to-head comparisons). */
export function article(input: ArticleInput) {
  const url = abs(input.url);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    ...(input.description ? { description: input.description } : {}),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: input.datePublished,
    dateModified: input.dateModified || input.datePublished,
    author: {
      '@type': 'Person',
      name: input.authorName || 'CryptoNav Team',
      url: `${SITE_URL}/about`,
    },
    publisher: { '@id': `${SITE_URL}/#organization` },
    image: input.image || SITE_LOGO,
    inLanguage: 'en',
    ...(input.keywords?.length ? { keywords: input.keywords.join(', ') } : {}),
  };
}

/** FAQPage from the [{group, items:[{q,a}]}] shape used by faq.json. */
export function faqPage(groups: { items: { q: string; a: string }[] }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((group) =>
      (group.items || []).map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    ),
  };
}
