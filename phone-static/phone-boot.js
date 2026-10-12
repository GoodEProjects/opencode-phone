/* First-run auto-seed: if this browser never opened any project here,
   open every directory that already has sessions (plus registered projects),
   then reload once so the app boots with the PC's projects visible.
   Runs ONLY when the store key is absent; never touches existing state.
   Same-origin API calls reuse the browser's saved login. No passwords here. */
(function () {
  var LS_KEY = 'opencode.global.dat:server';
  function bev(w) {
    try { new Image().src = '/apple-touch-icon-v3.png?pb=' + w; } catch (e) {}
  }
  try {
    bev('init3');
    if (sessionStorage.getItem('pe-boot-done') || sessionStorage.getItem('pe-boot-try')) return;
    if (localStorage.getItem(LS_KEY)) { sessionStorage.setItem('pe-boot-done', '1'); bev('skip'); return; }
    sessionStorage.setItem('pe-boot-try', '1');
  } catch (e) { return; }

  function norm(p) { return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
  function get(p) {
    return fetch(p, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  Promise.all([
    get('/api/session?limit=5000&order=desc').catch(function () { return { data: [] }; }),
    get('/project').catch(function () { return []; })
  ]).then(function (res) {
    var seen = {}, dirs = [], i, s;
    var arr = (res[0] && res[0].data) || [];
    for (i = 0; i < arr.length; i++) {
      s = arr[i];
      var d = s && s.location && s.location.directory;
      if (!d) continue;
      var k = norm(d);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      dirs.push(d);
    }
    var pj = res[1] || [];
    for (i = 0; i < pj.length; i++) {
      if (!pj[i] || !pj[i].worktree) continue;
      var k2 = norm(pj[i].worktree);
      if (!k2 || seen[k2]) continue;
      seen[k2] = 1;
      dirs.push(pj[i].worktree);
    }
    if (!dirs.length) { bev('empty'); return; }
    // most-recent session dir first (becomes the selected project)
    var latest = {}, tm, key;
    for (i = 0; i < arr.length; i++) {
      s = arr[i];
      if (!s || !s.location || !s.location.directory) continue;
      key = norm(s.location.directory);
      tm = (s.time && (s.time.updated || s.time.created)) || 0;
      if (tm >= (latest[key] || 0)) latest[key] = tm;
    }
    dirs.sort(function (a, b) { return (latest[norm(b)] || 0) - (latest[norm(a)] || 0); });
    var store = { list: [], projects: { local: [] }, lastProject: { local: dirs[0] }, recentlyClosed: {} };
    dirs.forEach(function (d) { store.projects.local.push({ worktree: d, expanded: true }); });
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { bev('wrterr'); return; }
    bev('seed' + dirs.length);
    location.reload();
  }).catch(function () { bev('fetchfail'); /* boot with empty home rather than loop */ });
})();
