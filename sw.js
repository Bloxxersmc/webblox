// Service worker for the hosted copy of WebBlox (Wisp mode on a static CDN such as jsDelivr).
// It serves the app from its own folder with the isolation headers the engine's threads need,
// builds the engine files from Roblox's official files plus WebBlox's patches, and relays
// Roblox requests through the page's Wisp transport like public/sw.js does.
const BASE = new URL('./', self.location.href).pathname;                // e.g. /gh/user/repo@sha/
importScripts('hosted-rbxm.js', 'hosted-fzstd.js', 'js/direct-cdn.js');  // model chunks, Zstandard, Roblox's CDNs
const CDN_PATHS = /^\/(gh|npm|wp|combine|esm)\//;                       // other packages on the same CDN
// COOP + COEP isolate a top-level page. Document-Isolation-Policy also isolates a page in a frame
// whose parent is not isolated, which is how the single-file launcher runs games: its own page is a
// local file, which can never be isolated, and the game frame needs isolation for the engine's threads.
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Document-Isolation-Policy': 'isolate-and-require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};
const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', wasm: 'application/wasm', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', ogg: 'audio/ogg', mp3: 'audio/mpeg', webm: 'video/webm',
};
const typeOf = path => TYPES[/\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase()] || 'application/octet-stream';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  pruneEngineCache().catch(() => {});
})()));

// --- paths -----------------------------------------------------------------------------------
// The app uses root-relative paths (/engine/..., /js/...). Requests for them from our pages arrive
// here wherever they point, so they are read as paths inside BASE.
function appPath(url) {
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith(BASE)) return '/' + url.pathname.slice(BASE.length);
  if (BASE !== '/' && CDN_PATHS.test(url.pathname)) return null;
  return url.pathname;
}
const own = path => BASE + path.replace(/^\//, '');

// jsDelivr is reachable under several hosts. If this one stops answering, the worker's own files come
// from the next one for the rest of its life.
const HOSTS = ['cdn.jsdelivr.net', 'gcore.jsdelivr.net', 'fastly.jsdelivr.net'];
let ownOrigin = self.location.origin;
async function fetchOwn(path, init) {
  const tried = new Set();
  for (;;) {
    try {
      return await fetch(ownOrigin + own(path), init);
    } catch (error) {
      tried.add(ownOrigin);
      const next = HOSTS.map(host => 'https://' + host).find(origin => !tried.has(origin));
      if (!HOSTS.includes(self.location.hostname) || !next) throw error;
      ownOrigin = next;
    }
  }
}

function isolate(response, type) {
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ISOLATION)) headers.set(key, value);
  if (type) headers.set('Content-Type', type);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const text = (status, body) => isolate(new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }));

// --- engine files ----------------------------------------------------------------------------
let sources;
const loadSources = () => (sources ??= fetchOwn('engine-sources.json').then(r => {
  if (!r.ok) throw new Error('engine-sources.json ' + r.status);
  return r.json();
}).catch(error => { sources = null; throw error; }));
const ENGINE_CACHE = 'webblox-engine-1';
const engineKey = entry => `https://webblox.engine/${entry.h}`;
const building = new Map();

async function pruneEngineCache() {
  const { files } = await loadSources();
  const wanted = new Set(Object.values(files).map(engineKey));
  const cache = await caches.open(ENGINE_CACHE);
  for (const request of await cache.keys()) if (!wanted.has(request.url) && request.url !== USED_KEY) await cache.delete(request);
}

