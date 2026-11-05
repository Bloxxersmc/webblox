(() => {
  'use strict';

  const { RING_PAGES, START, WORD, DIRECT_BYTES, SIDE, ENGINE } = self.__webbloxGlOps;
  const RING_BYTES = RING_PAGES * 65536;
  const HELPER_SPIN_MS = 40;
  const CLOCK_REFRESH_MASK = 15;
  const info = globalThis.__wbThreadGl;
  const control = new Int32Array(info.ring.buffer);
  const values = new Float64Array(info.ring.buffer, SIDE.VALUES_BYTE, 17);
  let rec = null;
  let proxied = [];
  let heapBytes = null;
  let helperClock = false;
  let clockCalls = 0;
  let clockValue = 0;

  const room = bytes => {
    if (bytes >= RING_BYTES - START - 64) throw new Error(`GL command of ${bytes} bytes is too large for the side ring`);
    for (;;) {
      const w = rec.getW();
      const tail = Atomics.load(control, WORD.TAIL) || START;
      if (w >= tail) {
        if (w + bytes + 8 <= RING_BYTES) {
          rec.setLim(RING_BYTES - 8);
          return w;
        }
        if (START + bytes + 8 < tail) {
          control[w >> 2] = self.__webbloxGlOps.OP.WRAP;
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
      Atomics.wait(control, WORD.TAIL, tail, 1);
    }
  };

  const askMain = (index, args) => {
    values[14] += 1;
    rec.publish();
    control[SIDE.STATE] = rec.getArray();
    control[SIDE.STATE + 1] = rec.getElement();
    control[SIDE.STATE + 6] = rec.getW();
    for (let i = 0; i < args.length; i++) values[i] = args[i];
    control[SIDE.REQUEST_COUNT] = args.length;
    Atomics.store(control, SIDE.REQUEST_INDEX, index);
    Atomics.store(control, SIDE.REQUEST, 1);
    heapBytes[ENGINE.REQUEST_FLAG] = 1;
    while (Atomics.load(control, SIDE.REQUEST) !== 2) Atomics.wait(control, SIDE.REQUEST, 1, 50);
    Atomics.store(control, SIDE.REQUEST, 0);
    rec.setArray(control[SIDE.STATE]);
    rec.setElement(control[SIDE.STATE + 1]);
    rec.setW(control[SIDE.STATE + 6]);
    rec.setLim(0);
    return values[16];
  };

  globalThis.__wbInstallThreadGl = (imports, heap) => {
    heapBytes = new Uint8Array(heap.buffer);
    const hot = new Set(info.hot);
    const now = imports.emscripten_get_now;
    imports.emscripten_get_now = () => {
      if (!helperClock) return now();
      if ((clockCalls++ & CLOCK_REFRESH_MASK) === 0) clockValue = now();
      return clockValue;
    };
    proxied = Object.keys(imports).filter(name => name.startsWith('gl') && !hot.has(name)).sort();
    proxied.forEach((name, index) => {
      imports[name] = (...args) => askMain(index, args);
    });
    const instance = new WebAssembly.Instance(info.module, {
      env: {
        heap,
        ring: info.ring,
        room,
        bindBufferSlow: (target, buffer) => { throw new Error(`the shadow thread bound pixel buffer ${buffer} to ${target}`); },
        vertexAttribPointerSlow: () => { throw new Error('the shadow thread used client-side vertex arrays'); },
        drawElementsSlow: () => { throw new Error('the shadow thread used client-side index arrays'); },
        bufferSubSlow: (target, offset, size, data) => {
          let done = 0;
          while (done < size) {
            const part = Math.min(size - done, DIRECT_BYTES);
            rec.glBufferSubData(target, offset + done, part, data + done);
            done += part;
          }
        },
      },
    });
    rec = instance.exports;
    rec.setLim(RING_BYTES - 8);
    for (const name of info.hot) imports[name] = rec[name];
  };

  globalThis.__wbHelperLoop = async (exports, memory) => {
    const heap = new Int32Array(memory.buffer);
    const job = ENGINE.JOB >> 2;
    Atomics.store(control, SIDE.READY, 1);
    const pause = Atomics.pause ? () => Atomics.pause() : () => {};
    helperClock = true;
    for (;;) {
      const spinUntil = performance.now() + HELPER_SPIN_MS;
      while (Atomics.load(control, SIDE.JOB) === 0 && performance.now() < spinUntil) pause();
      Atomics.wait(control, SIDE.JOB, 0);
      if (Atomics.load(control, SIDE.JOB) !== 1) continue;
      const started = performance.now();
      clockCalls = 0;
      try {
        exports.wb_shadow_tiles(heap[job], heap[job + 1], heap[job + 2], heap[job + 3], heap[job + 4], heap[job + 5]);
      } catch (error) {
        console.error('helper: shadow job failed', error && error.stack || error);
        if (Atomics.load(heap, ENGINE.LOCK >> 2) === exports.pthread_self()) {
          heap[ENGINE.DEPTH >> 2] = 0;
          Atomics.store(heap, ENGINE.LOCK >> 2, 0);
        }
        Atomics.store(control, SIDE.FAILED, 1);
      }
      values[15] += performance.now() - started;
      rec.glEnable(SIDE.ENABLE_END);
      rec.publish();
      while (Atomics.load(control, SIDE.DRAIN) === 1) {
        exports.wb_drain_marks();
        pause();
      }
      exports.wb_drain_marks();
      Atomics.store(control, SIDE.JOB, 0);
      Atomics.notify(control, SIDE.JOB);
    }
  };
})();
