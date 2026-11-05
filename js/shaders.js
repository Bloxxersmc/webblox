(() => {
  'use strict';

  if (window.__webbloxWebGPU || new URLSearchParams(location.search).get('warm') === '0') return;

  const DB_NAME = 'webblox-shaders';
  const STORE = 'programs';
  const SHARED_URL = '/gen/shader-warmup.json';
  const canShare = window.WEBLOX_MODE === 'node';
  const MAX_PROGRAMS = 2000;
  const IN_FLIGHT = 12;
  const POLL_MS = 30;

  const proto = WebGL2RenderingContext.prototype;
  const native = {};
  for (const name of ['createShader', 'shaderSource', 'compileShader', 'createProgram', 'attachShader',
                      'bindAttribLocation', 'linkProgram', 'getProgramParameter', 'deleteProgram',
                      'deleteShader', 'getExtension']) {
    native[name] = proto[name];
  }

  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const dbReady = openDb().catch(() => null);

  const hashKey = str => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };

  const shaderInfo = new WeakMap();
  const programShaders = new WeakMap();
  const programAttribs = new WeakMap();
  const warmPrograms = new WeakSet();
  const known = new Set();
  const sharedKeys = new Set();
  const unsaved = new Map();
  const unshared = new Map();
  let saveTimer = 0;
  const stats = { recorded: 0, stored: 0, shared: 0, warmed: 0, warmFailed: 0, warmMs: 0, supported: null };

  const share = () => {
    if (!canShare || !unshared.size) return;
    const batch = [...unshared].map(([key, rec]) => ({ key, ...rec }));
    unshared.clear();
    fetch('/__shaders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) })
      .then(r => r.ok ? r.json() : null)
      .then(r => { if (r) for (const { key } of batch) sharedKeys.add(key); })
      .catch(() => {});
  };

  const save = async () => {
    saveTimer = 0;
    share();
    const db = await dbReady;
    if (!db || !unsaved.size) return;
    const batch = [...unsaved];
    unsaved.clear();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [key, rec] of batch) store.put(rec, key);
    } catch {}
  };

  const remember = rec => {
    const key = hashKey(rec.vs + '\u0000' + rec.fs + '\u0000' + rec.attribs.join(','));
    if (known.has(key) || known.size >= MAX_PROGRAMS) return;
    known.add(key);
    unsaved.set(key, rec);
    if (!sharedKeys.has(key)) unshared.set(key, rec);
    stats.recorded++;
    if (!saveTimer) saveTimer = setTimeout(save, 2000);
  };

  proto.createShader = function (type) {
    const shader = native.createShader.call(this, type);
    if (shader) shaderInfo.set(shader, { type, source: '' });
    return shader;
  };
  proto.shaderSource = function (shader, source) {
    const info = shader && shaderInfo.get(shader);
    if (info) info.source = source;
    return native.shaderSource.call(this, shader, source);
  };
  proto.attachShader = function (program, shader) {
    if (program && !warmPrograms.has(program)) {
      const list = programShaders.get(program) || [];
      list.push(shader);
      programShaders.set(program, list);
    }
    return native.attachShader.call(this, program, shader);
  };
  proto.bindAttribLocation = function (program, index, name) {
    if (program && !warmPrograms.has(program)) {
      const list = programAttribs.get(program) || [];
      list.push(index + ':' + name);
      programAttribs.set(program, list);
    }
    return native.bindAttribLocation.call(this, program, index, name);
  };
  proto.linkProgram = function (program) {
    if (program && !warmPrograms.has(program)) {
      let vs = '', fs = '';
      for (const shader of programShaders.get(program) || []) {
        const info = shaderInfo.get(shader);
        if (!info) continue;
        if (info.type === this.VERTEX_SHADER) vs = info.source;
        else if (info.type === this.FRAGMENT_SHADER) fs = info.source;
      }
      if (vs && fs) remember({ vs, fs, attribs: (programAttribs.get(program) || []).slice().sort() });
    }
    return native.linkProgram.call(this, program);
  };

  const loadLocal = async () => {
    const db = await dbReady;
    if (!db) return new Map();
    return new Promise(resolve => {
      const out = new Map();
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(out);
          out.set(cursor.key, cursor.value);
          cursor.continue();
        };
        req.onerror = () => resolve(out);
      } catch { resolve(out); }
    });
  };

  const loadShared = async () => {
    try {
      const res = await fetch(SHARED_URL, { cache: 'no-cache' });
      if (!res.ok) return new Map();
      const data = await res.json();
      return new Map(Object.entries((data && data.programs) || {}));
    } catch { return new Map(); }
  };

  const loadAll = async () => {
    const [local, shared] = await Promise.all([loadLocal(), loadShared()]);
    const all = new Map(shared);
    for (const key of shared.keys()) { sharedKeys.add(key); known.add(key); }
    for (const [key, rec] of local) {
      known.add(key);
      all.set(key, rec);
      if (!sharedKeys.has(key)) unshared.set(key, rec);
    }
    stats.shared = shared.size;
    share();
    return [...all.values()];
  };

  const warm = async gl => {
    const ext = native.getExtension.call(gl, 'KHR_parallel_shader_compile');
    stats.supported = !!ext;
    const records = await loadAll();
    stats.stored = records.length;
    if (!ext || !records.length) return;
    const started = performance.now();
    const queue = records.slice();
    const flight = [];

    const start = rec => {
      const vs = native.createShader.call(gl, gl.VERTEX_SHADER);
      const fs = native.createShader.call(gl, gl.FRAGMENT_SHADER);
      const program = native.createProgram.call(gl);
      if (!vs || !fs || !program) return;
      warmPrograms.add(program);
      native.shaderSource.call(gl, vs, rec.vs);
      native.shaderSource.call(gl, fs, rec.fs);
      native.compileShader.call(gl, vs);
      native.compileShader.call(gl, fs);
      native.attachShader.call(gl, program, vs);
      native.attachShader.call(gl, program, fs);
      for (const entry of rec.attribs) {
        const cut = entry.indexOf(':');
        native.bindAttribLocation.call(gl, program, Number(entry.slice(0, cut)), entry.slice(cut + 1));
      }
      native.linkProgram.call(gl, program);
      flight.push({ program, vs, fs });
    };

    await new Promise(resolve => {
      const step = () => {
        if (gl.isContextLost()) return resolve();
        for (let i = flight.length - 1; i >= 0; i--) {
          const item = flight[i];
          if (!native.getProgramParameter.call(gl, item.program, ext.COMPLETION_STATUS_KHR)) continue;
          if (native.getProgramParameter.call(gl, item.program, gl.LINK_STATUS)) stats.warmed++;
          else stats.warmFailed++;
          native.deleteProgram.call(gl, item.program);
          native.deleteShader.call(gl, item.vs);
          native.deleteShader.call(gl, item.fs);
          flight.splice(i, 1);
        }
        while (flight.length < IN_FLIGHT && queue.length) start(queue.shift());
        if (!flight.length && !queue.length) return resolve();
        setTimeout(step, POLL_MS);
      };
      step();
    });
    stats.warmMs = Math.round(performance.now() - started);
    console.log(`[shaders] warmed ${stats.warmed}/${stats.stored} programs in ${stats.warmMs} ms` +
      (stats.warmFailed ? ` (${stats.warmFailed} failed to link)` : ''));
  };

  const prevGetContext = HTMLCanvasElement.prototype.getContext;
  let warming = false;
  HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
    const ctx = prevGetContext.call(this, type, attrs);
    if (!warming && ctx && type === 'webgl2' && this.id === 'canvas') {
      warming = true;
      warm(ctx).catch(err => console.warn('[shaders] warm-up failed:', err));
    }
    return ctx;
  };

  window.shaderWarmReport = () => ({ ...stats, known: known.size });
})();