async function gunzip(buffer) {
  return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function inflateRaw(buffer) {
  return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
}
function readVarint(data, at) {
  let value = 0, scale = 1;
  for (;;) {
    const byte = data[at++];
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, at];
    scale *= 128;
  }
}
// tools/autoport/delta.js: a target length, then runs of literal bytes or copies from the source.
function applyDelta(source, delta) {
  let [size, at] = readVarint(delta, 0);
  const out = new Uint8Array(size);
  let written = 0;
  while (at < delta.length) {
    let head;
    [head, at] = readVarint(delta, at);
    const length = Math.floor(head / 2);
    if (head % 2) {
      let from;
      [from, at] = readVarint(delta, at);
      out.set(source.subarray(from, from + length), written);
    } else {
      out.set(delta.subarray(at, at + length), written);
      at += length;
    }
    written += length;
  }
  if (written !== size) throw new Error('patch produced the wrong size');
  return out;
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const encodePath = rel => rel.split('/').map(encodeURIComponent).join('/');

async function officialBytes(entry, rel, clientId) {
  if (entry.s === 'o') {
    const response = await fetchOwn('engine/' + rel);
    if (!response.ok) throw new Error(`engine/${rel} ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const { web, win } = await loadSources();
  if (entry.s === 'w') {
    const url = `${web}/${encodePath(rel)}`;
    const direct = await self.webbloxDirect.get(url, { cache: 'no-store' });
    if (direct && direct.status === 200) return new Uint8Array(await direct.arrayBuffer());
    const reply = await upstream(url, 'GET', {}, null, clientId, true);
    if (reply.status !== 200) throw new Error(`${rel}: Roblox answered ${reply.status}`);
    return new Uint8Array(reply.body);
  }
  const range = `bytes=${entry.a}-${entry.a + entry.c - 1}`;
  const direct = await self.webbloxDirect.get(win + entry.z, { range, cache: 'no-store' });
  const reply = direct && (direct.status === 206 || direct.status === 200)
    ? { status: direct.status, body: await direct.arrayBuffer() }
    : await upstream(win + entry.z, 'GET', { range }, null, clientId, true);
  if (reply.status !== 206 && reply.status !== 200) throw new Error(`${rel}: Roblox answered ${reply.status}`);
  let raw = new Uint8Array(reply.body);
  if (reply.status === 200) raw = raw.subarray(entry.a, entry.a + entry.c);
  return new Uint8Array(entry.m === 8 ? await inflateRaw(raw) : raw);
}

async function buildEngineFile(entry, rel, clientId) {
  let bytes = await officialBytes(entry, rel, clientId);
  if (entry.r) bytes = self.webbloxRbxm.normalize(bytes, data => self.fzstd.decompress(data));
  if (entry.p) {
    const response = await fetchOwn('patches/' + entry.p);
    if (!response.ok) throw new Error(`patch for ${rel}: ${response.status}`);
    bytes = applyDelta(bytes, new Uint8Array(await gunzip(await response.arrayBuffer())));
  }
  if ((await sha256(bytes)).slice(0, entry.h.length) !== entry.h) throw new Error(`${rel} did not match the expected file`);
  const response = new Response(bytes, { headers: { 'Content-Type': typeOf(rel), 'Content-Length': String(bytes.length) } });
  const cache = await caches.open(ENGINE_CACHE);
  await cache.put(engineKey(entry), response.clone());
  return response;
}

function buildOnce(entry, rel, clientId) {
  if (!building.has(entry.h)) building.set(entry.h, buildEngineFile(entry, rel, clientId).finally(() => building.delete(entry.h)));
  return building.get(entry.h);
}

async function engineFile(rel, clientId) {
  const { files } = await loadSources();
  const entry = files[rel];
  if (!entry) return text(404, `Not found: /engine/${rel}`);
  noteUsed(rel);
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(engineKey(entry));
  if (hit) return isolate(hit, typeOf(rel));
  try {
    return isolate((await buildOnce(entry, rel, clientId)).clone(), typeOf(rel));
  } catch (error) {
    console.error('[sw] engine file', rel, error);
    return text(502, `Could not prepare /engine/${rel}: ${error.message || error}`);
  }
}

// --- warming ---------------------------------------------------------------------------------
// A first game needs a few hundred MB of engine files. While the launcher is open, the worker builds
// the ones every game starts with, plus the ones recent games used that changed in an update, so
// Play starts from the cache. The launcher page asks for this with a 'webblox-warm' message.
const WARM = [
  /^(WebClient\.(js|wasm|metadata\.json)|WasmPlayer\.js|WasmLoader\.js|stub\.js|PinnedFlags\.json|WebFlags\.json|audio-processor-fast\.js|shaders\/shaders_glsles3_web\.pack)$/,
  /^ExtraContent\/models\/InExperience\//,
  /^PlatformContent\/pc\/fonts\/NotoSansCJK/,
  /^content\/sky\//,
];
const USED_KEY = 'https://webblox.engine/used.json';
const USED_LIMIT = 4000;
let used = null, usedTimer = 0, warming = null;

async function readUsed() {
  if (used) return used;
  try {
    const hit = await (await caches.open(ENGINE_CACHE)).match(USED_KEY);
    used = new Set(hit ? await hit.json() : []);
  } catch { used = new Set(); }
  return used;
}
function noteUsed(rel) {
  readUsed().then(set => {
    if (set.has(rel) || set.size >= USED_LIMIT) return;
    set.add(rel);
    clearTimeout(usedTimer);
    usedTimer = setTimeout(async () => {
      try { await (await caches.open(ENGINE_CACHE)).put(USED_KEY, new Response(JSON.stringify([...set]), { headers: { 'Content-Type': 'application/json' } })); } catch {}
    }, 3000);
  });
}

// The game page's own scripts and styles, into the HTTP cache, so starting a game is mostly local.
async function warmPage() {
  const html = await (await fetchOwn('index.html')).text();
  const paths = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/(?:launcher|js|cobalt|assets)\/[^"]+)"|loadScript\('(\/[^']+)'/g)) paths.add(m[1] || m[2]);
  paths.add('/hosted-shim.js');
  await Promise.all([...paths].map(path => fetchOwn(path).then(r => r.arrayBuffer()).catch(() => {})));
}

// Signed out, the first thing anyone opens is Roblox's sign-in screen, which is Roblox's own app.
const SIGN_IN = /^ExtraContent\/models\/UniversalApp\//;

async function warm(signIn) {
  warmPage().catch(() => {});
  const { files } = await loadSources();
  const set = await readUsed();
  const cache = await caches.open(ENGINE_CACHE);
  const names = Object.keys(files).filter(rel => set.has(rel) || WARM.some(re => re.test(rel)) || (signIn && SIGN_IN.test(rel))).sort((a, b) => files[b].n - files[a].n);
  const todo = [];
  for (const rel of names) if (!await cache.match(engineKey(files[rel]))) todo.push(rel);
  if (!todo.length) return;
  const started = Date.now();
  let next = 0, failed = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < todo.length) {
      const rel = todo[next++];
      await buildOnce(files[rel], rel).catch(() => { failed++; });
    }
  }));
  console.log(`[sw] warmed ${todo.length - failed} engine file(s) in ${Date.now() - started} ms${failed ? `, ${failed} failed` : ''}`);
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'webblox-warm') return;
  warming ??= warm(!!event.data.signIn).catch(error => console.warn('[sw] warming failed', error)).finally(() => { warming = null; });
  event.waitUntil(warming);
});

// --- WebBlox's own files ---------------------------------------------------------------------
let shimSource;
const loadShim = () => (shimSource ??= fetchOwn('hosted-shim.js').then(r => r.text()).then(code =>
  `<script>window.__WEBBLOX_BASE=${JSON.stringify(BASE)};${code.replace(/<\/script/gi, '<\\/script')}</script>`));

async function ownFile(path, search, request) {
  if (path.endsWith('/')) path += 'index.html';
  const { large } = await loadSources().catch(() => ({ large: {} }));
  if (large?.[path]) {
    const response = await fetchOwn(large[path]);
    if (!response.ok) return text(response.status, `Not found: ${path}`);
    return isolate(new Response(response.body.pipeThrough(new DecompressionStream('gzip')), { status: 200 }), typeOf(path));
  }
  const response = await fetchOwn(path, request.headers.has('range') ? { headers: { range: request.headers.get('range') } } : undefined);
  if (!response.ok) return text(response.status === 404 ? 404 : 502, `Not found: ${path}`);
  if (!/\.html?$/i.test(path)) return isolate(response, typeOf(path));
  let html = await response.text();
  const shim = await loadShim();
  const head = /<head[^>]*>/i.exec(html);
  html = head ? html.slice(0, head.index + head[0].length) + shim + html.slice(head.index + head[0].length) : shim + html;
  return isolate(new Response(html, { status: 200, headers: { 'Cache-Control': 'no-cache' } }), TYPES.html);
}

// --- the relay through the page (from public/sw.js) -------------------------------------------
const SETTINGS_URL = /^https:\/\/apis\.roblox\.com\/webblox\/settings(?:\?|$)/;
const FRAME_PREFIX = '/__frame__/';
const PROXY_PREFIX = '/__proxy__/';
const LAUNCHER_PATH = '/launcher/';
const ENGINE_PARAMS = ['placeId', 'launcher', 'flag'];
const IN_APP_UA = ' RobloxApp/0.745.0.7451145 (GlobalDist; RobloxDirectDownload)';
const FRAME_BLOCKING_HEADERS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only'];
const FRAME_SCRIPT = `<script>(function(){var P=location.origin+${JSON.stringify(BASE.replace(/\/$/, '') + FRAME_PREFIX)};function w(u){try{var x=new URL(u,document.baseURI);if(x.origin===location.origin||!/^https?:$/.test(x.protocol))return null;return P+x.href}catch(e){return null}}document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented||a.target==='_blank')return;var u=w(a.href);if(u){e.preventDefault();location.href=u}},true);document.addEventListener('submit',function(e){var f=e.target;if(!f||(f.method||'get').toLowerCase()!=='get')return;var u=w(f.action);if(u){e.preventDefault();location.href=u+(u.indexOf('?')<0?'?':'&')+new URLSearchParams(new FormData(f))}},true);['pushState','replaceState'].forEach(function(k){var o=history[k];history[k]=function(s,t,u){if(u!=null){var p=w(u);if(p)u=p.slice(location.origin.length)}return o.call(this,s,t,u)}})})()<\/script>`;
const QUICK_LOGIN = /^https:\/\/(?:apis\.roblox\.com\/auth-token-service\/v1\/login\/(create|status|cancel)|auth\.roblox\.com\/v2\/(login))(?:[?#]|$)/;
let quickLoginChannel = null;

function watchQuickLogin(target, response) {
  const match = QUICK_LOGIN.exec(target);
  if (!match) return response;
  response.clone().text().then(body => {
    let status = '';
    try { status = JSON.parse(body).status || ''; } catch {}
    if (!status && body.includes('CodeInvalid')) status = 'CodeInvalid';
    quickLoginChannel ??= new BroadcastChannel('webblox-quick-login');
    quickLoginChannel.postMessage({ step: match[1] || match[2], status, httpStatus: response.status });
  }).catch(() => {});
  return response;
}

async function settingsReply(url) {
  const pages = await self.clients.matchAll({ type: 'window' });
  const replies = await Promise.all(pages.map(page => new Promise(resolve => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2000);
    ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data); };
    page.postMessage({ type: 'webblox-settings', url }, [ch.port2]);
  })));
  const body = replies.find(Boolean);
  return isolate(new Response(body || '{"error":"no page"}', { status: body ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
}

const ASSET_CACHE = 'webblox-assets-2';
const ASSET_HOST = /(^|\.)rbxcdn\.com$/i;
let assetCache = null;
const assetKey = href => {
  const m = new URL(href).pathname.match(/\/([0-9a-f]{32})$/i);
  return m ? `https://rbxcdn.webblox/${m[1].toLowerCase()}` : href;
};
async function cachedAsset(request, target) {
  if (request.method !== 'GET' || request.headers.has('range')) return null;
  if (!ASSET_HOST.test(new URL(target).hostname)) return null;
  try {
    assetCache ??= caches.open(ASSET_CACHE);
    const cache = await assetCache;
    const key = assetKey(target);
    const hit = await cache.match(key);
    if (!hit) return null;
    if (Number(hit.headers.get('x-webblox-expires')) > Date.now()) return hit;
    cache.delete(key);
  } catch {}
  return null;
}

