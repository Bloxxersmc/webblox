(() => {
  'use strict';

  if (window.__webbloxWebGPU || new URLSearchParams(location.search).get('ubostream') === '0') return;

  const proto = WebGL2RenderingContext.prototype;
  const GL = {
    UNIFORM_BUFFER: 0x8A11,
    DYNAMIC_DRAW: 0x88E8,
    ACTIVE_UNIFORM_BLOCKS: 0x8A36,
    UNIFORM_BLOCK_BINDING: 0x8A3F,
    UNIFORM_BLOCK_DATA_SIZE: 0x8A40,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
  };
  const SMALL_WRITE = 4096;
  const MAX_INTERVALS = 64;
  const WRITE_LOG = 32;
  const MIN_CAPACITY = 256;

  const original = {};
  for (const name of ['bindBuffer', 'bindBufferBase', 'bindBufferRange', 'bufferData', 'bufferSubData', 'copyBufferSubData',
                      'getBufferSubData', 'deleteBuffer', 'useProgram', 'uniformBlockBinding', 'linkProgram', 'drawElements',
                      'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements']) {
    original[name] = proto[name];
  }

  const contexts = new WeakMap();
  const live = [];
  const ctx = gl => {
    let c = contexts.get(gl);
    if (!c) {
      c = { generic: null, glGeneric: null, program: null, bindings: new Map(), actual: new Map(), pools: new Map(),
            epoch: 0, completed: -1, used: false, fences: [] };
      contexts.set(gl, c);
      live.push([gl, c]);
    }
    return c;
  };

  const tick = () => {
    for (const [gl, c] of live) {
      while (c.fences.length && gl.getSyncParameter(c.fences[0].sync, GL.SYNC_STATUS) === GL.SIGNALED) {
        const done = c.fences.shift();
        c.completed = done.epoch;
        gl.deleteSync(done.sync);
      }
      if (!c.used) continue;
      const sync = gl.fenceSync(GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync) c.fences.push({ epoch: c.epoch, sync });
      c.epoch++;
      c.used = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const bytesOf = (data, srcOffset, length) => {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (!ArrayBuffer.isView(data)) return null;
    const size = data.BYTES_PER_ELEMENT || 1;
    const start = data.byteOffset + (srcOffset || 0) * size;
    const count = length ? length * size : data.byteLength - (srcOffset || 0) * size;
    return new Uint8Array(data.buffer, start, count);
  };

  const ensureGeneric = (gl, c) => {
    if (c.glGeneric !== c.generic) {
      original.bindBuffer.call(gl, GL.UNIFORM_BUFFER, c.generic);
      c.glGeneric = c.generic;
    }
  };

  const addInterval = (page, lo, hi) => {
    const list = page.dirty;
    let i = 0;
    while (i < list.length && list[i][1] < lo) i++;
    let j = i;
    while (j < list.length && list[j][0] <= hi) {
      lo = Math.min(lo, list[j][0]);
      hi = Math.max(hi, list[j][1]);
      j++;
    }
    list.splice(i, j - i, [lo, hi]);
    if (list.length > MAX_INTERVALS) page.dirty = [[list[0][0], list[list.length - 1][1]]];
  };

  const removeInterval = (page, lo, hi) => {
    const next = [];
    for (const [a, b] of page.dirty) {
      if (b <= lo || a >= hi) next.push([a, b]);
      else {
        if (a < lo) next.push([a, lo]);
        if (b > hi) next.push([hi, b]);
      }
    }
    page.dirty = next;
  };

  const overlapsDirty = (page, lo, hi) => {
    for (const [a, b] of page.dirty) {
      if (a >= hi) return false;
      if (b > lo) return true;
    }
    return false;
  };

  const writtenSince = (page, seq, lo, hi) => {
    if (page.seq - seq > WRITE_LOG) return true;
    for (let s = seq + 1; s <= page.seq; s++) {
      const w = page.log[s % WRITE_LOG];
      if (w[0] < hi && w[1] > lo) return true;
    }
    return false;
  };

  const flushPage = (gl, c, buffer) => {
    const page = buffer && buffer.__webbloxUbo;
    if (!page || !page.dirty.length) return;
    original.bindBuffer.call(gl, GL.UNIFORM_BUFFER, buffer);
    c.glGeneric = buffer;
    for (const [lo, hi] of page.dirty) original.bufferSubData.call(gl, GL.UNIFORM_BUFFER, lo, page.bytes, lo, hi - lo);
    page.dirty = [];
  };

  const blockSizes = (gl, program) => {
    let sizes = program.__webbloxBlocks;
    if (sizes) return sizes;
    sizes = [];
    const count = gl.getProgramParameter(program, GL.ACTIVE_UNIFORM_BLOCKS) || 0;
    for (let i = 0; i < count; i++) {
      sizes.push([gl.getActiveUniformBlockParameter(program, i, GL.UNIFORM_BLOCK_BINDING),
                  gl.getActiveUniformBlockParameter(program, i, GL.UNIFORM_BLOCK_DATA_SIZE)]);
    }
    program.__webbloxBlocks = sizes;
    return sizes;
  };

  const acquire = (gl, c, capacity) => {
    let pool = c.pools.get(capacity);
    if (!pool) {
      pool = { free: [], busy: [], head: 0 };
      c.pools.set(capacity, pool);
    }
    while (pool.head < pool.busy.length && pool.busy[pool.head].epoch <= c.completed) pool.free.push(pool.busy[pool.head++]);
    if (pool.head > 1024 && pool.head * 2 > pool.busy.length) {
      pool.busy = pool.busy.slice(pool.head);
      pool.head = 0;
    }
    let entry = pool.free.pop();
    if (!entry) {
      entry = { buffer: gl.createBuffer(), pool, epoch: c.epoch };
      original.bindBuffer.call(gl, GL.UNIFORM_BUFFER, entry.buffer);
      original.bufferData.call(gl, GL.UNIFORM_BUFFER, capacity, GL.DYNAMIC_DRAW);
      c.glGeneric = entry.buffer;
    }
    c.used = true;
    return entry;
  };

  const release = (c, entry) => {
    entry.epoch = c.epoch;
    c.used = true;
    entry.pool.busy.push(entry);
  };

  const setActual = (c, index, next) => {
    const a = c.actual.get(index);
    if (a && a.entry && a.entry !== next.entry) release(c, a.entry);
    c.actual.set(index, next);
  };

  const uploadFullbright = (gl, c, page, lo, length, override) => {
    if (!c.fullbrightBytes || c.fullbrightBytes.length < length) {
      c.fullbrightBytes = new Uint8Array((length + 3) & ~3);
      c.fullbrightValues = new Float32Array(c.fullbrightBytes.buffer);
    }
    c.fullbrightBytes.set(page.bytes.subarray(lo, lo + length));
    override.apply(c.fullbrightValues);
    original.bufferSubData.call(gl, GL.UNIFORM_BUFFER, 0, c.fullbrightBytes, 0, length);
  };

  const fullbrightFor = (gl, program) => {
    const core = window.__webbloxFullbrightCore;
    if (!core) return null;
    const sources = { [gl.VERTEX_SHADER]: '', [gl.FRAGMENT_SHADER]: '' };
    for (const shader of gl.getAttachedShaders(program) || []) sources[gl.getShaderParameter(shader, gl.SHADER_TYPE)] = gl.getShaderSource(shader) || '';
    return core.overrideFor(sources[gl.VERTEX_SHADER], sources[gl.FRAGMENT_SHADER]);
  };

  const resolve = (gl, c, index, dataSize) => {
    const b = c.bindings.get(index);
    if (!b) return;
    const a = c.actual.get(index);
    const page = b.buffer && b.buffer.__webbloxUbo;
    const lo = b.offset;
    const span = Math.min(b.size || (page ? page.bytes.length - lo : 0), dataSize || Infinity);
    const hi = lo + span;
    const override = window.__webbloxFullbright && page ? c.program.__webbloxFullbright : null;
    const fullbright = override && override.block === index ? override : null;
    if (!fullbright && (!page || !overlapsDirty(page, lo, hi))) {
      if (a && !a.entry && a.buffer === b.buffer && a.offset === b.offset && a.size === b.size) return;
      if (b.size) original.bindBufferRange.call(gl, GL.UNIFORM_BUFFER, index, b.buffer, b.offset, b.size);
      else original.bindBufferBase.call(gl, GL.UNIFORM_BUFFER, index, b.buffer);
      c.glGeneric = b.buffer;
      setActual(c, index, { entry: null, buffer: b.buffer, offset: b.offset, size: b.size });
      return;
    }
    if (a && a.entry && a.fullbright === fullbright && a.page === page && a.offset === lo && a.size >= span && !writtenSince(page, a.seq, lo, hi)) return;
    const length = Math.min(span, page.bytes.length - lo);
    let capacity = MIN_CAPACITY;
    while (capacity < span) capacity *= 2;
    const entry = acquire(gl, c, capacity);
    original.bindBuffer.call(gl, GL.UNIFORM_BUFFER, entry.buffer);
    if (fullbright) uploadFullbright(gl, c, page, lo, length, fullbright);
    else original.bufferSubData.call(gl, GL.UNIFORM_BUFFER, 0, page.bytes, lo, length);
    original.bindBufferRange.call(gl, GL.UNIFORM_BUFFER, index, entry.buffer, 0, span);
    c.glGeneric = entry.buffer;
    setActual(c, index, { entry, page, buffer: b.buffer, offset: lo, size: span, seq: page.seq, fullbright });
  };

  const prepare = gl => {
    const c = ctx(gl);
    if (!c.program) return;
    for (const [index, dataSize] of blockSizes(gl, c.program)) resolve(gl, c, index, dataSize);
  };

  proto.useProgram = function (program) {
    ctx(this).program = program;
    return original.useProgram.apply(this, arguments);
  };

  proto.linkProgram = function (program) {
    if (program) {
      program.__webbloxBlocks = null;
      program.__webbloxFullbright = fullbrightFor(this, program);
    }
    return original.linkProgram.apply(this, arguments);
  };

  proto.uniformBlockBinding = function (program) {
    if (program) program.__webbloxBlocks = null;
    return original.uniformBlockBinding.apply(this, arguments);
  };

  proto.bindBuffer = function (target, buffer) {
    const c = ctx(this);
    if (target === GL.UNIFORM_BUFFER) {
      c.generic = buffer;
      c.glGeneric = buffer;
    } else if (buffer && buffer.__webbloxUbo && buffer.__webbloxUbo.dirty.length) {
      flushPage(this, c, buffer);
      ensureGeneric(this, c);
    }
    return original.bindBuffer.apply(this, arguments);
  };

  proto.bindBufferBase = function (target, index, buffer) {
    if (target !== GL.UNIFORM_BUFFER) return original.bindBufferBase.apply(this, arguments);
    const c = ctx(this);
    c.generic = buffer;
    c.bindings.set(index, { buffer, offset: 0, size: 0 });
  };

  proto.bindBufferRange = function (target, index, buffer, offset, size) {
    if (target !== GL.UNIFORM_BUFFER) return original.bindBufferRange.apply(this, arguments);
    const c = ctx(this);
    c.generic = buffer;
    c.bindings.set(index, { buffer, offset, size });
  };

  proto.bufferData = function (target, sizeOrData, usage, srcOffset, length) {
    if (target !== GL.UNIFORM_BUFFER) return original.bufferData.apply(this, arguments);
    const c = ctx(this);
    const buffer = c.generic;
    if (buffer) {
      let bytes = null;
      if (typeof sizeOrData === 'number') bytes = new Uint8Array(sizeOrData);
      else {
        const view = bytesOf(sizeOrData, srcOffset, length);
        if (view) bytes = new Uint8Array(view);
      }
      buffer.__webbloxUbo = bytes ? { bytes, dirty: [], seq: 0, log: Array.from({ length: WRITE_LOG }, () => [0, 0]) } : null;
    }
    ensureGeneric(this, c);
    return original.bufferData.apply(this, arguments);
  };

  proto.bufferSubData = function (target, dstOffset, data, srcOffset, length) {
    if (target !== GL.UNIFORM_BUFFER) return original.bufferSubData.apply(this, arguments);
    const c = ctx(this);
    const page = c.generic && c.generic.__webbloxUbo;
    const bytes = page && bytesOf(data, srcOffset, length);
    if (!bytes || dstOffset + bytes.length > page.bytes.length) {
      if (page) {
        flushPage(this, c, c.generic);
        c.generic.__webbloxUbo = null;
      }
      ensureGeneric(this, c);
      return original.bufferSubData.apply(this, arguments);
    }
    page.bytes.set(bytes, dstOffset);
    const end = dstOffset + bytes.length;
    page.seq++;
    const w = page.log[page.seq % WRITE_LOG];
    w[0] = dstOffset;
    w[1] = end;
    if (bytes.length < SMALL_WRITE) {
      addInterval(page, dstOffset, end);
      return;
    }
    removeInterval(page, dstOffset, end);
    ensureGeneric(this, c);
    return original.bufferSubData.apply(this, arguments);
  };

  proto.copyBufferSubData = function (readTarget, writeTarget) {
    const c = ctx(this);
    if (readTarget === GL.UNIFORM_BUFFER || writeTarget === GL.UNIFORM_BUFFER) {
      const buffer = c.generic;
      flushPage(this, c, buffer);
      if (writeTarget === GL.UNIFORM_BUFFER && buffer) buffer.__webbloxUbo = null;
      ensureGeneric(this, c);
    }
    return original.copyBufferSubData.apply(this, arguments);
  };

  proto.getBufferSubData = function (target) {
    const c = ctx(this);
    if (target === GL.UNIFORM_BUFFER) {
      flushPage(this, c, c.generic);
      ensureGeneric(this, c);
    }
    return original.getBufferSubData.apply(this, arguments);
  };

  proto.deleteBuffer = function (buffer) {
    const c = ctx(this);
    if (buffer) {
      buffer.__webbloxUbo = null;
      if (c.generic === buffer) c.generic = null;
      if (c.glGeneric === buffer) c.glGeneric = null;
      for (const [index, b] of c.bindings) if (b.buffer === buffer) c.bindings.delete(index);
      for (const [index, a] of c.actual) {
        if (a.buffer !== buffer) continue;
        if (a.entry) release(c, a.entry);
        c.actual.delete(index);
      }
    }
    return original.deleteBuffer.apply(this, arguments);
  };

  for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements']) {
    proto[name] = function () {
      prepare(this);
      return original[name].apply(this, arguments);
    };
  }
})();
