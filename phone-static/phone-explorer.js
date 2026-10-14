/* Phone file explorer, Windows-11 look. Opens ONLY from the app's own
   "Add project" buttons (text, aria-label, or data-action match).
   Same-origin API calls reuse the browser's saved login. No passwords here.
   Anonymous telemetry (pe= events carry no paths or content). */
(function () {
  if (window.__pe_installed) return;
  window.__pe_installed = true;
  try { new Image().src = '/apple-touch-icon-v3.png?pe=init13'; } catch (e) {}

  var LS_KEY = 'opencode.global.dat:server';
  var HOME = null, homeP = null;
  var lastIntercept = 0;
  var CSS_HREF = '/phone-explorer.css';
  try {
    var _cs = document.currentScript;
    if (_cs && _cs.src) {
      var _u = new URL(_cs.src);
      CSS_HREF = _u.pathname.replace(/[^/]*$/, '') + 'phone-explorer.css' + _u.search;
    }
  } catch (e) { /* keep default */ }
  function peEv(w) {
    try { new Image().src = '/apple-touch-icon-v3.png?pe=' + w; } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    try {
      var m = String((e && e.message) || 'err').slice(0, 60).replace(/[^a-zA-Z0-9 _:.-]/g, '');
      peEv('jserr' + encodeURIComponent(m));
    } catch (x) {}
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function base(p) {
    var q = String(p).replace(/[\\/]+$/, '');
    var i = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\'));
    return i < 0 ? q : q.slice(i + 1);
  }
  function parentDir(p) {
    var q = String(p).replace(/[\\/]+$/, '');
    var i = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\'));
    if (i < 0) return null;
    if (/^[A-Za-z]:$/.test(q.slice(0, 2)) && i === 2) return q.slice(0, 2) + '/';
    if (i === 0) return null;
    return q.slice(0, i);
  }
  function norm(p) { return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
  function api(path) {
    return fetch(path, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status === 401) throw new Error('LOGIN');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function home() {
    if (HOME) return Promise.resolve(HOME);
    if (!homeP) homeP = api('/path').then(function (d) { HOME = d.home || 'C:/Users/roblo'; return HOME; });
    return homeP;
  }
  function joinAbs(dir, rel) {
    var r = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    var d = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
    return d + '/' + r;
  }
  var FOLDER_SVG = '<svg viewBox="0 0 32 32" width="40" height="40"><path d="M2 7a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#4cc2ff" opacity=".95"/><path d="M2 11h28v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#7cd4ff"/></svg>';
  var FILE_SVG = '<svg viewBox="0 0 32 32" width="34" height="34"><path d="M7 3h11l7 7v19H7z" fill="#e8e8e8"/><path d="M18 3v7h7z" fill="#9ecbff"/></svg>';

  /* ---------- overlay shell ---------- */
  var root = null, listEl = null, crumbEl = null, msgEl = null, searchEl = null,
      titleEl = null, sideEl = null, statusEl = null, backBtn = null, fwdBtn = null;
  var cur = null, searchMode = false, previewMode = false;
  var hist = [], hi = -1, viewMode = 'grid', sortDesc = false, sideOpen = true;

  function ensureCss() {
    if (document.getElementById('pe-css')) return;
    var l = document.createElement('link');
    l.id = 'pe-css'; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  function build() {
    ensureCss();
    root = document.createElement('div');
    root.id = 'pe-root';
    root.innerHTML =
      '<div class="pe-titlebar"><button class="pe-tb" data-act="menu">☰</button>' +
      '<span class="pe-tab">🏠 <span id="pe-tabname">Home</span></span>' +
      '<span class="pe-sp"></span><button class="pe-tb" data-act="close">✕</button></div>' +
      '<div class="pe-navbar"><button class="pe-tb" data-act="back">‹</button>' +
      '<button class="pe-tb" data-act="fwd">›</button>' +
      '<button class="pe-tb" data-act="up">↑</button>' +
      '<button class="pe-tb" data-act="refresh">⟳</button>' +
      '<div class="pe-crumb" id="pe-crumb"></div>' +
      '<div class="pe-search"><input id="pe-q" class="pe-input" placeholder="Search" autocomplete="off"></div></div>' +
      '<div class="pe-cmd"><button class="pe-btn pe-sm" data-act="sort">⇅ Sort</button>' +
      '<button class="pe-btn pe-sm" data-act="view">▦ View</button>' +
      '<span class="pe-title" id="pe-title">PC files</span>' +
      '<button class="pe-btn pe-sm pe-open-cur" data-act="open-cur">Open</button></div>' +
      '<div class="pe-body"><div class="pe-side" id="pe-side"></div>' +
      '<div class="pe-main"><div class="pe-msg" id="pe-msg"></div>' +
      '<div class="pe-list" id="pe-list"></div>' +
      '<div class="pe-status" id="pe-status"></div></div></div>';
    document.body.appendChild(root);
    listEl = root.querySelector('#pe-list');
    crumbEl = root.querySelector('#pe-crumb');
    msgEl = root.querySelector('#pe-msg');
    searchEl = root.querySelector('#pe-q');
    titleEl = root.querySelector('#pe-title');
    sideEl = root.querySelector('#pe-side');
    statusEl = root.querySelector('#pe-status');
    var deb = null;
    searchEl.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { doSearch(searchEl.value.trim()); }, 350);
    });
    root.addEventListener('click', onTap);
    renderSide();
  }
  function say(t, bad) {
    msgEl.textContent = t || '';
    msgEl.className = 'pe-msg' + (bad ? ' pe-bad' : '');
  }
  function show() { if (!root) build(); root.classList.add('on'); document.body.classList.add('pe-lock'); }
  function hide() { if (root) root.classList.remove('on'); document.body.classList.remove('pe-lock'); }

  function openOverlay() {
    show(); say('');
    peEv('open');
    if (searchEl) searchEl.value = '';
    searchMode = false; previewMode = false;
    renderSide();
    loadProjects().then(function () { if (!searchMode && !previewMode) { if (cur) browse(cur, false); } });
    home().then(function (h) { if (!cur && !searchMode && !previewMode) browse(h, false); });
  }

  /* ---------- your existing projects ---------- */
  var projCache = null;
  function loadProjects() {
    if (projCache) return Promise.resolve();
    say('Loading your projects…');
    return Promise.all([
      api('/api/session?limit=5000&order=desc').catch(function () { return { data: [] }; }),
      api('/project').catch(function () { return []; })
    ]).then(function (res) {
      var byDir = {}, i, s, arr = (res[0] && res[0].data) || [];
      for (i = 0; i < arr.length; i++) {
        s = arr[i];
        var d = s && s.location && s.location.directory;
        if (!d) continue;
        var k = norm(d);
        if (!k) continue;
        if (!byDir[k]) byDir[k] = { dir: d, n: 0, t: 0, title: '' };
        byDir[k].n++;
        var tm = (s.time && (s.time.updated || s.time.created)) || 0;
        if (tm >= byDir[k].t) { byDir[k].t = tm; byDir[k].title = s.title || ''; }
      }
      var regs = {};
      var pj = res[1] || [];
      for (i = 0; i < pj.length; i++) {
        if (!pj[i] || !pj[i].worktree) continue;
        var k2 = norm(pj[i].worktree);
        if (k2) regs[k2] = { name: pj[i].name || base(pj[i].worktree), dir: pj[i].worktree };
      }
      var rows = Object.keys(byDir).map(function (k) {
        return { dir: byDir[k].dir, n: byDir[k].n, title: byDir[k].title, t: byDir[k].t };
      });
      Object.keys(regs).forEach(function (k) {
        if (!byDir[k] && k) rows.push({ dir: regs[k].dir, n: 0, title: '', t: 0, name: regs[k].name, raw: true });
      });
      rows.sort(function (a, b) { return b.t - a.t; });
      projCache = rows;
      renderSide();
    }).catch(function (e) {
      peEv('ffproj');
      say(e.message === 'LOGIN' ? 'Log in again, then reopen.' : 'Could not load projects.', true);
    });
  }

  /* ---------- sidebar ---------- */
  var expSets = { od: true, pc: false, yp: true };
  function renderSide() {
    if (!sideEl) return;
    var h = '<div class="pe-tree">';
    h += treeRow('home', '🏠', 'Home', HOME || '');
    h += '<div class="pe-tsec" data-exp="od"><span class="pe-caret">' + (expSets.od ? '▾' : '▸') + '</span>☁️ OneDrive</div>';
    if (expSets.od && HOME) {
      h += treeRow(HOME + '/Desktop', '🖥️', 'Desktop') + treeRow(HOME + '/Documents', '📄', 'Documents') +
           treeRow(HOME + '/Downloads', '📥', 'Downloads');
    }
    h += '<div class="pe-tsec" data-exp="pc"><span class="pe-caret">' + (expSets.pc ? '▾' : '▸') + '</span>💻 This PC</div>';
    if (expSets.pc) h += treeRow('C:/', '💽', 'Local Disk (C:)');
    h += '<div class="pe-tsec" data-exp="yp"><span class="pe-caret">' + (expSets.yp ? '▾' : '▸') + '</span>📁 Your projects</div>';
    if (expSets.yp && projCache) {
      projCache.slice(0, 30).forEach(function (p) {
        h += '<div class="pe-trow" data-jump="' + esc(p.dir) + '"><span class="pe-tind"></span>📁 ' + esc(base(p.dir)) + '</div>';
      });
    }
    h += '</div>';
    sideEl.innerHTML = h;
    sideEl.style.display = sideOpen ? '' : 'none';
  }
  function treeRow(dir, ic, label) {
    var sel = cur && norm(cur) === norm(dir) ? ' sel' : '';
    return '<div class="pe-trow' + sel + '" data-jump="' + esc(dir) + '">' + ic + ' ' + esc(label) + '</div>';
  }

  /* ---------- browse ---------- */
  function crumbs(dir) {
    var parts = String(dir).replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    var h = '<button class="pe-link" data-home="1">🏠</button>', acc = '';
    parts.forEach(function (p, i) {
      if (i === 0 && /^[A-Za-z]:$/.test(p)) { acc = p; h += '<button class="pe-link" data-jump="' + esc(acc) + '/">' + esc(p) + '</button>'; }
      else { acc += '/' + p; h += '<button class="pe-link" data-jump="' + esc(acc) + '">' + esc(p || '/') + '</button>'; }
      if (i < parts.length - 1) h += '<span class="pe-sep">›</span>';
    });
    return h;
  }
  function navTo(dir, push) {
    if (push !== false && dir !== cur) {
      hist = hist.slice(0, hi + 1);
      hist.push(dir);
      hi = hist.length - 1;
    }
    browse(dir);
  }
  function browse(dir) {
    if (!dir) return;
    cur = dir; searchMode = false; previewMode = false;
    if (searchEl) searchEl.value = '';
    titleEl.textContent = base(dir) || 'PC files';
    var tn = root.querySelector('#pe-tabname');
    if (tn) tn.textContent = base(dir) || 'Home';
    crumbEl.innerHTML = crumbs(dir);
    renderSide();
    say('Loading…');
    api('/file?' + new URLSearchParams({ path: '', directory: dir })).then(function (items) {
      say('');
      var dirs = [], files = [];
      (items || []).forEach(function (e) {
        if (!e || e.ignored) return;
        if (e.type === 'directory') dirs.push(e); else files.push(e);
      });
      dirs.sort(function (a, b) { return sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name); });
      files.sort(function (a, b) { return sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name); });
      var h = '<div class="pe-sec">This folder <button class="pe-btn pe-sm" data-open="' + esc(dir) + '">Open</button></div>';
      if (viewMode === 'grid') {
        h += '<div class="pe-grid">';
        dirs.forEach(function (e) {
          h += '<div class="pe-tile" data-drill="' + esc(e.absolute) + '"><div class="pe-tic">' + FOLDER_SVG + '</div>' +
            '<div class="pe-tnm">' + esc(e.name) + '</div>' +
            '<button class="pe-btn pe-sm" data-open="' + esc(e.absolute) + '">Open</button></div>';
        });
        files.forEach(function (e) {
          h += '<div class="pe-tile" data-prev="' + esc(e.name) + '"><div class="pe-tic">' + FILE_SVG + '</div>' +
            '<div class="pe-tnm">' + esc(e.name) + '</div></div>';
        });
        h += '</div>';
      } else {
        dirs.forEach(function (e) {
          h += '<div class="pe-row" data-drill="' + esc(e.absolute) + '"><span class="pe-ic">📁</span>' +
            '<span class="pe-nm">' + esc(e.name) + '</span>' +
            '<button class="pe-btn pe-sm" data-open="' + esc(e.absolute) + '">Open</button></div>';
        });
        files.forEach(function (e) {
          h += '<div class="pe-row" data-prev="' + esc(e.name) + '"><span class="pe-ic">📄</span>' +
            '<span class="pe-nm">' + esc(e.name) + '</span><span></span></div>';
        });
      }
      if (!dirs.length && !files.length) h += '<div class="pe-empty">This folder is empty</div>';
      listEl.innerHTML = h;
      statusEl.textContent = (dirs.length + files.length) + ' items';
    }).catch(function (e) {
      peEv('ffile');
      say(e.message === 'LOGIN' ? 'Log in again, then reopen.' : 'Cannot open folder.', true);
    });
  }

  /* ---------- search ---------- */
  function doSearch(q) {
    if (!q) { if (cur) browse(cur); return; }
    searchMode = true; previewMode = false;
    titleEl.textContent = 'Search';
    crumbEl.innerHTML = '<span class="pe-sub">results for “' + esc(q) + '”</span>';
    say('Searching…');
    home().then(function (h) {
      return api('/find/file?' + new URLSearchParams({ query: q, dirs: 'true', limit: 50, directory: h.replace(/\\/g, '/') }));
    }).then(function (res) {
      say('');
      var h = '';
      if (!res || !res.length) h += '<div class="pe-empty">No matches</div>';
      (res || []).slice(0, 50).forEach(function (r) {
        var abs = joinAbs(HOME, r);
        var isDir = /[\\/]$/.test(r);
        h += '<div class="pe-row" ' + (isDir ? 'data-drill="' + esc(abs) + '"' : 'data-sfile="' + esc(abs) + '"') + '>' +
          '<span class="pe-ic">' + (isDir ? '📁' : '📄') + '</span><span class="pe-nm">' + esc(r) + '</span>' +
          (isDir ? '<button class="pe-btn pe-sm" data-open="' + esc(abs) + '">Open</button>' : '<span></span>') + '</div>';
      });
      listEl.innerHTML = h;
      statusEl.textContent = ((res || []).length) + ' results';
    }).catch(function (e) {
      peEv('ffind');
      say(e.message === 'LOGIN' ? 'Log in again, then reopen.' : 'Search failed.', true);
    });
  }

  /* ---------- file preview ---------- */
  function preview(abs) {
    var d = parentDir(abs) || HOME;
    var name = base(abs);
    previewMode = true;
    say('Loading preview…');
    api('/file/content?' + new URLSearchParams({ path: name, directory: d })).then(function (r) {
      say('');
      var body = (r && r.type === 'text' && r.content) ? r.content.slice(0, 8000) : '';
      listEl.innerHTML = '<div class="pe-row" data-back="1"><span class="pe-ic">⬆️</span><span class="pe-nm">Back</span><span></span></div>' +
        '<div class="pe-sec">' + esc(name) + '</div>' +
        (body ? '<pre class="pe-pre">' + esc(body) + '</pre>' : '<div class="pe-empty">No text preview</div>');
      statusEl.textContent = name;
    }).catch(function () {
      peEv('ffprev');
      say('Cannot preview file.', true);
    });
  }

  /* ---------- open as project ---------- */
  function seedDirs(dirs, makeLast) {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null') ||
        { list: [], projects: {}, lastProject: {}, recentlyClosed: {} };
      s.projects = s.projects || {};
      s.projects.local = s.projects.local || [];
      var fresh = [];
      dirs.forEach(function (dir) {
        if (!dir || !norm(dir)) return;
        fresh.push(dir);
      });
      s.projects.local = s.projects.local.filter(function (p) {
        return !fresh.some(function (d) { return norm(p.worktree) === norm(d); });
      });
      fresh.forEach(function (dir) {
        s.projects.local.push({ worktree: dir, expanded: true });
      });
      s.lastProject = s.lastProject || {};
      s.lastProject.local = makeLast || dirs[dirs.length - 1];
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch (e) { /* proceed to reload anyway */ }
  }
  function openProject(dir) {
    if (projCache) {
      for (var i = 0; i < projCache.length; i++) {
        if (norm(projCache[i].dir) === norm(dir)) { dir = projCache[i].dir; break; }
      }
    }
    seedDirs([dir], dir);
    say('Opening…');
    setTimeout(function () { location.reload(); }, 250);
  }
  function openAll() {
    if (!projCache || !projCache.length) return;
    seedDirs(projCache.map(function (p) { return p.dir; }), projCache[0].dir);
    say('Opening all projects…');
    setTimeout(function () { location.reload(); }, 250);
  }

  /* ---------- tap handling ---------- */
  function onTap(e) {
    var t = e.target;
    var openBtn = t.closest('[data-open]');
    if (openBtn) { e.preventDefault(); e.stopPropagation(); openProject(openBtn.getAttribute('data-open')); return; }
    var drill = t.closest('[data-drill]');
    if (drill && !t.closest('[data-open]')) { navTo(drill.getAttribute('data-drill')); return; }
    var jump = t.closest('[data-jump]');
    if (jump) { navTo(jump.getAttribute('data-jump')); return; }
    var prev = t.closest('[data-prev]');
    if (prev && cur) { preview(joinAbs(cur, prev.getAttribute('data-prev'))); return; }
    var sf = t.closest('[data-sfile]');
    if (sf) { preview(sf.getAttribute('data-sfile')); return; }
    if (t.closest('[data-back]')) { if (cur) browse(cur); return; }
    if (t.closest('[data-home]')) { if (HOME) navTo(HOME); return; }
    var exp = t.closest('[data-exp]');
    if (exp) {
      var k = exp.getAttribute('data-exp');
      expSets[k] = !expSets[k];
      renderSide();
      return;
    }
    var act = t.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'close') hide();
      else if (a === 'menu') { sideOpen = !sideOpen; renderSide(); }
      else if (a === 'open-cur' && cur) openProject(cur);
      else if (a === 'open-all') openAll();
      else if (a === 'back' && hi > 0) { hi--; browse(hist[hi]); }
      else if (a === 'fwd' && hi < hist.length - 1) { hi++; browse(hist[hi]); }
      else if (a === 'up') { var u = cur && parentDir(cur); if (u) navTo(u); }
      else if (a === 'refresh' && cur) browse(cur);
      else if (a === 'sort') { sortDesc = !sortDesc; if (cur) browse(cur); }
      else if (a === 'view') { viewMode = viewMode === 'grid' ? 'list' : 'grid'; if (cur) browse(cur); }
      return;
    }
  }

  /* ---------- intercept Add-project buttons (ONLY these) ---------- */
  function isAddProject(b) {
    if (!b || b.tagName !== 'BUTTON') return false;
    if (b.textContent.trim().toLowerCase() === 'add project') return true;
    var al = (b.getAttribute('aria-label') || '').trim().toLowerCase();
    if (al === 'add project') return true;
    var da = (b.getAttribute('data-action') || '').toLowerCase();
    return da.indexOf('add-project') !== -1;
  }
  function tryIntercept(e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (isAddProject(b)) {
      e.preventDefault();
      e.stopPropagation();
      lastIntercept = Date.now();
      openOverlay();
      return true;
    }
    return false;
  }
  function isAddBtn(b) {
    return isAddProject(b) && !b.__pe_armed;
  }
  function armButtons() {
    var all = document.querySelectorAll('button'), i, b;
    for (i = 0; i < all.length; i++) {
      b = all[i];
      if (!isAddBtn(b)) continue;
      try {
        var c = b.cloneNode(true);
        b.__pe_armed = true;
        b.parentNode.replaceChild(c, b);
        b = c;
        b.__pe_armed = true;
      } catch (e) { b.__pe_armed = true; }
      (function (el) {
        el.addEventListener('pointerdown', function (e) {
          e.preventDefault(); e.stopPropagation();
          lastIntercept = Date.now();
          openOverlay();
        }, true);
        el.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          lastIntercept = Date.now();
          openOverlay();
        }, true);
      })(b);
    }
  }
  window.addEventListener('pointerdown', function (e) { tryIntercept(e); }, true);
  window.addEventListener('click', function (e) { tryIntercept(e); }, true);
  var armT = 0;
  function armSoon() {
    var n = Date.now();
    if (n - armT < 400) return;
    armT = n;
    armButtons();
  }
  armButtons();
  new MutationObserver(function () {
    armSoon();
    if (Date.now() - lastIntercept > 1500) return;
    var dlg = document.querySelector('[role="dialog"]');
    if (dlg && /open project/i.test(dlg.textContent.slice(0, 200))) {
      var c = dlg.querySelector('button[aria-label="Close"], button');
      if (c) c.click();
      openOverlay();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- live sync: PC -> phone without manual reload ----------
     Polls read-only endpoints; reloads only on real change, never with
     an unsent draft (shows a tap-to-refresh pill instead). */
  (function liveSync() {
    var POLL_MS = 7000, timer = null;
    var base = null, lastPath = location.pathname;
    function curSessionId() {
      var m = location.pathname.match(/\/session\/([^\/\?#]+)/);
      return m ? m[1] : null;
    }
    function hasDraft() {
      var all = document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.closest && el.closest('#pe-root')) continue;
        var v = el.isContentEditable ? el.textContent : el.value;
        if (v && v.trim()) return true;
      }
      return false;
    }
    function pill(show) {
      var p = document.getElementById('pe-live');
      if (!show) { if (p) p.remove(); return; }
      if (p) return;
      p = document.createElement('button');
      p.id = 'pe-live';
      p.textContent = '↑ New activity — tap to refresh';
      p.addEventListener('click', function () { location.reload(); });
      document.body.appendChild(p);
    }
    function tick() {
      if (document.hidden) return;
      var sid = curSessionId();
      function stop401(e) {
        if (e && String(e.message || '').indexOf('401') !== -1 && timer) { clearInterval(timer); timer = null; }
      }
      if (sid) {
        api('/session/' + encodeURIComponent(sid) + '/message?limit=1').then(function (arr) {
          var last = (arr && arr.length && arr[arr.length - 1]) || null;
          var id = last && (last.id || (last.info && last.info.id));
          if (!id) return;
          if (base === null || base.sess !== sid) { base = { sess: sid, id: id }; pill(false); return; }
          if (base.id !== id) {
            if (hasDraft()) { pill(true); peEv('pill'); }
            else { peEv('upd'); location.reload(); }
          }
        }).catch(stop401);
      } else {
        api('/api/session?limit=25&order=desc').then(function (res) {
          var arr = (res && res.data) || [];
          var sig = arr.map(function (s) {
            var tm = (s.time && (s.time.updated || s.time.created)) || 0;
            return s.id + ':' + tm;
          }).join('|');
          if (base === null || base.sess !== null) { base = { sess: null, id: sig }; pill(false); return; }
          if (base.id !== sig) {
            if (hasDraft()) { pill(true); peEv('pill'); }
            else { peEv('upd'); location.reload(); }
          }
        }).catch(stop401);
      }
    }
    timer = setInterval(function () {
      if (location.pathname !== lastPath) { lastPath = location.pathname; base = null; pill(false); }
      try { tick(); } catch (e) {}
    }, POLL_MS);
    peEv('live');
  })();

  /* ---------- mobile attachments: picker button + chip-x fix ----------
     The app's attach flow is paste/drag-drop only (no picker button) and
     its remove-x is hover-only on a 16px dot (invisible + untappable on
     touch). This adds: a floating attach button (native picker, works on
     iOS) feeding the app's own drop pipeline, and a touch-proof x. */
  (function attach() {
    var toastT = null;
    function toast(t) {
      var d = document.getElementById('pe-toast');
      if (!d) {
        d = document.createElement('div');
        d.id = 'pe-toast';
        document.body.appendChild(d);
      }
      d.textContent = t;
      d.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(function () { d.classList.remove('on'); }, 3500);
    }
    // touch-proof remove: real finger press re-fires as real click on badge
    window.addEventListener('pointerdown', function (e) {
      var b = e.target && e.target.closest ?
        e.target.closest('[data-slot="prompt-attachments"] button') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      try { b.click(); } catch (x) {}
    }, true);
    // attach button + native picker
    var btn = document.createElement('button');
    btn.id = 'pe-attach';
    btn.textContent = '📎';
    btn.setAttribute('aria-label', 'Attach images or files');
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.setAttribute('accept', 'image/*,video/*,.pdf,.txt,.md,.csv,.json,.log');
    inp.style.display = 'none';
    document.body.appendChild(btn);
    document.body.appendChild(inp);
    btn.addEventListener('click', function () { inp.click(); });
    // only show where a chat composer can exist (session views)
    function placeBtn() {
      btn.style.display = /\/session\//.test(location.pathname) ? '' : 'none';
    }
    placeBtn();
    setInterval(placeBtn, 2000);
    inp.addEventListener('change', function () {
      var files = inp.files ? Array.prototype.slice.call(inp.files) : [];
      inp.value = '';
      if (!files.length) return;
      peEv('got' + files.length);
      var big = files.filter(function (f) { return f.size > 100 * 1024 * 1024; });
      if (big.length) {
        toast('File too big for chat (' + big[0].name.slice(0, 24) + ') — use filedrop instead');
        peEv('dropbig');
        files = files.filter(function (f) { return f.size <= 100 * 1024 * 1024; });
        if (!files.length) return;
      }
      // find the composer form (else document body); app reads .files
      var ta = document.querySelector('form textarea');
      var target = (ta && ta.closest('form')) || document.body;
      try {
        var dt = new DataTransfer();
        files.forEach(function (f) { dt.items.add(f); });
        var ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(ev);
        peEv('drop' + files.length);
        toast(files.length === 1 ? 'Attached — tap send' : files.length + ' attached — tap send');
      } catch (x) {
        peEv('droperr');
        toast('Could not attach — copy + paste into the chat instead');
      }
    });
  })();
})();
