(() => {
  'use strict';

  if (window.__webbloxWebGPU || new URLSearchParams(location.search).get('vertexstate') === '0') return;

  const proto = WebGL2RenderingContext.prototype;
  const GL = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
  };

  const original = {};
  for (const name of ['bindBuffer', 'bufferData', 'bufferSubData', 'copyBufferSubData', 'getBufferSubData', 'deleteBuffer',
                      'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribPointer', 'vertexAttribIPointer',
                      'vertexAttribDivisor', 'bindVertexArray', 'getParameter', 'getVertexAttrib', 'getVertexAttribOffset',
                      'drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements']) {
    original[name] = proto[name];
  }

  const contexts = new WeakMap();
  const ctx = gl => {
    let c = contexts.get(gl);
    if (!c) {
      c = { array: null, glArray: null, element: undefined, wanted: [], applied: [], dirty: new Set() };
      contexts.set(gl, c);
    }
    return c;
  };

  const attrib = (list, index) => list[index] || (list[index] = { enabled: undefined, pointer: null, divisor: undefined });

  const syncArray = (gl, c) => {
    if (c.glArray !== c.array) {
      original.bindBuffer.call(gl, GL.ARRAY_BUFFER, c.array);
      c.glArray = c.array;
    }
  };

  const samePointer = (a, b) => a && b && a.buffer === b.buffer && a.size === b.size && a.type === b.type && a.normalized === b.normalized &&
    a.stride === b.stride && a.offset === b.offset && a.integer === b.integer;

  const flush = (gl, c) => {
    if (!c.dirty.size) return;
    for (const index of c.dirty) {
      const want = c.wanted[index];
      const have = attrib(c.applied, index);
      if (want.enabled !== undefined && want.enabled !== have.enabled) {
        if (want.enabled) original.enableVertexAttribArray.call(gl, index);
        else original.disableVertexAttribArray.call(gl, index);
        have.enabled = want.enabled;
      }
      if (want.pointer && !samePointer(want.pointer, have.pointer)) {
        const p = want.pointer;
        if (c.glArray !== p.buffer) {
          original.bindBuffer.call(gl, GL.ARRAY_BUFFER, p.buffer);
          c.glArray = p.buffer;
        }
        if (p.integer) original.vertexAttribIPointer.call(gl, index, p.size, p.type, p.stride, p.offset);
        else original.vertexAttribPointer.call(gl, index, p.size, p.type, p.normalized, p.stride, p.offset);
        have.pointer = p;
      }
      if (want.divisor !== undefined && want.divisor !== have.divisor) {
        original.vertexAttribDivisor.call(gl, index, want.divisor);
        have.divisor = want.divisor;
      }
    }
    c.dirty.clear();
  };

  const want = (gl, index) => {
    const c = ctx(gl);
    c.dirty.add(index);
    return attrib(c.wanted, index);
  };

  proto.enableVertexAttribArray = function (index) {
    want(this, index).enabled = true;
  };

  proto.disableVertexAttribArray = function (index) {
    want(this, index).enabled = false;
  };

  proto.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
    const c = ctx(this);
    want(this, index).pointer = { buffer: c.array, size, type, normalized: !!normalized, stride, offset, integer: false };
  };

  proto.vertexAttribIPointer = function (index, size, type, stride, offset) {
    const c = ctx(this);
    want(this, index).pointer = { buffer: c.array, size, type, normalized: false, stride, offset, integer: true };
  };

  proto.vertexAttribDivisor = function (index, divisor) {
    want(this, index).divisor = divisor;
  };

  proto.bindBuffer = function (target, buffer) {
    const c = ctx(this);
    if (target === GL.ARRAY_BUFFER) {
      c.array = buffer;
      return;
    }
    if (target === GL.ELEMENT_ARRAY_BUFFER) {
      if (c.element === buffer) return;
      c.element = buffer;
    }
    return original.bindBuffer.apply(this, arguments);
  };

  for (const name of ['bufferData', 'bufferSubData', 'getBufferSubData']) {
    proto[name] = function (target) {
      if (target === GL.ARRAY_BUFFER) syncArray(this, ctx(this));
      return original[name].apply(this, arguments);
    };
  }

  proto.copyBufferSubData = function (readTarget, writeTarget) {
    if (readTarget === GL.ARRAY_BUFFER || writeTarget === GL.ARRAY_BUFFER) syncArray(this, ctx(this));
    return original.copyBufferSubData.apply(this, arguments);
  };

  proto.deleteBuffer = function (buffer) {
    const c = ctx(this);
    if (buffer) {
      if (c.array === buffer) c.array = null;
      if (c.glArray === buffer) c.glArray = null;
      if (c.element === buffer) c.element = undefined;
      for (const a of c.applied) if (a && a.pointer && a.pointer.buffer === buffer) a.pointer = null;
    }
    return original.deleteBuffer.apply(this, arguments);
  };

  proto.bindVertexArray = function () {
    const c = ctx(this);
    flush(this, c);
    c.wanted = [];
    c.applied = [];
    c.element = undefined;
    return original.bindVertexArray.apply(this, arguments);
  };

  proto.getParameter = function (pname) {
    if (pname === 0x8894) return ctx(this).array;
    return original.getParameter.apply(this, arguments);
  };

  for (const name of ['getVertexAttrib', 'getVertexAttribOffset']) {
    proto[name] = function () {
      const c = ctx(this);
      flush(this, c);
      syncArray(this, c);
      return original[name].apply(this, arguments);
    };
  }

  for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements']) {
    proto[name] = function () {
      flush(this, ctx(this));
      return original[name].apply(this, arguments);
    };
  }
})();
