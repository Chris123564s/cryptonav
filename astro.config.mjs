import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://cryptonav.site',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    // Exclude /embed/* from the sitemap: those pages are embeddable widgets and carry
    // <meta name="robots" content="noindex"> (see src/pages/embed/[slug].astro).
    // Submitting noindex URLs in a sitemap is self-contradictory — GSC flags it as
    // "Submitted URL marked noindex", and it wastes a third of the crawl budget.
    sitemap({
      filter: (page) => !page.includes('/embed/'),
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
});
