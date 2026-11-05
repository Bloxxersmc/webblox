// Roblox's CDNs (*.rbxcdn.com, setup.rbxcdn.com included) answer cross-origin requests with
// Access-Control-Allow-Origin: *, so the Wisp-mode service workers download from them directly over
// the browser's own connection instead of through the Wisp relay. Anything that fails here (a network
// that blocks the CDN, a filter page without CORS headers) goes through the relay as before, and
// after repeated failures direct requests pause for a while so a blocked network doesn't pay twice.
// Loaded with importScripts by public/sw.js and the hosted service worker.
(function () {
  const HOST = /(^|\.)rbxcdn\.com$/i;
  const HEADERS_TIMEOUT_MS = 10000;
  const PAUSE_MS = 5 * 60 * 1000;
  const ASSET_CACHE = 'webblox-assets-2';            // shared with public/js/upstream.js
  const MAX_AGE = 7 * 24 * 3600 * 1000;
  const ENTRY_LIMIT = 64 * 1024 * 1024;
  const ENTRIES = 5000;
  const inflight = new Map();
  let failures = 0, pausedUntil = 0, writes = 0;

  function usable(url) {
    try { return HOST.test(new URL(url).hostname) && Date.now() >= pausedUntil; } catch { return false; }
  }

  // Resolves to the CDN's Response (any status), or null when the CDN could not be reached.
  async function get(url, { range, cache = 'default' } = {}) {
    if (!usable(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache, headers: range ? { range } : {}, signal: controller.signal });
      failures = 0;
      return response;
    } catch {
      if (++failures >= 3) { pausedUntil = Date.now() + PAUSE_MS; failures = 0; }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Content-addressed CDN files (a 32-hex path) never change, so they are kept in the asset cache.
  const hashKey = url => {
    const m = new URL(url).pathname.match(/\/([0-9a-f]{32})$/i);
    return m ? `https://rbxcdn.webblox/${m[1].toLowerCase()}` : null;
  };

  async function store(key, status, headers, body) {
    if (status !== 200 || body.size > ENTRY_LIMIT) return;
    try {
      const saved = new Headers(headers);
      saved.set('x-webblox-expires', String(Date.now() + MAX_AGE));
      const cache = await caches.open(ASSET_CACHE);
      await cache.put(key, new Response(body, { status: 200, headers: saved }));
      if (++writes % 250 === 0) {
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - ENTRIES))) cache.delete(old);
      }
    } catch {}
  }

  // A GET for a CDN file made by the engine or the page. Resolves to a Response, or null to relay.
  async function asset(request, url) {
    if (request.method !== 'GET' || !usable(url)) return null;
    const range = request.headers.get('range');
    if (range && !/^bytes=\d+-\d*$/.test(range)) return null;
    const key = !range && hashKey(url);
    if (!key) return get(url, { range });
    if (!inflight.has(key)) {
      const job = (async () => {
        const response = await get(url, { cache: 'no-store' });
        if (!response) return null;
        const body = await response.blob();
        const reply = { status: response.status, statusText: response.statusText, headers: [...response.headers], body };
        store(key, reply.status, reply.headers, body);
        return reply;
      })().catch(() => null).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const reply = await inflight.get(key);
    return reply && new Response(reply.body, { status: reply.status, statusText: reply.statusText, headers: reply.headers });
  }

  self.webbloxDirect = { asset, get, usable };
})();
