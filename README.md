# UptoZishu Store

**UptoZishu** (formerly Stardust Store) is a free Android app store by **ZISHU TRON**.
Every page is **pre-built static HTML**, so visitors never wait for a database and the store uses very little mobile data.

Live: <https://uptozishu.zishuai.cloud> · Developer Console: <https://dev.uptozishu.zishuai.cloud>

## Features

- Home with a hero slider, **Sponsored** row, categories, editor's choice and top charts
- One SEO page per app, per category and per developer
- Reviews, ratings, report an app, send feedback, support tickets
- **Developer verification** section on every app page (Verified / Unverified)
- Search with sponsored apps, saved apps and download history on the phone
- Light and dark theme, installable PWA, RSS feed and sitemap
- Admin-controlled lists: Featured, Editor's choice and Sponsored

## How it works

```
Developer Console ──publish──▶ Firebase ──every 10 min──▶ GitHub Action ──▶ static pages ──▶ GitHub Pages
```

1. A developer publishes or updates an app in the **UptoZishu Console**. Our team approves it in the admin panel.
2. The `Publish UptoZishu` workflow runs every 10 minutes (and on every push) and runs `scripts/build-static.mjs`.
3. The script reads all live apps, reviews, developer profiles and the admin's storefront picks from Firebase, and writes the static pages.
4. The build is incremental. A page is rebuilt only when its data, the generator or the storefront picks change. Sponsored and Featured apps with an end date drop out on the next build after it passes.

## What the build writes

| Path | What |
| --- | --- |
| `index.html` | Home: hero, Sponsored, categories, shelves, all apps |
| `apps/`, `apps/<slug>/` | All apps and one page per app |
| `category/<slug>/`, `developer/<slug>/` | Category and developer pages |
| `top/`, `editors-choice/`, `discover/` | Charts and curated lists |
| `search/`, `library/`, `report/`, `feedback/`, `support/` | Client-side pages |
| `apps-index.json`, `sitemap.xml`, `rss.xml`, `robots.txt`, `manifest.webmanifest`, `404.html` | Search index, SEO, feeds, PWA |
| `privacy.html`, `terms.html` | Legal pages (generated from the build script) |

Hand-written files: `assets/style.css`, `assets/app.js`, `scripts/build-static.mjs`, `favicon.png`.

## Setup (once)

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Actions → General → Workflow permissions: Read and write.**
3. Optional repository **variables** (Settings → Secrets and variables → Actions → Variables):
   - `SITE_BASE_URL`: public URL without a trailing slash (default `https://uptozishu.zishuai.cloud`)
   - `DEV_CONSOLE_URL`: developer console link in the footer (default `https://dev.uptozishu.zishuai.cloud`)
   - `SUPPORT_EMAIL`: contact address on the legal and support pages
4. **Actions → Publish UptoZishu → Run workflow** for the first build.

No secrets are required. The Firebase rules must allow public **read** on `apps`, `reviews`, `devprofiles` and `storefront`, and signed-in writes only where the rules say. Use the `firebase-rules` file from the project.

## Local build

```bash
npm run build          # needs network access to Firebase
npm run serve          # preview
```

Test without Firebase:

```bash
APPS_FILE=apps.json REVIEWS_FILE=reviews.json DEVS_FILE=devs.json STOREFRONT_FILE=storefront.json node scripts/build-static.mjs
```

## Notes

- If Firebase returns zero apps while the site has apps, the build fails on purpose instead of publishing an empty store (`ALLOW_EMPTY=1` overrides).
- Developer UIDs and private emails are never written into public pages.
- The build log prints the storefront picks (`featured, editors, sponsored`) so you can see what the admin set.

## Legal

- [LICENSE](LICENSE): proprietary, all rights reserved.
- Privacy policy and Terms of service: `/privacy.html` and `/terms.html`.

© 2026 ZISHU TRON. All rights reserved.
