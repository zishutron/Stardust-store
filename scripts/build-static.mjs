#!/usr/bin/env node
/**
 * ZISHUTRON APPS — static site builder
 *
 * Runs in GitHub Actions every 10 minutes (and on every push):
 *  1. Reads all LIVE apps (+ reviews) from Firebase Realtime Database (REST, no SDK)
 *  2. Generates real static HTML pages, so visitors never wait for Firebase:
 *       /                      home (hero, shelves, categories, all apps)
 *       /apps/                 all apps
 *       /apps/<slug>/          one page per app (SEO + instant load)
 *       /category/<slug>/      one page per category
 *       /top/                  top charts
 *       /search/, /library/    client-side pages (use /apps-index.json)
 *       /404.html, /sitemap.xml, /rss.xml, /robots.txt, /manifest.webmanifest, /apps-index.json
 *  3. Output is deterministic (no "generated at" timestamps) so the workflow only
 *     commits + deploys when something actually changed.
 *
 * Firebase is only used by the browser for: download counter, posting a review.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- config
const env = (k, d = '') => (process.env[k] || d).trim();
const DB = env('STORE_DB_URL', 'https://stardust-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const BASE = env('SITE_BASE_URL', 'https://stardustapkstore.zishuai.cloud').replace(/\/+$/, '');
const INSIGHT_URL = env('INSIGHT_URL', 'https://zishu-insight.zishuai.cloud').replace(/\/+$/, '');
const CONSOLE_URL = env('DEV_CONSOLE_URL'); // optional: shows a "For developers" link
const SUPPORT_EMAIL = env('SUPPORT_EMAIL', 'support.stardustofficial@gmail.com');
const APPS_FILE = env('APPS_FILE');       // local test fixture (skips Firebase)
const REVIEWS_FILE = env('REVIEWS_FILE'); // local test fixture

const SITE = 'ZishuTron Apps';
const TAGLINE = 'Free Android apps & games, safe APK downloads';
const SITE_DESC = 'ZishuTron Apps is a free Android app store. Discover, review and download verified APKs of apps and games, updated every few minutes.';
const FALLBACK_ICON = '/favicon.png';
const MAX_REVIEWS_BAKED = 15;

const LIVE = new Set(['live', 'approved']);
const CAT_ICON = {
  games: '🎮', social: '💬', ai: '🤖', entertainment: '🎬', tools: '🛠️', shopping: '🛍️',
  music: '🎵', education: '🎓', health: '❤️', photography: '📷', finance: '💰', travel: '✈️',
  productivity: '📈', communication: '💬', lifestyle: '🌿', news: '📰', sports: '⚽', general: '📦'
};

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escXml = (s) => esc(s).replace(/&#39;/g, '&apos;');
const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const httpUrl = (v) => { try { const u = new URL(str(v)); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const titleCase = (s) => (s.length <= 2 ? s.toUpperCase() : s.replace(/\b\w/g, (c) => c.toUpperCase()));
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : v && typeof v === 'object' ? Object.values(v) : [])
  .map(str).filter(Boolean);
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const dateFmt = (ts) => (ts ? new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const isoDate = (ts) => new Date(ts).toISOString().slice(0, 10);
const trunc = (s, n) => { s = str(s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };
const fmtCount = (n) => {
  n = Math.max(0, Math.floor(n));
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
};
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error(`GET ${url} failed: ${last?.message || last}`);
}

// ---------------------------------------------------------------- data
async function loadApps() {
  const raw = APPS_FILE ? JSON.parse(await readFile(APPS_FILE, 'utf8')) : await getJson(`${DB}/apps.json`);
  return Object.entries(raw || {}).map(([id, a]) => ({ id, ...(a || {}) }));
}

async function loadReviews(apps) {
  if (REVIEWS_FILE) return JSON.parse(await readFile(REVIEWS_FILE, 'utf8')) || {};
  try { return (await getJson(`${DB}/reviews.json`, 2)) || {}; }
  catch (e) {
    console.warn(`[build] reviews.json not readable (${e.message}); trying per-app reviews`);
  }
  const out = {};
  const queue = [...apps];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const a = queue.shift();
      try { const r = await getJson(`${DB}/reviews/${encodeURIComponent(a.id)}.json`, 2); if (r) out[a.id] = r; }
      catch { /* reviews will be loaded live in the browser instead */ }
    }
  }));
  return out;
}

