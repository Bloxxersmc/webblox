(() => {
  'use strict';

  if (new URLSearchParams(location.search).get('lightgrid') === '0') return;

  const proto = window.__webbloxWebGPU ? {} : WebGL2RenderingContext.prototype;
  const GL = {
    UNIFORM_BUFFER: 0x8A11,
    TEXTURE_3D: 0x806F,
    TEXTURE0: 0x84C0,
    R32I: 0x8235,
    R16I: 0x8233,
    RED_INTEGER: 0x8D94,
    INT: 0x1404,
    SHORT: 0x1402,
    UNPACK_ALIGNMENT: 0x0CF5,
    UNPACK_ROW_LENGTH: 0x0CF2,
    UNPACK_IMAGE_HEIGHT: 0x806E,
    UNPACK_SKIP_PIXELS: 0x0CF4,
    UNPACK_SKIP_ROWS: 0x0CF3,
    UNPACK_SKIP_IMAGES: 0x806D,
    PIXEL_UNPACK_BUFFER: 0x88EC,
  };
  const GRID_UNIT = 12;
  const INDEX_UNIT = 13;
  const LIGHT_STRIDE = 5;
  const MAX_LIGHTS = 204;
  const MAX_PER_CELL = 4095;
  const CELL_LIGHTS = (cap => (cap > 0 ? cap : MAX_PER_CELL))(Number(new URLSearchParams(location.search).get('lightcap') ?? 0));
  const MIN_PACKED_RANGE = 10;
  const FROXEL_ROW = 54;
  const GLOBALS_BINDING = 0;
  const LIGHTS_BINDING = 6;
  const CHUNK_SHIFT = 10;
  const INDEX_CAPACITY = 256;

  const contexts = new WeakMap();
  const ctx = gl => {
    let c = contexts.get(gl);
    if (!c) {
      c = { unit: 0, units: new Map(), uniform: null, unpackBuffer: null, unpack: new Map(), bindings: new Map(), inputs: null, ring: null };
      contexts.set(gl, c);
    }
    return c;
  };

  const shaderSources = new WeakMap();
  const original = {};
  for (const name of ['shaderSource', 'attachShader', 'useProgram', 'activeTexture', 'bindTexture', 'texStorage3D', 'bindBuffer', 'pixelStorei',
                      'bindBufferBase', 'bindBufferRange', 'bufferData', 'bufferSubData', 'drawElements', 'drawElementsInstanced',
                      'drawArrays', 'drawArraysInstanced']) {
    original[name] = proto[name];
  }

  proto.shaderSource = function (shader, source) {
    shaderSources.set(shader, source);
    return original.shaderSource.apply(this, arguments);
  };

  proto.attachShader = function (program, shader) {
    const source = shaderSources.get(shader) || '';
    if (/\bisampler3D\s+\w+\s*;/.test(source) && /\bCB6\b/.test(source)) program.__webbloxLightGrid = true;
    return original.attachShader.apply(this, arguments);
  };

  let current = null;
  proto.useProgram = function (program) {
    current = program;
    return original.useProgram.apply(this, arguments);
  };

  proto.activeTexture = function (unit) {
    ctx(this).unit = unit - GL.TEXTURE0;
    return original.activeTexture.apply(this, arguments);
  };

  proto.bindTexture = function (target, texture) {
    if (target === GL.TEXTURE_3D) ctx(this).units.set(ctx(this).unit, texture);
    return original.bindTexture.apply(this, arguments);
  };

  proto.texStorage3D = function (target, levels, format, width, height, depth) {
    const texture = target === GL.TEXTURE_3D && ctx(this).units.get(ctx(this).unit);
    if (texture) texture.__webbloxStorage = { format, width, height, depth };
    return original.texStorage3D.apply(this, arguments);
  };

  proto.pixelStorei = function (pname, value) {
    ctx(this).unpack.set(pname, value);
    return original.pixelStorei.apply(this, arguments);
  };

  proto.bindBuffer = function (target, buffer) {
    if (target === GL.UNIFORM_BUFFER) ctx(this).uniform = buffer;
    else if (target === GL.PIXEL_UNPACK_BUFFER) ctx(this).unpackBuffer = buffer;
    return original.bindBuffer.apply(this, arguments);
  };

  proto.bindBufferBase = function (target, index, buffer) {
    if (target === GL.UNIFORM_BUFFER) {
      ctx(this).uniform = buffer;
      ctx(this).bindings.set(index, { buffer, offset: 0 });
    }
    return original.bindBufferBase.apply(this, arguments);
  };

  proto.bindBufferRange = function (target, index, buffer, offset) {
    if (target === GL.UNIFORM_BUFFER) {
      ctx(this).uniform = buffer;
      ctx(this).bindings.set(index, { buffer, offset });
    }
    return original.bindBufferRange.apply(this, arguments);
  };

  const bytesOf = (data, srcOffset, length) => {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (!ArrayBuffer.isView(data)) return null;
    const size = data.BYTES_PER_ELEMENT || 1;
    const start = data.byteOffset + (srcOffset || 0) * size;
    const count = length ? length * size : data.byteLength - (srcOffset || 0) * size;
    return new Uint8Array(data.buffer, start, count);
  };

  proto.bufferData = function (target, sizeOrData, usage, srcOffset, length) {
    const buffer = target === GL.UNIFORM_BUFFER && ctx(this).uniform;
    if (buffer) {
      buffer.__webbloxVersion = (buffer.__webbloxVersion || 0) + 1;
      buffer.__webbloxChunks = null;
      if (typeof sizeOrData === 'number') buffer.__webbloxShadow = new Uint8Array(sizeOrData);
      else {
        const bytes = bytesOf(sizeOrData, srcOffset, length);
        buffer.__webbloxShadow = bytes ? new Uint8Array(bytes) : null;
      }
    }
    return original.bufferData.apply(this, arguments);
  };

  proto.bufferSubData = function (target, dstOffset, data, srcOffset, length) {
    const buffer = target === GL.UNIFORM_BUFFER && ctx(this).uniform;
    if (buffer && buffer.__webbloxShadow) {
      const bytes = bytesOf(data, srcOffset, length);
      if (bytes && dstOffset + bytes.length <= buffer.__webbloxShadow.length) {
        buffer.__webbloxShadow.set(bytes, dstOffset);
        const chunks = buffer.__webbloxChunks || (buffer.__webbloxChunks = new Uint32Array((buffer.__webbloxShadow.length >> CHUNK_SHIFT) + 1));
        const last = (dstOffset + bytes.length - 1) >> CHUNK_SHIFT;
        for (let chunk = dstOffset >> CHUNK_SHIFT; chunk <= last; chunk++) chunks[chunk]++;
      } else buffer.__webbloxVersion = (buffer.__webbloxVersion || 0) + 1;
    }
    return original.bufferSubData.apply(this, arguments);
  };

  const floatsAt = (c, binding, vec4Offset, vec4Count) => {
    const bound = c.bindings.get(binding);
    const shadow = bound && bound.buffer && bound.buffer.__webbloxShadow;
    if (!shadow) return null;
    const start = bound.offset + vec4Offset * 16;
    if (start + vec4Count * 16 > shadow.length) return null;
    return new Float32Array(shadow.buffer, shadow.byteOffset + start, vec4Count * 4);
  };

  const scratch = { grid: null, counts: null, cursor: null, spans: null, index: null, key: null };

  const SLICE_NEAR = 0.5;

  const falloff = (d, span) => {
    const t = d / span;
    return (1 - 3 * t * t + 2 * t * t * t) * (110 / (110 + d * d));
  };

  const strength = (lights, base, distance) => {
    const packed = lights[base + 3];
    const range = Math.floor(packed) * 0.001;
    const inner = (packed - Math.floor(packed)) * range;
    const span = range - inner;
    const brightness = Math.max(Math.abs(lights[base + 4]), Math.abs(lights[base + 5]), Math.abs(lights[base + 6]));
    if (!(span > 0)) return brightness;
    return brightness * falloff(Math.min(Math.max(distance - inner, 0), span), span);
  };

  const lightRange = (lights, base) => {
    const brightness = Math.max(Math.abs(lights[base + 4]), Math.abs(lights[base + 5]), Math.abs(lights[base + 6]));
    return brightness > 0 ? Math.floor(lights[base + 3]) * 0.001 : 0;
  };

  const sliceStart = z => (z === 0 ? SLICE_NEAR : 10 * Math.pow(1.5, z - 1));
  const sliceEnd = z => 10 * Math.pow(1.5, z);

  const sphere = new Float64Array(4);

  const boundLight = (lights, base, range, out) => {
    const x = lights[base], y = lights[base + 1], z = lights[base + 2];
    const sizeA = Math.abs(lights[base + 15]), sizeB = Math.abs(lights[base + 19]);
    const cosine = lights[base + 11];
    if (sizeA > 1e-3 || sizeB > 1e-3) {
      out[0] = x; out[1] = y; out[2] = z; out[3] = range + Math.hypot(sizeA, sizeB);
      return;
    }
    if (cosine > 0 && cosine < 1) {
      const dx = lights[base + 8], dy = lights[base + 9], dz = lights[base + 10];
      const length = Math.hypot(dx, dy, dz);
      if (length > 0.5) {
        const along = cosine >= Math.SQRT1_2 ? range / (2 * cosine) : range * cosine;
        const radius = cosine >= Math.SQRT1_2 ? along : range * Math.sqrt(1 - cosine * cosine);
        out[0] = x + dx / length * along;
        out[1] = y + dy / length * along;
        out[2] = z + dz / length * along;
        out[3] = radius * 1.001;
        return;
      }
    }
    out[0] = x; out[1] = y; out[2] = z; out[3] = range;
  };

  const tilePlanes = (froxel, row, count, store) => {
    const key = row === 0 ? 'planesX' : 'planesY';
    const planes = store[key] && store[key].length === (count + 1) * 4 ? store[key] : (store[key] = new Float64Array((count + 1) * 4));
    for (let i = 0; i <= count; i++) {
      const a = froxel[row] - i * froxel[12];
      const b = froxel[row + 1] - i * froxel[13];
      const c = froxel[row + 2] - i * froxel[14];
      const d = froxel[row + 3] - i * froxel[15];
      const length = Math.hypot(a, b, c) || 1;
      planes[i * 4] = a / length;
      planes[i * 4 + 1] = b / length;
      planes[i * 4 + 2] = c / length;
      planes[i * 4 + 3] = d / length;
    }
    return planes;
  };

  const reach = (planes, index, cx, cy, cz, radius, depth, near, far, vx, vy, vz, sign) => {
    const at = index * 4;
    const a = planes[at], b = planes[at + 1], c = planes[at + 2];
    const distance = a * cx + b * cy + c * cz + planes[at + 3];
    const tilt = a * vx + b * vy + c * vz;
    const wanted = depth + sign * radius * tilt;
    const t = wanted < near ? near : wanted > far ? far : wanted;
    const offset = t - depth;
    const disk = radius * radius - offset * offset;
    const lateral = disk > 0 ? Math.sqrt(disk) * Math.sqrt(Math.max(0, 1 - tilt * tilt)) : 0;
    return distance + offset * tilt + sign * lateral;
  };

  const cull = (froxel, lights, count, width, height, slices, maxDepth) => {
    const plane = width * height;
    const cells = plane * slices;
    if (!scratch.grid || scratch.grid.length !== cells) {
      scratch.grid = new Int32Array(cells);
      scratch.counts = new Int32Array(cells);
      scratch.cursor = new Int32Array(plane);
      scratch.spans = new Int32Array(MAX_LIGHTS * slices * 4);
      scratch.scores = new Float32Array(MAX_LIGHTS * slices);
    }
    const { grid, counts, cursor, spans, scores } = scratch;
    const order = [];
    counts.fill(0);
    const viewLength = Math.hypot(froxel[12], froxel[13], froxel[14]) || 1;
    const vx = froxel[12] / viewLength, vy = froxel[13] / viewLength, vz = froxel[14] / viewLength;
    const planesX = tilePlanes(froxel, 0, width, scratch);
    const planesY = tilePlanes(froxel, 4, height, scratch);
    const sliceOf = w => Math.min(slices - 1, Math.max(0, Math.floor(Math.log2(Math.max(w, 1e-6) * 0.1) * 1.709511280059814453125 + 1)));
    for (let i = 0; i < count; i++) {
      const base = i * LIGHT_STRIDE * 4;
      const range = lightRange(lights, base);
      if (!(range > 0)) continue;
      boundLight(lights, base, range, sphere);
      const cx = sphere[0], cy = sphere[1], cz = sphere[2], radius = sphere[3];
      const depth = (froxel[12] * cx + froxel[13] * cy + froxel[14] * cz + froxel[15]) / viewLength;
      if (depth + radius <= SLICE_NEAR) continue;
      const lightDepth = (froxel[12] * lights[base] + froxel[13] * lights[base + 1] + froxel[14] * lights[base + 2] + froxel[15]) / viewLength;
      const zLo = sliceOf(Math.max(SLICE_NEAR, depth - radius)), zHi = sliceOf(depth + radius);
      for (let sz = zLo; sz <= zHi; sz++) {
        const near = Math.max(sliceStart(sz), depth - radius);
        const far = sz === slices - 1 ? depth + radius : Math.min(sliceEnd(sz), depth + radius);
        if (near > far) continue;
        let xLo = 0, xHi = width - 1, yLo = 0, yHi = height - 1;
        while (xLo <= xHi && reach(planesX, xLo + 1, cx, cy, cz, radius, depth, near, far, vx, vy, vz, -1) > 0) xLo++;
        while (xHi >= xLo && reach(planesX, xHi, cx, cy, cz, radius, depth, near, far, vx, vy, vz, 1) < 0) xHi--;
        if (xLo > xHi) continue;
        while (yLo <= yHi && reach(planesY, yLo + 1, cx, cy, cz, radius, depth, near, far, vx, vy, vz, -1) > 0) yLo++;
        while (yHi >= yLo && reach(planesY, yHi, cx, cy, cz, radius, depth, near, far, vx, vy, vz, 1) < 0) yHi--;
        if (yLo > yHi) continue;
        const span = (i * slices + sz) * 4;
        spans[span] = xLo; spans[span + 1] = xHi; spans[span + 2] = yLo; spans[span + 3] = yHi;
        const nearestToLight = Math.min(Math.max(lightDepth, sliceStart(sz)), sliceEnd(sz));
        scores[i * slices + sz] = strength(lights, base, Math.abs(nearestToLight - lightDepth));
        order.push(i * slices + sz);
        for (let ty = yLo; ty <= yHi; ty++) {
          const row = sz * plane + ty * width;
          for (let tx = xLo; tx <= xHi; tx++) counts[row + tx]++;
        }
      }
    }
    cursor.fill(0);
    let used = 0;
    let overflow = false;
    for (let sz = 0; sz < slices; sz++) {
      const layer = sz * plane;
      for (let i = 0; i < plane; i++) {
        const offset = cursor[i];
        const n = Math.min(counts[layer + i], MAX_PER_CELL, CELL_LIGHTS, maxDepth - offset);
        if (n < counts[layer + i]) overflow = true;
        grid[layer + i] = n | (offset << 12);
        counts[layer + i] = offset;
        cursor[i] = offset + n;
        if (cursor[i] > used) used = cursor[i];
      }
    }
    const depth = Math.max(1, used);
    if (!scratch.index || scratch.index.length < plane * depth) scratch.index = new Int16Array(plane * Math.max(depth, 16));
    const index = scratch.index;
    if (overflow) order.sort((a, b) => scores[b] - scores[a]);
    for (const id of order) {
      const i = (id / slices) | 0, sz = id - i * slices;
      const span = id * 4;
      for (let ty = spans[span + 2]; ty <= spans[span + 3]; ty++) {
        const row = sz * plane + ty * width;
        for (let tx = spans[span]; tx <= spans[span + 1]; tx++) {
          const cell = row + tx;
          const end = (grid[cell] >> 12) + (grid[cell] & 4095);
          if (counts[cell] < end) index[counts[cell]++ * plane + ty * width + tx] = i;
        }
      }
    }
    return { grid, index, depth };
  };

  const KEY_FLOATS = LIGHT_STRIDE * 4;
  const SHADOW_SLOT_FIELD = 7;

  const sameInputs = (froxel, lights, count) => {
    const length = 17 + count * KEY_FLOATS;
    const key = scratch.key;
    let same = key && key.length === length && key[0] === count;
    for (let i = 0; i < 16 && same; i++) same = key[1 + i] === froxel[i];
    for (let i = 0; i < count && same; i++) {
      const base = i * LIGHT_STRIDE * 4;
      for (let k = 0; k < KEY_FLOATS && same; k++) same = k === SHADOW_SLOT_FIELD || key[17 + i * KEY_FLOATS + k] === lights[base + k];
    }
    if (same) return true;
    const next = new Float32Array(length);
    next[0] = count;
    next.set(froxel, 1);
    for (let i = 0; i < count; i++) next.set(lights.subarray(i * LIGHT_STRIDE * 4, i * LIGHT_STRIDE * 4 + KEY_FLOATS), 17 + i * KEY_FLOATS);
    scratch.key = next;
    return false;
  };

  const RING = 6;
  const UNPACK_DEFAULTS = [[GL.UNPACK_ALIGNMENT, 4], [GL.UNPACK_ROW_LENGTH, 0], [GL.UNPACK_IMAGE_HEIGHT, 0], [GL.UNPACK_SKIP_PIXELS, 0],
                           [GL.UNPACK_SKIP_ROWS, 0], [GL.UNPACK_SKIP_IMAGES, 0]];

  const makeTexture = (gl, storage) => {
    const texture = gl.createTexture();
    original.bindTexture.call(gl, GL.TEXTURE_3D, texture);
    gl.texParameteri(GL.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(GL.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(GL.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    original.texStorage3D.call(gl, GL.TEXTURE_3D, 1, storage.format, storage.width, storage.height, storage.depth);
    return texture;
  };

  const upload = (gl, c, gs, is, result) => {
    const pbo = c.unpackBuffer;
    const saved = UNPACK_DEFAULTS.map(([p, fallback]) => [p, c.unpack.has(p) ? c.unpack.get(p) : fallback]);
    if (pbo) original.bindBuffer.call(gl, GL.PIXEL_UNPACK_BUFFER, null);
    for (const [p, v] of saved) {
      const want = p === GL.UNPACK_ALIGNMENT ? 1 : 0;
      if (v !== want) original.pixelStorei.call(gl, p, want);
    }
    original.activeTexture.call(gl, GL.TEXTURE0 + GRID_UNIT);
    const previous = c.units.get(GRID_UNIT) || null;
    if (!c.ring || c.ring.width !== gs.width || c.ring.height !== gs.height || c.ring.slices !== gs.depth || c.ring.capacity !== is.depth) {
      c.ring = { width: gs.width, height: gs.height, slices: gs.depth, capacity: is.depth, next: 0, active: null, slots: [] };
      const indexStorage = { ...is, depth: Math.max(is.depth, INDEX_CAPACITY) };
      for (let i = 0; i < RING; i++) c.ring.slots.push({ grid: makeTexture(gl, gs), index: makeTexture(gl, indexStorage) });
    }
    const slot = c.ring.slots[c.ring.next];
    c.ring.next = (c.ring.next + 1) % RING;
    original.bindTexture.call(gl, GL.TEXTURE_3D, slot.grid);
    gl.texSubImage3D(GL.TEXTURE_3D, 0, 0, 0, 0, gs.width, gs.height, gs.depth, GL.RED_INTEGER, GL.INT, result.grid);
    original.bindTexture.call(gl, GL.TEXTURE_3D, slot.index);
    gl.texSubImage3D(GL.TEXTURE_3D, 0, 0, 0, 0, is.width, is.height, result.depth, GL.RED_INTEGER, GL.SHORT, result.index.subarray(0, is.width * is.height * result.depth));
    original.bindTexture.call(gl, GL.TEXTURE_3D, previous);
    original.activeTexture.call(gl, GL.TEXTURE0 + c.unit);
    for (const [p, v] of saved) if (v !== (p === GL.UNPACK_ALIGNMENT ? 1 : 0)) original.pixelStorei.call(gl, p, v);
    if (pbo) original.bindBuffer.call(gl, GL.PIXEL_UNPACK_BUFFER, pbo);
    c.ring.active = slot;
  };

  const withGrid = (gl, draw) => {
    const slot = ctx(gl).ring && ctx(gl).ring.active;
    if (!slot) return draw();
    const c = ctx(gl);
    const active = c.unit;
    original.activeTexture.call(gl, GL.TEXTURE0 + GRID_UNIT);
    original.bindTexture.call(gl, GL.TEXTURE_3D, slot.grid);
    original.activeTexture.call(gl, GL.TEXTURE0 + INDEX_UNIT);
    original.bindTexture.call(gl, GL.TEXTURE_3D, slot.index);
    try {
      return draw();
    } finally {
      original.bindTexture.call(gl, GL.TEXTURE_3D, c.units.get(INDEX_UNIT) || null);
      original.activeTexture.call(gl, GL.TEXTURE0 + GRID_UNIT);
      original.bindTexture.call(gl, GL.TEXTURE_3D, c.units.get(GRID_UNIT) || null);
      original.activeTexture.call(gl, GL.TEXTURE0 + active);
    }
  };

  const lightCount = lights => {
    let count = 0;
    while (count < MAX_LIGHTS && lights[count * LIGHT_STRIDE * 4 + 3] >= MIN_PACKED_RANGE) count++;
    return count;
  };

  const rangeVersion = (buffer, offset, size) => {
    let version = buffer.__webbloxVersion || 0;
    const chunks = buffer.__webbloxChunks;
    if (!chunks) return version;
    const last = Math.min((offset + size - 1) >> CHUNK_SHIFT, chunks.length - 1);
    for (let chunk = offset >> CHUNK_SHIFT; chunk <= last; chunk++) version += chunks[chunk];
    return version;
  };

  const prepare = gl => {
    if (!current || !current.__webbloxLightGrid) return;
    const c = ctx(gl);
    const globals = c.bindings.get(GLOBALS_BINDING);
    const lightBinding = c.bindings.get(LIGHTS_BINDING);
    if (!globals || !lightBinding || !globals.buffer || !lightBinding.buffer) return;
    const inputs = c.inputs;
    const globalsVersion = rangeVersion(globals.buffer, globals.offset + FROXEL_ROW * 16, 64);
    const lightsVersion = rangeVersion(lightBinding.buffer, lightBinding.offset, MAX_LIGHTS * LIGHT_STRIDE * 16);
    if (inputs && inputs[0] === globals.buffer && inputs[1] === globalsVersion && inputs[2] === globals.offset &&
        inputs[3] === lightBinding.buffer && inputs[4] === lightsVersion && inputs[5] === lightBinding.offset) return;
    const grid = c.units.get(GRID_UNIT);
    const indexTex = c.units.get(INDEX_UNIT);
    const gs = grid && grid.__webbloxStorage;
    const is = indexTex && indexTex.__webbloxStorage;
    if (!gs || !is || gs.format !== GL.R32I || is.format !== GL.R16I || gs.width !== is.width || gs.height !== is.height) return;
    const froxel = floatsAt(c, GLOBALS_BINDING, FROXEL_ROW, 4);
    const lights = floatsAt(c, LIGHTS_BINDING, 0, MAX_LIGHTS * LIGHT_STRIDE);
    if (!froxel || !lights || (froxel[15] === 0 && froxel[12] === 0)) return;
    c.inputs = [globals.buffer, globalsVersion, globals.offset, lightBinding.buffer, lightsVersion, lightBinding.offset];
    const count = lightCount(lights);
    if (c.ring && c.ring.active && sameInputs(froxel, lights, count)) return;
    if (!(c.ring && c.ring.active)) sameInputs(froxel, lights, count);
    upload(gl, c, gs, is, cull(froxel, lights, count, gs.width, gs.height, gs.depth, Math.max(is.depth, INDEX_CAPACITY)));
  };

  window.__webbloxLightGridCore = { cull, lightCount, sameInputs, MAX_LIGHTS, LIGHT_STRIDE, FROXEL_ROW };

  for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced']) {
    proto[name] = function () {
      if (!current || !current.__webbloxLightGrid) return original[name].apply(this, arguments);
      prepare(this);
      return withGrid(this, () => original[name].apply(this, arguments));
    };
  }
})();
