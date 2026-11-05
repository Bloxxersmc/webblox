(() => {
  'use strict';

  const { OP, CALLS, KINDS, RING_PAGES, START, WORD, STATS_BYTE, STATS, DIRECT_BYTES, FRAME_LIMIT, READ_WAIT_MS, STALL_WAIT_MS, SIDE, ENGINE } = self.__webbloxGlOps;
  const RING_BYTES = RING_PAGES * 65536;
  const MAILBOX_WAIT_MS = 20;
  const GOVERNOR_WINDOW_MS = 500;
  const HELPER_ON_LOAD = 0.85;
  const HELPER_OFF_LOAD = 0.6;
  const HELPER_MIN_FRAME_MS = 12;
  const HELPER_RETRY_MS = 10000;
  const HELPER_SLOWDOWN = 1.4;
  const HELPER_MIN_GAIN = 0.08;
  const MARK_MS = 0.0002;
  const WORKER_LOAD_TRIES = 4;
  const WORKER_RETRY_MS = 250;
  const DEPTH_CLAMP_EXTENSION = 'EXT_depth_clamp';

  const uleb = value => {
    const out = [];
    let v = value >>> 0;
    do {
      let byte = v & 0x7f;
      v >>>= 7;
      if (v) byte |= 0x80;
      out.push(byte);
    } while (v);
    return out;
  };
  const sleb = value => {
    const out = [];
    let v = value | 0;
    for (;;) {
      const byte = v & 0x7f;
      v >>= 7;
      if ((v === 0 && !(byte & 0x40)) || (v === -1 && (byte & 0x40))) {
        out.push(byte);
        return out;
      }
      out.push(byte | 0x80);
    }
  };
  const text = value => [...uleb(value.length), ...new TextEncoder().encode(value)];
  const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
  const vector = items => [...uleb(items.length), ...items.flat()];

  const I32 = 0x7f;
  const F32 = 0x7d;
  const VALUE = { i: I32, f: F32 };

  const INS = {
    get: i => [0x20, ...uleb(i)],
    set: i => [0x21, ...uleb(i)],
    tee: i => [0x22, ...uleb(i)],
    gget: i => [0x23, ...uleb(i)],
    gset: i => [0x24, ...uleb(i)],
    i32: v => [0x41, ...sleb(v)],
    add: [0x6a],
    and: [0x71],
    or: [0x72],
    shl: [0x74],
    eqz: [0x45],
    eq: [0x46],
    gtu: [0x4b],
    call: i => [0x10, ...uleb(i)],
    ifVoid: [0x04, 0x40],
    end: [0x0b],
    ret: [0x0f],
    drop: [0x1a],
    store: offset => [0x36, 0x42, 0x01, ...uleb(offset)],
    storeF: offset => [0x38, 0x42, 0x01, ...uleb(offset)],
    loadHeap: offset => [0x28, 0x02, ...uleb(offset)],
    atomicStore: [0xfe, 0x17, 0x42, 0x01, 0x00],
    atomicLoad: [0xfe, 0x10, 0x42, 0x01, 0x00],
    notify: [0xfe, 0x00, 0x42, 0x01, 0x00],
    copyFromHeap: [0xfc, 0x0a, 0x01, 0x00],
  };

  const buildRecorder = () => {
    const types = [];
    const typeOf = (params, results = '') => {
      const key = `${params}:${results}`;
      let at = types.findIndex(t => t.key === key);
      if (at < 0) {
        at = types.length;
        types.push({ key, bytes: [0x60, ...vector([...params].map(c => [VALUE[c]])), ...vector([...results].map(c => [VALUE[c]]))] });
      }
      return at;
    };

    const imports = [
      { name: 'room', params: 'i', results: 'i' },
      { name: 'bindBufferSlow', params: 'ii' },
      { name: 'vertexAttribPointerSlow', params: 'iiiiii' },
      { name: 'drawElementsSlow', params: 'iiii' },
      { name: 'bufferSubSlow', params: 'iiii' },
    ];
    const importIndex = name => imports.findIndex(item => item.name === name);

    const G = { w: 0, lim: 1, array: 2, element: 3, program: 4, drawFb: 5, readFb: 6, unit: 7 };
    const GLOBAL_COUNT = 8;

    const funcs = [];
    const add = (exportName, params, results, locals, body) => funcs.push({ exportName, params, results, locals, body });

    const reserveFixed = (bytes, p) => [
      ...INS.gget(G.w), ...INS.tee(p), ...INS.i32(bytes), ...INS.add, ...INS.gget(G.lim), ...INS.gtu, ...INS.ifVoid,
      ...INS.i32(bytes), ...INS.call(importIndex('room')), ...INS.set(p), ...INS.end,
    ];
    const reserveDynamic = (total, p) => [
      ...INS.gget(G.w), ...INS.tee(p), ...INS.get(total), ...INS.add, ...INS.gget(G.lim), ...INS.gtu, ...INS.ifVoid,
      ...INS.get(total), ...INS.call(importIndex('room')), ...INS.set(p), ...INS.end,
    ];
    const finishFixed = (bytes, p) => [...INS.get(p), ...INS.i32(bytes), ...INS.add, ...INS.gset(G.w)];
    const publish = [
      ...INS.i32(WORD.HEAD * 4), ...INS.gget(G.w), ...INS.atomicStore,
      ...INS.i32(WORD.SLEEP * 4), ...INS.atomicLoad, ...INS.ifVoid,
      ...INS.i32(WORD.HEAD * 4), ...INS.i32(1), ...INS.notify, ...INS.drop, ...INS.end,
    ];

    const record = (op, sig, p) => {
      const bytes = 4 + sig.length * 4;
      const body = [...reserveFixed(bytes, p), ...INS.get(p), ...INS.i32(op), ...INS.store(0)];
      [...sig].forEach((type, i) => {
        body.push(...INS.get(p), ...INS.get(i));
        body.push(...(type === 'f' ? INS.storeF(4 + i * 4) : INS.store(4 + i * 4)));
      });
      body.push(...finishFixed(bytes, p));
      return body;
    };

    const simple = (glName, callName, options = {}) => {
      const [, sig] = CALLS.find(([name]) => name === callName);
      const wasmSig = sig.replace(/[BTFRVPS]/g, 'i');
      const p = wasmSig.length;
      const body = [];
      if (options.before) body.push(...options.before);
      body.push(...record(OP[callName], wasmSig, p));
      if (options.publish) body.push(...publish);
      add(glName, wasmSig, '', 1, body);
    };

    simple('glActiveTexture', 'activeTexture', { before: [...INS.get(0), ...INS.gset(G.unit)] });
    simple('glBindBufferBase', 'bindBufferBase');
    simple('glBindBufferRange', 'bindBufferRange');
    simple('glBindFramebuffer', 'bindFramebuffer', {
      before: [
        ...INS.get(0), ...INS.i32(0x8CA8), ...INS.eq, ...INS.eqz, ...INS.ifVoid, ...INS.get(1), ...INS.gset(G.drawFb), ...INS.end,
        ...INS.get(0), ...INS.i32(0x8CA9), ...INS.eq, ...INS.eqz, ...INS.ifVoid, ...INS.get(1), ...INS.gset(G.readFb), ...INS.end,
      ],
    });
    simple('glBindTexture', 'bindTexture');
    simple('glBlendFunc', 'blendFunc');
    simple('glBlendFuncSeparate', 'blendFuncSeparate');
    simple('glColorMask', 'colorMask');
    simple('glCullFace', 'cullFace');
    simple('glDepthFunc', 'depthFunc');
    simple('glDepthMask', 'depthMask');
    simple('glDisable', 'disable');
    simple('glEnable', 'enable');
    simple('glEnableVertexAttribArray', 'enableVertexAttribArray');
    simple('glDisableVertexAttribArray', 'disableVertexAttribArray');
    simple('glDrawArrays', 'drawArrays', { publish: true });
    simple('glDrawArraysInstanced', 'drawArraysInstanced', { publish: true });
    simple('glDrawElementsInstanced', 'drawElementsInstanced', { publish: true });
    simple('glPolygonOffset', 'polygonOffset');
    simple('glScissor', 'scissor');
    simple('glStencilFunc', 'stencilFunc');
    simple('glStencilMask', 'stencilMask');
    simple('glStencilOp', 'stencilOp');
    simple('glTexParameteri', 'texParameteri');
    simple('glTexParameterf', 'texParameterf');
    simple('glUseProgram', 'useProgram', { before: [...INS.get(0), ...INS.gset(G.program)] });
    simple('glViewport', 'viewport');
    simple('glClear', 'clear');
    simple('glClearColor', 'clearColor');
    simple('glClearDepthf', 'clearDepth');
    simple('glClearStencil', 'clearStencil');

    add('glBindBuffer', 'ii', '', 1, [
      ...INS.get(0), ...INS.i32(0x88EB), ...INS.eq, ...INS.get(0), ...INS.i32(0x88EC), ...INS.eq, ...INS.or, ...INS.ifVoid,
      ...INS.get(0), ...INS.get(1), ...INS.call(importIndex('bindBufferSlow')), ...INS.ret, ...INS.end,
      ...INS.get(0), ...INS.i32(0x8892), ...INS.eq, ...INS.ifVoid, ...INS.get(1), ...INS.gset(G.array), ...INS.end,
      ...INS.get(0), ...INS.i32(0x8893), ...INS.eq, ...INS.ifVoid, ...INS.get(1), ...INS.gset(G.element), ...INS.end,
      ...record(OP.bindBuffer, 'ii', 2),
    ]);
    add('glVertexAttribPointer', 'iiiiii', '', 1, [
      ...INS.gget(G.array), ...INS.eqz, ...INS.ifVoid,
      ...INS.get(0), ...INS.get(1), ...INS.get(2), ...INS.get(3), ...INS.get(4), ...INS.get(5), ...INS.call(importIndex('vertexAttribPointerSlow')), ...INS.ret, ...INS.end,
      ...record(OP.vertexAttribPointer, 'iiiiii', 6),
    ]);
    add('glDrawElements', 'iiii', '', 1, [
      ...INS.gget(G.element), ...INS.eqz, ...INS.ifVoid,
      ...INS.get(0), ...INS.get(1), ...INS.get(2), ...INS.get(3), ...INS.call(importIndex('drawElementsSlow')), ...INS.ret, ...INS.end,
      ...record(OP.drawElements, 'iiii', 4),
      ...publish,
    ]);
    add('glBufferSubData', 'iiii', '', 2, [
      ...INS.get(2), ...INS.i32(DIRECT_BYTES), ...INS.gtu, ...INS.ifVoid,
      ...INS.get(0), ...INS.get(1), ...INS.get(2), ...INS.get(3), ...INS.call(importIndex('bufferSubSlow')), ...INS.ret, ...INS.end,
      ...INS.get(2), ...INS.i32(19), ...INS.add, ...INS.i32(-4), ...INS.and, ...INS.set(5),
      ...reserveDynamic(5, 4),
      ...INS.get(4), ...INS.i32(OP.BUFFER_SUB), ...INS.store(0),
      ...INS.get(4), ...INS.get(0), ...INS.store(4),
      ...INS.get(4), ...INS.get(1), ...INS.store(8),
      ...INS.get(4), ...INS.get(2), ...INS.store(12),
      ...INS.get(4), ...INS.i32(16), ...INS.add, ...INS.get(3), ...INS.get(2), ...INS.copyFromHeap,
      ...INS.get(4), ...INS.get(5), ...INS.add, ...INS.gset(G.w),
    ]);
    add('glClearBufferfv', 'iii', '', 1, [
      ...reserveFixed(28, 3),
      ...INS.get(3), ...INS.i32(OP.CLEAR_BUFFER_FV), ...INS.store(0),
      ...INS.get(3), ...INS.get(0), ...INS.store(4),
      ...INS.get(3), ...INS.get(1), ...INS.store(8),
      ...INS.get(3), ...INS.get(2), ...INS.loadHeap(0), ...INS.store(12),
      ...INS.get(3), ...INS.get(2), ...INS.loadHeap(4), ...INS.store(16),
      ...INS.get(3), ...INS.get(2), ...INS.loadHeap(8), ...INS.store(20),
      ...INS.get(3), ...INS.get(2), ...INS.loadHeap(12), ...INS.store(24),
      ...finishFixed(28, 3),
    ]);
    add('glDrawBuffers', 'ii', '', 2, [
      ...INS.get(0), ...INS.i32(2), ...INS.shl, ...INS.i32(8), ...INS.add, ...INS.set(3),
      ...reserveDynamic(3, 2),
      ...INS.get(2), ...INS.i32(OP.DRAW_BUFFERS), ...INS.store(0),
      ...INS.get(2), ...INS.get(0), ...INS.store(4),
      ...INS.get(2), ...INS.i32(8), ...INS.add, ...INS.get(1), ...INS.get(0), ...INS.i32(2), ...INS.shl, ...INS.copyFromHeap,
      ...INS.get(2), ...INS.get(3), ...INS.add, ...INS.gset(G.w),
    ]);

    add('reserve', 'i', 'i', 1, [
      ...INS.gget(G.w), ...INS.tee(1), ...INS.get(0), ...INS.add, ...INS.gget(G.lim), ...INS.gtu, ...INS.ifVoid,
      ...INS.get(0), ...INS.call(importIndex('room')), ...INS.set(1), ...INS.end,
      ...INS.get(1), ...INS.get(0), ...INS.add, ...INS.gset(G.w),
      ...INS.get(1),
    ]);
    add('publish', '', '', 0, publish);
    add('getW', '', 'i', 0, INS.gget(G.w));
    add('setW', 'i', '', 0, [...INS.get(0), ...INS.gset(G.w)]);
    add('setLim', 'i', '', 0, [...INS.get(0), ...INS.gset(G.lim)]);
    add('getArray', '', 'i', 0, INS.gget(G.array));
    add('setArray', 'i', '', 0, [...INS.get(0), ...INS.gset(G.array)]);
    add('getElement', '', 'i', 0, INS.gget(G.element));
    add('setElement', 'i', '', 0, [...INS.get(0), ...INS.gset(G.element)]);
    add('getProgram', '', 'i', 0, INS.gget(G.program));
    add('getDrawFb', '', 'i', 0, INS.gget(G.drawFb));
    add('getReadFb', '', 'i', 0, INS.gget(G.readFb));
    add('getUnit', '', 'i', 0, INS.gget(G.unit));
    add('setProgram', 'i', '', 0, [...INS.get(0), ...INS.gset(G.program)]);
    add('setDrawFb', 'i', '', 0, [...INS.get(0), ...INS.gset(G.drawFb)]);
    add('setReadFb', 'i', '', 0, [...INS.get(0), ...INS.gset(G.readFb)]);
    add('setUnit', 'i', '', 0, [...INS.get(0), ...INS.gset(G.unit)]);

    const importEntries = [
      [...text('env'), ...text('heap'), 0x02, 0x03, ...uleb(1), ...uleb(65536)],
      [...text('env'), ...text('ring'), 0x02, 0x03, ...uleb(RING_PAGES), ...uleb(RING_PAGES)],
      ...imports.map(item => [...text('env'), ...text(item.name), 0x00, ...uleb(typeOf(item.params, item.results || ''))]),
    ];
    const functionEntries = funcs.map(item => uleb(typeOf(item.params, item.results)));
    const globalEntries = Array.from({ length: GLOBAL_COUNT }, (_, i) => [I32, 0x01, ...INS.i32(i === G.w ? START : 0), 0x0b]);
    const exportEntries = funcs.map((item, i) => [...text(item.exportName), 0x00, ...uleb(imports.length + i)]);
    const codeEntries = funcs.map(item => {
      const locals = item.locals ? [0x01, ...uleb(item.locals), I32] : [0x00];
      const bytes = [...locals, ...item.body, 0x0b];
      return [...uleb(bytes.length), ...bytes];
    });

    return new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ...section(1, vector(types.map(t => t.bytes))),
      ...section(2, vector(importEntries)),
      ...section(3, vector(functionEntries)),
      ...section(6, vector(globalEntries)),
      ...section(7, vector(exportEntries)),
      ...section(10, vector(codeEntries)),
    ]);
  };

  const HOT = ['glActiveTexture', 'glBindBuffer', 'glBindBufferBase', 'glBindBufferRange', 'glBindFramebuffer', 'glBindTexture', 'glBlendFunc', 'glBlendFuncSeparate', 'glBufferSubData', 'glClear', 'glClearBufferfv', 'glClearColor', 'glClearDepthf', 'glClearStencil', 'glColorMask', 'glCullFace', 'glDepthFunc', 'glDepthMask', 'glDisable', 'glDisableVertexAttribArray', 'glDrawArrays', 'glDrawArraysInstanced', 'glDrawBuffers', 'glDrawElements', 'glDrawElementsInstanced', 'glEnable', 'glEnableVertexAttribArray', 'glPolygonOffset', 'glScissor', 'glStencilFunc', 'glStencilMask', 'glStencilOp', 'glTexParameterf', 'glTexParameteri', 'glUseProgram', 'glVertexAttribPointer', 'glViewport'];

  const SAMPLER_TYPES = { sampler2D: 0x8B5E, sampler3D: 0x8B5F, samplerCube: 0x8B60, sampler2DArray: 0x8DC1, isampler2D: 0x8DCA, isampler3D: 0x8DCB, usampler2D: 0x8DD2, usampler3D: 0x8DD3, sampler2DShadow: 0x8B62 };
  const parseGlsl = source => ({
    samplers: [...source.matchAll(/^uniform\s+(?:\w+\s+)?(\w*sampler\w+)\s+(\w+);/gm)].map(m => ({ type: m[1], name: m[2] })),
    blocks: [...source.matchAll(/^layout\(std140\) uniform (block_CB(\d+)) \{ \w+ CB\d+\[(\d+)\]; \};/gm)].map(m => ({ name: m[1], number: Number(m[2]), size: Number(m[3]) * 16 })),
    attributes: [...source.matchAll(/^layout\(location = (\d+)\) in (\w+) (\w+);/gm)].map(m => ({ location: Number(m[1]), type: m[2], name: m[3] })),
  });

  const GLE = { VERTEX_SHADER: 0x8B31, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, DELETE_STATUS: 0x8B80, COMPLETION_STATUS: 0x91B1, VALIDATE_STATUS: 0x8B83, ATTACHED_SHADERS: 0x8B85, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89, ACTIVE_UNIFORM_BLOCKS: 0x8A36, UNIFORM_BLOCK_BINDING: 0x8A3F, UNIFORM_BLOCK_DATA_SIZE: 0x8A40, FRAMEBUFFER_COMPLETE: 0x8CD5, ALREADY_SIGNALED: 0x911A, TIMEOUT_EXPIRED: 0x911B, CONDITION_SATISFIED: 0x911C };

  class Bridge {
    constructor(canvas, ring, worker, limits, probe) {
      this.canvas = canvas;
      this.ring = ring;
      this.worker = worker;
      this.limits = limits;
      this.probe = probe;
      this.buffer = ring.buffer;
      this.i32 = new Int32Array(this.buffer);
      this.f32 = new Float32Array(this.buffer);
      this.u8 = new Uint8Array(this.buffer);
      this.statsView = new Float64Array(this.buffer, STATS_BYTE, STATS.length);
      this.encoder = new TextEncoder();
      this.nextShader = 1;
      this.nextPrivate = 1 << 24;
      this.syncSeq = 0;
      this.framesSent = 0;
      this.lastEndW = START;
      this.recorder = null;
      this.programs = new Map();
      this.width = canvas.width;
      this.height = canvas.height;
      this.errors = [];
      this.missing = [];
      this.inIteration = false;
      this.renderbuffer = 0;
      this.clipOrigin = 0x8CA1;
      this.clipDepth = 0x935E;
      this.defaultVao = { element: 0 };
      this.vao = this.defaultVao;
      const stats = {};
      STATS.forEach((name, i) => Object.defineProperty(stats, name, { enumerable: true, get: () => this.statsView[i] }));
      this.stats = stats;
      this.watchFrames();
    }

    get framesInFlight() { return this.framesSent - Atomics.load(this.i32, WORD.DONE); }

    get frameLimit() {
      return this.engineU8 && this.engineU8[ENGINE.FLAGS] & ENGINE.SHADOW_THREAD ? FRAME_LIMIT + 1 : FRAME_LIMIT;
    }

    get inIteration() { return this.iterating; }

    set inIteration(value) {
      if (value) this.iterationStart = performance.now();
      this.iterating = value;
    }

    watchFrames() {
      const seen = Atomics.load(this.i32, WORD.DONE);
      const next = () => {
        if (window.__webbloxFrameRelease) window.__webbloxFrameRelease();
        this.watchFrames();
      };
      const waiter = Atomics.waitAsync(this.i32, WORD.DONE, seen);
      if (waiter.async) waiter.value.then(next);
      else queueMicrotask(next);
    }

    frameEnd() {
      this.inIteration = false;
      if (this.helperAsked === false && window.__webbloxEngineExports) this.startHelper();
      if (this.engineU8 && this.engineU8[ENGINE.JOB_ACTIVE]) this.join();
      if (this.engineU8 && Atomics.load(this.sideControl, SIDE.FAILED) === 1) this.stopHelper('a shadow job failed');
      if (this.helperWaiting && Atomics.load(this.sideControl, SIDE.READY)) {
        this.helperWaiting = false;
        this.engineU8[ENGINE.FLAGS] |= ENGINE.SHADOW_THREAD;
      }
      const rec = this.recorder;
      if (!rec || rec.getW() === this.lastEndW) return;
      if (this.governed) this.governHelper();
      const p = rec.reserve(4);
      this.i32[p >> 2] = OP.FRAME_END;
      rec.publish();
      this.framesSent++;
      Atomics.store(this.i32, WORD.SENT, this.framesSent);
      this.lastEndW = rec.getW();
    }

    installRecorder(imports, heap) {
      if (this.recorder) return;
      this.heap = heap;
      this.worker.postMessage({ type: 'heap', heap });
      const original = {};
      for (const name of HOT) original[name] = imports[name];
      const instance = new WebAssembly.Instance(new WebAssembly.Module(buildRecorder()), {
        env: {
          heap,
          ring: this.ring,
          room: bytes => this.room(bytes),
          bindBufferSlow: original.glBindBuffer,
          vertexAttribPointerSlow: () => this.leaveWorker('the engine used client-side vertex arrays'),
          drawElementsSlow: () => this.leaveWorker('the engine used client-side index arrays'),
          bufferSubSlow: original.glBufferSubData,
        },
      });
      this.recorder = instance.exports;
      this.recorder.setLim(RING_BYTES - 8);
      for (const name of HOT) imports[name] = instance.exports[name];
      this.imports = imports;
      this.proxied = Object.keys(imports).filter(name => name.startsWith('gl') && !HOT.includes(name)).sort();
      const pixelStorei = imports.glPixelStorei;
      imports.glPixelStorei = (pname, value) => {
        if (pname === SIDE.KICK) this.kick();
        else if (pname === SIDE.JOIN) this.join();
        else if (pname === SIDE.SERVICE) this.serviceHelper();
        else pixelStorei(pname, value);
      };
    }

    attachSide(side) {
      this.side = side;
      this.sideControl = new Int32Array(side.ring.buffer);
      this.sideF64 = new Float64Array(side.ring.buffer, SIDE.VALUES_BYTE, 17);
      this.helperAsked = false;
      this.helperGone = false;
      this.helperStreamer = 0;
      this.governed = false;
      this.helperRequested = false;
      this.governor = { busy: 0, total: 0, frames: 0, last: 0, jobs: 0, overlap: 0, jobMs: 0, marks: 0, load: 0, kickAt: 0, retryAt: 0 };
      this.servicing = false;
      this.lockReleases = -1;
      this.lockWaitFrom = 0;
    }

    startHelper() {
      this.helperAsked = true;
      const exports = window.__webbloxEngineExports;
      if (!this.side || !exports || !exports.wb_thread_create) return;
      this.engineU8 = new Uint8Array(this.heap.buffer);
      this.engineI32 = new Int32Array(this.heap.buffer);
      this.engine = exports;
      const params = new URLSearchParams(location.search);
      let off = params.get('helper') === '0';
      try {
        if (sessionStorage.getItem('webblox.helperOff')) off = true;
      } catch (error) {}
      this.engineU8[ENGINE.FLAGS] = (params.get('lightcull') === '1' || params.get('lightgrid') === '0' ? 0 : ENGINE.SKIP_LIGHT_CULL);
      if (off) return;
      if (params.get('helper') === '1') this.requestHelper();
      else this.governed = true;
    }

    requestHelper() {
      if (this.helperRequested) {
        this.helperWaiting = true;
        return;
      }
      this.helperRequested = true;
      this.engineU8.fill(0, ENGINE.THREAD_ATTR, ENGINE.THREAD_ATTR + 64);
      this.engineI32[ENGINE.THREAD_ATTR >> 2] = SIDE.STACK_BYTES;
      this.engineU8[ENGINE.THREAD_REQUEST] = 1;
      this.helperWaiting = true;
    }

    governHelper() {
      const now = performance.now();
      const gov = this.governor;
      gov.busy += now - this.iterationStart;
      gov.total += gov.last ? now - gov.last : 0;
      gov.last = now;
      gov.frames++;
      if (gov.total < GOVERNOR_WINDOW_MS) return;
      const load = gov.busy / gov.total;
      const frameMs = gov.total / gov.frames;
      gov.load = load;
      const helping = (this.engineU8[ENGINE.FLAGS] & ENGINE.SHADOW_THREAD) !== 0;
      if (helping) {
        const jobMs = this.sideF64[15] - gov.jobMs;
        const marks = this.engineI32[ENGINE.MARKS_WRITE >> 2] - gov.marks;
        const job = gov.overlap >= jobMs ? jobMs / HELPER_SLOWDOWN : gov.overlap - jobMs * (1 - 1 / HELPER_SLOWDOWN);
        const useless = gov.jobs > 0 && job + marks * MARK_MS < gov.total * HELPER_MIN_GAIN;
        if (useless) gov.retryAt = now + HELPER_RETRY_MS;
        if (useless || load < HELPER_OFF_LOAD) this.engineU8[ENGINE.FLAGS] &= ~ENGINE.SHADOW_THREAD;
      } else if (!this.helperWaiting && load > HELPER_ON_LOAD && frameMs > HELPER_MIN_FRAME_MS && now >= gov.retryAt) {
        this.requestHelper();
      }
      gov.busy = 0;
      gov.total = 0;
      gov.frames = 0;
      gov.jobs = 0;
      gov.overlap = 0;
      gov.jobMs = this.sideF64[15];
      gov.marks = this.engineI32[ENGINE.MARKS_WRITE >> 2];
    }

    stopHelper(reason) {
      console.warn(`[webgpu] drawing shadows on the main thread: ${reason}`);
      Atomics.store(this.sideControl, SIDE.FAILED, 2);
      this.helperWaiting = false;
      this.governed = false;
      this.engineU8[ENGINE.FLAGS] &= ~ENGINE.SHADOW_THREAD;
      try { sessionStorage.setItem('webblox.helperOff', reason); } catch (error) {}
    }

    leaveHelper(reason) {
      console.warn(`[webgpu] reloading without the shadow thread: ${reason}`);
      this.helperGone = true;
      this.engineU8[ENGINE.JOB_ACTIVE] = 0;
      try { sessionStorage.setItem('webblox.helperOff', reason); } catch (error) {}
      location.reload();
      throw new Error(`shadow thread: ${reason}`);
    }

    prepareContext(context) {
      const u8 = this.engineU8;
      const i32 = this.engineI32;
      const block = i32[ENGINE.BLOCK >> 2];
      const clone = block;
      const device = block + ENGINE.CONTEXT_BYTES;
      const mainDevice = i32[(context + 12) >> 2];
      u8.copyWithin(clone, context, context + ENGINE.CONTEXT_BYTES);
      i32[(clone + 12) >> 2] = device;
      if (!this.deviceReady) {
        this.deviceReady = true;
        let backing = block + ENGINE.CONTEXT_BYTES + ENGINE.DEVICE_BYTES;
        for (let index = 0; index < 2; index++) {
          const slot = device + ENGINE.STREAMER_AT + index * ENGINE.STREAMER_BYTES;
          const source = mainDevice + ENGINE.STREAMER_AT + index * ENGINE.STREAMER_BYTES;
          u8.copyWithin(slot, source, source + ENGINE.STREAMER_BYTES);
          for (const offset of [0, 4, 8, 12, 16, 20, 44, 48]) i32[(slot + offset) >> 2] = 0;
          i32[(slot + 60) >> 2] = i32[(source + 60) >> 2] ? backing : 0;
          backing += (i32[(source + 32) >> 2] + i32[(source + 56) >> 2] + 255) & ~255;
        }
      }
      const after = ENGINE.STREAMER_AT + 2 * ENGINE.STREAMER_BYTES + 4;
      u8.copyWithin(device, mainDevice, mainDevice + ENGINE.STREAMER_AT);
      u8.copyWithin(device + after, mainDevice + after, mainDevice + ENGINE.DEVICE_BYTES);
      this.helperStreamer = 1 - this.helperStreamer;
      i32[(device + ENGINE.STREAMER_INDEX) >> 2] = this.helperStreamer;
      const slot = device + ENGINE.STREAMER_AT + this.helperStreamer * ENGINE.STREAMER_BYTES;
      for (const offset of [24, 28, 40, 72, 76]) i32[(slot + offset) >> 2] = 0;
      return clone;
    }

    kick() {
      const control = this.sideControl;
      if (this.engineU8.length !== this.heap.buffer.byteLength) {
        this.engineU8 = new Uint8Array(this.heap.buffer);
        this.engineI32 = new Int32Array(this.heap.buffer);
      }
      if (Atomics.load(control, SIDE.JOB) !== 0) this.join();
      const rec = this.recorder;
      rec.glEnable(SIDE.ENABLE_BEGIN);
      rec.publish();
      const job = ENGINE.JOB >> 2;
      this.engineI32[job + 1] = this.prepareContext(this.engineI32[job + 1]);
      this.governor.kickAt = performance.now();
      this.engineU8[ENGINE.JOB_ACTIVE] = ENGINE.JOB_RUNNING;
      Atomics.store(control, SIDE.DRAIN, 1);
      Atomics.store(control, SIDE.JOB, 1);
      Atomics.notify(control, SIDE.JOB);
    }

    join() {
      if (this.helperGone) return;
      if (this.engineU8[ENGINE.JOB_ACTIVE] === ENGINE.JOB_PENDING) this.kick();
      const control = this.sideControl;
      const gov = this.governor;
      if (gov.kickAt) {
        gov.overlap += performance.now() - gov.kickAt;
        gov.jobs++;
        gov.kickAt = 0;
      }
      Atomics.store(control, SIDE.DRAIN, 0);
      let spins = 0;
      let started = 0;
      while (Atomics.load(control, SIDE.JOB) !== 0) {
        if (Atomics.load(control, SIDE.REQUEST) === 1) this.serviceRequest();
        spins++;
        if ((spins & 4095) === 0) {
          const now = performance.now();
          if (!started) started = now;
          if (now - started > MAILBOX_WAIT_MS) this.checkMailbox();
          if (now - started > STALL_WAIT_MS) this.leaveHelper('it stopped answering');
        }
      }
      this.engineU8[ENGINE.JOB_ACTIVE] = 0;
    }

    checkMailbox() {
      try {
        this.engine._emscripten_check_mailbox();
      } catch (error) {}
    }

    pollHelper(started) {
      if (!this.engineU8 || !this.engineU8[ENGINE.JOB_ACTIVE] || this.servicing) return;
      this.serviceRequest();
      if (performance.now() - started > MAILBOX_WAIT_MS) this.checkMailbox();
    }

    serviceHelper() {
      const now = performance.now();
      const releases = this.engineI32[ENGINE.LOCK_RELEASES >> 2];
      if (releases !== this.lockReleases) {
        this.lockReleases = releases;
        this.lockWaitFrom = now;
      }
      if (Atomics.load(this.sideControl, SIDE.REQUEST) === 1) this.serviceRequest();
      else this.checkMailbox();
      if (now - this.lockWaitFrom > STALL_WAIT_MS) this.leaveHelper('it held the render lock too long');
    }

    serviceRequest() {
      const control = this.sideControl;
      if (this.servicing || Atomics.load(control, SIDE.REQUEST) !== 1) return;
      this.servicing = true;
      this.engineU8[ENGINE.REQUEST_FLAG] = 0;
      const values = this.sideF64;
      const name = this.proxied[Atomics.load(control, SIDE.REQUEST_INDEX)];
      const args = [];
      for (let i = 0, n = control[SIDE.REQUEST_COUNT]; i < n; i++) args.push(values[i]);
      const saved = { recorder: this.recorder, i32: this.i32, f32: this.f32, u8: this.u8, buffer: this.buffer };
      const rec = this.sideRecorder;
      rec.setW(control[SIDE.STATE + 6]);
      rec.setLim(0);
      rec.setArray(control[SIDE.STATE]);
      rec.setElement(control[SIDE.STATE + 1]);
      this.recorder = rec;
      this.buffer = this.side.ring.buffer;
      this.i32 = control;
      this.f32 = new Float32Array(this.buffer);
      this.u8 = new Uint8Array(this.buffer);
      try {
        const result = this.imports[name](...args);
        values[16] = typeof result === 'number' ? result : 0;
      } catch (error) {
        console.error(`[webgpu] ${name} failed for the shadow thread`, error);
        values[16] = 0;
      }
      control[SIDE.STATE + 6] = rec.getW();
      control[SIDE.STATE] = rec.getArray();
      control[SIDE.STATE + 1] = rec.getElement();
      Object.assign(this, saved);
      this.servicing = false;
      Atomics.store(control, SIDE.REQUEST, 2);
      Atomics.notify(control, SIDE.REQUEST);
    }

    leaveWorker(reason) {
      console.warn(`[webgpu] reloading without the render worker: ${reason}`);
      try { sessionStorage.setItem('webblox.glWorkerOff', reason); } catch (error) {}
      location.reload();
      throw new Error(`render worker: ${reason}`);
    }

    room(bytes) {
      if (bytes >= RING_BYTES - START - 64) throw new Error(`GL command of ${bytes} bytes is too large for the ring`);
      const rec = this.recorder;
      const started = performance.now();
      for (;;) {
        const w = rec.getW();
        const tail = Atomics.load(this.i32, WORD.TAIL) || START;
        if (w >= tail) {
          if (w + bytes + 8 <= RING_BYTES) {
            rec.setLim(RING_BYTES - 8);
            return w;
          }
          if (START + bytes + 8 < tail) {
            this.i32[w >> 2] = OP.WRAP;
            rec.setW(START);
            rec.publish();
            rec.setLim(tail - 8);
            return START;
          }
        } else if (w + bytes + 8 < tail) {
          rec.setLim(tail - 8);
          return w;
        }
        rec.publish();
        this.pollHelper(started);
        if (performance.now() - started > STALL_WAIT_MS) this.leaveWorker('it stopped reading GL commands');
      }
    }

    ints(op, ...values) {
      const rec = this.recorder;
      const p = rec.reserve(4 + values.length * 4);
      const at = p >> 2;
      this.i32[at] = op;
      for (let i = 0; i < values.length; i++) this.i32[at + 1 + i] = values[i];
      rec.publish();
    }

    blob(op, values, bytes) {
      const rec = this.recorder;
      const size = bytes ? bytes.length : 0;
      const direct = size > DIRECT_BYTES && bytes.buffer !== this.buffer && bytes.buffer instanceof SharedArrayBuffer;
      const header = 4 + values.length * 4;
      const total = direct ? header + 16 : (header + 4 + size + 3) & ~3;
      const p = rec.reserve(total);
      const at = p >> 2;
      this.i32[at] = op;
      for (let i = 0; i < values.length; i++) this.i32[at + 1 + i] = values[i];
      const sizeAt = at + 1 + values.length;
      if (direct) {
        const seq = ++this.syncSeq;
        this.i32[sizeAt] = -1;
        this.i32[sizeAt + 1] = bytes.byteOffset;
        this.i32[sizeAt + 2] = size;
        this.i32[sizeAt + 3] = seq;
        rec.publish();
        if (!this.waitFor(seq, STALL_WAIT_MS)) console.warn('[webgpu] a large upload is still waiting on the render worker');
        return;
      }
      this.i32[sizeAt] = size;
      if (bytes) this.u8.set(bytes, p + header + 4);
      rec.publish();
    }

    waitFor(seq, limit) {
      const started = performance.now();
      while (Atomics.load(this.i32, WORD.READ_SEQ) < seq) {
        this.pollHelper(started);
        if (performance.now() - started > limit) return false;
      }
      return true;
    }

    bytesOf(data, srcOffset, length) {
      if (!ArrayBuffer.isView(data)) return null;
      const size = data.BYTES_PER_ELEMENT || 1;
      const start = data.byteOffset + (srcOffset || 0) * size;
      const count = length ? length * size : data.byteLength - (srcOffset || 0) * size;
      return new Uint8Array(data.buffer, start, count);
    }

    idOf(object) {
      if (!object) return 0;
      if (object.id) return object.id;
      if (object.kind === undefined) return object.name | 0;
      object.id = this.nextPrivate++;
      this.ints(OP.CREATE, object.kind, object.id, 0);
      return object.id;
    }

    upload(op, values, data, offset) {
      if (typeof data === 'number') {
        this.blob(op, [...values, 2, data], null);
        return;
      }
      const bytes = data ? this.bytesOf(data, offset, 0) : null;
      this.blob(op, [...values, bytes ? 1 : 0, 0], bytes);
    }

    uploadCompressed(op, values, data, offset, length) {
      const bytes = this.bytesOf(data, offset, length);
      if (typeof data === 'number') this.noteUnsupported('compressed uploads through a pixel buffer');
      this.blob(op, [...values, bytes ? 1 : 0, 0], bytes);
    }

    noteUnsupported(what) {
      if (this.warned === what) return;
      this.warned = what;
      console.warn(`[webgpu] skipped ${what}`);
    }
  }

  class Named {
    constructor(bridge, kind) {
      this.bridge = bridge;
      this.kind = kind;
      this.id = 0;
      this.element = 0;
    }
    get name() { return this.id; }
    set name(value) {
      if (value && value !== this.id) {
        this.id = value;
        this.bridge.ints(OP.CREATE, this.kind, value, 0);
        if (this.kind === KINDS.PROGRAM) this.bridge.programs.set(value, this);
      } else if (!value) {
        if (this.kind === KINDS.PROGRAM) this.bridge.programs.delete(this.id);
        this.id = 0;
      }
    }
  }

  const makeContext = (bridge, canvas) => {
    const context = Object.create(WebGL2RenderingContext.prototype);
    const named = kind => () => new Named(bridge, kind);
    const ref = id => (id ? { name: id } : null);
    const methods = {
      getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false, desynchronized: false }),
      isContextLost: () => false,
      getError: () => 0,
      flush: () => {},
      finish: () => {},
      hint: () => {},
      getSupportedExtensions: () => {
        const list = bridge.probe.getSupportedExtensions().filter(name => name !== DEPTH_CLAMP_EXTENSION);
        return bridge.limits.depthClamp ? [...list, DEPTH_CLAMP_EXTENSION] : list;
      },
      getExtension: name => {
        if (name === DEPTH_CLAMP_EXTENSION) return bridge.limits.depthClamp ? { DEPTH_CLAMP_EXT: 0x864F } : null;
        if (name === 'EXT_clip_control') {
          return {
            LOWER_LEFT_EXT: 0x8CA1, UPPER_LEFT_EXT: 0x8CA2, NEGATIVE_ONE_TO_ONE_EXT: 0x935E, ZERO_TO_ONE_EXT: 0x935F,
            clipControlEXT: (origin, depth) => {
              bridge.clipOrigin = origin;
              bridge.clipDepth = depth;
              bridge.ints(OP.clipControl, origin, depth);
            },
          };
        }
        if (name === 'EXT_polygon_offset_clamp') return { POLYGON_OFFSET_CLAMP_EXT: 0x8E1B, polygonOffsetClampEXT: (factor, units) => methods.polygonOffset(factor, units) };
        if (name === 'EXT_texture_filter_anisotropic') return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE };
        if (name === 'EXT_disjoint_timer_query_webgl2' || name === 'EXT_disjoint_timer_query') return null;
        return bridge.probe.getSupportedExtensions().includes(name) ? bridge.probe.getExtension(name) : null;
      },
      getParameter: pname => {
        const rec = bridge.recorder;
        const limits = bridge.limits;
        switch (pname) {
          case 0x8894: return ref(rec.getArray());
          case 0x8895: return ref(rec.getElement());
          case 0x88EF: return ref(context.currentPixelUnpackBufferBinding | 0);
          case 0x88ED: return ref(context.currentPixelPackBufferBinding | 0);
          case 0x8CA6: return ref(rec.getDrawFb());
          case 0x8CAA: return ref(rec.getReadFb());
          case 0x8CA7: return ref(bridge.renderbuffer);
          case 0x8B8D: return bridge.programs.get(rec.getProgram()) || null;
          case 0x85B5: return bridge.vao === bridge.defaultVao ? null : bridge.vao;
          case 0x84E0: return rec.getUnit() || 0x84C0;
          case 0x0BA2: case 0x0C10: return new Int32Array([0, 0, bridge.width, bridge.height]);
          case 0x935C: return bridge.clipOrigin;
          case 0x935D: return bridge.clipDepth;
          case 0x0D57: return 8;
          case 0x8A34: return limits.minUniformBufferOffsetAlignment;
          case 0x0D33: case 0x851C: case 0x84E8: return Math.min(limits.maxTextureDimension2D, 16384);
          case 0x8073: return limits.maxTextureDimension3D;
          case 0x88FF: return limits.maxTextureArrayLayers;
          case 0x8872: return Math.min(16, limits.maxSampledTexturesPerShaderStage);
          case 0x8B4C: return 16;
          case 0x8B4D: return 32;
          case 0x8869: return Math.min(16, limits.maxVertexAttributes);
          case 0x8CDF: case 0x8824: return Math.min(8, limits.maxColorAttachments);
          case 0x8D57: return 4;
          default: return bridge.probe.getParameter(pname);
        }
      },
      getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
      getInternalformatParameter: () => new Int32Array([4, 1]),
      checkFramebufferStatus: () => GLE.FRAMEBUFFER_COMPLETE,
      createBuffer: named(KINDS.BUFFER),
      createTexture: named(KINDS.TEXTURE),
      createFramebuffer: named(KINDS.FRAMEBUFFER),
      createRenderbuffer: named(KINDS.RENDERBUFFER),
      createVertexArray: named(KINDS.VAO),
      createProgram: () => Object.assign(new Named(bridge, KINDS.PROGRAM), { shaders: [], locations: new Map() }),
      createShader: type => {
        const id = bridge.nextShader++;
        bridge.ints(OP.CREATE, KINDS.SHADER, id, type);
        return { id, type, source: '' };
      },
      shaderSource: (shader, source) => {
        shader.source = source;
        bridge.blob(OP.SHADER_SOURCE, [shader.id], bridge.encoder.encode(source));
      },
      getShaderSource: shader => shader.source,
      compileShader: shader => bridge.ints(OP.compileShader, shader.id),
      getShaderParameter: (shader, pname) => {
        if (pname === GLE.COMPILE_STATUS || pname === GLE.COMPLETION_STATUS) return true;
        if (pname === 0x8B4F) return shader.type;
        return 0;
      },
      getShaderInfoLog: () => '',
      deleteShader: shader => { if (shader) bridge.ints(OP.deleteShader, shader.id); },
      attachShader: (program, shader) => {
        program.shaders.push(shader);
        bridge.ints(OP.attachShader, bridge.idOf(program), shader.id);
      },
      detachShader: () => {},
      bindAttribLocation: () => {},
      validateProgram: () => {},
      linkProgram: program => {
        const vs = program.shaders.find(s => s.type === GLE.VERTEX_SHADER);
        const fs = program.shaders.find(s => s.type !== GLE.VERTEX_SHADER);
        if (vs && fs) {
          program.vsReflect = parseGlsl(vs.source);
          program.fsReflect = parseGlsl(fs.source);
          const names = new Map();
          for (const sampler of [...program.vsReflect.samplers, ...program.fsReflect.samplers]) names.set(sampler.name, sampler);
          program.glslSamplers = [...names.values()];
          const blockNames = new Map();
          for (const block of [...program.vsReflect.blocks, ...program.fsReflect.blocks]) {
            const known = blockNames.get(block.name);
            blockNames.set(block.name, known && known.size > block.size ? known : block);
          }
          program.glslBlocks = [...blockNames.values()].sort((a, b) => a.number - b.number);
        }
        bridge.ints(OP.linkProgram, bridge.idOf(program));
      },
      getProgramParameter: (program, pname) => {
        switch (pname) {
          case GLE.LINK_STATUS: case GLE.COMPLETION_STATUS: case GLE.VALIDATE_STATUS: return true;
          case GLE.DELETE_STATUS: return false;
          case GLE.ATTACHED_SHADERS: return program.shaders.length;
          case GLE.ACTIVE_UNIFORMS: return program.glslSamplers ? program.glslSamplers.length : 0;
          case GLE.ACTIVE_ATTRIBUTES: return program.vsReflect ? program.vsReflect.attributes.length : 0;
          case GLE.ACTIVE_UNIFORM_BLOCKS: return program.glslBlocks ? program.glslBlocks.length : 0;
          default: return 0;
        }
      },
      getProgramInfoLog: () => '',
      getActiveUniform: (program, index) => {
        const sampler = program.glslSamplers && program.glslSamplers[index];
        return sampler ? { name: sampler.name, size: 1, type: SAMPLER_TYPES[sampler.type] || 0x8B5E } : null;
      },
      getActiveAttrib: (program, index) => {
        const attribute = program.vsReflect && program.vsReflect.attributes[index];
        return attribute ? { name: attribute.name, size: 1, type: 0x8B52 } : null;
      },
      getAttribLocation: (program, name) => {
        const attribute = program.vsReflect && program.vsReflect.attributes.find(a => a.name === name);
        return attribute ? attribute.location : -1;
      },
      getUniformLocation: (program, name) => {
        if (!program.glslSamplers || !program.glslSamplers.some(s => s.name === name)) return null;
        let location = program.locations.get(name);
        if (!location) {
          location = { program, name };
          program.locations.set(name, location);
        }
        return location;
      },
      uniform1i: (location, value) => {
        if (location) bridge.blob(OP.UNIFORM1I, [bridge.idOf(location.program), value], bridge.encoder.encode(location.name));
      },
      getUniformBlockIndex: (program, name) => {
        const match = /^block_CB(\d+)$/.exec(name);
        if (!match || !program.glslBlocks || !program.glslBlocks.some(b => b.name === name)) return 0xFFFFFFFF;
        return Number(match[1]);
      },
      uniformBlockBinding: () => {},
      getActiveUniformBlockName: (program, index) => (program.glslBlocks[index] ? program.glslBlocks[index].name : null),
      getActiveUniformBlockParameter: (program, index, pname) => {
        const block = program.glslBlocks[index];
        if (!block) return 0;
        if (pname === GLE.UNIFORM_BLOCK_DATA_SIZE) return block.size;
        if (pname === GLE.UNIFORM_BLOCK_BINDING) return block.number;
        return 0;
      },
      fenceSync: () => ({ name: 0 }),
      deleteSync: () => {},
      waitSync: () => {},
      clientWaitSync: (sync, flags, timeout) => {
        if (bridge.framesInFlight < FRAME_LIMIT) return GLE.ALREADY_SIGNALED;
        return timeout > 0 ? GLE.CONDITION_SATISFIED : GLE.TIMEOUT_EXPIRED;
      },
      getSyncParameter: (sync, pname) => {
        if (pname === 0x9114) return bridge.framesInFlight < bridge.frameLimit ? 0x9119 : 0x9118;
        return 0;
      },
      bindVertexArray: vao => {
        const rec = bridge.recorder;
        bridge.vao.element = rec.getElement();
        bridge.vao = vao || bridge.defaultVao;
        rec.setElement(bridge.vao.element);
        bridge.ints(OP.bindVertexArray, bridge.idOf(vao));
      },
      bufferData: (target, sizeOrData, usage, srcOffset, length) => {
        const bytes = typeof sizeOrData === 'number' ? null : bridge.bytesOf(sizeOrData, srcOffset, length);
        bridge.blob(OP.BUFFER_DATA, [target, usage, bytes ? bytes.length : sizeOrData], bytes);
      },
      bufferSubData: (target, offset, data, srcOffset, length) => {
        const bytes = bridge.bytesOf(data, srcOffset, length);
        if (bytes) bridge.blob(OP.BUFFER_SUB, [target, offset], bytes);
      },
      clearBufferfv: (buffer, drawbuffer, values, offset) => {
        const at = offset || 0;
        const rec = bridge.recorder;
        const p = rec.reserve(28) >> 2;
        bridge.i32[p] = OP.CLEAR_BUFFER_FV;
        bridge.i32[p + 1] = buffer;
        bridge.i32[p + 2] = drawbuffer;
        for (let i = 0; i < 4; i++) bridge.f32[p + 3 + i] = values[at + i];
        rec.publish();
      },
      clearBufferiv: (buffer, drawbuffer, values, offset) => {
        const at = offset || 0;
        bridge.ints(OP.CLEAR_BUFFER_IV, buffer, drawbuffer, values[at] | 0, values[at + 1] | 0, values[at + 2] | 0, values[at + 3] | 0);
      },
      clearBufferuiv: (buffer, drawbuffer, values, offset) => methods.clearBufferiv(buffer, drawbuffer, values, offset),
      drawBuffers: list => bridge.ints(OP.DRAW_BUFFERS, list.length, ...list),
      invalidateFramebuffer: (target, attachments) => bridge.ints(OP.INVALIDATE, target, attachments.length, ...attachments),
      invalidateSubFramebuffer: () => {},
      readBuffer: () => {},
      colorMask: (r, g, b, a) => bridge.ints(OP.colorMask, r ? 1 : 0, g ? 1 : 0, b ? 1 : 0, a ? 1 : 0),
      depthMask: flag => bridge.ints(OP.depthMask, flag ? 1 : 0),
      bindRenderbuffer: (target, renderbuffer) => {
        bridge.renderbuffer = bridge.idOf(renderbuffer);
        bridge.ints(OP.bindRenderbuffer, target, bridge.renderbuffer);
      },
      texImage2D: (target, level, internal, width, height, border, format, type, data, offset) => {
        bridge.upload(OP.TEX_IMAGE_2D, [target, level, internal, width, height, border, format, type], data, offset);
      },
      texImage3D: (target, level, internal, width, height, depth, border, format, type, data, offset) => {
        bridge.upload(OP.TEX_IMAGE_3D, [target, level, internal, width, height, depth, border, format, type], data, offset);
      },
      texSubImage2D: (target, level, x, y, width, height, format, type, data, offset) => {
        bridge.upload(OP.TEX_SUB_2D, [target, level, x, y, width, height, format, type], data, offset);
      },
      texSubImage3D: (target, level, x, y, z, width, height, depth, format, type, data, offset) => {
        bridge.upload(OP.TEX_SUB_3D, [target, level, x, y, z, width, height, depth, format, type], data, offset);
      },
      compressedTexImage2D: (target, level, internal, width, height, border, data, offset, length) => {
        bridge.uploadCompressed(OP.COMPRESSED_2D, [target, level, internal, width, height, border], data, offset, length);
      },
      compressedTexImage3D: (target, level, internal, width, height, depth, border, data, offset, length) => {
        bridge.uploadCompressed(OP.COMPRESSED_3D, [target, level, internal, width, height, depth, border], data, offset, length);
      },
      compressedTexSubImage2D: (target, level, x, y, width, height, format, data, offset, length) => {
        bridge.uploadCompressed(OP.COMPRESSED_SUB_2D, [target, level, x, y, width, height, format], data, offset, length);
      },
      compressedTexSubImage3D: (target, level, x, y, z, width, height, depth, format, data, offset, length) => {
        bridge.uploadCompressed(OP.COMPRESSED_SUB_3D, [target, level, x, y, z, width, height, depth, format], data, offset, length);
      },
      readPixels: (x, y, width, height, format, type, pixels, offset) => {
        const bytes = typeof pixels === 'number' ? null : bridge.bytesOf(pixels, offset, 0);
        if (bytes && !(bytes.buffer instanceof SharedArrayBuffer)) {
          bytes.fill(0);
          return;
        }
        if (!bytes && typeof pixels !== 'number') return;
        const seq = ++bridge.syncSeq;
        Atomics.store(bridge.i32, WORD.READ_CLAIM, seq);
        if (bytes) bridge.ints(OP.READ_PIXELS, seq, x, y, width, height, format, type, 0, bytes.byteOffset, bytes.length);
        else bridge.ints(OP.READ_PIXELS, seq, x, y, width, height, format, type, 1, pixels, 0);
        if (bridge.waitFor(seq, READ_WAIT_MS)) return;
        if (Atomics.compareExchange(bridge.i32, WORD.READ_CLAIM, seq, 0) === seq) {
          if (bytes) bytes.fill(0);
          console.warn(`[webgpu] readPixels gave up after ${READ_WAIT_MS} ms and returned a blank image`);
          return;
        }
        bridge.waitFor(seq, READ_WAIT_MS);
      },
    };
    const object = { B: 1, T: 1, F: 1, R: 1, V: 1, P: 1, S: 1 };
    for (const [name, signature] of CALLS) {
      if (methods[name] || name === 'clipControl') continue;
      const code = OP[name];
      if (signature.includes('f')) {
        methods[name] = (...args) => {
          const rec = bridge.recorder;
          const at = rec.reserve(4 + signature.length * 4) >> 2;
          bridge.i32[at] = code;
          for (let i = 0; i < signature.length; i++) {
            if (signature[i] === 'f') bridge.f32[at + 1 + i] = args[i];
            else bridge.i32[at + 1 + i] = args[i];
          }
          rec.publish();
        };
      } else {
        methods[name] = (...args) => {
          const values = new Array(signature.length);
          for (let i = 0; i < signature.length; i++) values[i] = object[signature[i]] ? bridge.idOf(args[i]) : args[i] | 0;
          bridge.ints(code, ...values);
        };
      }
    }
    for (const [name, value] of Object.entries(methods)) context[name] = value;
    const accessor = (name, get, set) => Object.defineProperty(context, name, { configurable: true, get, set });
    accessor('canvas', () => canvas);
    accessor('drawingBufferWidth', () => bridge.width);
    accessor('drawingBufferHeight', () => bridge.height);
    accessor('currentProgram', () => bridge.programs.get(bridge.recorder.getProgram()), () => {});
    accessor('currentArrayBufferBinding', () => bridge.recorder.getArray(), value => bridge.recorder.setArray(value | 0));
    accessor('currentElementArrayBufferBinding', () => bridge.recorder.getElement(), value => bridge.recorder.setElement(value | 0));
    Object.defineProperty(context, 'drawingBufferColorSpace', { value: 'srgb', writable: true });
    return context;
  };

  const multiMemoryWorks = () => {
    try {
      new WebAssembly.Module(buildRecorder());
      return true;
    } catch (error) {
      return false;
    }
  };

  window.__webgpuWorkerWanted = () => {
    const params = new URLSearchParams(location.search);
    if (params.get('glworker') === '0' || params.get('gltrace')) return false;
    try {
      if (sessionStorage.getItem('webblox.glWorkerOff')) return false;
    } catch (error) {}
    return typeof Atomics.waitAsync === 'function' && typeof OffscreenCanvas === 'function' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' && self.crossOriginIsolated === true && multiMemoryWorks();
  };

  const loadWorker = async () => {
    for (let attempt = 1; ; attempt++) {
      const worker = new Worker(`/js/gl-worker.js${location.search}`);
      const failure = await new Promise(resolve => {
        worker.onerror = event => resolve(event.message || 'render worker failed to load');
        worker.onmessage = event => {
          if (event.data.type === 'loaded') resolve(null);
        };
      });
      if (!failure) return worker;
      worker.terminate();
      if (attempt === WORKER_LOAD_TRIES) throw new Error(failure);
      console.warn(`[local] render worker load ${attempt} failed, retrying:`, failure);
      await new Promise(resolve => setTimeout(resolve, WORKER_RETRY_MS));
    }
  };

  window.__webgpuStartWorker = async (canvas, onFailure) => {
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (!probe) throw new Error('no WebGL2 context for capability queries');
    const ring = new WebAssembly.Memory({ initial: RING_PAGES, maximum: RING_PAGES, shared: true });
    const sideRing = new WebAssembly.Memory({ initial: RING_PAGES, maximum: RING_PAGES, shared: true });
    const worker = await loadWorker();
    const offscreen = canvas.transferControlToOffscreen();
    let width = canvas.width;
    let height = canvas.height;
    const limits = await new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message || 'render worker failed to load'));
      worker.onmessage = event => {
        if (event.data.type === 'ready') resolve(event.data.limits);
        else if (event.data.type === 'failure') reject(new Error(event.data.reason));
      };
      worker.postMessage({ type: 'init', ring, sideRing, canvas: offscreen, starWidth: window.__webbloxStarWidth, fullbright: window.__webbloxFullbright }, [offscreen]);
    });
    const bridge = new Bridge(canvas, ring, worker, limits, probe);
    const recorderModule = new WebAssembly.Module(buildRecorder());
    bridge.attachSide({ ring: sideRing, module: recorderModule });
    globalThis.__webbloxThreadGl = { module: recorderModule, ring: sideRing, hot: HOT };
    worker.onerror = event => onFailure(event.message || 'render worker crashed');
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'failure') onFailure(message.reason);
      else if (message.type === 'error') bridge.errors.push(message.message);
      else if (message.type === 'missing') bridge.missing.push(message.source);
    };
    const resize = () => {
      bridge.width = width;
      bridge.height = height;
      if (bridge.recorder) bridge.ints(OP.RESIZE, width, height);
    };
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => width,
      set: value => {
        const next = Number(value) | 0;
        if (next !== width) {
          width = next;
          resize();
        }
      },
    });
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get: () => height,
      set: value => {
        const next = Number(value) | 0;
        if (next !== height) {
          height = next;
          resize();
        }
      },
    });
    const context = makeContext(bridge, canvas);
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    canvas.getContext = (kind, attrs) => (kind === 'webgl2' ? context : nativeGetContext.call(canvas, kind, attrs));
    window.__webgpuGL = bridge;
    (window.__webbloxImportPatches = window.__webbloxImportPatches || []).push((imports, heap) => {
      bridge.installRecorder(imports, heap);
      bridge.sideRecorder = new WebAssembly.Instance(recorderModule, {
        env: {
          heap,
          ring: sideRing,
          room: bytes => bridge.room(bytes),
          bindBufferSlow: () => {},
          vertexAttribPointerSlow: () => bridge.leaveWorker('the engine used client-side vertex arrays'),
          drawElementsSlow: () => bridge.leaveWorker('the engine used client-side index arrays'),
          bufferSubSlow: () => {},
        },
      }).exports;
      resize();
    });
    return bridge;
  };
})();
