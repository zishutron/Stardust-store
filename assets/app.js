/* UptoZishu — shared client script.
 * The store itself is pre-built static HTML. Firebase is only touched (via tiny REST calls,
 * no SDK) when the visitor downloads an app or posts a review. */
(function () {
  'use strict';
  var DB = (window.ZT && window.ZT.db) || '';
  var FB = '/favicon.png';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2400);
  }

  // broken images -> fallback icon
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG' && !el.dataset.fb && (el.classList.contains('ic') || el.classList.contains('app-ic'))) { el.dataset.fb = 1; el.src = FB; }
    else if (el && el.classList && el.classList.contains('hero-bg')) el.remove();
  }, true);

  /* ---------- theme ---------- */
  var themeBtn = $('#themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('zt_theme', next); } catch (e) { /* ignore */ }
  });

  /* ---------- apps index (loaded lazily, only when needed) ---------- */
  var indexPromise;
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch('/apps-index.json').then(function (r) { return r.json(); }).then(function (d) { return d.apps || []; }).catch(function () { return []; });
    return indexPromise;
  }
  function matches(a, q, f) {
    var n = a.name.toLowerCase(), d = (a.dev || '').toLowerCase(), c = (a.cat || '').toLowerCase();
    if (f === 'name') return n.indexOf(q) > -1;
    if (f === 'dev') return d.indexOf(q) > -1;
    if (f === 'cat') return c.indexOf(q) > -1;
    return n.indexOf(q) > -1 || d.indexOf(q) > -1 || c.indexOf(q) > -1 || (a.short || '').toLowerCase().indexOf(q) > -1 ||
      (a.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) > -1; });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rowHtml(a, note) {
    return '<a class="row" href="/apps/' + encodeURIComponent(a.slug) + '/"><img class="ic" src="' + esc(a.icon) + '" width="64" height="64" loading="lazy" alt="">' +
      '<span class="meta"><span class="nm">' + esc(a.name) + '</span><span class="ds">' + esc(a.short || a.cat) + '</span>' +
      '<span class="st">' + (a.r ? '<span class="star">★</span> ' + a.r.toFixed(1) : '<span class="new">New</span>') + ' · ' + esc(a.cat) + (a.size ? ' · ' + esc(a.size) : '') + '</span>' + (note ? '<span class="st">' + esc(note) + '</span>' : '') + '</span></a>';
  }

  /* ---------- header search suggestions ---------- */
  var hs = $('.search input'), sg = $('.suggest');
  if (hs && sg) {
    hs.addEventListener('focus', loadIndex);
    hs.addEventListener('input', function () {
      var q = hs.value.trim().toLowerCase();
      if (!q) { sg.hidden = true; return; }
      loadIndex().then(function (apps) {
        var hit = apps.filter(function (a) { return matches(a, q, 'all'); }).slice(0, 6);
        sg.innerHTML = hit.map(function (a) {
          return '<a href="/apps/' + encodeURIComponent(a.slug) + '/"><img src="' + esc(a.icon) + '" alt=""><span><b>' + esc(a.name) + '</b><small>' + esc(a.cat) + '</small></span></a>';
        }).join('');
        sg.hidden = !hit.length;
      });
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) sg.hidden = true; });
  }

  /* ---------- sort controls on list pages ---------- */
  $$('select[data-sort]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var box = $(sel.dataset.sort), k = sel.value; if (!box) return;
      var rows = $$('.row,.tile', box);
      rows.sort(function (a, b) { return k === 'n' ? a.dataset.n.localeCompare(b.dataset.n) : (+b.dataset[k]) - (+a.dataset[k]); });
      rows.forEach(function (r) { box.appendChild(r); });
    });
  });

  /* ---------- search page ---------- */
  var q = $('#q'), results = $('#results');
  if (q && results) {
    var filter = 'all', fb = $('#fallback'), count = $('#count');
    var run = function () {
      var term = q.value.trim().toLowerCase();
      if (!term) { results.innerHTML = ''; count.textContent = ''; if (fb) fb.hidden = false; return; }
      if (fb) fb.hidden = true;
      loadIndex().then(function (apps) {
        var hit = apps.filter(function (a) { return matches(a, term, filter); });
        results.innerHTML = hit.map(rowHtml).join('');
        count.textContent = hit.length ? hit.length + ' result' + (hit.length > 1 ? 's' : '') : 'No apps found for “' + q.value.trim() + '”.';
      });
    };
    q.value = new URLSearchParams(location.search).get('q') || '';
    q.addEventListener('input', function () { history.replaceState(null, '', q.value ? '?q=' + encodeURIComponent(q.value) : location.pathname); run(); });
    $$('#filters .chip').forEach(function (c) {
      c.addEventListener('click', function () { filter = c.dataset.f; $$('#filters .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); run(); });
    });
    var v = $('#voice'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (v) { if (!SR) v.hidden = true; else v.addEventListener('click', function () {
      var r = new SR(); r.lang = 'en-US'; r.onresult = function (e) { q.value = e.results[0][0].transcript; run(); }; r.start();
    }); }
    run();
  }

  /* ---------- library: profile card, saved apps, download history ---------- */
  var card = $('#profileCard');
  if (card) {
    var cleanHandle = function (h) { return String(h || '').trim().replace(/^@+/, '').replace(/\s+/g, ''); };
    var paint = function () {
      var name = store.get('zt_name', '') || 'Guest User', handle = cleanHandle(store.get('zt_handle', '')) || 'guest', bio = store.get('zt_bio', '');
      $('#pfName').textContent = name; $('#pfHandle').textContent = '@' + handle;
      $('#pfAvatar').textContent = (name.trim().charAt(0) || 'G').toUpperCase();
      var b = $('#pfBio'); b.textContent = bio || 'No bio yet. Tap the pencil to add one.'; b.classList.toggle('muted', !bio);
      $('#savedCount').textContent = store.get('zt_saved', []).length || '';
      $('#historyCount').textContent = store.get('zt_history', []).length || '';
    };
    var pf = $('#pfForm'), view = $('.pf-view', card);
    $('#pfEdit').addEventListener('click', function () {
      pf.name.value = store.get('zt_name', ''); pf.handle.value = cleanHandle(store.get('zt_handle', '')); pf.bio.value = store.get('zt_bio', '');
      view.hidden = true; pf.hidden = false; pf.name.focus();
    });
    $('#pfCancel').addEventListener('click', function () { pf.hidden = true; view.hidden = false; });
    pf.addEventListener('submit', function (e) {
      e.preventDefault();
      store.set('zt_name', pf.name.value.trim()); store.set('zt_handle', cleanHandle(pf.handle.value)); store.set('zt_bio', pf.bio.value.trim());
      pf.hidden = true; view.hidden = false; paint(); toast('Profile saved');
    });
    paint();
  }
  var saved = $('#saved'), hist = $('#history');
  if (saved || hist) {
    loadIndex().then(function (apps) {
      var byId = {}; apps.forEach(function (a) { byId[a.id] = a; });
      if (saved) {
        var ids = store.get('zt_saved', []).filter(function (id) { return byId[id]; });
        saved.innerHTML = ids.length ? ids.map(function (id) { return rowHtml(byId[id]); }).join('') : '<p class="muted">No saved apps yet. Tap “Save” on any app page and it will show up here.</p>';
      }
      if (hist) {
        var h = store.get('zt_history', []).filter(function (x) { return byId[x.id]; });
        var fmt = function (t) { try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
        hist.innerHTML = h.length ? h.map(function (x) { return rowHtml(byId[x.id], x.t ? 'Downloaded ' + fmt(x.t) : ''); }).join('') : '<p class="muted">No downloads yet.</p>';
      }
    });
    var ch = $('#clearHistory');
    if (ch) ch.addEventListener('click', function () { store.set('zt_history', []); hist.innerHTML = '<p class="muted">No downloads yet.</p>'; });
  }

  /* ---------- app page ---------- */
  var app = $('.app');
  if (!app) return;
  var id = app.dataset.appId;

  // long description: collapse with "Show more"
  var desc = $('#desc'), more = $('#descMore');
  if (desc && more) {
    if (desc.scrollHeight > desc.clientHeight + 6) {
      more.hidden = false;
      more.addEventListener('click', function () {
        var open = desc.classList.toggle('open');
        more.textContent = open ? 'Show less' : 'Show more'; more.setAttribute('aria-expanded', open);
      });
    } else desc.classList.remove('clamp');
  }

  // lightbox: × button, tap outside, Esc, or the phone's back button all close it
  var lb = $('#lightbox');
  function openLb(src) { $('img', lb).src = src; lb.hidden = false; document.body.style.overflow = 'hidden'; try { history.pushState({ lb: 1 }, ''); } catch (e) { /* ignore */ } }
  function closeLb(fromPop) {
    if (!lb || lb.hidden) return;
    lb.hidden = true; document.body.style.overflow = '';
    if (!fromPop && history.state && history.state.lb) history.back();
  }
  document.addEventListener('click', function (e) {
    var z = e.target.closest('[data-zoom]');
    if (z && lb) openLb(z.src);
    else if (lb && !lb.hidden && e.target.closest('#lightbox')) closeLb();
  });
  window.addEventListener('popstate', function () { closeLb(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });

  // save to library
  var saveBtn = $('#saveBtn');
  function paintSave() {
    var on = store.get('zt_saved', []).indexOf(id) > -1;
    saveBtn.setAttribute('aria-pressed', on); $('span', saveBtn).textContent = on ? 'Saved' : 'Save';
  }
  if (saveBtn) {
    paintSave();
    saveBtn.addEventListener('click', function () {
      var s = store.get('zt_saved', []), i = s.indexOf(id);
      if (i > -1) s.splice(i, 1); else s.unshift(id);
      store.set('zt_saved', s); paintSave();
    });
  }

  // share
  var shareBtn = $('#shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', function () {
    var data = { title: app.dataset.name + ' — UptoZishu', url: location.origin + location.pathname };
    if (navigator.share) navigator.share(data).catch(function () { });
    else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { toast('Link copied'); });
  });

  // The page is rebuilt every few minutes; until then show this visitor's own download/review right away
  function fmtN(n) { return n < 1000 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M'; }
  function bumpDl(add) {
    var el = $('#dlCount'); if (!el) return;
    var base = +el.dataset.dl || 0, all = store.get('zt_dl', {}), cur = all[id];
    if (!cur || cur.base !== base) cur = { base: base, add: 0 };
    cur.add += add; all[id] = cur; store.set('zt_dl', all);
    el.textContent = fmtN(base + cur.add);
  }
  (function showPending() {
    var el = $('#dlCount'), all = store.get('zt_dl', {});
    if (el && all[id]) { if (all[id].base === (+el.dataset.dl || 0)) el.textContent = fmtN(all[id].base + all[id].add); else { delete all[id]; store.set('zt_dl', all); } }
    var mine = store.get('zt_my_rev', {}), r = mine[id], list = $('#revList');
    if (!r || !list) return;
    if (list.querySelector('.rev[data-ts="' + r.ts + '"]')) { delete mine[id]; store.set('zt_my_rev', mine); return; } // the build already has it
    var none = $('#noRev'); if (none) none.remove();
    var rv = document.createElement('article'); rv.className = 'rev'; rv.dataset.ts = r.ts;
    rv.innerHTML = '<header><b></b><span class="stars"></span></header><p></p><footer>Just now · will show for everyone after the next update</footer>';
    $('b', rv).textContent = r.author; $('.stars', rv).textContent = '★★★★★'.slice(0, r.rating) + '☆☆☆☆☆'.slice(0, 5 - r.rating); $('p', rv).textContent = r.text;
    list.insertBefore(rv, list.firstChild);
  })();

  // download counter: one tiny REST call, the link itself opens normally in a new tab
  var lastHit = 0;
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-download]'); if (!a) return;
    var h = store.get('zt_history', []).filter(function (x) { return x.id !== id; }); h.unshift({ id: id, t: Date.now() }); store.set('zt_history', h.slice(0, 50));
    if (Date.now() - lastHit < 5000) return; lastHit = Date.now();
    bumpDl(1);
    try { fetch(DB + '/apps/' + encodeURIComponent(id) + '/downloadCount.json', { method: 'PUT', body: JSON.stringify({ '.sv': { increment: 1 } }) }).catch(function () { }); } catch (err) { /* ignore */ }
    // per-day counter (IST day) so the developer console can draw real download charts
    try { var day = new Date(Date.now() + 19800000).toISOString().slice(0, 10); fetch(DB + '/stats/' + encodeURIComponent(id) + '/' + day + '.json', { method: 'PUT', body: JSON.stringify({ '.sv': { increment: 1 } }) }).catch(function () { }); } catch (err) { /* ignore */ }
  });

  // sticky download bar once the main button scrolls away (mobile)
  var main = $('#dlBtn'), bar = $('#stickyBar');
  if (main && bar && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { bar.hidden = en[0].isIntersecting || en[0].boundingClientRect.top > 0; }).observe(main);
  }

  // reviews
  var form = $('#revForm'), rating = 5;
  if (!form) return;
  var pick = $$('.starpick button', form);
  function paintStars() { pick.forEach(function (b) { var on = +b.dataset.s <= rating; b.classList.toggle('on', on); b.setAttribute('aria-checked', +b.dataset.s === rating); }); }
  pick.forEach(function (b) { b.addEventListener('click', function () { rating = +b.dataset.s; paintStars(); }); });
  paintStars();
  var msg = $('#revMsg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = form.text.value.trim();
    if (text.length < 3) { msg.textContent = 'Please write a short review first.'; return; }
    var done = store.get('zt_reviewed', []);
    if (done.indexOf(id) > -1) { msg.textContent = 'You already reviewed this app on this device.'; return; }
    var btn = $('button[type=submit]', form); btn.disabled = true; msg.textContent = 'Posting…';
    var review = { author: store.get('zt_name', '') || 'Guest User', handle: store.get('zt_handle', '') || '@guest', text: text, rating: rating, timestamp: Date.now(), images: '' };
    var base = DB + '/reviews/' + encodeURIComponent(id);
    fetch(base + '.json', { method: 'POST', body: JSON.stringify(review) })
      .then(function (r) { if (!r.ok) throw new Error('post'); })
      .then(function () {
        // same bookkeeping the old store did: bump the counter, recompute the average
        return fetch(DB + '/apps/' + encodeURIComponent(id) + '/reviewCount.json', { method: 'PUT', body: JSON.stringify({ '.sv': { increment: 1 } }) })
          .then(function () { return fetch(base + '.json').then(function (r) { return r.json(); }); })
          .then(function (all) {
            var rs = Object.keys(all || {}).map(function (k) { return all[k]; });
            if (!rs.length) return;
            var avg = rs.reduce(function (s, r) { return s + (+r.rating || 5); }, 0) / rs.length;
            return fetch(DB + '/apps/' + encodeURIComponent(id) + '/rating.json', { method: 'PUT', body: JSON.stringify(Math.round(avg * 10) / 10) });
          }).catch(function () { });
      })
      .then(function () {
        done.push(id); store.set('zt_reviewed', done);
        var mine = store.get('zt_my_rev', {}); mine[id] = { ts: review.timestamp, author: review.author, text: text, rating: rating }; store.set('zt_my_rev', mine);
        var logs = store.get('zt_review_logs', []); logs.unshift('[' + rating + '★] ' + app.dataset.name + ': ' + text); store.set('zt_review_logs', logs.slice(0, 30));
        var list = $('#revList'), none = $('#noRev'); if (none) none.remove();
        var el = document.createElement('article'); el.className = 'rev'; el.dataset.ts = review.timestamp;
        el.innerHTML = '<header><b></b><span class="stars"></span></header><p></p><footer>Just now</footer>';
        $('b', el).textContent = review.author; $('.stars', el).textContent = '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating); $('p', el).textContent = text;
        list.insertBefore(el, list.firstChild); form.text.value = ''; msg.textContent = 'Thanks! Your review is live and will show on the page for everyone shortly.';
      })
      .catch(function () { msg.textContent = 'Could not post the review. Please try again.'; btn.disabled = false; });
  });
})();
