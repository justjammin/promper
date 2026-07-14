# promper site

Live at https://promper.justjammin.workers.dev — the canonical URL baked into the page's
`<link rel="canonical">`, Open Graph tags, JSON-LD, `robots.txt`, `sitemap.xml`, and `llms.txt`.
If the site moves, update it in all six places.

Static landing page for the `breakdown` skill. Sourced from the Claude Design project
"Promper Landing Page" (`Breakdown.dc.html`), converted to plain self-contained HTML —
no build step, no runtime dependencies beyond Google Fonts.

## Deploy to Cloudflare Pages

CLI (one-off):

```bash
npx wrangler pages deploy site --project-name promper
```

Dashboard (git-connected):

- Framework preset: **None**
- Build command: *(leave empty)*
- Build output directory: `site`