// Windows that loaded public/js/upstream.js say so, and any of them can relay. The game page is a
// frame inside the single-file launcher, so this can't just look for a top-level window.
const relays = new Set();
self.addEventListener('message', event => {
  if (event.data?.type === 'webblox-relay-ready' && event.source?.id) relays.add(event.source.id);
});

async function topPage(clientId) {
  const ownClient = clientId && await self.clients.get(clientId);
  if (ownClient && ownClient.type === 'window' && (relays.has(ownClient.id) || ownClient.frameType === 'top-level')) return ownClient;
  for (let i = 0; i < 100; i++) {
    const pages = await self.clients.matchAll({ type: 'window' });
    // After a restart the worker has forgotten who announced, so fall back to the game page.
    const page = pages.find(p => relays.has(p.id)) || pages.find(p => p.frameType === 'top-level')
      || pages.find(p => /[?&](placeId|launcher|flag)=|\/app\.xhtml\b/.test(p.url));
    if (page) return page;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('no window to relay through');
}

async function upstream(url, method, headers, body, clientId, fallback = false) {
  const page = await topPage(clientId);
  const reply = await new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const stop = () => { clearTimeout(timer); clearInterval(watch); };
    const timer = setTimeout(() => { stop(); reject(new Error('upstream timed out')); }, 300000);
    const watch = setInterval(async () => {
      if (await self.clients.get(page.id)) return;
      stop();
      reject(new Error('the page closed'));
    }, 1000);
    ch.port1.onmessage = e => { stop(); resolve(e.data); };
    page.postMessage({ type: 'webblox-fetch', url, method, headers, body, fallback }, body && body.byteLength ? [ch.port2, body] : [ch.port2]);
  });
  if (!reply.ok) throw new Error(reply.error);
  return reply;
}

