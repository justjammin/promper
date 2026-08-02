# promper site

Live at https://promper.justjammin.workers.dev — the canonical URL baked into the page's
`<link rel="canonical">`, Open Graph tags, JSON-LD, `robots.txt`, `sitemap.xml`, and `llms.txt`.
If the site moves, update it in all six places.

Static landing page for the `breakdown` and `singularity` skills. Sourced from the Claude
Design project "Promper Landing Page" (`Breakdown.dc.html`) and converted to plain HTML with
no build step. The singularity section loads pinned GSAP, ScrollTrigger, and Three.js ESM
builds from jsDelivr; the rest of the page only depends on Google Fonts.

## Deploy to Cloudflare Pages

CLI (one-off):

```bash
npx wrangler pages deploy site --project-name promper
```

Dashboard (git-connected):

- Framework preset: **None**
- Build command: *(leave empty)*
- Build output directory: `site`
