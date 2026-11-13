# UptoZishu

**UptoZishu** (formerly Stardust Store) is a free Android app store by ZISHU TRON.
Every page is **pre-built static HTML** — visitors never wait for a database, and the store uses very little mobile data.

## How it works

```
Developer Console ──publish──▶ Firebase ──every 10 min──▶ GitHub Action ──▶ static pages ──▶ GitHub Pages
```

1. A developer publishes or updates an app in the **UptoZishu Console**.
2. The `Publish UptoZishu` workflow runs every 10 minutes (and on every push) and runs `scripts/build-static.mjs`.
3. The script reads all live apps and reviews from Firebase and generates the whole site.
4. The workflow commits the result and deploys it. If nothing changed, nothing is deployed.

Firebase is only used by the visitor's browser for two tiny calls: the **download counter** and **posting a review** (plain REST, no SDK).

## Generated files (do not edit by hand)

| Path | What |
| --- | --- |
| `index.html` | Home: featured, categories, shelves, all apps |
| `apps/` , `apps/<slug>/` | All apps + one SEO page per app |
| `category/<slug>/` | One page per category |
| `top/` | Top charts |
| `search/`, `library/` | Client-side pages (use `apps-index.json`) |
| `apps-index.json`, `sitemap.xml`, `rss.xml`, `robots.txt`, `manifest.webmanifest`, `404.html` | Search index, SEO, feeds, PWA |

Hand-written files: `assets/style.css`, `assets/app.js`, `scripts/build-static.mjs`, `privacy.html`, `terms.html`, `favicon.png`.

## Setup (once)

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Actions → General → Workflow permissions: Read and write.**
3. Optional repository **variables** (Settings → Secrets and variables → Actions → Variables):
   - `SITE_BASE_URL` — your public URL, no trailing slash (default `https://uptozishu.zishuai.cloud`)
   - `DEV_CONSOLE_URL` — developer console link in the footer (default `https://dev.uptozishu.zishuai.cloud`)
4. **Actions → Publish UptoZishu → Run workflow** for the first build.

No secrets are required. The Firebase database must allow public **read** on `apps` and `reviews`, and **write** on `apps/*/downloadCount`, `apps/*/reviewCount`, `apps/*/rating` and `reviews/*` (the same as the old store).

## Local build

```bash
npm run build          # needs network access to Firebase
npm run serve          # preview
```

Test without Firebase: `APPS_FILE=apps.json REVIEWS_FILE=reviews.json node scripts/build-static.mjs`

## Notes

- Old links like `/?appuid=<id>` are redirected to the new `/apps/<slug>/` pages.
- If Firebase returns zero apps while the site has apps, the build fails on purpose instead of publishing an empty store (`ALLOW_EMPTY=1` overrides).
- Fields such as the developer UID and support e-mail are never written into the public pages.

## License

Proprietary. See [LICENSE](LICENSE). © ZISHU TRON.