function normalize(apps, reviewsAll) {
  const out = [];
  for (const a of apps) {
    if (!LIVE.has(str(a.status).toLowerCase())) continue;
    const name = str(a.name);
    if (!name) continue;
    const rawCat = str(a.category) || 'General';
    const catSlug = slugify(rawCat) || 'general';
    const ts = num(a.timestamp) || 0;
    const updatedTs = Date.parse(str(a.updatedDate)) || ts;
    const history = [...new Set([...list(a.versionHistory), str(a.version)].filter(Boolean))];

    const revs = Object.values(reviewsAll[a.id] || {}).filter((r) => r && typeof r === 'object')
      .map((r) => ({
        author: trunc(r.author || 'Anonymous', 40), handle: trunc(r.handle || '', 40), text: str(r.text).slice(0, 1000),
        rating: Math.min(5, Math.max(1, Math.round(num(r.rating) || 5))), ts: num(r.timestamp),
        images: list(r.images).map(httpUrl).filter(Boolean).slice(0, 4), reply: str(r.reply).slice(0, 1000)
      }))
      .filter((r) => r.text)
      .sort((x, y) => y.ts - x.ts);

    out.push({
      id: a.id, name, catRaw: rawCat, catSlug,
      pkg: str(a.package), version: str(a.version) || '1.0', size: str(a.size) || '',
      short: str(a.shortDescription), desc: str(a.description), whatsNew: str(a.whatsNew).split('\n').map(str).filter(Boolean),
      downloadUrl: httpUrl(a.downloadUrl), icon: httpUrl(a.icon) || FALLBACK_ICON, banner: httpUrl(a.banner),
      shots: list(a.screenshot).map(httpUrl).filter(Boolean), tags: list(a.tags).slice(0, 12),
      permissions: list(a.permissions), history, dev: str(a.developerName || a.developer) || 'Independent developer',
      website: httpUrl(a.website), privacy: httpUrl(a.privacyPolicy), youtube: httpUrl(a.youtube),
      minAndroid: str(a.minAndroid) || '5.0', language: str(a.language) || 'English', sha256: /^[a-f0-9]{64}$/i.test(str(a.sha256)) ? str(a.sha256) : '',
      dl: Math.max(0, num(a.downloadCount)), rc: Math.max(0, num(a.reviewCount)), rating: Math.min(5, Math.max(0, num(a.rating))),
      verified: !!a.verified, ts, updatedTs, reviews: revs
    });
  }

  // stable slugs (package name): oldest app keeps the plain slug, later duplicates get a short id suffix
  const used = new Set();
  for (const a of [...out].sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id))) {
    const pk = a.pkg.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '');
    let s = pk.length >= 3 ? pk : (slugify(a.name) || 'app'); // URL = package name, e.g. /apps/com.zishu.os/
    if (used.has(s)) s = `${s}-${slugify(a.id).slice(-5) || sha(a.id).slice(0, 5)}`;
    used.add(s); a.slug = s; a.path = `/apps/${s}/`;
  }
  return out;
}

// ---------------------------------------------------------------- rendering primitives
const ASSET_V = sha((await readFile(join(ROOT, 'assets/style.css'), 'utf8')) + (await readFile(join(ROOT, 'assets/app.js'), 'utf8')));
const svg = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'
};

const statLine = (a) => `${a.rc > 0 ? `<span class="star">★</span> ${a.rating.toFixed(1)}` : '<span class="new">New</span>'} · ${svg.download.replace('<svg', '<svg class="mi"')} ${fmtCount(a.dl)}${a.size ? ` · ${esc(a.size)}` : ''}`;

const sortAttrs = (a) => `data-n="${esc(a.name.toLowerCase())}" data-d="${a.dl}" data-r="${a.rc > 0 ? a.rating : 0}" data-t="${a.ts}" data-u="${a.updatedTs}"`;

function row(a, extra = '') {
  return `<a class="row" href="${a.path}" ${sortAttrs(a)}>${extra}<img class="ic" src="${esc(a.icon)}" width="64" height="64" loading="lazy" decoding="async" alt="">`
    + `<span class="meta"><span class="nm">${esc(a.name)}</span><span class="ds">${esc(trunc(a.short || a.catRaw, 70))}</span><span class="st">${statLine(a)}</span></span></a>`;
}
function tile(a) {
  return `<a class="tile" href="${a.path}" ${sortAttrs(a)}><img class="ic" src="${esc(a.icon)}" width="72" height="72" loading="lazy" decoding="async" alt="">`
    + `<span class="nm">${esc(a.name)}</span><span class="st">${a.rc > 0 ? `<span class="star">★</span> ${a.rating.toFixed(1)}` : esc(a.catRaw)}</span></a>`;
}
const shelf = (title, apps, more) => apps.length ? `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2>${more ? `<a href="${more}">See all</a>` : ''}</div><div class="shelf">${apps.map(tile).join('')}</div></section>` : '';
const tilesSection = (title, apps, more) => apps.length ? `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2>${more ? `<a href="${more}">See all</a>` : ''}</div><div class="tiles">${apps.map(tile).join('')}</div></section>` : '';
const rowsSection = (title, apps, more) => apps.length ? `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2>${more ? `<a href="${more}">See all</a>` : ''}</div><div class="grid">${apps.map((a) => row(a)).join('')}</div></section>` : '';

const sortBar = (target) => `<label class="sortbar">Sort by <select data-sort="${target}" aria-label="Sort apps"><option value="d">Most downloaded</option><option value="r">Top rated</option><option value="t">Newest</option><option value="u">Recently updated</option><option value="n">Name A–Z</option></select></label>`;

