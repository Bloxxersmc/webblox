(() => {
  const JAR_KEY = 'cobalt-cookies';
  const SESSION_DOMAINS = ['roblox.com', 'rbxcdn.com', 'robloxlabs.com'];
  const SESSION_CHECK_URL = 'https://users.roblox.com/v1/users/authenticated';
  const ROBLOX_HOST = /(^|\.)(roblox\.com|rbxcdn\.com|robloxlabs\.com)$/;
  const SKIP_RESPONSE_HEADERS = new Set([
    'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie',
    'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers',
    'access-control-allow-methods', 'access-control-expose-headers', 'cross-origin-opener-policy',
    'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'strict-transport-security',
  ]);

  function hasSession() {
    try { return JSON.parse(localStorage.getItem(JAR_KEY) || '[]').some(c => c.n === '.ROBLOSECURITY'); } catch { return false; }
  }

  function storeSession(value) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(JAR_KEY) || '[]'); } catch {}
    all = all.filter(c => c.n !== '.ROBLOSECURITY');
    for (const d of SESSION_DOMAINS) {
      all.push({ n: '.ROBLOSECURITY', v: value, d, h: false, p: '/', s: true, o: true, e: 0, ss: 'none' });
    }
    localStorage.setItem(JAR_KEY, JSON.stringify(all));
  }

  const ROBLOSECURITY_PREFIX = '_|WARNING:-DO-NOT-SHARE-THIS.';
  const MARK = '<svg viewBox="157 157 710 710" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M307.201 157.281L157.281 716.799L716.799 866.719L866.719 307.201L307.201 157.281ZM569.242 611.157L412.893 569.242L454.807 412.893L611.219 454.807L569.242 611.157Z"/></svg>';

  function forgetSession() {
    try {
      const kept = JSON.parse(localStorage.getItem(JAR_KEY) || '[]').filter(c => c.n !== '.ROBLOSECURITY');
      localStorage.setItem(JAR_KEY, JSON.stringify(kept));
    } catch {}
  }

  async function sessionAccepted() {
    try {
      const r = await cb_fetch(SESSION_CHECK_URL, {
        method: 'GET',
        headers: { origin: 'https://www.roblox.com', referer: 'https://www.roblox.com/' },
        redirect: 'follow',
      });
      return r.status !== 401;
    } catch {
      return true;
    }
  }

  const askForSession = expired => new Promise(resolve => {
    const form = document.createElement('form');
    form.className = 'session-prompt';
    form.noValidate = true;
    form.setAttribute('aria-labelledby', 'session-title');
    form.innerHTML =
      '<header class="session-top">' +
        '<div class="session-logo" role="img" aria-label="WebBlox">' + MARK + '</div>' +
        (window.WEBLOX_SERVER ? '<a class="session-switch" href="/?mode=node">Use local server</a>' : '') +
      '</header>' +
      '<div class="session-body">' +
        '<h1 id="session-title">' + (expired ? 'Your session expired' : 'Sign in') + '</h1>' +
        '<button class="session-submit session-roblox" type="button">Sign in with Roblox</button>' +
        '<p class="session-or"><span>or use a cookie</span></p>' +
        '<div class="session-field">' +
          '<label for="session-cookie">.ROBLOSECURITY</label>' +
          '<input id="session-cookie" name="cookie" type="password" autocomplete="off" spellcheck="false" aria-describedby="session-error">' +
          '<p class="session-error" id="session-error" role="alert"></p>' +
        '</div>' +
        '<button class="session-submit session-secondary" type="submit">Sign in with cookie</button>' +
      '</div>';
    // Roblox's own sign-in screen (username and password, Quick Sign In) runs in Roblox's launcher.
    // The single-file launcher opens it in its game frame; elsewhere it's the engine page.
    form.querySelector('.session-roblox').addEventListener('click', () => {
      if (window.webbloxSignIn) return window.webbloxSignIn();
      const next = new URLSearchParams({ launcher: 'roblox', signin: '1' });
      for (const name of ['mode', 'wisp', 'flagset']) if (PAGE_PARAMS.has(name)) next.set(name, PAGE_PARAMS.get(name));
      location.href = '/?' + next;
    });
    const input = form.querySelector('input');
    const error = form.querySelector('.session-error');
    const fail = message => {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    const submit = form.querySelector('.session-secondary');
    form.onsubmit = async e => {
      e.preventDefault();
      const v = input.value.trim().replace(/^\.ROBLOSECURITY=/, '');
      if (!v) return fail('Paste your .ROBLOSECURITY value.');
      if (!v.startsWith(ROBLOSECURITY_PREFIX)) return fail("That isn't a .ROBLOSECURITY value.");
      submit.disabled = true;
      storeSession(v);
      const accepted = await sessionAccepted();
      submit.disabled = false;
      if (!accepted) {
        forgetSession();
        return fail('Roblox rejected that session.');
      }
      try {
        Object.keys(localStorage).filter(key => /^webblox\.launcher\.(home|shell)/.test(key)).forEach(key => localStorage.removeItem(key));
      } catch {}
      form.remove();
      resolve();
    };
    const mount = () => {
      document.body.appendChild(form);
      input.focus();
    };
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = (self.__WB||'/')+'launcher/session.css';
    sheet.onload = sheet.onerror = () => document.body ? mount() : addEventListener('DOMContentLoaded', mount);
    document.head.appendChild(sheet);
  });

  // Roblox's own launcher is never held up by the cookie prompt: signed out, it shows Roblox's sign-in
  // screen, and the session Roblox sets lands in the relay's cookie jar like any other cookie.
  const PAGE_PARAMS = new URLSearchParams(location.search);
  const ROBLOX_LAUNCHER = PAGE_PARAMS.get('launcher') === 'roblox';
  const sessionReady = (async () => {
    const saved = hasSession();
    if (saved && await sessionAccepted()) return;
    if (saved) forgetSession();
    if (ROBLOX_LAUNCHER) return watchSignIn();
    await askForSession(saved);
  })();

  // Opened to sign in: once Roblox has set the session, go back to WebBlox's launcher. In the
  // single-file launcher's game frame that hands control back to the file, which reloads signed in.
  function watchSignIn() {
    if (PAGE_PARAMS.get('signin') !== '1') return;
    const timer = setInterval(() => {
      if (!hasSession()) return;
      clearInterval(timer);
      const back = new URLSearchParams();
      for (const name of ['mode', 'wisp', 'flagset']) if (PAGE_PARAMS.has(name)) back.set(name, PAGE_PARAMS.get(name));
      setTimeout(() => location.replace((self.__WB||'/')+'launcher/' + (back.size ? '?' + back : '')), 400);
    }, 500);
  }

  window.webbloxSessionReady = sessionReady;

  const spoofNativeUa = headers => {
    const copy = { ...headers };
    if (copy['rbx-user-agent']) {
      copy['rbx-user-agent'] = copy['rbx-user-agent']
        .replace(/Roblox\/Web\s+(?:\w+\s+Desktop|Unknown)/, 'Roblox/WinInet')   // Chromebooks report "Unknown" instead of "<OS> Desktop"
        .replace(/\s*Browser\/\S+/, '');
    }
    return copy;
  };

  const cache = new Map();
  const CACHE_LIMIT = 512 * 1024 * 1024;
  const ENTRY_LIMIT = 64 * 1024 * 1024;
  let cacheBytes = 0;
  const CACHEABLE_HOST = /(^|\.)(rbxcdn\.com|assetdelivery\.roblox\.com|contentdelivery\.roblox\.com|thumbnails\.roblox\.com|assetgame\.roblox\.com|clientsettingscdn\.roblox\.com|clientsettings\.roblox\.com|users\.roblox\.com)$/i;

  async function cacheKey(method, url, body) {
    const u = new URL(url);
    if (!CACHEABLE_HOST.test(u.hostname)) return null;
    if (method === 'GET' && ASSET_HOST.test(u.hostname)) return null;
    if (method === 'GET' || method === 'HEAD') return `G ${url}`;
    if (method === 'POST' && (/\/v1\/assets\/batch$/.test(u.pathname) || /\/v1\/users$/.test(u.pathname))) {
      const digest = await crypto.subtle.digest('SHA-1', body || new ArrayBuffer(0));
      return `P ${url} ${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
    }
    return null;
  }

  function cacheTtl(method, headers) {
    const cc = headers.get('cache-control') || '';
    const m = cc.match(/max-age=(\d+)/i);
    if (m) return Math.min(Number(m[1]), 30 * 24 * 3600) * 1000;
    if (/no-store/i.test(cc)) return 0;
    if (method === 'POST') return 10 * 60 * 1000;
    if (/no-cache/i.test(cc)) return 60 * 1000;
    return 60 * 60 * 1000;
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) { cache.delete(key); cacheBytes -= hit.body.byteLength; return null; }
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function cacheSet(key, entry, ttl) {
    if (!ttl || entry.status !== 200 || entry.body.byteLength > ENTRY_LIMIT) return;
    if (cache.has(key)) { cacheBytes -= cache.get(key).body.byteLength; cache.delete(key); }
    cache.set(key, { ...entry, expires: Date.now() + ttl });
    cacheBytes += entry.body.byteLength;
    while (cacheBytes > CACHE_LIMIT && cache.size > 1) {
      const [k, v] = cache.entries().next().value;
      cache.delete(k);
      cacheBytes -= v.body.byteLength;
    }
  }

  const ASSET_CACHE = 'webblox-assets-2';
  const ASSET_HOST = /(^|\.)rbxcdn\.com$/i;
  const ASSET_MAX_AGE = 7 * 24 * 3600 * 1000;
  const ASSET_ENTRIES = 5000;
  const PREFETCH_CONCURRENCY = 16;
  let assetCache = null;
  let assetWrites = 0;
  const openAssets = () => (assetCache ??= caches.open(ASSET_CACHE));
  const isAsset = (method, target, headers) => method === 'GET' && ASSET_HOST.test(target.hostname) && !headers.range;
  const assetKey = href => {
    const m = new URL(href).pathname.match(/\/([0-9a-f]{32})$/i);
    return m ? `https://rbxcdn.webblox/${m[1].toLowerCase()}` : href;
  };

  function responseHeaders(headers) {
    const out = [];
    for (const [k, v] of headers) if (!SKIP_RESPONSE_HEADERS.has(k)) out.push([k, v]);
    return out;
  }

  async function storeAsset(href, r, resHeaders) {
    const key = assetKey(href);
    const ttl = key !== href ? ASSET_MAX_AGE : Math.min(cacheTtl('GET', r.headers), ASSET_MAX_AGE);
    if (r.status !== 200 || !ttl || r.body.byteLength > ENTRY_LIMIT) return;
    const body = r.body.slice(0);
    try {
      const cache = await openAssets();
      await cache.put(key, new Response(body, { status: 200, headers: [...resHeaders, ['x-webblox-expires', String(Date.now() + ttl)]] }));
      if (++assetWrites % 250 === 0) {
        const keys = await cache.keys();
        for (const req of keys.slice(0, Math.max(0, keys.length - ASSET_ENTRIES))) cache.delete(req);
      }
    } catch {}
  }

  async function cachedAsset(key) {
    try {
      const hit = await (await openAssets()).match(key);
      if (!hit || !(Number(hit.headers.get('x-webblox-expires')) > Date.now())) return null;
      return { status: hit.status, statusText: hit.statusText, headers: [...hit.headers], body: await hit.arrayBuffer() };
    } catch {
      return null;
    }
  }

  const prefetchQueue = [];
  const prefetchJobs = new Map();
  let prefetchActive = 0;

  function prefetchLocations(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const urls = [];
      if (typeof item.location === 'string') urls.push(item.location);
      if (Array.isArray(item.locations)) {
        for (const loc of item.locations) if (loc && typeof loc.location === 'string') urls.push(loc.location);
      }
      for (const href of urls) {
        let host;
        try { host = new URL(href).hostname; } catch { continue; }
        const key = assetKey(href);
        if (!ASSET_HOST.test(host) || prefetchJobs.has(key)) continue;
        const job = { href, key, started: false };
        job.promise = new Promise(resolve => { job.resolve = resolve; });
        prefetchJobs.set(key, job);
        prefetchQueue.push(job);
      }
    }
    pumpPrefetch();
  }

  async function prefetchJob(job) {
    try {
      const hit = await cachedAsset(job.key);
      if (hit) return hit;
      // Through the service worker, which fetches the CDN directly and caches the file, or asks
      // this page to relay it (with fallback set, so it does not wait on this job).
      const r = await fetch(job.href, { mode: 'cors', credentials: 'omit' });
      return { status: r.status, statusText: r.statusText, headers: [...r.headers], body: await r.arrayBuffer() };
    } catch {
      return null;
    }
  }

  function runPrefetch(job) {
    job.started = true;
    prefetchActive++;
    prefetchJob(job).then(job.resolve).finally(() => {
      prefetchActive--;
      prefetchJobs.delete(job.key);
      pumpPrefetch();
    });
  }

  function pumpPrefetch() {
    while (prefetchActive < PREFETCH_CONCURRENCY && prefetchQueue.length) {
      const job = prefetchQueue.shift();
      if (!job.started) runPrefetch(job);
    }
  }

  async function localAsset(href) {
    const key = assetKey(href);
    const job = prefetchJobs.get(key);
    if (!job) return cachedAsset(key);
    if (!job.started) runPrefetch(job);
    const r = await job.promise;
    return r && { status: r.status, statusText: r.statusText, headers: r.headers, body: r.body.slice(0) };
  }

  function qdmuxFqdn(joinScript) {
    const udmux = joinScript.UdmuxEndpoints && joinScript.UdmuxEndpoints[0];
    const nst = String(joinScript.NetStackTokenValue || '');
    if (!udmux || !nst || !joinScript.MachineAddress || !joinScript.NetStackPort) return null;
    let token = nst.toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) {
      try { token = [...atob(nst)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); } catch { return null; }
    }
    if (token.length !== 32) return null;
    const octets = udmux.Address.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !(n >= 0 && n <= 255))) return null;
    octets[3] += 1;
    const hex = list => list.map(n => n.toString(16).padStart(2, '0')).join('');
    const machine = joinScript.MachineAddress.split('.').map(Number);
    return `${token}-${hex(machine)}-${Number(joinScript.NetStackPort).toString(16)}.${hex(octets)}.qdmux.roblox.com`;
  }

  async function wisp(url, init) {
    const r = await cb_fetch(url, { ...init, redirect: 'follow' });
    return { status: r.status, statusText: r.statusText, headers: r.headers, body: await r.arrayBuffer() };
  }

  function jarNames(host) {
    try {
      return JSON.parse(localStorage.getItem(JAR_KEY) || '[]')
        .filter(c => host === c.d || (!c.h && host.endsWith('.' + c.d)))
        .map(c => c.n + '@' + c.d);
    } catch {
      return [];
    }
  }

  const LAUNCHER_JOIN = /(?:^|;\s*)launcher_join=(\d+):([gp]):([A-Za-z0-9-]+)(?::(\d+))?/;
  const LAUNCHER_JOIN_TTL = 120000;   // same lifetime as the launcher_join cookie

  function launcherJoin(url, body) {
    // The launcher leaves the chosen server in a cookie, or in sessionStorage when it runs from a file
    // and hands the game to a frame on another origin.
    let saved = '';
    try { saved = sessionStorage.getItem('webblox.launcherJoin') || ''; } catch {}
    // sessionStorage has no expiry of its own, so a server picked earlier in this tab would otherwise be
    // applied to every later join of that place (a stale private-server code is rejected as "not authorized").
    const savedAt = /:(\d+)$/.exec(saved);
    if (!savedAt || Date.now() - Number(savedAt[1]) > LAUNCHER_JOIN_TTL) saved = '';
    const match = /\/v1\/join-game$/.test(url) && (LAUNCHER_JOIN.exec(document.cookie) || (saved && LAUNCHER_JOIN.exec('launcher_join=' + saved)));
    if (!match) return { url, body };
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (String(parsed.placeId) !== match[1] || parsed.isTeleport) return { url, body };
      const server = match[2] === 'g' ? { gameId: match[3] } : { accessCode: match[3] };
      return {
        url: url.replace(/\/join-game$/, match[2] === 'g' ? '/join-game-instance' : '/join-private-game'),
        body: new TextEncoder().encode(JSON.stringify({ ...parsed, ...server })).buffer,
      };
    } catch {
      return { url, body };
    }
  }

  // Shows why Roblox refused a join right on the page, for browsers where the console is locked.
  async function reportJoin(status, json, url, body, headers) {
    const ok = !!(json && json.joinScript);
    let sent = {};
    try { sent = JSON.parse(new TextDecoder().decode(body)) || {}; } catch {}
    let who = 'unknown';
    try {
      const me = await wisp(SESSION_CHECK_URL, { method: 'GET', headers: spoofNativeUa({ origin: 'https://www.roblox.com', referer: 'https://www.roblox.com/' }) });
      if (me.status === 401) who = 'NOT signed in (no valid session)';
      else { const u = JSON.parse(new TextDecoder().decode(me.body)); who = u.name ? 'signed in as ' + u.name : 'status ' + me.status; }
    } catch { who = 'could not check (network problem reaching Roblox)'; }
    const mode = /join-private-game/.test(url) ? 'private server' : /join-game-instance/.test(url) ? 'specific server' : 'normal join';
    let exitIp = 'unknown';
    try { const ip = await wisp('https://api.ipify.org', { method: 'GET', headers: {} }); exitIp = new TextDecoder().decode(ip.body).trim().slice(0, 64); } catch {}
    const text = (ok ? 'Join OK. Roblox status: ' : 'Join refused. Roblox status: ') + (json && json.status != null ? json.status : r_(status)) +
      ' | message: ' + ((json && json.message) || 'none') + ' | ' + who + ' | join type: ' + mode +
      ' | placeId: ' + sent.placeId + ' | gameId: ' + (sent.gameId || 'none') + ' | teleport: ' + !!sent.isTeleport +
      '\nrelay exit IP: ' + exitIp + ' | page: ' + location.href +
      '\nbody: ' + JSON.stringify(sent).slice(0, 600) +
      '\ncookie names: ' + jarNames(new URL(url).hostname).join(', ') +
      '\nheaders: ' + Object.keys(headers || {}).filter(k => !/^(cookie|authorization)$/i.test(k)).map(k => k + '=' + String(headers[k]).slice(0, 80)).join(' ; ');
    console.log(ok ? '[gamejoin-ok]' : '[gamejoin-failed]', text);
    try {
      let box = document.getElementById('webblox-join-error');
      if (!box) {
        box = document.createElement('div');
        box.id = 'webblox-join-error';
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:' + (ok ? '#030' : '#300') + ';color:#fff;font:13px/1.4 sans-serif;padding:10px 12px;border-radius:6px;white-space:pre-wrap;word-break:break-word';
        (document.body || document.documentElement).appendChild(box);
      }
      box.style.background = ok ? '#030' : '#300';
      box.textContent = text;
      if (ok) setTimeout(() => box.remove(), 30000);
    } catch {}
  }
  const r_ = status => 'HTTP ' + status;

  async function handleGameJoin(url, method, headers, body) {
    ({ url, body } = launcherJoin(url, body));
    const r = await wisp(url, { method, headers: spoofNativeUa(headers), body });
    let json = null;
    try { json = JSON.parse(new TextDecoder().decode(r.body)); } catch {}
    console.log('[gamejoin]', url, r.status, JSON.stringify({
      status: json && json.status,
      message: json && json.message,
      hasJoinScript: !!(json && json.joinScript),
      cookies: jarNames(new URL(url).hostname),
    }));
    reportJoin(r.status, json, url, body, headers);
    if (r.status === 200 && json && json.joinScript && !json.joinScript.gameFqdn) {
      const fqdn = qdmuxFqdn(json.joinScript);
      if (fqdn) {
        json.joinScript.gameFqdn = fqdn;
        r.body = new TextEncoder().encode(JSON.stringify(json)).buffer;
      }
    }
    return r;
  }

  const APP_POLICY_URL = /^https:\/\/apis\.roblox\.com\/guac-v2\/v1\/bundles\/app-policy(?:[?#]|$)/;
  const APP_POLICY_OVERRIDES = { EnableWebViewSupport: true };
  function patchAppPolicy(r) {
    try {
      const policy = JSON.parse(new TextDecoder().decode(r.body));
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return r;
      Object.assign(policy, APP_POLICY_OVERRIDES);
      return { ...r, body: new TextEncoder().encode(JSON.stringify(policy)).buffer };
    } catch {
      return r;
    }
  }

  async function upstream({ url, method, headers, body, fallback }) {
    await sessionReady;
    const target = new URL(url);
    headers = { ...headers };
    delete headers.cookie;
    delete headers['content-length'];
    delete headers.referer;
    delete headers.origin;
    const isRoblox = ROBLOX_HOST.test(target.hostname);
    if (isRoblox) {
      headers.origin = 'https://www.roblox.com';
      headers.referer = 'https://www.roblox.com/';
      Object.assign(headers, spoofNativeUa(headers));
    } else {
      headers.origin = target.origin;
      headers.referer = target.origin + '/';
    }
    if (body && !body.byteLength) body = null;

    const asset = isAsset(method, target, headers);
    if (asset && !fallback) {
      const ready = await localAsset(url);
      if (ready) return ready;
    }

    const key = await cacheKey(method, url, body);
    if (key) {
      const hit = cacheGet(key);
      if (hit) return { status: hit.status, statusText: hit.statusText, headers: hit.headers, body: hit.body.slice(0) };
    }

    let r = (isRoblox && target.hostname === 'gamejoin.roblox.com' && method === 'POST')
      ? await handleGameJoin(url, method, headers, body)
      : await wisp(url, { method, headers, body });
    if (r.status === 200 && APP_POLICY_URL.test(url)) r = patchAppPolicy(r);

    const resHeaders = responseHeaders(r.headers);
    if (asset) storeAsset(url, r, resHeaders);
    if (r.status === 200 && method === 'POST' && /\/v1\/assets\/batch$/.test(target.pathname)) {
      try { prefetchLocations(JSON.parse(new TextDecoder().decode(r.body))); } catch {}
    }
    if (r.status >= 400) console.log(`[proxy] → ${r.status} ${method} ${target.hostname}${target.pathname}`);

    if (key) {
      let ttl = cacheTtl(method, r.headers);
      if (/\/v1\/(assets\/batch|users)$/.test(target.pathname) &&
          new TextDecoder().decode(r.body).includes('"errors"')) ttl = Math.min(ttl, 60 * 1000);
      cacheSet(key, { status: r.status, statusText: r.statusText, headers: resHeaders, body: r.body.slice(0) }, ttl);
    }
    return { status: r.status, statusText: r.statusText, headers: resHeaders, body: r.body };
  }

  // Used directly by the single-file launcher, which has no service worker of its own.
  window.webbloxUpstream = upstream;
  if (!navigator.serviceWorker || window.WEBBLOX_EMBED) return;

  navigator.serviceWorker.addEventListener('message', async event => {
    const msg = event.data;
    if (!msg || msg.type !== 'webblox-fetch') return;
    const port = event.ports[0];
    try {
      const r = await upstream(msg);
      port.postMessage({ ok: true, ...r }, [r.body]);
    } catch (err) {
      console.error('[proxy]', msg.method, msg.url, '-', err.message || err);
      port.postMessage({ ok: false, error: String(err.message || err) });
    }
  });
  navigator.serviceWorker.startMessages();
  // Tell the worker this window can relay. In a frame (the single-file launcher's game frame) it
  // cannot look for a top-level window to do it.
  const announce = () => navigator.serviceWorker.controller?.postMessage({ type: 'webblox-relay-ready' });
  announce();
  navigator.serviceWorker.addEventListener('controllerchange', announce);
})();
