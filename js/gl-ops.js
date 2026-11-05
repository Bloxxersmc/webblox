(root => {
  'use strict';

  const CALLS = [
    ['activeTexture', 'i'], ['bindBuffer', 'iB'], ['bindBufferBase', 'iiB'], ['bindBufferRange', 'iiBii'], ['bindFramebuffer', 'iF'], ['bindTexture', 'iT'],
    ['blendFunc', 'ii'], ['blendFuncSeparate', 'iiii'], ['colorMask', 'iiii'], ['cullFace', 'i'], ['depthFunc', 'i'], ['depthMask', 'i'], ['disable', 'i'], ['enable', 'i'],
    ['enableVertexAttribArray', 'i'], ['disableVertexAttribArray', 'i'], ['drawArrays', 'iii'], ['drawArraysInstanced', 'iiii'], ['drawElements', 'iiii'], ['drawElementsInstanced', 'iiiii'],
    ['polygonOffset', 'ff'], ['scissor', 'iiii'], ['stencilFunc', 'iii'], ['stencilMask', 'i'], ['stencilOp', 'iii'], ['texParameteri', 'iii'], ['texParameterf', 'iif'], ['useProgram', 'P'],
    ['vertexAttribPointer', 'iiiiii'], ['viewport', 'iiii'], ['clear', 'i'], ['clearColor', 'ffff'], ['clearDepth', 'f'], ['clearStencil', 'i'],
    ['attachShader', 'PS'], ['bindRenderbuffer', 'iR'], ['bindVertexArray', 'V'], ['blitFramebuffer', 'iiiiiiiiii'], ['clearBufferfi', 'iifi'], ['compileShader', 'S'], ['copyTexSubImage2D', 'iiiiiiii'],
    ['deleteBuffer', 'B'], ['deleteFramebuffer', 'F'], ['deleteProgram', 'P'], ['deleteRenderbuffer', 'R'], ['deleteShader', 'S'], ['deleteTexture', 'T'], ['deleteVertexArray', 'V'],
    ['framebufferRenderbuffer', 'iiiR'], ['framebufferTexture2D', 'iiiTi'], ['framebufferTextureLayer', 'iiTii'], ['generateMipmap', 'i'], ['linkProgram', 'P'], ['pixelStorei', 'ii'],
    ['renderbufferStorage', 'iiii'], ['renderbufferStorageMultisample', 'iiiii'], ['texStorage2D', 'iiiii'], ['texStorage3D', 'iiiiii'], ['clipControl', 'ii'],
  ];

  const CUSTOM = ['WRAP', 'FRAME_END', 'RESIZE', 'CREATE', 'BUFFER_DATA', 'BUFFER_SUB', 'CLEAR_BUFFER_FV', 'CLEAR_BUFFER_IV', 'DRAW_BUFFERS', 'INVALIDATE', 'SHADER_SOURCE', 'UNIFORM1I',
    'TEX_IMAGE_2D', 'TEX_IMAGE_3D', 'TEX_SUB_2D', 'TEX_SUB_3D', 'COMPRESSED_2D', 'COMPRESSED_3D', 'COMPRESSED_SUB_2D', 'COMPRESSED_SUB_3D', 'READ_PIXELS'];

  const OP = {};
  CUSTOM.forEach((name, i) => { OP[name] = i; });
  CALLS.forEach(([name], i) => { OP[name] = CUSTOM.length + i; });

  root.__webbloxGlOps = {
    OP,
    CALLS,
    FIRST_CALL: CUSTOM.length,
    KINDS: { BUFFER: 0, TEXTURE: 1, FRAMEBUFFER: 2, RENDERBUFFER: 3, VAO: 4, PROGRAM: 5, SHADER: 6 },
    RING_PAGES: 2048,
    START: 4096,
    WORD: { HEAD: 0, TAIL: 1, SLEEP: 2, DONE: 3, READ_SEQ: 4, SENT: 5, READ_CLAIM: 6 },
    STATS_BYTE: 256,
    STATS: ['draws', 'passes', 'submits', 'pipelines', 'bindGroups', 'missingPrograms', 'skipped', 'ringBytes', 'frames', 'readPixels', 'arenaBytes'],
    DIRECT_BYTES: 16 * 1024 * 1024,
    FRAME_LIMIT: 3,
    READ_WAIT_MS: 10000,
    STALL_WAIT_MS: 30000,
    SIDE: { ENABLE_BEGIN: 0x7E5A0001, ENABLE_END: 0x7E5A0002, KICK: 0x7E5A0010, JOIN: 0x7E5A0011, SERVICE: 0x7E5A0012, THREAD_ARG: 0x7E5A0020, JOB: 16, READY: 17, REQUEST: 18, REQUEST_INDEX: 19, REQUEST_COUNT: 20, FAILED: 21, DRAIN: 22, STATE: 32, VALUES_BYTE: 512, STACK_BYTES: 8 * 1024 * 1024 },
    ENGINE: { FLAGS: 768, THREAD_REQUEST: 770, JOB_ACTIVE: 771, JOB_RUNNING: 1, JOB_PENDING: 2, JOB: 772, THREAD_ATTR: 896, BLOCK: 964, LOCK: 976, DEPTH: 980, LOCK_RELEASES: 984, MARKS_WRITE: 988, CONTEXT_BYTES: 640, DEVICE_BYTES: 1024, STREAMER_AT: 68, STREAMER_BYTES: 80, STREAMER_INDEX: 228, REQUEST_FLAG: 975, SKIP_LIGHT_CULL: 1, SHADOW_THREAD: 4 },
  };
})(self);