async function frame(request, target, clientId) {
  try {
    const headers = {};
    for (const [k, v] of request.headers) headers[k] = v;
    headers['user-agent'] = navigator.userAgent + IN_APP_UA;
    const reply = await upstream(target, 'GET', headers, null, clientId);
    const out = new Headers(reply.headers);
    for (const name of FRAME_BLOCKING_HEADERS) out.delete(name);
    let body = reply.body;
    if (/text\/html/i.test(out.get('content-type') || '')) {
      let html = new TextDecoder().decode(reply.body);
      const head = html.match(/<head[^>]*>/i);
      const inject = `<base href="${target.replace(/"/g, '&quot;')}">${FRAME_SCRIPT}`;
      html = head ? html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length) : inject + html;
      body = new TextEncoder().encode(html);
    }
    return isolate(new Response(body, { status: reply.status, statusText: reply.statusText, headers: out }));
  } catch (err) {
    return text(502, `Could not load ${target}: ${err.message || err}`);
  }
}

async function relay(request, target, clientId) {
  try {
    const hit = await cachedAsset(request, target);
    if (hit) return isolate(hit);
    const tried = self.webbloxDirect.usable(target);
    const direct = tried && await self.webbloxDirect.asset(request, target);
    if (direct) return isolate(direct);
    const headers = {};
    for (const [k, v] of request.headers) headers[k] = v;
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
    const reply = await upstream(target, request.method, headers, body, clientId, tried);
    const empty = [101, 204, 205, 304].includes(reply.status);
    return watchQuickLogin(target, isolate(new Response(empty ? null : reply.body, { status: reply.status, statusText: reply.statusText, headers: reply.headers })));
  } catch (err) {
    console.error('[sw] upstream failed for', target, err);
    return isolate(new Response(JSON.stringify({ error: String(err.message || err) }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
  }
}

// --- routing ---------------------------------------------------------------------------------
self.addEventListener('fetch', event => {
  const { request } = event;
  if (!/^https?:/.test(request.url)) return;
  const url = new URL(request.url);
  if (SETTINGS_URL.test(request.url)) { event.respondWith(settingsReply(request.url)); return; }
  const path = appPath(url);
  if (path === null) {
    if (url.origin === self.location.origin) return;            // another package on the CDN
    event.respondWith(crossOrigin(request, event.clientId));
    return;
  }
  event.respondWith(serveLocal(request, url, path, event.clientId));
});

async function crossOrigin(request, clientId) {
  if (request.destination === 'image') {
    const client = clientId && await self.clients.get(clientId);
    const path = client && appPath(new URL(client.url));
    if (path && path.startsWith(LAUNCHER_PATH)) {
      try { return await fetch(request.url, { mode: 'cors', credentials: 'omit' }); } catch {}
    }
  }
  return relay(request, request.url, clientId);
}

async function serveLocal(request, url, path, clientId) {
  path = decodeURIComponent(path);
  if (path.startsWith(FRAME_PREFIX)) return frame(request, url.href.slice(url.href.indexOf(FRAME_PREFIX) + FRAME_PREFIX.length), clientId);
  if (path.startsWith(PROXY_PREFIX)) {
    const target = url.href.slice(url.href.indexOf(PROXY_PREFIX) + PROXY_PREFIX.length);
    return SETTINGS_URL.test(target) ? settingsReply(target) : relay(request, target, clientId);
  }
  if (path.startsWith('/perf-collect/')) return isolate(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  if ((path === '/' || path === '/index.html') && !ENGINE_PARAMS.some(name => url.searchParams.has(name))) {
    return Response.redirect(own(LAUNCHER_PATH) + url.search, 302);
  }
  if (path === '/' || path === '/games/start') return ownFile('/index.html', url.search, request);
  if (path.startsWith('/engine/')) return engineFile(path.slice('/engine/'.length), clientId);
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
  return ownFile(path, url.search, request);
}
