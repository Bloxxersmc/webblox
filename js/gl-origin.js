(() => {
  'use strict';

  if (window.__webbloxWebGPU) return;

  const proto = WebGL2RenderingContext.prototype;
  const GL = {
    FRAMEBUFFER: 0x8D40,
    DRAW_FRAMEBUFFER: 0x8CA9,
    READ_FRAMEBUFFER: 0x8CA8,
    DEPTH_ATTACHMENT: 0x8D00,
    STENCIL_ATTACHMENT: 0x8D20,
    DEPTH_STENCIL_ATTACHMENT: 0x821A,
    TEXTURE0: 0x84C0,
  };

  const sizes = new WeakMap();
  const state = new WeakMap();
  const contextState = gl => {
    let s = state.get(gl);
    if (!s) {
      s = { unit: 0, textures: new Map(), renderbuffer: null, draw: null, viewport: null, scissor: null };
      state.set(gl, s);
    }
    return s;
  };

  const original = {};
  for (const name of ['activeTexture', 'bindTexture', 'texStorage2D', 'texImage2D', 'bindRenderbuffer', 'renderbufferStorage',
                      'renderbufferStorageMultisample', 'bindFramebuffer', 'framebufferTexture2D', 'framebufferTextureLayer',
                      'framebufferRenderbuffer', 'viewport', 'scissor', 'shaderSource']) {
    original[name] = proto[name];
  }

  const STAR_POINT = /gl_PointSize = 2\.0;/;
  const STAR_QUAD = /\(CB0\[50\]\.xy \* 2\.0\)/;
  const sizeStars = source => {
    const width = window.__webbloxStarWidth;
    if (window.__webbloxWebGPU || !(width > 0) || width === 2 || typeof source !== 'string' || !/\bgl_Position\b/.test(source) || !/\bTEXCOORD0\b/.test(source)) return source;
    const size = width.toFixed(3);
    return source.replace(STAR_POINT, `gl_PointSize = ${size};`).replace(STAR_QUAD, `(CB0[50].xy * ${size})`);
  };

  proto.shaderSource = function (shader, source) {
    return original.shaderSource.call(this, shader, sizeStars(source));
  };

  const DEPTH_CLAMP = 0x864F;
  const clampSupport = new WeakMap();
  const hasDepthClamp = gl => {
    if (!clampSupport.has(gl)) clampSupport.set(gl, !!gl.getExtension('EXT_depth_clamp'));
    return clampSupport.get(gl);
  };
  for (const name of ['enable', 'disable']) {
    const native = proto[name];
    proto[name] = function (cap) {
      if (cap !== DEPTH_CLAMP || hasDepthClamp(this)) native.call(this, cap);
    };
  }

  const attachmentInfo = fb => {
    let info = fb.__webbloxAttachments;
    if (!info) info = fb.__webbloxAttachments = new Map();
    return info;
  };

  const depthOnlyHeight = fb => {
    if (!fb || !fb.__webbloxAttachments) return 0;
    let height = 0;
    for (const [attachment, entry] of fb.__webbloxAttachments) {
      if (!entry) continue;
      if (attachment === GL.DEPTH_ATTACHMENT || attachment === GL.DEPTH_STENCIL_ATTACHMENT || attachment === GL.STENCIL_ATTACHMENT) height = entry.height;
      else return 0;
    }
    return height;
  };

  const applyRect = (gl, call, rect) => {
    if (!rect) return;
    const [x, y, w, h] = rect;
    const height = depthOnlyHeight(contextState(gl).draw);
    if (height && h < height) original[call].call(gl, x, height - y - h, w, h);
    else original[call].call(gl, x, y, w, h);
  };

  proto.activeTexture = function (unit) {
    contextState(this).unit = unit - GL.TEXTURE0;
    return original.activeTexture.apply(this, arguments);
  };

  proto.bindTexture = function (target, texture) {
    contextState(this).textures.set(`${contextState(this).unit}:${target}`, texture);
    return original.bindTexture.apply(this, arguments);
  };

  const recordTextureSize = (gl, target, width, height) => {
    const texture = contextState(gl).textures.get(`${contextState(gl).unit}:${target}`);
    if (texture && typeof width === 'number' && typeof height === 'number') sizes.set(texture, { width, height });
  };

  proto.texStorage2D = function (target, levels, format, width, height) {
    recordTextureSize(this, target, width, height);
    return original.texStorage2D.apply(this, arguments);
  };

  proto.texImage2D = function (target, level, format, width, height) {
    if (level === 0) recordTextureSize(this, target, width, height);
    return original.texImage2D.apply(this, arguments);
  };

  proto.bindRenderbuffer = function (target, renderbuffer) {
    contextState(this).renderbuffer = renderbuffer;
    return original.bindRenderbuffer.apply(this, arguments);
  };

  proto.renderbufferStorage = function (target, format, width, height) {
    const rb = contextState(this).renderbuffer;
    if (rb) sizes.set(rb, { width, height });
    return original.renderbufferStorage.apply(this, arguments);
  };

  proto.renderbufferStorageMultisample = function (target, samples, format, width, height) {
    const rb = contextState(this).renderbuffer;
    if (rb) sizes.set(rb, { width, height });
    return original.renderbufferStorageMultisample.apply(this, arguments);
  };

  proto.bindFramebuffer = function (target, framebuffer) {
    const result = original.bindFramebuffer.apply(this, arguments);
    if (target === GL.FRAMEBUFFER || target === GL.DRAW_FRAMEBUFFER) {
      const s = contextState(this);
      const before = depthOnlyHeight(s.draw);
      s.draw = framebuffer;
      if (before || depthOnlyHeight(framebuffer)) {
        applyRect(this, 'viewport', s.viewport);
        applyRect(this, 'scissor', s.scissor);
      }
    }
    return result;
  };

  const boundFor = (gl, target) => (target === GL.READ_FRAMEBUFFER ? null : contextState(gl).draw);

  proto.framebufferTexture2D = function (target, attachment, textarget, texture, level) {
    const fb = boundFor(this, target);
    if (fb) {
      const size = texture && sizes.get(texture);
      attachmentInfo(fb).set(attachment, texture ? { height: size ? Math.max(1, size.height >> level) : 0 } : null);
    }
    return original.framebufferTexture2D.apply(this, arguments);
  };

  proto.framebufferTextureLayer = function (target, attachment, texture, level) {
    const fb = boundFor(this, target);
    if (fb) {
      const size = texture && sizes.get(texture);
      attachmentInfo(fb).set(attachment, texture ? { height: size ? Math.max(1, size.height >> level) : 0 } : null);
    }
    return original.framebufferTextureLayer.apply(this, arguments);
  };

  proto.framebufferRenderbuffer = function (target, attachment, rbTarget, renderbuffer) {
    const fb = boundFor(this, target);
    if (fb) {
      const size = renderbuffer && sizes.get(renderbuffer);
      attachmentInfo(fb).set(attachment, renderbuffer ? { height: size ? size.height : 0 } : null);
    }
    return original.framebufferRenderbuffer.apply(this, arguments);
  };

  proto.viewport = function (x, y, w, h) {
    contextState(this).viewport = [x, y, w, h];
    applyRect(this, 'viewport', [x, y, w, h]);
  };

  proto.scissor = function (x, y, w, h) {
    contextState(this).scissor = [x, y, w, h];
    applyRect(this, 'scissor', [x, y, w, h]);
  };
})();