function layout({ title, desc, path, body, ld = [], image, noindex = false, ogType = 'website', page = '', cats = [], activeCat = '', head = '' }) {
  const canonical = `${BASE}${path}`;
  const img = image || `${BASE}/favicon.png`;
  const nav = (href, label, key) => `<a href="${href}"${page === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const catbar = [`<a href="/"${(page === 'home' || page === 'apps') && !activeCat ? ' class="on"' : ''}>All</a>`,
    ...cats.map((c) => `<a href="/category/${c.slug}/"${activeCat === c.slug ? ' class="on"' : ''}>${esc(c.name)}</a>`)].join('');
  const bn = (href, label, key, icon) => `<a href="${href}"${page === key ? ' aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(trunc(desc, 160))}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta name="theme-color" content="#2563eb">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${SITE} — new &amp; updated apps" href="${BASE}/rss.xml">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(trunc(desc, 200))}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary">
<script>try{var t=localStorage.getItem('zt_theme')||localStorage.getItem('stardust_theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}window.ZT={db:${JSON.stringify(DB)}};</script>
<link rel="stylesheet" href="/assets/style.css?v=${ASSET_V}">
${head}${ld.map(jsonLd).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap hdr-in">
    <a class="brand" href="/" aria-label="${SITE} home"><img src="/favicon.png" width="34" height="34" alt=""><span>ZishuTron <b>Apps</b></span></a>
    <nav class="nav" aria-label="Main">${nav('/', 'Home', 'home')}${nav('/apps/', 'Apps', 'apps')}${nav('/top/', 'Top charts', 'top')}${nav('/library/', 'Library', 'library')}</nav>
    <form class="search" role="search" action="/search/" method="get">
      <input type="search" name="q" placeholder="Search apps…" autocomplete="off" aria-label="Search apps" enterkeyhint="search">
      <button type="submit" aria-label="Search">${svg.search}</button>
      <div class="suggest" hidden></div>
    </form>
    <button class="icon-btn" id="themeBtn" type="button" aria-label="Toggle dark mode">${svg.moon}</button>
  </div>
  <div class="catbar"><div class="wrap cat-in">${catbar}</div></div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div><a class="brand" href="/"><img src="/favicon.png" width="30" height="30" alt=""><span>ZishuTron <b>Apps</b></span></a>
        <p>${esc(TAGLINE)}. Every app is published by its developer and listed with its version, size and requirements.</p></div>
      <div><h3>Explore</h3><a href="/apps/">All apps</a><a href="/top/">Top charts</a><a href="/library/">My library</a><a href="/rss.xml">RSS feed</a></div>
      <div><h3>Company</h3><a href="${INSIGHT_URL}/">ZishuTron Insight</a><a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms of service</a><a href="mailto:${esc(SUPPORT_EMAIL)}?subject=Report%20an%20app">Report an app</a>${CONSOLE_URL ? `<a href="${esc(CONSOLE_URL)}">For developers</a>` : ''}</div>
    </div>
    <p class="copy">© ${new Date().getFullYear()} ZISHU TRON · ${SITE}. App names, logos and trademarks belong to their respective owners.</p>
  </div>
</footer>
<nav class="bottom-nav" aria-label="Primary">
  ${bn('/', 'Home', 'home', svg.home)}${bn('/search/', 'Search', 'search', svg.search)}${bn('/top/', 'Top', 'top', svg.trophy)}${bn('/library/', 'Library', 'library', svg.heart)}
</nav>
<script src="/assets/app.js?v=${ASSET_V}" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- pages
const byDl = (a, b) => b.dl - a.dl || b.ts - a.ts;
const byNew = (a, b) => b.ts - a.ts;
const byUpd = (a, b) => b.updatedTs - a.updatedTs || b.ts - a.ts;
const byRate = (a, b) => b.rating - a.rating || b.rc - a.rc;

function homePage(apps, cats) {
  const popular = [...apps].sort(byDl);
  const heroPool = [...popular.filter((a) => a.banner), ...popular.filter((a) => !a.banner)].slice(0, 5);
  const hero = heroPool.length ? `<section class="hero" aria-label="Featured apps">${heroPool.map((a, i) => `
    <a class="hero-slide" href="${a.path}">${a.banner ? `<img class="hero-bg" src="${esc(a.banner)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">` : ''}
      <span class="hero-body"><img class="ic" src="${esc(a.icon)}" width="72" height="72" alt="">
      <span><span class="tag">${i === 0 ? 'Editor’s choice' : 'Featured'}</span><strong>${esc(a.name)}</strong><span class="ds">${esc(trunc(a.short || a.catRaw, 80))}</span></span></span></a>`).join('')}</section>` : '';
  const catTiles = cats.length ? `<section class="sec"><div class="sec-h"><h2>Browse categories</h2></div><div class="cat-grid">${cats.map((c) =>
    `<a class="cat-tile" href="/category/${c.slug}/"><span class="ce">${c.icon}</span><span>${esc(c.name)}<small>${c.count} ${c.count === 1 ? 'app' : 'apps'}</small></span></a>`).join('')}</div></section>` : '';
  const body = `
<h1 class="page-title">${SITE} <small>${esc(TAGLINE)}</small></h1>
${hero}
${shelf('Popular right now', popular.slice(0, 10), '/top/')}
${shelf('New releases', [...apps].sort(byNew).slice(0, 10), '/apps/')}
${shelf('Recently updated', [...apps].sort(byUpd).slice(0, 10), '/top/#updated')}
${cats.map((c) => shelf(c.name, popular.filter((a) => a.catSlug === c.slug).slice(0, 15), `/category/${c.slug}/`)).join('\n')}
${apps.length ? '' : '<div class="empty"><h2>No apps yet</h2><p>New apps will appear here soon.</p></div>'}
<section class="about">
  <h2>About ${SITE}</h2>
  <p>${SITE} is a free Android app store built by ZISHU TRON. Browse ${apps.length || 'our'} apps and games, read real user reviews, check the version, size and Android requirements, and download the APK straight from the developer. The whole store is pre-built, so pages open instantly and use very little mobile data.</p>
</section>`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: `${BASE}/`, description: SITE_DESC,
    publisher: { '@type': 'Organization', name: 'ZISHU TRON', url: `${BASE}/`, logo: `${BASE}/favicon.png` },
    potentialAction: { '@type': 'SearchAction', target: `${BASE}/search/?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }];
  // old links like /?appuid=<firebaseId> keep working: redirect to the new static page
  const idmap = Object.fromEntries(apps.map((a) => [a.id, a.slug]));
  const head = `<script>(function(){var q=new URLSearchParams(location.search).get('appuid');if(!q)return;var m=${JSON.stringify(idmap).replace(/</g, '\\u003c')};if(m[q])location.replace('/apps/'+m[q]+'/')})()</script>\n`;
  return layout({ title: `${SITE} — ${TAGLINE}`, desc: SITE_DESC, path: '/', body, ld, page: 'home', cats, head, image: heroPool[0]?.icon });
}

function listPage({ title, h1, intro, path, apps, cats, page, activeCat, crumbs }) {
  const body = `
${crumbs}
<h1 class="page-title">${esc(h1)} <small>${apps.length} ${apps.length === 1 ? 'app' : 'apps'}</small></h1>
${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
${apps.length ? `${sortBar('#list')}<div class="tiles" id="list">${apps.slice(0, 500).map(tile).join('')}</div>` : '<div class="empty"><h2>Nothing here yet</h2><p>Check back soon.</p></div>'}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: `${BASE}${path}`,
    mainEntity: { '@type': 'ItemList', itemListElement: apps.slice(0, 30).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}${a.path}`, name: a.name })) } }];
  return layout({ title, desc: intro, path, body, ld, page, cats, activeCat });
}

const crumbHtml = (items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([h, l]) => (h ? `<a href="${h}">${esc(l)}</a>` : `<span aria-current="page">${esc(l)}</span>`)).join('<i>›</i>')}</nav>`;
const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([h, l], i) => ({ '@type': 'ListItem', position: i + 1, name: l, ...(h ? { item: `${BASE}${h}` } : {}) })) });

function topPage(apps, cats) {
  const ranked = (title, id, arr) => arr.length ? `<section class="sec" id="${id}"><div class="sec-h"><h2>${title}</h2></div><div class="grid ranked">${arr.slice(0, 30).map((a, i) => row(a, `<span class="rk">${i + 1}</span>`)).join('')}</div></section>` : '';
  const rated = [...apps].filter((a) => a.rc > 0).sort(byRate);
  const body = `${crumbHtml([['/', 'Home'], [null, 'Top charts']])}<h1 class="page-title">Top charts <small>ranked by real downloads and ratings</small></h1>
<div class="chips"><a class="chip" href="#downloads">Most downloaded</a><a class="chip" href="#rated">Top rated</a><a class="chip" href="#new">New</a><a class="chip" href="#updated">Recently updated</a></div>
${ranked('Most downloaded', 'downloads', [...apps].sort(byDl))}${ranked('Top rated', 'rated', rated)}${ranked('New releases', 'new', [...apps].sort(byNew))}${ranked('Recently updated', 'updated', [...apps].sort(byUpd))}`;
  return layout({ title: `Top Android Apps & Games — Top Charts | ${SITE}`, desc: 'The most downloaded, top rated, newest and recently updated Android apps and games on ZishuTron Apps.', path: '/top/', body, page: 'top', cats,
    ld: [crumbLd([['/', 'Home'], [null, 'Top charts']])] });
}

function searchPage(apps, cats) {
  const body = `<h1 class="page-title">Search</h1>
<form class="bigsearch" role="search" action="/search/" method="get"><input id="q" type="search" name="q" placeholder="Search apps, games, developers…" autocomplete="off" autofocus aria-label="Search apps"><button type="button" id="voice" aria-label="Voice search">${svg.mic}</button></form>
<div class="chips" id="filters"><button class="chip on" data-f="all" type="button">All</button><button class="chip" data-f="name" type="button">Name</button><button class="chip" data-f="dev" type="button">Developer</button><button class="chip" data-f="cat" type="button">Category</button></div>
<p class="muted" id="count" aria-live="polite"></p>
<div class="grid" id="results"></div>
<div id="fallback">${rowsSection('Popular apps', [...apps].sort(byDl).slice(0, 12))}</div>`;
  return layout({ title: `Search apps — ${SITE}`, desc: 'Search every app and game on ZishuTron Apps.', path: '/search/', body, page: 'search', cats, noindex: true });
}

function libraryPage(cats) {
  const body = `<h1 class="page-title">My library <small>saved on this device only</small></h1>
<section class="sec"><div class="sec-h"><h2>Your profile</h2></div>
  <form class="card form" id="profileForm"><label>Display name<input name="name" maxlength="40" placeholder="Guest User"></label><label>Handle<input name="handle" maxlength="40" placeholder="@guest"></label><button class="btn btn-primary" type="submit">Save</button><span class="muted" id="profileMsg" role="status"></span></form>
  <p class="muted">Used when you post a review. Nothing is uploaded until you post.</p></section>
<section class="sec"><div class="sec-h"><h2>Saved apps</h2></div><div class="grid" id="saved"></div></section>
<section class="sec"><div class="sec-h"><h2>Download history</h2><button class="linkbtn" id="clearHistory" type="button">Clear</button></div><div class="grid" id="history"></div></section>`;
  return layout({ title: `My library — ${SITE}`, desc: 'Your saved apps and download history on ZishuTron Apps.', path: '/library/', body, page: 'library', cats, noindex: true });
}

function appPage(a, apps, cats) {
  const cat = cats.find((c) => c.slug === a.catSlug);
  const related = apps.filter((x) => x.id !== a.id && x.catSlug === a.catSlug).sort(byDl).slice(0, 10);
  const more = related.length < 6 ? [...related, ...apps.filter((x) => x.id !== a.id && x.catSlug !== a.catSlug).sort(byDl).slice(0, 10 - related.length)] : related;
  const crumbs = [['/', 'Home'], [`/category/${a.catSlug}/`, a.catRaw], [null, a.name]];
  const paras = a.desc ? a.desc.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p>No description provided by the developer.</p>';
  const dist = [0, 0, 0, 0, 0]; a.reviews.forEach((r) => { dist[r.rating - 1]++; });
  const total = a.reviews.length;
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const revHtml = a.reviews.slice(0, MAX_REVIEWS_BAKED).map((r) => `<article class="rev"><header><b>${esc(r.author)}</b><span class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</span></header>
    <p>${esc(r.text)}</p>${r.images.length ? `<div class="rev-img">${r.images.map((u) => `<img src="${esc(u)}" height="56" loading="lazy" alt="Review screenshot" data-zoom>`).join('')}</div>` : ''}
    <footer>${dateFmt(r.ts)}</footer>${r.reply ? `<div class="reply"><b>Developer reply</b><p>${esc(r.reply)}</p></div>` : ''}</article>`).join('');
  const info = [
    ['Package', a.pkg], ['Version', a.version], ['Size', a.size], ['Category', `<a href="/category/${a.catSlug}/">${esc(a.catRaw)}</a>`, true],
    ['Requires', `Android ${a.minAndroid}+`], ['Updated', dateFmt(a.updatedTs)], ['Released', dateFmt(a.ts)], ['Downloads', a.dl.toLocaleString('en-US')],
    ['Developer', a.dev], ['Language', a.language],
    ['Website', a.website ? `<a href="${esc(a.website)}" rel="nofollow noopener" target="_blank">${esc(a.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '', true],
    ['Privacy policy', a.privacy ? `<a href="${esc(a.privacy)}" rel="nofollow noopener" target="_blank">View</a>` : '', true]
  ].filter(([, v]) => v).map(([k, v, raw]) => `<div><dt>${k}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('');
  const title = `${a.name} ${a.version} APK Download — ${a.catRaw} | ${SITE}`;
  const desc = a.short ? `${a.short} Download ${a.name} ${a.version} APK for Android ${a.minAndroid}+${a.size ? ` (${a.size})` : ''} from ${SITE}.` : trunc(a.desc, 150) || `Download ${a.name} APK for Android.`;
  const dlBtn = a.downloadUrl
    ? `<a class="btn btn-primary btn-lg" id="dlBtn" href="${esc(a.downloadUrl)}" target="_blank" rel="noopener nofollow" data-download data-id="${esc(a.id)}">${svg.download}<span>Download APK${a.size ? ` · ${esc(a.size)}` : ''}</span></a>`
    : `<span class="btn btn-lg disabled" aria-disabled="true">Download not available yet</span>`;
  const body = `${crumbHtml(crumbs)}
<article class="app" data-app-id="${esc(a.id)}" data-slug="${esc(a.slug)}" data-name="${esc(a.name)}" data-icon="${esc(a.icon)}">
  <header class="app-head">
    <img class="app-ic" src="${esc(a.icon)}" width="112" height="112" alt="${esc(a.name)} icon" fetchpriority="high">
    <div class="app-main">
      <h1>${esc(a.name)}${a.verified ? ` <span class="verified" title="Verified developer">${svg.shield}Verified</span>` : ''}</h1>
      <p class="dev">${esc(a.dev)}</p>
      <ul class="facts">
        <li><b>${a.rc > 0 ? `${a.rating.toFixed(1)} <span class="star">★</span>` : 'New'}</b><small>${a.rc > 0 ? `${fmtCount(a.rc)} ${a.rc === 1 ? 'review' : 'reviews'}` : 'no reviews'}</small></li>
        <li><b>${fmtCount(a.dl)}</b><small>downloads</small></li>
        ${a.size ? `<li><b>${esc(a.size)}</b><small>size</small></li>` : ''}
        <li><b>${esc(a.version)}</b><small>version</small></li>
        <li><b>${esc(a.minAndroid)}+</b><small>Android</small></li>
      </ul>
      <div class="cta">${dlBtn}<button class="btn btn-ghost" id="saveBtn" type="button" aria-pressed="false" aria-label="Save to library">${svg.heart}<span>Save</span></button><button class="btn btn-ghost" id="shareBtn" type="button" aria-label="Share">${svg.share}<span>Share</span></button></div>
    </div>
  </header>
  ${a.short ? `<p class="tagline">${esc(a.short)}</p>` : ''}
  ${a.shots.length ? `<section class="sec"><h2>Screenshots</h2><div class="shots">${a.shots.map((u, i) => `<img src="${esc(u)}" loading="lazy" decoding="async" alt="${esc(a.name)} screenshot ${i + 1}" data-zoom>`).join('')}</div></section>` : ''}
  <section class="sec prose"><h2>About ${esc(a.name)}</h2><div class="clamp" id="desc">${paras}</div><button class="linkbtn more" id="descMore" type="button" aria-expanded="false" aria-controls="desc" hidden>Show more</button>${a.tags.length ? `<div class="chips">${a.tags.map((t) => `<a class="chip" href="/search/?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}</section>
  ${a.whatsNew.length ? `<section class="sec"><h2>What’s new in ${esc(a.version)}</h2><ul class="wn">${a.whatsNew.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
  <section class="sec"><h2>App information</h2><dl class="info">${info}</dl></section>
  ${a.history.length > 1 ? `<section class="sec"><h2>Version history</h2><div class="chips">${[...a.history].reverse().map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div></section>` : ''}
  ${a.permissions.length ? `<section class="sec"><h2>Permissions</h2><div class="chips">${a.permissions.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div></section>` : ''}
  <section class="sec"><h2>Security</h2><div class="card secure">${svg.shield}<div><b>Direct from the developer</b><p>The APK is hosted by the developer and opens from its official download link. Always install apps from sources you trust.</p>${a.sha256 ? `<p class="hash">SHA-256: <code>${esc(a.sha256)}</code></p>` : ''}</div></div></section>
  <section class="sec" id="reviews"><h2>Ratings &amp; reviews</h2>
    <div class="rev-sum"><div class="big"><b>${a.rc > 0 ? a.rating.toFixed(1) : '–'}</b><span class="stars">${stars(Math.round(a.rc > 0 ? a.rating : 0))}</span><small>${a.rc} ${a.rc === 1 ? 'review' : 'reviews'}</small></div>
      <div class="bars">${[5, 4, 3, 2, 1].map((n) => `<div><span>${n}</span><i><u style="width:${total ? Math.round((dist[n - 1] / total) * 100) : 0}%"></u></i><span>${dist[n - 1]}</span></div>`).join('')}</div></div>
    <div id="revList">${revHtml || '<p class="muted" id="noRev">No reviews yet. Be the first to review this app.</p>'}</div>
    <form class="card form" id="revForm" novalidate><h3>Write a review</h3>
      <div class="starpick" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === 5}" data-s="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <textarea name="text" rows="3" maxlength="500" placeholder="Share your experience with ${esc(a.name)}…" required aria-label="Your review"></textarea>
      <div class="form-row"><button class="btn btn-primary" type="submit">Post review</button><span class="muted" id="revMsg" role="status"></span></div></form>
  </section>
  ${shelf('You may also like', more)}
</article>
<div class="stickybar" id="stickyBar" hidden><img src="${esc(a.icon)}" width="40" height="40" alt=""><span><b>${esc(a.name)}</b><small>${esc(a.version)}${a.size ? ` · ${esc(a.size)}` : ''}</small></span>${a.downloadUrl ? `<a class="btn btn-primary" href="${esc(a.downloadUrl)}" target="_blank" rel="noopener nofollow" data-download data-id="${esc(a.id)}">Download</a>` : ''}</div>
<div class="lightbox" id="lightbox" hidden><img alt=""></div>`;

  const ld = [{
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: a.name, operatingSystem: `Android ${a.minAndroid}+`,
    applicationCategory: a.catSlug === 'games' ? 'GameApplication' : 'MobileApplication', description: trunc(a.desc || a.short, 300),
    softwareVersion: a.version, image: a.icon.startsWith('/') ? `${BASE}${a.icon}` : a.icon, url: `${BASE}${a.path}`,
    ...(a.downloadUrl ? { downloadUrl: a.downloadUrl } : {}), ...(a.ts ? { datePublished: isoDate(a.ts) } : {}), ...(a.updatedTs ? { dateModified: isoDate(a.updatedTs) } : {}),
    ...(a.size ? { fileSize: a.size } : {}), author: { '@type': 'Organization', name: a.dev }, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(a.rc > 0 && a.rating > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: a.rating.toFixed(1), ratingCount: a.rc, bestRating: 5, worstRating: 1 } } : {}),
    ...(a.shots.length ? { screenshot: a.shots } : {})
  }, crumbLd(crumbs)];
  return layout({ title, desc, path: a.path, body, ld, page: 'app', cats, ogType: 'website', image: a.banner || a.icon.startsWith('http') ? (a.banner || a.icon) : undefined });
}

function notFound(cats) {
  const body = `<div class="empty"><h1>404 — page not found</h1><p>This app may have been moved or removed.</p><p><a class="btn btn-primary" href="/">Back to ${SITE}</a></p></div>`;
  return layout({ title: `Page not found — ${SITE}`, desc: 'Page not found.', path: '/404.html', body, noindex: true, cats });
}

// ---------------------------------------------------------------- feeds
function sitemap(apps, cats) {
  const last = apps.reduce((m, a) => Math.max(m, a.updatedTs), 0);
  const urls = [
    { loc: '/', lm: last, p: '1.0', f: 'daily' }, { loc: '/apps/', lm: last, p: '0.9', f: 'daily' }, { loc: '/top/', lm: last, p: '0.8', f: 'daily' },
    ...cats.map((c) => ({ loc: `/category/${c.slug}/`, lm: c.last, p: '0.7', f: 'daily' })),
    ...apps.map((a) => ({ loc: a.path, lm: a.updatedTs, p: '0.8', f: 'weekly' }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${escXml(BASE + u.loc)}</loc>${u.lm ? `<lastmod>${isoDate(u.lm)}</lastmod>` : ''}<changefreq>${u.f}</changefreq><priority>${u.p}</priority></url>`).join('\n')}\n</urlset>\n`;
}
function rss(apps) {
  const items = [...apps].sort(byUpd).slice(0, 30).map((a) => `    <item>
      <title>${escXml(`${a.name} ${a.version}`)}</title>
      <link>${escXml(BASE + a.path)}</link>
      <guid isPermaLink="true">${escXml(BASE + a.path)}</guid>
      <pubDate>${new Date(a.updatedTs || a.ts || 0).toUTCString()}</pubDate>
      <description>${escXml(trunc(a.short || a.desc, 280))}</description>
      <category>${escXml(a.catRaw)}</category>
    </item>`).join('\n');
  const lbd = apps.length ? new Date(Math.max(...apps.map((a) => a.updatedTs || 0))).toUTCString() : new Date(0).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${SITE}</title>\n    <link>${BASE}/</link>\n    <description>${escXml(SITE_DESC)}</description>\n    <language>en</language>\n    <lastBuildDate>${lbd}</lastBuildDate>\n    <atom:link href="${BASE}/rss.xml" rel="self" type="application/rss+xml"/>\n${items}\n  </channel>\n</rss>\n`;
}
const robots = () => `User-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /library/\n\nSitemap: ${BASE}/sitemap.xml\n`;
const manifest = () => JSON.stringify({ name: SITE, short_name: 'ZishuTron', description: SITE_DESC, start_url: '/', scope: '/', display: 'standalone',
  background_color: '#f6f7fb', theme_color: '#2563eb', icons: [{ src: '/favicon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }] }, null, 2);

// ---------------------------------------------------------------- main
async function write(rel, content) {
  const file = join(ROOT, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

async function main() {
  console.log(`[build] source: ${APPS_FILE || DB}`);
  console.log(`[build] base url: ${BASE}`);
  const rawApps = await loadApps();
  const reviews = await loadReviews(rawApps.filter((a) => LIVE.has(str(a.status).toLowerCase())));
  const apps = normalize(rawApps, reviews);
  console.log(`[build] ${rawApps.length} app record(s), ${apps.length} live`);

  // ---- incremental build -------------------------------------------------------
  // Listing pages (home, /apps/, categories, top, sitemap, search index) are rebuilt only when an app
  // is added / removed / edited (or the generator itself changed). Download + review counters only
  // change the page of that one app, so a download never rewrites the home page.
  const STATE = join(ROOT, 'data/build-state.json');
  const GEN = sha((await readFile(fileURLToPath(import.meta.url), 'utf8')) + ASSET_V + BASE + DB);
  const prev = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')) : null;
  const meta = (a) => sha(JSON.stringify({ ...a, dl: 0, rc: 0, rating: 0, reviews: 0 }));
  const cur = Object.fromEntries(apps.map((a) => [a.id, { h: meta(a), dl: a.dl, rc: a.rc, rating: a.rating }]));
  const same = prev && prev.gen === GEN && !process.env.FULL_BUILD &&
    Object.keys(cur).length === Object.keys(prev.apps).length && Object.keys(cur).every((k) => prev.apps[k] && prev.apps[k].h === cur[k].h);
  // apps as shown in listings: frozen counters when nothing structural changed
  const listApps = same ? apps.map((a) => ({ ...a, dl: prev.apps[a.id].dl, rc: prev.apps[a.id].rc, rating: prev.apps[a.id].rating })) : apps;
  const state = same ? prev : { gen: GEN, apps: cur };
  console.log(`[build] mode: ${same ? 'incremental (app pages only)' : 'full (listings + app pages)'}`);

  // Safety net: never wipe a working site because Firebase returned nothing unexpectedly.
  const idxPath = join(ROOT, 'apps-index.json');
  if (!apps.length && existsSync(idxPath) && !process.env.ALLOW_EMPTY) {
    const prev = JSON.parse(await readFile(idxPath, 'utf8'));
    if (prev.count > 0) throw new Error('Firebase returned 0 live apps but the site currently has apps. Refusing to publish an empty store (set ALLOW_EMPTY=1 to override).');
  }

  // categories (only ones that have apps)
  const catMap = new Map();
  for (const a of listApps) {
    const c = catMap.get(a.catSlug) || { slug: a.catSlug, name: a.catSlug === 'ai' ? 'AI' : titleCase(a.catRaw), icon: CAT_ICON[a.catSlug] || '📦', count: 0, last: 0 };
    c.count++; c.last = Math.max(c.last, a.updatedTs); catMap.set(a.catSlug, c);
  }
  const cats = [...catMap.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  if (!same) {
    // clean previously generated folders, then rebuild every listing page
    for (const d of ['apps', 'category', 'top', 'search', 'library']) await rm(join(ROOT, d), { recursive: true, force: true });
    await write('index.html', homePage(listApps, cats));
    await write('apps/index.html', listPage({
      title: `All Android Apps & Games — Free APK Download | ${SITE}`, h1: 'All apps', path: '/apps/', apps: [...listApps].sort(byDl), cats, page: 'apps',
      intro: `Browse every Android app and game on ${SITE}. Sort by downloads, rating or latest update.`, crumbs: crumbHtml([['/', 'Home'], [null, 'All apps']])
    }));
    for (const c of cats) {
      await write(`category/${c.slug}/index.html`, listPage({
        title: `Best ${c.name} Apps for Android — Free APK Download | ${SITE}`, h1: `${c.name} apps`, path: `/category/${c.slug}/`,
        apps: listApps.filter((a) => a.catSlug === c.slug).sort(byDl), cats, page: 'apps', activeCat: c.slug,
        intro: `Download the best ${c.name.toLowerCase()} apps for Android. ${c.count} ${c.count === 1 ? 'app' : 'apps'} with version, size and user reviews.`,
        crumbs: crumbHtml([['/', 'Home'], [null, c.name]])
      }));
    }
    await write('top/index.html', topPage(listApps, cats));
    await write('search/index.html', searchPage(listApps, cats));
    await write('library/index.html', libraryPage(cats));
    await write('404.html', notFound(cats));
    await write('sitemap.xml', sitemap(listApps, cats));
    await write('rss.xml', rss(listApps));
    await write('robots.txt', robots());
    await write('manifest.webmanifest', manifest());
    await write('apps-index.json', JSON.stringify({
      count: listApps.length,
      apps: [...listApps].sort(byDl).map((a) => ({ id: a.id, slug: a.slug, name: a.name, icon: a.icon, cat: a.catRaw, dev: a.dev, size: a.size, ver: a.version, dl: a.dl,
        r: a.rc > 0 ? a.rating : 0, short: trunc(a.short, 90), tags: a.tags }))
    }));
  }

  // app pages: always refreshed with live counters + reviews; git only sees the ones that actually changed
  for (const a of apps) await write(`apps/${a.slug}/index.html`, appPage(a, listApps, cats));
  await write('data/build-state.json', JSON.stringify(state));

  console.log(`[build] Done: ${apps.length} app page(s)${same ? '' : `, ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`}.`);
}

main().catch((e) => { console.error('[build] FAILED:', e); process.exit(1); });
