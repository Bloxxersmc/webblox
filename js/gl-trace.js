(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const frameLimit = Number(params.get('gltrace'));
  if (!(frameLimit > 0)) return;

  const ENDPOINT = '/__gltrace';
  const TRACE = params.get('gltracename') || new Date().toISOString().replace(/[:.]/g, '-');
  const FLUSH_BYTES = 32 * 1024 * 1024;
  const FLUSH_CALLS = 200000;
  const MAX_QUEUED_BYTES = 384 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
  const GL = {
    UNPACK_ALIGNMENT: 0x0CF5,
    UNPACK_ROW_LENGTH: 0x0CF2,
    UNPACK_IMAGE_HEIGHT: 0x806E,
    UNPACK_SKIP_PIXELS: 0x0CF4,
    UNPACK_SKIP_ROWS: 0x0CF3,
    UNPACK_SKIP_IMAGES: 0x806D,
    PIXEL_UNPACK_BUFFER: 0x88EC,
  };
  const FORMAT_CHANNELS = { 0x1903: 1, 0x8D94: 1, 0x8227: 2, 0x8228: 2, 0x1907: 3, 0x8D98: 3, 0x1908: 4, 0x8D99: 4, 0x1902: 1, 0x84F9: 2, 0x1909: 1, 0x190A: 2 };
  const TYPE_BYTES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 };
  const PACKED_BYTES = { 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8C3E: 4, 0x84FA: 4, 0x8368: 4, 0x8DAD: 8 };
  const SKIP = /^(get|is|check|validate)/;
  const KEEP_GETTERS = new Set(['getUniformLocation', 'getUniformBlockIndex', 'getExtension']);

  const proto = WebGL2RenderingContext.prototype;
  const ids = new WeakMap();
  let nextId = 1;
  let traced = null;
  let calls = [];
  let blobs = [];
  let blobBytes = 0;
  let queuedBytes = 0;
  let chunk = 0;
  let frames = 0;
  let drawsThisFrame = 0;
  let stopped = false;
  let finishing = false;
  let pending = Promise.resolve();
  const unpack = { [GL.UNPACK_ALIGNMENT]: 4, [GL.UNPACK_ROW_LENGTH]: 0, [GL.UNPACK_IMAGE_HEIGHT]: 0, [GL.UNPACK_SKIP_PIXELS]: 0, [GL.UNPACK_SKIP_ROWS]: 0, [GL.UNPACK_SKIP_IMAGES]: 0 };
  const stats = { calls: 0, bytes: 0, chunks: 0, failed: 0 };

  const flush = () => {
    if (!calls.length && !blobs.length) return pending;
    const table = [];
    let offset = 0;
    for (const blob of blobs) {
      table.push(offset);
      offset += blob.byteLength;
    }
    const head = new TextEncoder().encode(JSON.stringify({ calls, table }));
    const parts = [new Uint32Array([head.byteLength]), head, ...blobs];
    const index = chunk++;
    calls = [];
    blobs = [];
    blobBytes = 0;
    const body = new Blob(parts);
    stats.bytes += body.size;
    stats.chunks++;
    queuedBytes += body.size;
    if (!stopped && (queuedBytes > MAX_QUEUED_BYTES || stats.bytes > MAX_TOTAL_BYTES)) {
      console.warn(`[gltrace] stopping early: ${queuedBytes} bytes queued, ${stats.bytes} recorded`);
      stats.stoppedEarly = true;
      setTimeout(finish, 0);
    }
    pending = pending.then(() => fetch(`${ENDPOINT}/chunk/${encodeURIComponent(TRACE)}/${index}`, { method: 'POST', body }))
      .then(response => {
        queuedBytes -= body.size;
        if (!response.ok) throw new Error(`status ${response.status}`);
      })
      .catch(err => {
        stats.failed++;
        console.warn('[gltrace] chunk failed', err);
      });
    return pending;
  };

  const addBlob = (view, start, length) => {
    const bytes = new Uint8Array(length);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset + start, length));
    if (length > 256 * 1024 * 1024) console.warn('[gltrace] huge blob', length, currentCall);
    blobs.push(bytes);
    blobBytes += length;
    return blobs.length - 1;
  };

  const encode = value => {
    if (value === null || value === undefined) return null;
    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (ArrayBuffer.isView(value)) return { view: value.constructor.name, blob: addBlob(value, 0, value.byteLength) };
    if (Array.isArray(value)) return { list: value.map(encode) };
    if (type === 'object') {
      let id = ids.get(value);
      if (!id) {
        id = nextId++;
        ids.set(value, id);
      }
      return { o: id };
    }
    return null;
  };

  const elementSize = view => view.BYTES_PER_ELEMENT || 1;

  const sliced = (view, srcOffset, length) => {
    const size = elementSize(view);
    const start = (srcOffset || 0) * size;
    const bytes = length ? length * size : view.byteLength - start;
    return { view: view.constructor.name, blob: addBlob(view, start, bytes) };
  };

  const imageBytes = (width, height, depth, format, type) => {
    const pixel = PACKED_BYTES[type] || (FORMAT_CHANNELS[format] || 4) * (TYPE_BYTES[type] || 1);
    const align = unpack[GL.UNPACK_ALIGNMENT] || 1;
    const rowPixels = unpack[GL.UNPACK_ROW_LENGTH] || width;
    const row = Math.ceil(rowPixels * pixel / align) * align;
    const imageRows = unpack[GL.UNPACK_IMAGE_HEIGHT] || height;
    const lead = unpack[GL.UNPACK_SKIP_IMAGES] * imageRows * row + unpack[GL.UNPACK_SKIP_ROWS] * row + unpack[GL.UNPACK_SKIP_PIXELS] * pixel;
    return lead + (depth - 1) * imageRows * row + (height - 1) * row + width * pixel;
  };

  const imageArg = (args, at, offsetAt, width, height, depth, format, type) => {
    const data = args[at];
    if (!ArrayBuffer.isView(data)) return args.map(encode);
    const size = elementSize(data);
    const start = (args[offsetAt] || 0) * size;
    const bytes = Math.min(imageBytes(width, height, depth, format, type), data.byteLength - start);
    const out = args.map((arg, i) => (i === at || i === offsetAt ? null : encode(arg)));
    out[at] = { view: 'Uint8Array', blob: addBlob(data, start, bytes) };
    out.length = at + 1;
    return out;
  };

  const compressedArg = (args, at) => {
    const data = args[at];
    if (!ArrayBuffer.isView(data)) return args.map(encode);
    const out = args.slice(0, at).map(encode);
    out[at] = sliced(data, args[at + 1], args[at + 2]);
    return out;
  };

  const clearValues = a => {
    if (!ArrayBuffer.isView(a[2])) return a.map(encode);
    return [a[0], a[1], sliced(a[2], a[3] || 0, 4)];
  };

  const special = {
    bufferData: a => (ArrayBuffer.isView(a[1]) ? [a[0], sliced(a[1], a[3], a[4]), a[2]] : a.map(encode)),
    bufferSubData: a => (ArrayBuffer.isView(a[2]) ? [a[0], a[1], sliced(a[2], a[3], a[4])] : a.map(encode)),
    texImage2D: a => (a.length >= 9 ? imageArg(a, 8, 9, a[3], a[4], 1, a[6], a[7]) : a.map(encode)),
    texImage3D: a => imageArg(a, 9, 10, a[3], a[4], a[5], a[7], a[8]),
    texSubImage2D: a => (a.length >= 9 ? imageArg(a, 8, 9, a[4], a[5], 1, a[6], a[7]) : a.map(encode)),
    texSubImage3D: a => imageArg(a, 10, 11, a[5], a[6], a[7], a[8], a[9]),
    compressedTexImage2D: a => compressedArg(a, 6),
    compressedTexImage3D: a => compressedArg(a, 7),
    compressedTexSubImage2D: a => compressedArg(a, 7),
    compressedTexSubImage3D: a => compressedArg(a, 9),
    readPixels: a => a.slice(0, 6),
    clearBufferfv: a => clearValues(a),
    clearBufferiv: a => clearValues(a),
    clearBufferuiv: a => clearValues(a),
  };

  let currentCall = '';
  const record = (name, args, result) => {
    currentCall = name;
    const encoded = special[name] ? special[name](args) : args.map(encode);
    const entry = [name, encoded];
    if (result !== undefined && result !== null && typeof result === 'object') entry.push(encode(result));
    else if (name === 'getUniformBlockIndex') entry.push(result);
    calls.push(entry);
    stats.calls++;
    if (blobBytes > FLUSH_BYTES || calls.length > FLUSH_CALLS) flush();
  };

  const wrapExtension = (name, extension) => {
    if (!extension || extension.__glTrace) return extension;
    extension.__glTrace = true;
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(extension))) {
      if (typeof extension[key] !== 'function' || key === 'constructor') continue;
      const method = extension[key];
      extension[key] = function (...args) {
        if (traced && !stopped) record(`ext:${name}:${key}`, args);
        return method.apply(extension, args);
      };
    }
    return extension;
  };

  for (const name of Object.getOwnPropertyNames(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== 'function') continue;
    if (SKIP.test(name) && !KEEP_GETTERS.has(name)) continue;
    const method = descriptor.value;
    proto[name] = function (...args) {
      if (this !== traced || stopped) return method.apply(this, args);
      if (name === 'pixelStorei' && args[0] in unpack) unpack[args[0]] = args[1];
      if (name === 'drawElements' || name === 'drawElementsInstanced' || name === 'drawArrays' || name === 'drawArraysInstanced') drawsThisFrame++;
      const result = method.apply(this, args);
      try {
        if (name === 'getExtension') {
          record(name, args);
          return wrapExtension(args[0], result);
        }
        record(name, args, result);
      } catch (err) {
        stopped = true;
        window.__glTraceError = String(err && err.stack || err);
        console.warn('[gltrace] stopped:', window.__glTraceError);
      }
      return result;
    };
  }

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
    const context = getContext.apply(this, arguments);
    if (kind === 'webgl2' && context && !traced && this.id === 'canvas') {
      traced = context;
      calls.push(['@context', [attributes || {}, this.width, this.height]]);
      for (const name of ['extClipControl']) if (context[name]) wrapExtension('EXT_clip_control', context[name]);
      requestAnimationFrame(tick);
      console.log(`[gltrace] recording ${TRACE}, ${frameLimit} frames`);
    }
    return context;
  };

  const finish = async () => {
    if (finishing) return;
    finishing = true;
    stopped = true;
    await flush();
    await pending;
    await fetch(`${ENDPOINT}/done/${encodeURIComponent(TRACE)}`, {
      method: 'POST',
      body: JSON.stringify({ frames, chunks: chunk, stats, renderer: rendererName(), dpr: devicePixelRatio, url: location.pathname + location.search }),
    }).catch(() => {});
    window.__glTraceDone = { trace: TRACE, frames, chunks: chunk, ...stats };
    console.log('[gltrace] finished', window.__glTraceDone);
  };

  const rendererName = () => {
    const info = traced && traced.getExtension('WEBGL_debug_renderer_info');
    return info ? traced.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  };

  function tick() {
    if (stopped) return;
    if (drawsThisFrame) {
      const canvas = traced.canvas;
      calls.push(['@frame', [frames, canvas.width, canvas.height, drawsThisFrame]]);
      frames++;
      drawsThisFrame = 0;
      if (frames >= frameLimit) {
        finish();
        return;
      }
      if (frames % 30 === 0) flush();
    }
    requestAnimationFrame(tick);
  }

  window.__glTraceStop = () => (stopped ? pending : finish());
  window.__glTraceStats = () => ({ frames, chunk, ...stats, stopped });
})();
