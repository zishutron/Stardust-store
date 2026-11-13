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

  /* ---------- accounts (Firebase Auth, loaded only when needed) ---------- */
  var FBV = '9.22.0', fbP = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function loadFirebase() {
    if (fbP) return fbP;
    fbP = loadScript('https://www.gstatic.com/firebasejs/' + FBV + '/firebase-app-compat.js')
      .then(function () { return loadScript('https://www.gstatic.com/firebasejs/' + FBV + '/firebase-auth-compat.js'); })
      .then(function () { if (!firebase.apps.length) firebase.initializeApp(window.ZT.fb); return firebase.auth(); });
    fbP.catch(function () { fbP = null; });
    return fbP;
  }
  function authUser() { // resolves with the signed-in user (or null) once Firebase has restored the session
    return loadFirebase().then(function (auth) { return new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(u); }); }); });
  }
  function dbReq(method, path, body, token) {
    var url = DB + '/' + path + '.json' + (token ? '?auth=' + encodeURIComponent(token) : '');
    return fetch(url, { method: method, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      if (!r.ok) throw new Error('db ' + r.status);
      return r.json();
    });
  }
  var USER_RE = /^[a-z0-9_.]{3,20}$/;
  function cleanUser(u) { return String(u || '').trim().toLowerCase().replace(/^@+/, ''); }
  function avc(seed) { var h = 0, s = String(seed || 'G').toLowerCase(); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997; return 'c' + (h % 8); }
  function me() { return store.get('zt_profile', null); }
  function setMe(p, uid) { if (p) { store.set('zt_profile', { uid: uid || p.uid, name: p.name, username: p.username, bio: p.bio || '' }); store.set('zt_uid', uid || p.uid); } else { store.set('zt_profile', null); store.set('zt_uid', ''); } }
  function safeNext() { var n = new URLSearchParams(location.search).get('next') || ''; return (n.charAt(0) === '/' && n.charAt(1) !== '/') ? n : ''; }

  /* ---------- library: account card, saved apps, download history ---------- */
  var acct = $('#acct');
  if (acct) {
    var show = function (which) { ['acctLoading', 'acctOut', 'acctComplete', 'acctProfile'].forEach(function (x) { $('#' + x).hidden = x !== which; }); };
    var paintProfile = function (p, email) {
      var av = $('#pfAvatar'); av.textContent = (p.name.trim().charAt(0) || 'G').toUpperCase(); av.className = 'avatar ' + avc(p.username || p.name);
      $('#pfName').textContent = p.name; $('#pfHandle').textContent = '@' + p.username;
      var b = $('#pfBio'); b.textContent = p.bio || 'No bio yet. Tap the pencil to add one.'; b.classList.toggle('muted', !p.bio);
      $('#pfEmail').textContent = email ? 'Signed in as ' + email + ' · only you can see your email' : '';
    };
    $('#savedCount').textContent = store.get('zt_saved', []).length || '';
    $('#historyCount').textContent = store.get('zt_history', []).length || '';

    var authMode = 'in', form = $('#authForm'), amsg = $('#authMsg');
    var setMode = function (m) {
      authMode = m; $$('.su', form).forEach(function (x) { x.hidden = m !== 'up'; });
      $('#authSubmit').textContent = m === 'up' ? 'Create account' : 'Sign in';
      $('#authToggle').textContent = m === 'up' ? 'Already have an account? Sign in' : 'New here? Create an account';
      form.password.autocomplete = m === 'up' ? 'new-password' : 'current-password'; amsg.textContent = '';
    };
    $('#authToggle').addEventListener('click', function () { setMode(authMode === 'in' ? 'up' : 'in'); });
    var errText = function (e) {
      var c = (e && e.code) || '';
      if (c === 'auth/email-already-in-use') return 'That email already has an account. Try signing in.';
      if (c === 'auth/weak-password') return 'Password is too weak. Use at least 6 characters.';
      if (c === 'auth/invalid-email') return 'That email address does not look right.';
      if (c === 'auth/wrong-password' || c === 'auth/invalid-credential' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return 'Wrong email or password.';
      if (c === 'auth/too-many-requests') return 'Too many tries. Please wait a bit and try again.';
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
      if (c === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups and try again.';
      if (c === 'auth/unauthorized-domain') return 'This website is not authorised for sign-in yet.';
      if (c === 'auth/network-request-failed') return 'No internet connection.';
      return 'Something went wrong. Please try again.';
    };
    var checkUsername = function (u) { // returns an error text or ''
      if (!USER_RE.test(u)) return 'Username must be 3–20 characters: lowercase letters, numbers, _ or .';
      return '';
    };
    // claim the username for this uid (fails if somebody else already owns it)
    var claim = function (u, user) {
      return user.getIdToken().then(function (tok) {
        return dbReq('GET', 'usernames/' + u).then(function (owner) {
          if (owner && owner !== user.uid) throw new Error('taken');
          if (owner === user.uid) return tok;
          return dbReq('PUT', 'usernames/' + u, user.uid, tok).then(function () { return tok; }, function () { throw new Error('taken'); });
        });
      });
    };
    var saveProfile = function (user, name, u, bio) {
      return claim(u, user).then(function (tok) {
        var prof = { name: name, username: u, bio: bio, createdAt: Date.now() };
        return dbReq('GET', 'users/' + user.uid).then(function (old) { if (old && old.createdAt) prof.createdAt = old.createdAt; return dbReq('PUT', 'users/' + user.uid, prof, tok); })
          .then(function () { setMe(prof, user.uid); try { user.updateProfile({ displayName: name }); } catch (e) { /* optional */ } return prof; });
      });
    };
    var afterLogin = function (user) {
      return dbReq('GET', 'users/' + user.uid).then(function (prof) {
        if (prof && prof.username) {
          setMe(prof, user.uid);
          var nx = safeNext(); if (nx) { location.replace(nx); return; }
          paintProfile(prof, user.email); show('acctProfile'); return;
        }
        var c = $('#acctComplete'); c.name.value = user.displayName || ''; show('acctComplete');
      }).catch(function () { show('acctOut'); amsg.textContent = 'Could not load your profile. Check your connection.'; });
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault(); amsg.textContent = '';
      var email = form.email.value.trim(), pw = form.password.value;
      if (!email || !pw) { amsg.textContent = 'Enter your email and password.'; return; }
      var btn = $('#authSubmit'); btn.disabled = true;
      var done = function () { btn.disabled = false; };
      if (authMode === 'in') {
        loadFirebase().then(function (a) { return a.signInWithEmailAndPassword(email, pw); }).then(function (r) { return afterLogin(r.user); })
          .catch(function (err) { amsg.textContent = errText(err); }).then(done);
        return;
      }
      var name = form.name.value.trim(), u = cleanUser(form.username.value), bio = form.bio.value.trim();
      if (name.length < 2) { amsg.textContent = 'Please enter your name.'; btn.disabled = false; return; }
      var ue = checkUsername(u); if (ue) { amsg.textContent = ue; btn.disabled = false; return; }
      if (pw.length < 6) { amsg.textContent = 'Password must be at least 6 characters.'; btn.disabled = false; return; }
      if (pw !== form.confirm.value) { amsg.textContent = 'Passwords do not match.'; btn.disabled = false; return; }
      amsg.textContent = 'Creating your account…';
      dbReq('GET', 'usernames/' + u).then(function (owner) {
        if (owner) { amsg.textContent = 'That username is already taken. Try another one.'; return; }
        return loadFirebase().then(function (a) { return a.createUserWithEmailAndPassword(email, pw); }).then(function (r) {
          return saveProfile(r.user, name, u, bio).then(function (prof) { amsg.textContent = ''; var nx = safeNext(); if (nx) { location.replace(nx); return; } paintProfile(prof, r.user.email); show('acctProfile'); },
            function (err) { // lost the race for the username: remove the half-created account so they can retry
              return r.user.delete().catch(function () { }).then(function () { amsg.textContent = err && err.message === 'taken' ? 'That username was just taken. Try another one.' : 'Could not save your profile. Please try again.'; });
            });
        });
      }).catch(function (err) { amsg.textContent = errText(err); }).then(done);
    });

    $('#authForgot').addEventListener('click', function () {
      var email = form.email.value.trim();
      if (!email) { amsg.textContent = 'Type your email above first, then tap “Forgot password?”.'; return; }
      loadFirebase().then(function (a) { return a.sendPasswordResetEmail(email); }).then(function () { amsg.textContent = 'Password reset email sent. Check your inbox.'; }).catch(function (err) { amsg.textContent = errText(err); });
    });
    $('#gBtn').addEventListener('click', function () {
      amsg.textContent = '';
      loadFirebase().then(function (a) { return a.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }).then(function (r) { return afterLogin(r.user); })
        .catch(function (err) { amsg.textContent = errText(err); });
    });

    var cf = $('#acctComplete'), cmsg = $('#cpMsg');
    cf.addEventListener('submit', function (e) {
      e.preventDefault(); cmsg.textContent = '';
      var name = cf.name.value.trim(), u = cleanUser(cf.username.value), bio = cf.bio.value.trim();
      if (name.length < 2) { cmsg.textContent = 'Please enter your name.'; return; }
      var ue = checkUsername(u); if (ue) { cmsg.textContent = ue; return; }
      cmsg.textContent = 'Saving…';
      authUser().then(function (user) { return saveProfile(user, name, u, bio).then(function (prof) { cmsg.textContent = ''; var nx = safeNext(); if (nx) { location.replace(nx); return; } paintProfile(prof, user.email); show('acctProfile'); }); })
        .catch(function (err) { cmsg.textContent = err && err.message === 'taken' ? 'That username is already taken. Try another one.' : 'Could not save. Please try again.'; });
    });
    var signOut = function () { loadFirebase().then(function (a) { return a.signOut(); }).catch(function () { }).then(function () { setMe(null); setMode('in'); show('acctOut'); }); };
    $('#cpOut').addEventListener('click', signOut); $('#pfOut').addEventListener('click', signOut);

    var pf = $('#pfForm'), view = $('.pf-view', acct), pmsg = $('#pfMsg');
    $('#pfEdit').addEventListener('click', function () { var p = me() || {}; pf.name.value = p.name || ''; pf.username.value = '@' + (p.username || ''); pf.bio.value = p.bio || ''; pmsg.textContent = ''; view.hidden = true; pf.hidden = false; pf.name.focus(); });
    $('#pfCancel').addEventListener('click', function () { pf.hidden = true; view.hidden = false; });
    pf.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = pf.name.value.trim(), bio = pf.bio.value.trim();
      if (name.length < 2) { pmsg.textContent = 'Please enter your name.'; return; }
      pmsg.textContent = 'Saving…';
      authUser().then(function (user) { return user.getIdToken().then(function (tok) { return dbReq('PATCH', 'users/' + user.uid, { name: name, bio: bio }, tok); }).then(function () {
        var p = me() || {}; p.name = name; p.bio = bio; setMe(p, user.uid); paintProfile(p, user.email); pf.hidden = true; view.hidden = false; toast('Profile saved');
      }); }).catch(function () { pmsg.textContent = 'Could not save. Please try again.'; });
    });

    // first paint from the cached profile, then confirm with Firebase
    var cached = me();
    if (cached && store.get('zt_uid', '')) { paintProfile(cached, ''); show('acctProfile'); } else show('acctLoading');
    if (cached || store.get('zt_uid', '')) {
      authUser().then(function (user) {
        if (!user) { setMe(null); setMode('in'); show('acctOut'); return; }
        afterLogin(user);
      }).catch(function () { if (!cached) show('acctOut'); });
    } else { setMode('in'); show('acctOut'); }
  }

  /* ---------- public member profile (/u/?u=username) ---------- */
  var ucard = $('#userCard');
  if (ucard) {
    var uname = cleanUser(new URLSearchParams(location.search).get('u'));
    var notFound = function () { ucard.innerHTML = '<p class="muted center">This profile could not be found.</p>'; };
    if (!USER_RE.test(uname)) notFound();
    else dbReq('GET', 'usernames/' + uname).then(function (uid) { return uid ? dbReq('GET', 'users/' + encodeURIComponent(uid)) : null; }).then(function (p) {
      if (!p || !p.name) return notFound();
      var since = ''; try { since = p.createdAt ? new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : ''; } catch (e) { /* ignore */ }
      ucard.innerHTML = '<div class="pf-top"><div class="avatar" aria-hidden="true"></div><div class="pf-info"><h2></h2><p class="pf-handle"></p></div></div><p class="pf-bio"></p><p class="muted small pf-since"></p>';
      var av = $('.avatar', ucard); av.textContent = (p.name.trim().charAt(0) || 'G').toUpperCase(); av.className = 'avatar ' + avc(uname);
      $('h2', ucard).textContent = p.name; $('.pf-handle', ucard).textContent = '@' + (p.username || uname);
      var b = $('.pf-bio', ucard); b.textContent = p.bio || ''; if (!p.bio) b.remove();
      $('.pf-since', ucard).textContent = since ? 'Member since ' + since : '';
      document.title = p.name + ' (@' + uname + ') — ' + document.title.split('—').pop().trim();
    }).catch(notFound);
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
  function revEl(r) {
    var rv = document.createElement('article'); rv.className = 'rev'; rv.dataset.ts = r.ts; if (r.uid) rv.dataset.uid = r.uid;
    rv.innerHTML = '<header><span class="rv-av" aria-hidden="true"></span><b></b></header><div class="rv-meta"><span class="stars"></span><time>Just now</time></div><p></p>';
    var av = $('.rv-av', rv); av.textContent = (String(r.author).trim().charAt(0) || 'G').toUpperCase(); av.className = 'rv-av ' + avc(r.username || r.author);
    $('b', rv).textContent = r.author;
    $('.stars', rv).textContent = '★★★★★'.slice(0, r.rating) + '☆☆☆☆☆'.slice(0, 5 - r.rating);
    $('p', rv).textContent = r.text;
    if (r.username) { var a = document.createElement('a'); a.className = 'rv-who'; a.href = '/u/?u=' + encodeURIComponent(r.username); while (rv.firstChild.firstChild) a.appendChild(rv.firstChild.firstChild); rv.firstChild.appendChild(a); }
    return rv;
  }
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
    var mine = store.get('zt_my_rev', {}), mr = mine[id], list = $('#revList');
    if (Array.isArray(mr)) mr = mr[mr.length - 1]; // older format
    if (!mr || !list) return;
    if (list.querySelector('.rev[data-ts="' + mr.ts + '"]')) { delete mine[id]; store.set('zt_my_rev', mine); return; } // the build already has it
    $$('.rev[data-uid="' + mr.uid + '"]', list).forEach(function (x) { x.remove(); }); // my older version
    var none = $('#noRev'); if (none) none.remove();
    list.insertBefore(revEl(mr), list.firstChild);
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

  // reviews: only for signed-in members, one review per person per app (the review is stored under the member's uid)
  var form = $('#revForm'), gate = $('#revGate'), rating = 5;
  if (!form) return;
  var signedIn = !!(me() && store.get('zt_uid', ''));
  var gl = $('#revSignIn'); if (gl) gl.href = '/library/?next=' + encodeURIComponent(location.pathname);
  if (signedIn) {
    gate.hidden = true; form.hidden = false;
    $('#revAs').textContent = 'Posting as ' + me().name + ' (@' + me().username + ')';
  }
  var pick = $$('.starpick button', form);
  function paintStars() { pick.forEach(function (b) { var on = +b.dataset.s <= rating; b.classList.toggle('on', on); b.setAttribute('aria-checked', +b.dataset.s === rating); }); }
  pick.forEach(function (b) { b.addEventListener('click', function () { rating = +b.dataset.s; paintStars(); }); });
  paintStars();
  var msg = $('#revMsg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = form.text.value.trim();
    if (text.length < 3) { msg.textContent = 'Please write a short review first.'; return; }
    var btn = $('button[type=submit]', form); btn.disabled = true; msg.textContent = 'Posting…';
    var base = 'reviews/' + encodeURIComponent(id), review;
    authUser().then(function (user) {
      if (!user) { setMe(null); gate.hidden = false; form.hidden = true; throw new Error('signin'); }
      var p = me();
      var prof = p && p.uid === user.uid ? Promise.resolve(p) : dbReq('GET', 'users/' + user.uid).then(function (x) { if (x && x.username) { setMe(x, user.uid); return me(); } throw new Error('profile'); });
      return prof.then(function (pr) {
        review = { uid: user.uid, author: pr.name, username: pr.username, text: text, rating: rating, timestamp: Date.now(), images: '' };
        return user.getIdToken().then(function (tok) {
          return dbReq('PATCH', base + '/' + user.uid, review, tok).then(function () {
            // recompute the counters from the real reviews
            return dbReq('GET', base).then(function (all) {
              var rs = Object.keys(all || {}).map(function (k) { return all[k]; }).filter(function (r) { return r && typeof r === 'object'; });
              if (!rs.length) return;
              var avg = rs.reduce(function (s, r) { return s + (+r.rating || 5); }, 0) / rs.length;
              return dbReq('PUT', 'apps/' + encodeURIComponent(id) + '/reviewCount', rs.length).then(function () { return dbReq('PUT', 'apps/' + encodeURIComponent(id) + '/rating', Math.round(avg * 10) / 10); });
            }).catch(function () { });
          });
        });
      });
    }).then(function () {
      var mine = store.get('zt_my_rev', {}); mine[id] = { ts: review.timestamp, uid: review.uid, author: review.author, username: review.username, text: text, rating: rating }; store.set('zt_my_rev', mine);
      var logs = store.get('zt_review_logs', []); logs.unshift('[' + rating + '★] ' + app.dataset.name + ': ' + text); store.set('zt_review_logs', logs.slice(0, 30));
      var list = $('#revList'), none = $('#noRev'); if (none) none.remove();
      $$('.rev[data-uid="' + review.uid + '"]', list).forEach(function (x) { x.remove(); });
      list.insertBefore(revEl(mine[id]), list.firstChild); form.text.value = ''; btn.disabled = false;
      msg.textContent = 'Thanks! Your review is live and will show on the page for everyone shortly.';
    }).catch(function (err) {
      if (window.console) console.warn('review failed', err);
      btn.disabled = false;
      msg.textContent = err && err.message === 'signin' ? 'Please sign in again to post your review.'
        : err && err.message === 'profile' ? 'Finish your profile in the Library tab first.' : 'Could not post the review. Please try again.';
    });
  });
})();
