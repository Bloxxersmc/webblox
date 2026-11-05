'use strict';

self.window = self;
self.__webbloxWebGPU = true;
importScripts('gl-ops.js', 'gl-webgpu-key.js', 'fullbright.js', 'gl-webgpu.js', 'light-grid.js');

{
  const { OP, CALLS, KINDS, START, WORD, STATS_BYTE, STATS, SIDE } = self.__webbloxGlOps;
  const SPIN_MS = 0.3;
  const BATCH_WORDS = 1 << 20;

  let gl, ctrl, i32, f32, ringBuffer, statsView, heap, sideRing, mainRing, mainBindings;
  let at = START >> 2;
  let ack = 0;
  let blobWords = 0;

  const buffers = [];
  const textures = [];
  const framebuffers = [];
  const renderbuffers = [];
  const vaos = [];
  const programs = [];
  const shaders = [];
  const TABLES = { B: buffers, T: textures, F: framebuffers, R: renderbuffers, V: vaos, P: programs, S: shaders };

  const buffer = id => (id ? buffers[id] || (buffers[id] = gl.createBuffer()) : null);
  const blob = index => {
    const size = i32[index];
    if (size >= 0) {
      blobWords = 1 + ((size + 3) >> 2);
      return size ? new Uint8Array(ringBuffer, (index + 1) << 2, size) : null;
    }
    blobWords = 4;
    ack = i32[index + 3];
    return new Uint8Array(heap.buffer, i32[index + 1] >>> 0, i32[index + 2] >>> 0);
  };
  const acknowledge = seq => {
    if (Atomics.load(mainRing.i32, WORD.READ_SEQ) < seq) Atomics.store(mainRing.i32, WORD.READ_SEQ, seq);
  };
  const finishBlob = () => {
    if (ack) {
      acknowledge(ack);
      ack = 0;
    }
  };

  const H = [];
  const define = (op, handler) => { H[op] = handler; };

  const installHandlers = () => {
    for (const [name, signature] of CALLS) {
      const count = signature.length;
      const words = count + 1;
      define(OP[name], index => {
        const args = new Array(count);
        for (let i = 0; i < count; i++) {
          const type = signature[i];
          if (type === 'i') args[i] = i32[index + 1 + i];
          else if (type === 'f') args[i] = f32[index + 1 + i];
          else args[i] = TABLES[type][i32[index + 1 + i]] || null;
        }
        gl[name](...args);
        return words;
      });
    }
    define(OP.activeTexture, index => { gl.activeTexture(i32[index + 1]); return 2; });
    define(OP.bindBuffer, index => { gl.bindBuffer(i32[index + 1], buffer(i32[index + 2])); return 3; });
    define(OP.bindBufferBase, index => { gl.bindBufferBase(i32[index + 1], i32[index + 2], buffer(i32[index + 3])); return 4; });
    define(OP.bindBufferRange, index => { gl.bindBufferRange(i32[index + 1], i32[index + 2], buffer(i32[index + 3]), i32[index + 4] >>> 0, i32[index + 5] >>> 0); return 6; });
    define(OP.bindFramebuffer, index => { gl.bindFramebuffer(i32[index + 1], framebuffers[i32[index + 2]] || null); return 3; });
    define(OP.bindTexture, index => { gl.bindTexture(i32[index + 1], textures[i32[index + 2]] || null); return 3; });
    define(OP.blendFunc, index => { gl.blendFunc(i32[index + 1], i32[index + 2]); return 3; });
    define(OP.blendFuncSeparate, index => { gl.blendFuncSeparate(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4]); return 5; });
    define(OP.colorMask, index => { gl.colorMask(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4]); return 5; });
    define(OP.cullFace, index => { gl.cullFace(i32[index + 1]); return 2; });
    define(OP.depthFunc, index => { gl.depthFunc(i32[index + 1]); return 2; });
    define(OP.depthMask, index => { gl.depthMask(i32[index + 1]); return 2; });
    define(OP.disable, index => { gl.disable(i32[index + 1]); return 2; });
    define(OP.enable, index => { gl.enable(i32[index + 1]); return 2; });
    define(OP.enableVertexAttribArray, index => { gl.enableVertexAttribArray(i32[index + 1]); return 2; });
    define(OP.disableVertexAttribArray, index => { gl.disableVertexAttribArray(i32[index + 1]); return 2; });
    define(OP.drawArrays, index => { gl.drawArraysInstanced(i32[index + 1], i32[index + 2], i32[index + 3], 1); return 4; });
    define(OP.drawArraysInstanced, index => { gl.drawArraysInstanced(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4]); return 5; });
    define(OP.drawElements, index => { gl.drawElementsInstanced(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4] >>> 0, 1); return 5; });
    define(OP.drawElementsInstanced, index => { gl.drawElementsInstanced(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4] >>> 0, i32[index + 5]); return 6; });
    define(OP.polygonOffset, index => { gl.polygonOffset(f32[index + 1], f32[index + 2]); return 3; });
    define(OP.scissor, index => { gl.scissor(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4]); return 5; });
    define(OP.stencilFunc, index => { gl.stencilFunc(i32[index + 1], i32[index + 2], i32[index + 3]); return 4; });
    define(OP.stencilMask, index => { gl.stencilMask(i32[index + 1]); return 2; });
    define(OP.stencilOp, index => { gl.stencilOp(i32[index + 1], i32[index + 2], i32[index + 3]); return 4; });
    define(OP.texParameteri, index => { gl.texParameteri(i32[index + 1], i32[index + 2], i32[index + 3]); return 4; });
    define(OP.texParameterf, index => { gl.texParameterf(i32[index + 1], i32[index + 2], f32[index + 3]); return 4; });
    define(OP.useProgram, index => { gl.useProgram(programs[i32[index + 1]] || null); return 2; });
    define(OP.vertexAttribPointer, index => { gl.vertexAttribPointer(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4] !== 0, i32[index + 5], i32[index + 6] >>> 0); return 7; });
    define(OP.viewport, index => { gl.viewport(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4]); return 5; });
    define(OP.clear, index => { gl.clear(i32[index + 1]); return 2; });
    define(OP.clearColor, index => { gl.clearColor(f32[index + 1], f32[index + 2], f32[index + 3], f32[index + 4]); return 5; });
    define(OP.clearDepth, index => { gl.clearDepth(f32[index + 1]); return 2; });
    define(OP.clearStencil, index => { gl.clearStencil(i32[index + 1]); return 2; });

    define(OP.bindVertexArray, index => { gl.bindVertexArray(vaos[i32[index + 1]] || null); return 2; });
    define(OP.compileShader, index => {
      const shader = shaders[i32[index + 1]];
      gl.compileShader(shader);
      if (!shader.wgsl) postMessage({ type: 'missing', source: shader.source });
      return 2;
    });
    define(OP.deleteBuffer, index => {
      const id = i32[index + 1];
      if (buffers[id]) gl.deleteBuffer(buffers[id]);
      buffers[id] = null;
      return 2;
    });
    define(OP.deleteFramebuffer, index => {
      const id = i32[index + 1];
      if (framebuffers[id]) gl.deleteFramebuffer(framebuffers[id]);
      framebuffers[id] = null;
      return 2;
    });
    define(OP.deleteProgram, index => {
      const id = i32[index + 1];
      if (programs[id]) gl.deleteProgram(programs[id]);
      programs[id] = null;
      return 2;
    });
    define(OP.deleteRenderbuffer, index => {
      const id = i32[index + 1];
      if (renderbuffers[id]) gl.deleteRenderbuffer(renderbuffers[id]);
      renderbuffers[id] = null;
      return 2;
    });
    define(OP.deleteShader, index => {
      shaders[i32[index + 1]] = null;
      return 2;
    });
    define(OP.deleteTexture, index => {
      const id = i32[index + 1];
      if (textures[id]) gl.deleteTexture(textures[id]);
      textures[id] = null;
      return 2;
    });
    define(OP.deleteVertexArray, index => {
      const id = i32[index + 1];
      if (vaos[id]) gl.deleteVertexArray(vaos[id]);
      vaos[id] = null;
      return 2;
    });

    define(OP.RESIZE, index => {
      gl.canvas.width = i32[index + 1];
      gl.canvas.height = i32[index + 2];
      return 3;
    });
    define(OP.CREATE, index => {
      const kind = i32[index + 1];
      const id = i32[index + 2];
      if (kind === KINDS.BUFFER) buffers[id] = gl.createBuffer();
      else if (kind === KINDS.TEXTURE) textures[id] = gl.createTexture();
      else if (kind === KINDS.FRAMEBUFFER) framebuffers[id] = gl.createFramebuffer();
      else if (kind === KINDS.RENDERBUFFER) renderbuffers[id] = gl.createRenderbuffer();
      else if (kind === KINDS.VAO) vaos[id] = gl.createVertexArray();
      else if (kind === KINDS.PROGRAM) programs[id] = gl.createProgram();
      else if (kind === KINDS.SHADER) shaders[id] = gl.createShader(i32[index + 3]);
      return 4;
    });
    define(OP.BUFFER_DATA, index => {
      const bytes = blob(index + 4);
      gl.bufferData(i32[index + 1], bytes || (i32[index + 3] >>> 0), i32[index + 2]);
      finishBlob();
      return 4 + blobWords;
    });
    define(OP.BUFFER_SUB, index => {
      const bytes = blob(index + 3);
      gl.bufferSubData(i32[index + 1], i32[index + 2] >>> 0, bytes);
      finishBlob();
      return 3 + blobWords;
    });
    define(OP.CLEAR_BUFFER_FV, index => { gl.clearBufferfv(i32[index + 1], i32[index + 2], f32, index + 3); return 7; });
    define(OP.CLEAR_BUFFER_IV, index => { gl.clearBufferiv(i32[index + 1], i32[index + 2], i32, index + 3); return 7; });
    define(OP.DRAW_BUFFERS, index => {
      const count = i32[index + 1];
      gl.drawBuffers(i32.subarray(index + 2, index + 2 + count));
      return 2 + count;
    });
    define(OP.INVALIDATE, index => {
      const count = i32[index + 2];
      gl.invalidateFramebuffer(i32[index + 1], i32.subarray(index + 3, index + 3 + count));
      return 3 + count;
    });
    define(OP.SHADER_SOURCE, index => {
      const bytes = blob(index + 2);
      gl.shaderSource(shaders[i32[index + 1]], bytes ? new TextDecoder().decode(bytes.slice()) : '');
      finishBlob();
      return 2 + blobWords;
    });
    define(OP.UNIFORM1I, index => {
      const bytes = blob(index + 3);
      const program = programs[i32[index + 1]];
      if (program) {
        const name = new TextDecoder().decode(bytes.slice());
        const location = gl.getUniformLocation(program, name);
        if (location) gl.uniform1i(location, i32[index + 2]);
      }
      finishBlob();
      return 3 + blobWords;
    });

    const uploadSource = index => {
      const mode = i32[index];
      const bytes = blob(index + 2);
      if (mode === 2) return i32[index + 1] >>> 0;
      return mode === 1 ? bytes : null;
    };
    define(OP.TEX_IMAGE_2D, index => {
      const data = uploadSource(index + 9);
      gl.texImage2D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], i32[index + 8], data);
      finishBlob();
      return 11 + blobWords;
    });
    define(OP.TEX_IMAGE_3D, index => {
      const data = uploadSource(index + 10);
      gl.texImage3D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], i32[index + 8], i32[index + 9], data);
      finishBlob();
      return 12 + blobWords;
    });
    define(OP.TEX_SUB_2D, index => {
      const data = uploadSource(index + 9);
      if (data !== null) gl.texSubImage2D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], i32[index + 8], data);
      finishBlob();
      return 11 + blobWords;
    });
    define(OP.TEX_SUB_3D, index => {
      const data = uploadSource(index + 11);
      if (data !== null) gl.texSubImage3D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], i32[index + 8], i32[index + 9], i32[index + 10], data);
      finishBlob();
      return 13 + blobWords;
    });
    define(OP.COMPRESSED_2D, index => {
      const data = uploadSource(index + 7);
      gl.compressedTexImage2D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], data);
      finishBlob();
      return 9 + blobWords;
    });
    define(OP.COMPRESSED_3D, index => {
      const data = uploadSource(index + 8);
      gl.compressedTexImage3D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], data);
      finishBlob();
      return 10 + blobWords;
    });
    define(OP.COMPRESSED_SUB_2D, index => {
      const data = uploadSource(index + 8);
      gl.compressedTexSubImage2D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], data);
      finishBlob();
      return 10 + blobWords;
    });
    define(OP.COMPRESSED_SUB_3D, index => {
      const data = uploadSource(index + 10);
      gl.compressedTexSubImage3D(i32[index + 1], i32[index + 2], i32[index + 3], i32[index + 4], i32[index + 5], i32[index + 6], i32[index + 7], i32[index + 8], i32[index + 9], data);
      finishBlob();
      return 12 + blobWords;
    });
    define(OP.READ_PIXELS, index => {
      const seq = i32[index + 1];
      const width = i32[index + 4];
      const height = i32[index + 5];
      const offset = i32[index + 9] >>> 0;
      const length = i32[index + 10] >>> 0;
      const pack = i32[index + 8] === 1 ? gl.packBuffer : null;
      const fromPack = i32[index + 8] === 1;
      const claim = () => {
        if (Atomics.compareExchange(mainRing.i32, WORD.READ_CLAIM, seq, -seq) !== seq) return null;
        if (fromPack) return pack && pack.cpu ? pack.cpu.subarray(offset, offset + width * height * 4) : null;
        return new Uint8Array(heap.buffer, offset, length);
      };
      gl.readPixelsInto(i32[index + 2], i32[index + 3], width, height, i32[index + 6], i32[index + 7], claim).catch(error => {
        gl.noteError(`readPixels failed: ${error && error.message}`);
        const target = claim();
        if (target) target.fill(0);
      }).then(() => acknowledge(seq));
      return 11;
    });
  };

  const VALUE_COUNTS = {
    [OP.BUFFER_DATA]: 3, [OP.BUFFER_SUB]: 2, [OP.SHADER_SOURCE]: 1, [OP.UNIFORM1I]: 2, [OP.TEX_IMAGE_2D]: 10, [OP.TEX_IMAGE_3D]: 11, [OP.TEX_SUB_2D]: 10, [OP.TEX_SUB_3D]: 12,
    [OP.COMPRESSED_2D]: 8, [OP.COMPRESSED_3D]: 9, [OP.COMPRESSED_SUB_2D]: 9, [OP.COMPRESSED_SUB_3D]: 11,
  };
  const FIXED_WORDS = { [OP.RESIZE]: 3, [OP.CREATE]: 4, [OP.CLEAR_BUFFER_FV]: 7, [OP.CLEAR_BUFFER_IV]: 7, [OP.READ_PIXELS]: 11 };
  for (const [name, signature] of CALLS) FIXED_WORDS[OP[name]] = signature.length + 1;
  const wordsOf = (op, index) => {
    if (FIXED_WORDS[op]) return FIXED_WORDS[op];
    if (op === OP.DRAW_BUFFERS) return 2 + i32[index + 1];
    if (op === OP.INVALIDATE) return 3 + i32[index + 2];
    const sizeAt = index + 1 + VALUE_COUNTS[op];
    const size = i32[sizeAt];
    return 1 + VALUE_COUNTS[op] + (size >= 0 ? 1 + ((size + 3) >> 2) : 4);
  };

  const yieldChannel = new MessageChannel();

  const finishFrame = () => {
    gl.frameEnd();
    gl.inIteration = true;
    const stats = gl.stats;
    for (let i = 0; i < STATS.length; i++) statsView[i] = stats[STATS[i]];
    gl.queue.onSubmittedWorkDone().then(() => {
      Atomics.add(mainRing.i32, WORD.DONE, 1);
      Atomics.notify(mainRing.i32, WORD.DONE);
    });
  };

  const wake = () => {
    Atomics.store(ctrl, WORD.SLEEP, 0);
    pump();
  };

  const useRing = ring => {
    i32 = ring.i32;
    f32 = ring.f32;
    ringBuffer = ring.buffer;
    ctrl = ring.i32;
    at = ring.at;
  };

  const switchRing = cap => {
    at += 2;
    Atomics.store(ctrl, WORD.TAIL, at << 2);
    const entering = cap === SIDE.ENABLE_BEGIN;
    (entering ? mainRing : sideRing).at = at;
    if (entering) mainBindings = gl.saveBindings();
    else gl.restoreBindings(mainBindings);
    useRing(entering ? sideRing : mainRing);
  };

  const pump = () => {
    let spinUntil = performance.now() + SPIN_MS;
    for (;;) {
      const headBytes = Atomics.load(ctrl, WORD.HEAD);
      const head = headBytes >> 2;
      if (head === 0 || head === at) {
        Atomics.store(ctrl, WORD.TAIL, at << 2);
        if (performance.now() < spinUntil) continue;
        Atomics.store(ctrl, WORD.SLEEP, 1);
        if (Atomics.load(ctrl, WORD.HEAD) !== headBytes) {
          Atomics.store(ctrl, WORD.SLEEP, 0);
          continue;
        }
        const waiter = Atomics.waitAsync(ctrl, WORD.HEAD, headBytes);
        if (waiter.async) {
          waiter.value.then(wake);
          return;
        }
        Atomics.store(ctrl, WORD.SLEEP, 0);
        continue;
      }
      let budget = BATCH_WORDS;
      while (at !== head && budget > 0) {
        const op = i32[at];
        if (op === OP.WRAP) {
          at = START >> 2;
          continue;
        }
        if (op === OP.enable && (i32[at + 1] === SIDE.ENABLE_BEGIN || i32[at + 1] === SIDE.ENABLE_END)) {
          switchRing(i32[at + 1]);
          break;
        }
        if (op === OP.FRAME_END) {
          at += 1;
          try {
            finishFrame();
          } catch (error) {
            gl.noteError(`frame end: ${error.message}`);
          }
          Atomics.store(ctrl, WORD.TAIL, at << 2);
          yieldChannel.port2.postMessage(0);
          return;
        }
        const handler = H[op];
        if (!handler) {
          self.__webgpuOnFailure(`render worker lost its place in the command stream at op ${op}`);
          return;
        }
        let words;
        try {
          words = handler(at);
        } catch (error) {
          gl.noteError(`GL command ${op}: ${error.message}`);
          words = wordsOf(op, at);
          finishBlob();
        }
        at += words;
        budget -= words;
      }
      Atomics.store(ctrl, WORD.TAIL, at << 2);
      spinUntil = performance.now() + SPIN_MS;
    }
  };

  yieldChannel.port1.onmessage = pump;

  const init = async message => {
    self.__webbloxStarWidth = message.starWidth;
    self.__webbloxFullbright = message.fullbright;
    self.__webgpuOnFailure = reason => postMessage({ type: 'failure', reason: String(reason && reason.message || reason) });
    ringBuffer = message.ring.buffer;
    i32 = new Int32Array(ringBuffer);
    f32 = new Float32Array(ringBuffer);
    ctrl = i32;
    mainRing = { i32, f32, buffer: ringBuffer, at };
    const sideBuffer = message.sideRing.buffer;
    sideRing = { i32: new Int32Array(sideBuffer), f32: new Float32Array(sideBuffer), buffer: sideBuffer, at: START >> 2 };
    Atomics.store(sideRing.i32, WORD.TAIL, START);
    statsView = new Float64Array(ringBuffer, STATS_BYTE, STATS.length);
    Atomics.store(ctrl, WORD.TAIL, START);
    gl = await self.__webgpuCreate(message.canvas);
    gl.inIteration = true;
    self.__webgpuGL = gl;
    const noteError = gl.noteError.bind(gl);
    gl.noteError = text => {
      const before = gl.errors.length;
      noteError(text);
      if (gl.errors.length > before) postMessage({ type: 'error', message: gl.errors[gl.errors.length - 1] });
    };
    installHandlers();
    const limits = {};
    for (const key of ['minUniformBufferOffsetAlignment', 'maxTextureDimension2D', 'maxTextureDimension3D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage', 'maxVertexAttributes', 'maxColorAttachments']) limits[key] = gl.device.limits[key];
    limits.depthClamp = gl.depthClamp;
    postMessage({ type: 'ready', limits });
  };

  self.onmessage = event => {
    const message = event.data;
    if (message.type === 'init') {
      init(message).catch(error => postMessage({ type: 'failure', reason: String(error && error.message || error) }));
    } else if (message.type === 'heap') {
      heap = message.heap;
      pump();
    } else if (message.type === 'fullbright') {
      self.__webbloxFullbright = message.on;
    }
  };

  postMessage({ type: 'loaded' });
}
