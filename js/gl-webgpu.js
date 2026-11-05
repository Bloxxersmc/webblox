(() => {
  'use strict';

  const RING_BYTES = 32 * 1024 * 1024;
  const ARENA_BYTES = 32 * 1024 * 1024;
  const ARENA_PADDING = 16384;
  const UBO_ALIGN = 256;
  const GRANULE_SHIFT = 8;
  const MAX_GPU_ERRORS = 200;
  const GRID_INDEX_CAPACITY = 256;
  const MAX_FRAMES_IN_FLIGHT = 2;
  const REQUIRED_FEATURES = ['texture-compression-bc', 'rg11b10ufloat-renderable', 'float32-filterable', 'depth32float-stencil8'];
  const OPTIONAL_FEATURES = ['float32-blendable', 'texture-compression-bc-sliced-3d', 'texture-formats-tier1', 'timestamp-query', 'depth-clip-control'];
  const DEPTH_CLAMP_EXTENSION = 'EXT_depth_clamp';
  const DEPTH_ONLY_PIPELINES = new URLSearchParams(location.search).get('depthonly') !== '0';

  const GLE = {
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8A11, PIXEL_UNPACK_BUFFER: 0x88EC, PIXEL_PACK_BUFFER: 0x88EB, COPY_READ_BUFFER: 0x8F36, COPY_WRITE_BUFFER: 0x8F37,
    TEXTURE_2D: 0x0DE1, TEXTURE_3D: 0x806F, TEXTURE_2D_ARRAY: 0x8C1A, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, RENDERBUFFER: 0x8D41,
    COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20, DEPTH_STENCIL_ATTACHMENT: 0x821A,
    BACK: 0x0405, NONE: 0, COLOR: 0x1800, DEPTH: 0x1801, STENCIL: 0x1802,
    COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400,
    BLEND: 0x0BE2, CULL_FACE: 0x0B44, DEPTH_CLAMP: 0x864F, DEPTH_TEST: 0x0B71, SCISSOR_TEST: 0x0C11, STENCIL_TEST: 0x0B90, POLYGON_OFFSET_FILL: 0x8037, DITHER: 0x0BD0, RASTERIZER_DISCARD: 0x8C89,
    FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, DELETE_STATUS: 0x8B80, COMPLETION_STATUS: 0x91B1, VALIDATE_STATUS: 0x8B83, ATTACHED_SHADERS: 0x8B85,
    ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89, ACTIVE_UNIFORM_BLOCKS: 0x8A36, UNIFORM_BLOCK_BINDING: 0x8A3F, UNIFORM_BLOCK_DATA_SIZE: 0x8A40,
    UNPACK_ALIGNMENT: 0x0CF5, UNPACK_ROW_LENGTH: 0x0CF2, UNPACK_IMAGE_HEIGHT: 0x806E, UNPACK_SKIP_PIXELS: 0x0CF4, UNPACK_SKIP_ROWS: 0x0CF3, UNPACK_SKIP_IMAGES: 0x806D,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE_WRAP_R: 0x8072, TEXTURE_BASE_LEVEL: 0x813C, TEXTURE_MAX_LEVEL: 0x813D, TEXTURE_MIN_LOD: 0x813A, TEXTURE_MAX_LOD: 0x813B, TEXTURE_COMPARE_MODE: 0x884C, TEXTURE_COMPARE_FUNC: 0x884D, TEXTURE_MAX_ANISOTROPY: 0x84FE,
    NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_NEAREST: 0x2700, LINEAR_MIPMAP_NEAREST: 0x2701, NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703,
    FRAMEBUFFER_COMPLETE: 0x8CD5, ALREADY_SIGNALED: 0x911A, TIMEOUT_EXPIRED: 0x911B, CONDITION_SATISFIED: 0x911C, WAIT_FAILED: 0x911D,
    FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, BYTE: 0x1400, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, HALF_FLOAT: 0x140B,
  };

  const SIMPLE_FORMATS = {
    0x8058: ['rgba8unorm', 4], 0x8C43: ['rgba8unorm-srgb', 4], 0x8229: ['r8unorm', 1], 0x822B: ['rg8unorm', 2], 0x881A: ['rgba16float', 8], 0x822F: ['rg16float', 4], 0x822D: ['r16float', 2],
    0x8814: ['rgba32float', 16], 0x8230: ['rg32float', 8], 0x822E: ['r32float', 4], 0x8C3A: ['rg11b10ufloat', 4], 0x8059: ['rgb10a2unorm', 4], 0x8235: ['r32sint', 4], 0x8236: ['r32uint', 4], 0x8233: ['r16sint', 2], 0x8234: ['r16uint', 2],
    0x8231: ['r8sint', 1], 0x8232: ['r8uint', 1], 0x8239: ['rg16sint', 4], 0x823A: ['rg16uint', 4], 0x8D70: ['rgba32uint', 16], 0x8D82: ['rgba32sint', 16], 0x8D7C: ['rgba8uint', 4], 0x8D8E: ['rgba8sint', 4], 0x822C: ['rg32float', 8], 0x8D62: ['rgba8unorm', 4, 'rgb565'], 0x8056: ['rgba8unorm', 4], 0x8057: ['rgba8unorm', 4],
    0x1908: ['rgba8unorm', 4], 0x8051: ['rgba8unorm', 4, 'rgb'], 0x1907: ['rgba8unorm', 4, 'rgb'],
  };
  const COMPRESSED_FORMATS = {
    0x83F0: ['bc1-rgba-unorm', 8], 0x83F1: ['bc1-rgba-unorm', 8], 0x83F2: ['bc2-rgba-unorm', 16], 0x83F3: ['bc3-rgba-unorm', 16],
    0x8C4C: ['bc1-rgba-unorm-srgb', 8], 0x8C4D: ['bc1-rgba-unorm-srgb', 8], 0x8C4E: ['bc2-rgba-unorm-srgb', 16], 0x8C4F: ['bc3-rgba-unorm-srgb', 16],
    0x8DBB: ['bc4-r-unorm', 8], 0x8DBC: ['bc4-r-snorm', 8], 0x8DBD: ['bc5-rg-unorm', 16], 0x8DBE: ['bc5-rg-snorm', 16],
    0x8E8C: ['bc7-rgba-unorm', 16], 0x8E8D: ['bc7-rgba-unorm-srgb', 16], 0x8E8E: ['bc6h-rgb-float', 16], 0x8E8F: ['bc6h-rgb-ufloat', 16],
  };
  const DEPTH_FORMATS = {
    0x81A5: ['depth16unorm', false], 0x81A6: ['depth24plus', false], 0x88F0: ['depth24plus-stencil8', true], 0x8CAC: ['depth32float', false], 0x8CAD: ['depth32float-stencil8', true], 0x8D48: ['depth24plus-stencil8', true], 0x84F9: ['depth24plus-stencil8', true],
  };
  const BLEND_FACTORS = {
    0: 'zero', 1: 'one', 0x0300: 'src', 0x0301: 'one-minus-src', 0x0302: 'src-alpha', 0x0303: 'one-minus-src-alpha', 0x0304: 'dst-alpha', 0x0305: 'one-minus-dst-alpha',
    0x0306: 'dst', 0x0307: 'one-minus-dst', 0x0308: 'src-alpha-saturated', 0x8001: 'constant', 0x8002: 'one-minus-constant',
  };
  const COMPARE = { 0x0200: 'never', 0x0201: 'less', 0x0202: 'equal', 0x0203: 'less-equal', 0x0204: 'greater', 0x0205: 'not-equal', 0x0206: 'greater-equal', 0x0207: 'always' };
  const STENCIL_OPS = { 0: 'zero', 0x1E00: 'keep', 0x1E01: 'replace', 0x1E02: 'increment-clamp', 0x1E03: 'decrement-clamp', 0x150A: 'invert', 0x8507: 'increment-wrap', 0x8508: 'decrement-wrap' };
  const BLEND_OPS = { 0x8006: 'add', 0x800A: 'subtract', 0x800B: 'reverse-subtract', 0x8007: 'min', 0x8008: 'max' };
  const WRAP = { 0x2901: 'repeat', 0x812F: 'clamp-to-edge', 0x812D: 'clamp-to-edge', 0x8370: 'mirror-repeat' };
  const TOPOLOGY = { 0: 'point-list', 1: 'line-list', 3: 'line-strip', 4: 'triangle-list', 5: 'triangle-strip' };

  const PACKED_16 = {
    0x8363: (v, out, at) => {
      out[at] = (v >> 11) * 255 / 31 + 0.5;
      out[at + 1] = ((v >> 5) & 63) * 255 / 63 + 0.5;
      out[at + 2] = (v & 31) * 255 / 31 + 0.5;
      out[at + 3] = 255;
    },
    0x8033: (v, out, at) => {
      out[at] = (v >> 12) * 17;
      out[at + 1] = ((v >> 8) & 15) * 17;
      out[at + 2] = ((v >> 4) & 15) * 17;
      out[at + 3] = (v & 15) * 17;
    },
    0x8034: (v, out, at) => {
      out[at] = (v >> 11) * 255 / 31 + 0.5;
      out[at + 1] = ((v >> 6) & 31) * 255 / 31 + 0.5;
      out[at + 2] = ((v >> 1) & 31) * 255 / 31 + 0.5;
      out[at + 3] = (v & 1) * 255;
    },
  };

  const vertexFormat = (size, type, normalized, integer) => {
    if (type === GLE.FLOAT) return size === 1 ? 'float32' : `float32x${size}`;
    if (type === GLE.HALF_FLOAT) return size === 1 ? 'float16' : `float16x${size === 3 ? 4 : size}`;
    const base = { [GLE.UNSIGNED_BYTE]: normalized ? 'unorm8' : 'uint8', [GLE.BYTE]: normalized ? 'snorm8' : 'sint8', [GLE.UNSIGNED_SHORT]: normalized ? 'unorm16' : 'uint16', [GLE.SHORT]: normalized ? 'snorm16' : 'sint16', [GLE.UNSIGNED_INT]: 'uint32', [GLE.INT]: 'sint32' }[type];
    if (!base) return null;
    const count = size === 3 && !base.endsWith('32') ? 4 : size;
    return count === 1 ? base : `${base}x${count}`;
  };

  const attributeShaderKind = format => {
    if (!format) return 'f';
    if (format.startsWith('uint')) return 'u';
    if (format.startsWith('sint')) return 'i';
    return 'f';
  };

  const mipCount = (w, h, d) => Math.floor(Math.log2(Math.max(w, h, d || 1))) + 1;

  class Shared {
    constructor(device, table, key) {
      this.device = device;
      this.table = table;
      this.key = key;
      this.modules = new Map();
      this.decoder = new TextDecoder('latin1');
    }

    lookup(source) {
      const entry = this.table.index[this.key(source)];
      if (!entry) return null;
      return this.decoder.decode(this.table.bytes.subarray(entry[0], entry[0] + entry[1]));
    }

    module(code) {
      let module = this.modules.get(code);
      if (!module) {
        module = this.device.createShaderModule({ code: `diagnostic(off, derivative_uniformity);\n${code}` });
        this.modules.set(code, module);
      }
      return module;
    }
  }

  const parseWgsl = code => {
    const textures = new Map();
    const samplers = new Set();
    const blocks = new Map();
    const structs = new Map();
    for (const m of code.matchAll(/struct (\w+) \{\s*([^}]*)\}/g)) {
      const size = /array<vec4<\w+>, (\d+)>/.exec(m[2]);
      if (size) structs.set(m[1], Number(size[1]) * 16);
    }
    for (const m of code.matchAll(/@group\((\d+)\) @binding\((\d+)\)\s*var(<uniform>)?\s+(\w+): ([^;]+);/g)) {
      const [, group, binding, uniform, name, type] = m;
      if (uniform || group === '0') blocks.set(Number(binding), structs.get(type.trim()) || 16);
      else if (type.startsWith('sampler')) samplers.add(name.replace(/_sampler$/, ''));
      else {
        const t = /texture_(2d_array|2d|3d|cube_array|cube)<(\w+)>/.exec(type);
        if (t) textures.set(name.replace(/_image$/, ''), { dimension: t[1].replace('_', '-'), kind: t[2] });
      }
    }
    return { textures, samplers, blocks };
  };

  const parseGlsl = source => {
    const samplers = [...source.matchAll(/^uniform\s+(?:\w+\s+)?(\w*sampler\w+)\s+(\w+);/gm)].map(m => ({ type: m[1], name: m[2] }));
    const blocks = [...source.matchAll(/^layout\(std140\) uniform (block_CB(\d+)) \{ \w+ CB\d+\[(\d+)\]; \};/gm)].map(m => ({ name: m[1], number: Number(m[2]), size: Number(m[3]) * 16 }));
    const attributes = [...source.matchAll(/^layout\(location = (\d+)\) in (\w+) (\w+);/gm)].map(m => ({ location: Number(m[1]), type: m[2], name: m[3] }));
    return { samplers, blocks, attributes };
  };

  const SAMPLER_TYPES = { sampler2D: 0x8B5E, sampler3D: 0x8B5F, samplerCube: 0x8B60, sampler2DArray: 0x8DC1, isampler2D: 0x8DCA, isampler3D: 0x8DCB, usampler2D: 0x8DD2, usampler3D: 0x8DD3, sampler2DShadow: 0x8B62 };

  const CLEAR_WGSL = `struct P { color: vec4f, depth: vec4f };
@group(0) @binding(0) var<uniform> p: P;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let x = f32(i32(i & 1u) * 4 - 1);
  let y = f32(i32(i & 2u) * 2 - 1);
  return vec4f(x, y, p.depth.x, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return p.color; }`;

  const BLIT_WGSL = `struct P { rect: vec4f };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var t: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let x = f32(i32(i & 1u) * 2);
  let y = f32(i32(i & 2u));
  var out: V;
  out.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = p.rect.xy + vec2f(x, y) * p.rect.zw;
  return out;
}
@fragment fn fs(in: V) -> @location(0) vec4f { return textureSampleLevel(t, s, in.uv, 0.0); }`;

  class GL {
    constructor(canvas, device, shared, attributes, probe) {
      this.canvas = canvas;
      this.device = device;
      this.shared = shared;
      this.attributes = attributes || {};
      this.probe = probe;
      this.queue = device.queue;
      this.depthClamp = device.features.has('depth-clip-control');
      this.nextId = 1;
      this.drawingBufferColorSpace = 'srgb';
      this.errors = [];
      this.stats = { draws: 0, passes: 0, submits: 0, pipelines: 0, bindGroups: 0, missingPrograms: 0, skipped: 0, ringBytes: 0, frames: 0, readPixels: 0, arenaBytes: 0 };
      this.seenErrors = new Set();
      this.errorCount = 0;
      device.addEventListener('uncapturederror', event => {
        this.noteError(event.error.message);
        if (++this.errorCount === MAX_GPU_ERRORS && window.__webgpuOnFailure) window.__webgpuOnFailure(`${MAX_GPU_ERRORS} GPU errors`);
      });
      device.lost.then(info => {
        this.noteError(`device lost: ${info.reason} ${info.message}`);
        this.lost = true;
        if (info.reason !== 'destroyed' && window.__webgpuOnFailure) window.__webgpuOnFailure(`device lost: ${info.message}`);
      });

      this.context = canvas.getContext('webgpu');
      this.presentFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device, format: this.presentFormat, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });

      this.ring = device.createBuffer({ size: ARENA_BYTES + RING_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.ringCpu = new Uint8Array(RING_BYTES);
      this.ringCursor = 0;
      this.ringFlushed = 0;
      this.ringEpoch = 1;
      this.uboAlign = device.limits.minUniformBufferOffsetAlignment;
      this.arenaCursor = 0;
      this.arenaFree = new Map();
      this.arenaDirty = [];
      this.arenaConflicts = [];
      this.arenaRetired = [];

      this.encoder = null;
      this.encoderStamp = 1;
      this.pass = null;
      this.passDraws = 0;

      this.arrayBuffer = null;
      this.uniformBuffer = null;
      this.unpackBuffer = null;
      this.packBuffer = null;
      this.copyRead = null;
      this.copyWrite = null;
      this.uboBindings = [];
      this.defaultVao = this.makeVao();
      this.vao = this.defaultVao;
      this.activeUnit = 0;
      this.units = [];
      this.unpack = { [GLE.UNPACK_ALIGNMENT]: 4, [GLE.UNPACK_ROW_LENGTH]: 0, [GLE.UNPACK_IMAGE_HEIGHT]: 0, [GLE.UNPACK_SKIP_PIXELS]: 0, [GLE.UNPACK_SKIP_ROWS]: 0, [GLE.UNPACK_SKIP_IMAGES]: 0 };
      this.program = null;
      this.renderbuffer = null;
      this.readFb = null;
      this.drawFb = null;

      this.enabled = new Map();
      this.blendSrc = [1, 1];
      this.blendDst = [0, 0];
      this.blendOp = [0x8006, 0x8006];
      this.blendConstant = [0, 0, 0, 0];
      this.boundBlendConstant = null;
      this.colorMaskBits = 15;
      this.depthWrite = true;
      this.depthCompare = 0x0201;
      this.cullMode = GLE.BACK;
      this.frontFaceCw = false;
      this.stencil = { func: 0x0207, ref: 0, mask: 0xff, fail: 0x1E00, zfail: 0x1E00, zpass: 0x1E00, write: 0xff };
      this.stencilBack = { func: 0x0207, fail: 0x1E00, zfail: 0x1E00, zpass: 0x1E00 };
      this.polygon = { factor: 0, units: 0, clamp: 0 };
      this.viewportRect = [0, 0, canvas.width, canvas.height];
      this.scissorRect = [0, 0, canvas.width, canvas.height];
      this.clearColorValue = [0, 0, 0, 0];
      this.clearDepthValue = 1;
      this.clearStencilValue = 0;

      this.rasterKey = '';
      this.rasterDirty = true;
      this.pipelineDirty = true;
      this.texturesDirty = true;
      this.vertexDirty = true;
      this.viewDirty = true;
      this.boundPipeline = null;
      this.boundVertexBuffers = [];
      this.boundVertexOffsets = [];
      this.boundOffsets = new Uint32Array(16);
      this.boundIndex = null;
      this.boundIndexFormat = null;
      this.boundIndexOffset = -1;
      this.boundGroup1 = null;
      this.boundStencilRef = -1;

      this.pipelines = new Map();
      this.vertexLayouts = new Map();
      this.groupLayouts = new Map();
      this.pipelineLayouts = new Map();
      this.samplers = new Map();
      this.dummyTextures = new Map();
      this.helpers = new Map();
      this.pendingPresent = false;
      this.framesInFlight = 0;
      this.clipOrigin = 0x8CA1;
      this.clipDepth = 0x935E;
      this.zeroAttrib = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
      new Float32Array(this.zeroAttrib.getMappedRange()).set([0, 0, 0, 1]);
      this.zeroAttrib.unmap();
      this.ensureBackbuffer();
      this.defaultFb = this.makeDefaultFb();
    }

    noteError(message) {
      const short = String(message).slice(0, 600);
      if (this.seenErrors.has(short)) return;
      this.seenErrors.add(short);
      this.errors.push(short);
      if (this.errors.length < 12) console.warn('[webgpu]', short);
    }

    id() { return this.nextId++; }

    get drawingBufferWidth() { return this.canvas.width; }
    get drawingBufferHeight() { return this.canvas.height; }

    ensureBackbuffer() {
      const w = Math.max(1, this.canvas.width);
      const h = Math.max(1, this.canvas.height);
      if (this.backColor && this.backColor.width === w && this.backColor.height === h) return false;
      if (this.backColor) {
        this.endPass();
        this.flushSubmit();
        this.retire(this.backColor.gpu);
        this.retire(this.backDepth.gpu);
      }
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
      this.backColor = this.wrapTexture(this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage }), 'rgba8unorm', w, h);
      this.backDepth = this.wrapTexture(this.device.createTexture({ size: [w, h], format: 'depth24plus-stencil8', usage: GPUTextureUsage.RENDER_ATTACHMENT }), 'depth24plus-stencil8', w, h);
      if (this.defaultFb) {
        this.defaultFb.attachments.set(GLE.COLOR_ATTACHMENT0, { texture: this.backColor, level: 0, layer: 0 });
        this.defaultFb.attachments.set(GLE.DEPTH_STENCIL_ATTACHMENT, { texture: this.backDepth, level: 0, layer: 0 });
        this.defaultFb.version++;
      }
      return true;
    }

    wrapTexture(gpu, format, w, h) {
      const isDepth = format.startsWith('depth');
      return { id: this.id(), gpu, format, width: w, height: h, depth: 1, levels: 1, target: GLE.TEXTURE_2D, sampleCount: 1, params: {}, views: new Map(), attachViews: new Map(), stamp: 0, isDepth, hasStencil: format.endsWith('stencil8'), sampleKind: isDepth ? 'unfilterable-float' : 'float' };
    }

    makeDefaultFb() {
      const fb = { id: 0, attachments: new Map(), drawBuffers: [GLE.COLOR_ATTACHMENT0], version: 1, pending: new Map(), isDefault: true };
      fb.attachments.set(GLE.COLOR_ATTACHMENT0, { texture: this.backColor, level: 0, layer: 0 });
      fb.attachments.set(GLE.DEPTH_STENCIL_ATTACHMENT, { texture: this.backDepth, level: 0, layer: 0 });
      return fb;
    }

    makeVao() {
      return { id: this.nextId++, attribs: [], element: null };
    }

    getContextAttributes() {
      return { alpha: false, antialias: false, depth: true, stencil: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false, desynchronized: false };
    }

    isContextLost() { return !!this.lost; }
    getError() { return 0; }
    flush() {}
    finish() {}
    hint() {}
    getSupportedExtensions() {
      const list = (this.probe ? this.probe.getSupportedExtensions() : []).filter(name => name !== DEPTH_CLAMP_EXTENSION);
      return this.depthClamp ? [...list, DEPTH_CLAMP_EXTENSION] : list;
    }

    getExtension(name) {
      if (name === DEPTH_CLAMP_EXTENSION) return this.depthClamp ? { DEPTH_CLAMP_EXT: 0x864F } : null;
      if (name === 'EXT_clip_control') return { LOWER_LEFT_EXT: 0x8CA1, UPPER_LEFT_EXT: 0x8CA2, NEGATIVE_ONE_TO_ONE_EXT: 0x935E, ZERO_TO_ONE_EXT: 0x935F, clipControlEXT: (origin, depth) => this.clipControl(origin, depth) };
      if (name === 'EXT_polygon_offset_clamp') return { POLYGON_OFFSET_CLAMP_EXT: 0x8E1B, polygonOffsetClampEXT: (factor, units, clamp) => this.polygonOffsetClamp(factor, units, clamp) };
      if (name === 'WEBGL_debug_renderer_info') return this.probe ? this.probe.getExtension(name) : null;
      if (name === 'EXT_texture_filter_anisotropic') return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE };
      if (name === 'EXT_disjoint_timer_query_webgl2' || name === 'EXT_disjoint_timer_query') return null;
      if (!this.probe) return null;
      const list = this.probe.getSupportedExtensions();
      return list.includes(name) ? this.probe.getExtension(name) : null;
    }

    clipControl(origin, depth) {
      this.clipOrigin = origin;
      this.clipDepth = depth;
      if (origin !== 0x8CA1 || depth !== 0x935F) this.noteError(`unexpected clip control ${origin} ${depth}`);
    }

    get extClipControl() { return this.getExtension('EXT_clip_control'); }

    getParameter(pname) {
      switch (pname) {
        case 0x8894: return this.arrayBuffer;
        case 0x8895: return this.vao.element;
        case 0x8A28: return this.uniformBuffer;
        case 0x88EF: return this.unpackBuffer;
        case 0x88ED: return this.packBuffer;
        case 0x8CA6: return this.drawFb;
        case 0x8CAA: return this.readFb;
        case 0x8CA7: return this.renderbuffer;
        case 0x8B8D: return this.program;
        case 0x85B5: return this.vao === this.defaultVao ? null : this.vao;
        case 0x84E0: return 0x84C0 + this.activeUnit;
        case 0x0BA2: return new Int32Array(this.viewportRect);
        case 0x0C10: return new Int32Array(this.scissorRect);
        case 0x935C: return this.clipOrigin;
        case 0x935D: return this.clipDepth;
        case 0x0D57: return 8;
        case 0x8A34: return this.uboAlign;
        case 0x0D33: return Math.min(this.device.limits.maxTextureDimension2D, 16384);
        case 0x8073: return this.device.limits.maxTextureDimension3D;
        case 0x851C: return Math.min(this.device.limits.maxTextureDimension2D, 16384);
        case 0x88FF: return this.device.limits.maxTextureArrayLayers;
        case 0x84E8: return Math.min(this.device.limits.maxTextureDimension2D, 16384);
        case 0x8872: return Math.min(16, this.device.limits.maxSampledTexturesPerShaderStage);
        case 0x8B4C: return 16;
        case 0x8B4D: return 32;
        case 0x8869: return Math.min(16, this.device.limits.maxVertexAttributes);
        case 0x8CDF: case 0x8824: return Math.min(8, this.device.limits.maxColorAttachments);
        case 0x8D57: return 4;
        default: return this.probe ? this.probe.getParameter(pname) : 0;
      }
    }

    getShaderPrecisionFormat() { return { rangeMin: 127, rangeMax: 127, precision: 23 }; }
    getInternalformatParameter() { return new Int32Array([4, 1]); }

    enable(cap) { this.setCap(cap, true); }
    disable(cap) { this.setCap(cap, false); }
    isEnabled(cap) { return !!this.enabled.get(cap); }

    setCap(cap, value) {
      if (!!this.enabled.get(cap) === value) return;
      this.enabled.set(cap, value);
      if (cap === GLE.SCISSOR_TEST) this.viewDirty = true;
      else this.rasterDirty = true;
    }

    blendFunc(src, dst) { this.blendFuncSeparate(src, dst, src, dst); }
    blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha) {
      this.blendSrc = [srcRgb, srcAlpha];
      this.blendDst = [dstRgb, dstAlpha];
      this.rasterDirty = true;
    }
    blendEquation(mode) { this.blendEquationSeparate(mode, mode); }
    blendEquationSeparate(rgb, alpha) {
      if (rgb === this.blendOp[0] && alpha === this.blendOp[1]) return;
      this.blendOp = [rgb, alpha];
      this.rasterDirty = true;
    }
    blendColor(r, g, b, a) { this.blendConstant = [r, g, b, a]; }
    colorMask(r, g, b, a) {
      const bits = (r ? 1 : 0) | (g ? 2 : 0) | (b ? 4 : 0) | (a ? 8 : 0);
      if (bits !== this.colorMaskBits) {
        this.colorMaskBits = bits;
        this.rasterDirty = true;
      }
    }
    depthMask(flag) {
      if (!!flag !== this.depthWrite) {
        this.depthWrite = !!flag;
        this.rasterDirty = true;
      }
    }
    depthFunc(func) {
      if (func !== this.depthCompare) {
        this.depthCompare = func;
        this.rasterDirty = true;
      }
    }
    depthRange() {}
    cullFace(mode) {
      if (mode !== this.cullMode) {
        this.cullMode = mode;
        this.rasterDirty = true;
      }
    }
    frontFace(mode) {
      const cw = mode === 0x0900;
      if (cw !== this.frontFaceCw) {
        this.frontFaceCw = cw;
        this.rasterDirty = true;
      }
    }
    stencilFunc(func, ref, mask) { this.stencilFuncSeparate(0x0408, func, ref, mask); }
    stencilFuncSeparate(face, func, ref, mask) {
      if (face !== 0x0405) {
        this.stencil.func = func;
        this.stencil.ref = ref;
        this.stencil.mask = mask;
      }
      if (face !== 0x0404) this.stencilBack.func = func;
      this.rasterDirty = true;
    }
    stencilMask(mask) {
      this.stencil.write = mask;
      this.rasterDirty = true;
    }
    stencilMaskSeparate(face, mask) { if (face !== 0x0405) this.stencilMask(mask); }
    stencilOp(fail, zfail, zpass) { this.stencilOpSeparate(0x0408, fail, zfail, zpass); }
    stencilOpSeparate(face, fail, zfail, zpass) {
      for (const side of face === 0x0404 ? [this.stencil] : face === 0x0405 ? [this.stencilBack] : [this.stencil, this.stencilBack]) {
        side.fail = fail;
        side.zfail = zfail;
        side.zpass = zpass;
      }
      this.rasterDirty = true;
    }
    polygonOffset(factor, units) {
      this.polygon.factor = factor;
      this.polygon.units = units;
      this.polygon.clamp = 0;
      this.rasterDirty = true;
    }
    polygonOffsetClamp(factor, units, clamp) {
      this.polygon.factor = factor;
      this.polygon.units = units;
      this.polygon.clamp = clamp;
      this.rasterDirty = true;
    }
    lineWidth() {}
    sampleCoverage() {}
    viewport(x, y, w, h) {
      this.viewportRect = [x, y, w, h];
      this.viewDirty = true;
    }
    scissor(x, y, w, h) {
      this.scissorRect = [x, y, w, h];
      this.viewDirty = true;
    }
    clearColor(r, g, b, a) { this.clearColorValue = [r, g, b, a]; }
    clearDepth(d) { this.clearDepthValue = d; }
    clearDepthf(d) { this.clearDepthValue = d; }
    clearStencil(s) { this.clearStencilValue = s; }
    pixelStorei(pname, value) { this.unpack[pname] = value; }
    readBuffer() {}

    createBuffer() { return { id: this.id(), kind: null, size: 0, cpu: null, gpu: null, seq: 0, granules: null, cache: null, usedStamp: 0 }; }

    bindBuffer(target, buffer) {
      switch (target) {
        case GLE.ARRAY_BUFFER: this.arrayBuffer = buffer; break;
        case GLE.ELEMENT_ARRAY_BUFFER: this.vao.element = buffer; break;
        case GLE.UNIFORM_BUFFER: this.uniformBuffer = buffer; break;
        case GLE.PIXEL_UNPACK_BUFFER: this.unpackBuffer = buffer; break;
        case GLE.PIXEL_PACK_BUFFER: this.packBuffer = buffer; break;
        case GLE.COPY_READ_BUFFER: this.copyRead = buffer; break;
        case GLE.COPY_WRITE_BUFFER: this.copyWrite = buffer; break;
        default: break;
      }
      if (buffer && !buffer.kind) buffer.kind = target === GLE.ARRAY_BUFFER || target === GLE.ELEMENT_ARRAY_BUFFER ? 'gpu' : 'cpu';
    }

    bufferFor(target) {
      switch (target) {
        case GLE.ARRAY_BUFFER: return this.arrayBuffer;
        case GLE.ELEMENT_ARRAY_BUFFER: return this.vao.element;
        case GLE.UNIFORM_BUFFER: return this.uniformBuffer;
        case GLE.PIXEL_UNPACK_BUFFER: return this.unpackBuffer;
        case GLE.PIXEL_PACK_BUFFER: return this.packBuffer;
        case GLE.COPY_READ_BUFFER: return this.copyRead;
        case GLE.COPY_WRITE_BUFFER: return this.copyWrite;
        default: return null;
      }
    }

    bytesOf(data, srcOffset, length) {
      if (!srcOffset && !length && data instanceof Uint8Array) return data;
      if (data instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer)) return new Uint8Array(data);
      if (!ArrayBuffer.isView(data)) return null;
      const size = data.BYTES_PER_ELEMENT || 1;
      const start = data.byteOffset + (srcOffset || 0) * size;
      const count = length ? length * size : data.byteLength - (srcOffset || 0) * size;
      return new Uint8Array(data.buffer, start, count);
    }

    bufferData(target, sizeOrData, usage, srcOffset, length) {
      const buffer = this.bufferFor(target);
      if (!buffer) return;
      const bytes = typeof sizeOrData === 'number' ? null : this.bytesOf(sizeOrData, srcOffset, length);
      const size = bytes ? bytes.length : sizeOrData;
      buffer.size = size;
      buffer.usage = usage;
      if (buffer.kind === 'cpu') {
        this.releaseArena(buffer);
        buffer.cpu = new Uint8Array((size + 3) & ~3);
        if (bytes) buffer.cpu.set(bytes);
        buffer.granules = new Uint32Array((size >> GRANULE_SHIFT) + 2);
        buffer.seq = (buffer.seq || 0) + 1;
        buffer.cache = new Map();
        return;
      }
      if (buffer.gpu) this.retire(buffer.gpu);
      const aligned = Math.max(4, (size + 3) & ~3);
      buffer.gpu = this.device.createBuffer({ size: aligned, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      buffer.usedStamp = 0;
      buffer.version = (buffer.version || 0) + 1;
      if (usage !== 0x88E4) buffer.cpu = new Uint8Array(aligned);
      if (bytes) this.writeGpuBuffer(buffer, 0, bytes);
      this.vertexDirty = true;
      this.boundIndex = null;
    }

    bufferSubData(target, offset, data, srcOffset, length) {
      const buffer = this.bufferFor(target);
      const bytes = this.bytesOf(data, srcOffset, length);
      if (!buffer || !bytes || !bytes.length) return;
      if (buffer.kind === 'cpu') {
        if (!buffer.cpu || offset + bytes.length > buffer.cpu.length) return;
        if (buffer.arenaBase >= 0) this.noteArenaWrite(buffer, offset, offset + bytes.length);
        buffer.cpu.set(bytes, offset);
        const seq = ++buffer.seq;
        const last = (offset + bytes.length - 1) >> GRANULE_SHIFT;
        const granules = buffer.granules;
        for (let g = offset >> GRANULE_SHIFT; g <= last; g++) granules[g] = seq;
        return;
      }
      if (buffer.usedStamp === this.encoderStamp) this.flushSubmit();
      this.writeGpuBuffer(buffer, offset, bytes);
    }

    writeGpuBuffer(buffer, offset, bytes) {
      if (buffer.cpu) buffer.cpu.set(bytes, offset);
      const lo = offset & ~3;
      const hi = (offset + bytes.length + 3) & ~3;
      if (lo === offset && hi === offset + bytes.length) {
        this.queue.writeBuffer(buffer.gpu, offset, this.unshared(bytes));
        return;
      }
      const padded = new Uint8Array(hi - lo);
      if (buffer.cpu) padded.set(buffer.cpu.subarray(lo, hi));
      padded.set(bytes, offset - lo);
      this.queue.writeBuffer(buffer.gpu, lo, padded);
    }

    unshared(bytes) {
      return bytes;
    }

    copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size) {
      const from = this.bufferFor(readTarget);
      const to = this.bufferFor(writeTarget);
      if (!from || !to) return;
      const bytes = from.cpu ? from.cpu.subarray(readOffset, readOffset + size) : null;
      if (bytes) {
        const previous = this.copyWrite;
        this.copyWrite = to;
        this.bufferSubData(GLE.COPY_WRITE_BUFFER, writeOffset, bytes);
        this.copyWrite = previous;
      } else this.noteError('copyBufferSubData from a static buffer');
    }

    deleteBuffer(buffer) {
      if (!buffer) return;
      if (buffer.gpu) this.retire(buffer.gpu);
      this.releaseArena(buffer);
      buffer.gpu = null;
      buffer.cpu = null;
      buffer.cache = null;
      if (this.arrayBuffer === buffer) this.arrayBuffer = null;
      if (this.uniformBuffer === buffer) this.uniformBuffer = null;
      if (this.vao.element === buffer) this.vao.element = null;
      this.vertexDirty = true;
      this.boundIndex = null;
      for (const binding of this.uboBindings) if (binding && binding.buffer === buffer) binding.buffer = null;
    }

    retire(resource) {
      (this.retired || (this.retired = [])).push(resource);
    }

    bindBufferBase(target, index, buffer) {
      this.bindBufferRange(target, index, buffer, 0, 0);
    }

    bindBufferRange(target, index, buffer, offset, size) {
      this.uniformBuffer = buffer;
      if (buffer && !buffer.kind) buffer.kind = 'cpu';
      const binding = this.uboBindings[index] || (this.uboBindings[index] = { buffer: null, offset: 0, size: 0 });
      binding.buffer = buffer;
      binding.offset = offset;
      binding.size = size;
    }

    createVertexArray() { return this.makeVao(); }
    deleteVertexArray(vao) {
      if (this.vao === vao) this.vao = this.defaultVao;
    }
    bindVertexArray(vao) {
      this.vao = vao || this.defaultVao;
      this.vertexDirty = true;
      this.boundIndex = null;
    }
    attrib(index) {
      const list = this.vao.attribs;
      return list[index] || (list[index] = { enabled: false, buffer: null, format: null, size: 4, type: GLE.FLOAT, normalized: false, stride: 0, offset: 0, divisor: 0, integer: false });
    }
    enableVertexAttribArray(index) {
      const a = this.attrib(index);
      if (!a.enabled) {
        a.enabled = true;
        this.vertexDirty = true;
      }
    }
    disableVertexAttribArray(index) {
      const a = this.attrib(index);
      if (a.enabled) {
        a.enabled = false;
        this.vertexDirty = true;
      }
    }
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      const a = this.attrib(index);
      const nextStride = stride || 0;
      if (a.buffer === this.arrayBuffer && a.offset === offset && a.stride === nextStride && a.size === size && a.type === type && a.normalized === !!normalized && !a.integer) return;
      a.buffer = this.arrayBuffer;
      a.size = size;
      a.type = type;
      a.normalized = !!normalized;
      a.stride = stride || 0;
      a.offset = offset;
      a.integer = false;
      this.vertexDirty = true;
    }
    vertexAttribIPointer(index, size, type, stride, offset) {
      this.vertexAttribPointer(index, size, type, false, stride, offset);
      this.attrib(index).integer = true;
    }
    vertexAttribDivisor(index, divisor) {
      this.attrib(index).divisor = divisor;
      this.vertexDirty = true;
    }

    createShader(type) { return { id: this.id(), type, source: '', wgsl: null, compiled: false }; }
    shaderSource(shader, source) { shader.source = source; }
    getShaderSource(shader) { return shader.source; }
    compileShader(shader) {
      shader.wgsl = this.shared.lookup(shader.source);
      shader.compiled = true;
      const starWidth = window.__webbloxStarWidth;
      if (shader.wgsl && starWidth > 0 && starWidth !== 2 && /\(CB0\[50\]\.xy \* 2\.0\)/.test(shader.source)) shader.wgsl = shader.wgsl.replace(/(_e\d+\.xy \* )2f/, `$1${starWidth.toFixed(3)}f`);
      if (!shader.wgsl) (this.missing || (this.missing = [])).push(shader.source);
    }
    getShaderParameter(shader, pname) {
      if (pname === GLE.COMPILE_STATUS || pname === GLE.COMPLETION_STATUS) return true;
      if (pname === 0x8B4F) return shader.type;
      return 0;
    }
    getShaderInfoLog() { return ''; }
    deleteShader() {}
    createProgram() { return { id: this.id(), shaders: [], linked: false, samplerUnits: new Map(), locations: new Map() }; }
    attachShader(program, shader) { program.shaders.push(shader); }
    detachShader() {}
    bindAttribLocation() {}
    deleteProgram(program) {
      if (this.program === program) this.program = null;
    }
    validateProgram() {}

    linkProgram(program) {
      const vs = program.shaders.find(s => s.type === GLE.VERTEX_SHADER);
      const fs = program.shaders.find(s => s.type === GLE.FRAGMENT_SHADER);
      program.linked = true;
      if (!vs || !fs) return;
      program.vs = vs;
      program.fs = fs;
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
      const lightText = `${vs.source}\n${fs.source}`;
      program.usesLightGrid = !!this.integrated && /\bisampler3D\s+\w+\s*;/.test(lightText) && /\bCB6\b/.test(lightText);
      const fullbright = window.__webbloxFullbrightCore;
      program.fullbrightOverride = fullbright ? fullbright.overrideFor(vs.source, fs.source) : null;
      program.ready = false;
      program.broken = !vs.wgsl || !fs.wgsl;
    }

    prepareProgram(program) {
      program.ready = true;
      if (program.broken) return;
      const vs = parseWgsl(program.vs.wgsl);
      const fs = parseWgsl(program.fs.wgsl);
      const blocks = new Map();
      for (const parsed of [vs, fs]) for (const [binding, size] of parsed.blocks) blocks.set(binding, Math.max(blocks.get(binding) || 0, size));
      program.blocks = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([binding, size]) => ({ binding, size }));
      program.offsets = new Uint32Array(program.blocks.length);
      program.ringNeed = program.blocks.reduce((sum, block) => sum + ((block.size + UBO_ALIGN - 1) & ~(UBO_ALIGN - 1)), 0);
      const textures = new Map();
      for (const [parsed, stage] of [[vs, GPUShaderStage.VERTEX], [fs, GPUShaderStage.FRAGMENT]]) {
        for (const [name, info] of parsed.textures) {
          const entry = textures.get(name) || { name, dimension: info.dimension, kind: info.kind, visibility: 0 };
          entry.visibility |= stage;
          textures.set(name, entry);
        }
      }
      program.textures = [...textures.values()];
      program.textures.forEach((entry, index) => {
        entry.imageBinding = index * 2;
        entry.samplerBinding = index * 2 + 1;
      });
      const rebind = code => {
        let out = code;
        for (const entry of program.textures) {
          out = out.replace(new RegExp(`@group\\(1\\) @binding\\(\\d+\\)(\\s*var ${entry.name}_image:)`), `@group(1) @binding(${entry.imageBinding})$1`);
          out = out.replace(new RegExp(`@group\\(1\\) @binding\\(\\d+\\)(\\s*var ${entry.name}_sampler:)`), `@group(1) @binding(${entry.samplerBinding})$1`);
        }
        return out;
      };
      program.vsCode = rebind(program.vs.wgsl);
      program.fsCode = rebind(program.fs.wgsl);
      program.fsModule = this.shared.module(program.fsCode);
      const outputStruct = /struct FragmentOutput \{([^}]*)\}/.exec(program.fsCode);
      if (outputStruct) program.fsOutputs = new Set([...outputStruct[1].matchAll(/@location\((\d+)\)/g)].map(m => Number(m[1])));
      else {
        const arrow = /-> @location\((\d+)\)/.exec(program.fsCode);
        program.fsOutputs = new Set(arrow ? [Number(arrow[1])] : []);
      }
      const entryStart = program.vsCode.indexOf('fn main(');
      const entryParameters = program.vsCode.slice(entryStart, program.vsCode.indexOf(')', program.vsCode.indexOf('->', entryStart) - 2) + 1);
      program.vsInputs = [...entryParameters.matchAll(/@location\((\d+)\)\s+(\w+):\s*([\w<>]+)/g)].map(m => ({ location: Number(m[1]), name: m[2], type: m[3] }));
      program.vsVariants = new Map();
      program.fsWritesDepth = /\bdiscard\b|@builtin\(frag_depth\)/.test(program.fsCode);
      program.group0 = this.group0Layout(program);
    }

    positionOnly(code) {
      const struct = /struct VertexOutput \{([^}]*)\}/.exec(code);
      if (!struct) return code;
      const position = struct[1].split(',').findIndex(member => member.includes('@builtin(position)'));
      if (position < 0) return code;
      return code.replace(/-> VertexOutput \{/, '-> @builtin(position) vec4<f32> {').replace(/return VertexOutput\(([^)]*)\);/, (match, list) => `return ${list.split(',')[position].trim()};`);
    }

    vsModule(program, signature, depthOnly) {
      const key = depthOnly ? `${signature}#depth` : signature;
      let module = program.vsVariants.get(key);
      if (module) return module;
      let code = depthOnly ? this.positionOnly(program.vsCode) : program.vsCode;
      for (const input of program.vsInputs) {
        const kind = signature[input.location * 1];
        if (kind !== 'u' && kind !== 'i') continue;
        const scalar = kind === 'u' ? 'u32' : 'i32';
        const intType = input.type.replace('f32', scalar).replace(/^f32$/, scalar);
        code = code.replace(new RegExp(`(@location\\(${input.location}\\)\\s+${input.name}:\\s*)${input.type.replace(/[<>]/g, '\\$&')}`), `$1${intType}`);
        code = code.replace(new RegExp(`(\\w+\\s*=\\s*)${input.name}\\s*;`), `$1${input.type}(${input.name});`);
      }
      module = this.shared.module(code);
      program.vsVariants.set(key, module);
      return module;
    }

    getProgramParameter(program, pname) {
      switch (pname) {
        case GLE.LINK_STATUS: case GLE.COMPLETION_STATUS: case GLE.VALIDATE_STATUS: return true;
        case GLE.DELETE_STATUS: return false;
        case GLE.ATTACHED_SHADERS: return program.shaders.length;
        case GLE.ACTIVE_UNIFORMS: return program.glslSamplers ? program.glslSamplers.length : 0;
        case GLE.ACTIVE_ATTRIBUTES: return program.vsReflect ? program.vsReflect.attributes.length : 0;
        case GLE.ACTIVE_UNIFORM_BLOCKS: return program.glslBlocks ? program.glslBlocks.length : 0;
        default: return 0;
      }
    }
    getProgramInfoLog() { return ''; }
    getActiveUniform(program, index) {
      const sampler = program.glslSamplers && program.glslSamplers[index];
      return sampler ? { name: sampler.name, size: 1, type: SAMPLER_TYPES[sampler.type] || 0x8B5E } : null;
    }
    getActiveAttrib(program, index) {
      const attribute = program.vsReflect && program.vsReflect.attributes[index];
      return attribute ? { name: attribute.name, size: 1, type: 0x8B52 } : null;
    }
    getAttribLocation(program, name) {
      const attribute = program.vsReflect && program.vsReflect.attributes.find(a => a.name === name);
      return attribute ? attribute.location : -1;
    }
    getUniformLocation(program, name) {
      if (!program.glslSamplers || !program.glslSamplers.some(s => s.name === name)) return null;
      let location = program.locations.get(name);
      if (!location) {
        location = { program, name };
        program.locations.set(name, location);
      }
      return location;
    }
    uniform1i(location, value) {
      if (!location) return;
      location.program.samplerUnits.set(location.name, value);
      if (location.program === this.program) this.texturesDirty = true;
    }
    getUniformBlockIndex(program, name) {
      const match = /^block_CB(\d+)$/.exec(name);
      if (!match || !program.glslBlocks || !program.glslBlocks.some(b => b.name === name)) return 0xFFFFFFFF;
      return Number(match[1]);
    }
    uniformBlockBinding() {}
    getActiveUniformBlockName(program, index) {
      return program.glslBlocks[index] ? program.glslBlocks[index].name : null;
    }
    getActiveUniformBlockParameter(program, index, pname) {
      const block = program.glslBlocks[index];
      if (!block) return 0;
      if (pname === GLE.UNIFORM_BLOCK_DATA_SIZE) return block.size;
      if (pname === GLE.UNIFORM_BLOCK_BINDING) return block.number;
      return 0;
    }
    useProgram(program) {
      if (program === this.program) return;
      this.program = program;
      this.pipelineDirty = true;
      this.texturesDirty = true;
      this.vertexDirty = true;
    }

    createTexture() {
      return { id: this.id(), gpu: null, target: 0, format: null, width: 0, height: 0, depth: 1, levels: 1, sampleCount: 1, params: {}, views: new Map(), attachViews: new Map(), stamp: 0, samplerKey: null, samplerObject: null, sampleKind: 'float' };
    }
    activeTexture(unit) { this.activeUnit = unit - 0x84C0; }
    bindTexture(target, texture) {
      const unit = this.units[this.activeUnit] || (this.units[this.activeUnit] = {});
      if (unit[target] === texture) return;
      unit[target] = texture;
      if (texture && !texture.target) texture.target = target;
      this.texturesDirty = true;
    }
    boundTexture(target) {
      const face = target >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && target < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6;
      const unit = this.units[this.activeUnit];
      return unit ? unit[face ? GLE.TEXTURE_CUBE_MAP : target] : null;
    }
    deleteTexture(texture) {
      if (!texture) return;
      if (texture.gpu) this.retire(texture.gpu);
      texture.gpu = null;
      texture.deleted = true;
      texture.views = new Map();
      texture.attachViews = new Map();
      this.dropGroups(texture);
      for (const unit of this.units) {
        if (!unit) continue;
        for (const target of Object.keys(unit)) if (unit[target] === texture) unit[target] = null;
      }
      this.texturesDirty = true;
    }
    dropGroups(texture) {
      const refs = texture.groupRefs;
      if (!refs) return;
      for (let i = 0; i < refs.length; i += 2) refs[i].delete(refs[i + 1]);
      texture.groupRefs = null;
    }
    texParameteri(target, pname, value) {
      const texture = this.boundTexture(target);
      if (!texture || texture.params[pname] === value) return;
      texture.params[pname] = value;
      texture.samplerKey = null;
      if (pname === GLE.TEXTURE_BASE_LEVEL || pname === GLE.TEXTURE_MAX_LEVEL) texture.views = new Map();
      this.texturesDirty = true;
    }
    texParameterf(target, pname, value) { this.texParameteri(target, pname, value); }

    allocate(texture, target, formatCode, width, height, depth, levels, compressed) {
      if (texture.gpu) this.retire(texture.gpu);
      this.dropGroups(texture);
      let format, bytes, block = 1, blockBytes = 0, isDepth = false, hasStencil = false, convert = null;
      if (compressed) {
        const entry = COMPRESSED_FORMATS[formatCode];
        if (!entry) this.noteError(`unknown compressed format 0x${formatCode.toString(16)}`);
        [format, blockBytes] = entry || ['bc1-rgba-unorm', 8];
        block = 4;
        bytes = blockBytes;
      } else if (DEPTH_FORMATS[formatCode]) {
        [format, hasStencil] = DEPTH_FORMATS[formatCode];
        isDepth = true;
        bytes = 4;
      } else {
        const entry = SIMPLE_FORMATS[formatCode];
        if (!entry) this.noteError(`unknown texture format 0x${formatCode.toString(16)}`);
        [format, bytes, convert] = entry || ['rgba8unorm', 4];
      }
      let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
      if (!compressed) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
      const dimension = target === GLE.TEXTURE_3D ? '3d' : '2d';
      const layers = target === GLE.TEXTURE_CUBE_MAP ? 6 : depth;
      const size = compressed ? [(width + 3) & ~3, (height + 3) & ~3, layers] : [width, height, layers];
      const count = Math.min(levels, mipCount(size[0], size[1], dimension === '3d' ? size[2] : 1));
      texture.gpu = this.device.createTexture({ size, format, usage: isDepth ? usage & ~GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_DST : usage, mipLevelCount: count, dimension });
      texture.target = target;
      texture.format = format;
      texture.formatCode = formatCode;
      texture.width = width;
      texture.height = height;
      texture.depth = layers;
      texture.levels = count;
      texture.compressed = compressed;
      texture.block = block;
      texture.blockBytes = blockBytes;
      texture.bytes = bytes;
      texture.convert = convert;
      texture.isDepth = isDepth;
      texture.hasStencil = hasStencil;
      texture.sampleKind = isDepth ? 'unfilterable-float' : /sint$/.test(format) ? 'sint' : /uint$/.test(format) ? 'uint' : (format === 'r32float' || format === 'rg32float' || format === 'rgba32float') ? 'float' : 'float';
      texture.views = new Map();
      texture.attachViews = new Map();
      texture.samplerKey = null;
      this.texturesDirty = true;
    }

    texStorage2D(target, levels, internalformat, width, height) {
      const texture = this.boundTexture(target);
      if (texture) this.allocate(texture, target, internalformat, width, height, 1, levels, !!COMPRESSED_FORMATS[internalformat]);
    }
    texStorage3D(target, levels, internalformat, width, height, depth) {
      const texture = this.boundTexture(target);
      if (texture) this.allocate(texture, target, internalformat, width, height, depth, levels, !!COMPRESSED_FORMATS[internalformat]);
    }

    uploadTarget(texture, target, x, y, z) {
      const isFace = target >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && target < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6;
      return { x, y, z: isFace ? target - GLE.TEXTURE_CUBE_MAP_POSITIVE_X : z };
    }

    upload(texture, target, level, x, y, z, width, height, depth, format, type, data, srcOffset) {
      if (!texture || !texture.gpu || level >= texture.levels || !width || !height || !depth) return;
      if (texture.stamp === this.encoderStamp) this.flushSubmit();
      let source = data;
      let offset = 0;
      if (typeof data === 'number') {
        if (!this.unpackBuffer || !this.unpackBuffer.cpu) return;
        source = this.unpackBuffer.cpu;
        offset = data;
      } else if (!ArrayBuffer.isView(data)) {
        this.uploadImage(texture, target, level, x, y, z, data);
        return;
      } else offset = (srcOffset || 0) * (data.BYTES_PER_ELEMENT || 1);
      const channels = { 0x1903: 1, 0x8D94: 1, 0x8227: 2, 0x8228: 2, 0x1907: 3, 0x8D98: 3, 0x1908: 4, 0x8D99: 4 }[format] || 4;
      const typeBytes = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 }[type] || 1;
      const packed = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x8368: 4, 0x8C3B: 4, 0x8C3E: 4 }[type];
      const pixel = packed || channels * typeBytes;
      const align = this.unpack[GLE.UNPACK_ALIGNMENT] || 1;
      const rowPixels = this.unpack[GLE.UNPACK_ROW_LENGTH] || width;
      const rowBytes = Math.ceil(rowPixels * pixel / align) * align;
      const imageRows = this.unpack[GLE.UNPACK_IMAGE_HEIGHT] || height;
      const skip = this.unpack[GLE.UNPACK_SKIP_IMAGES] * imageRows * rowBytes + this.unpack[GLE.UNPACK_SKIP_ROWS] * rowBytes + this.unpack[GLE.UNPACK_SKIP_PIXELS] * pixel;
      const origin = this.uploadTarget(texture, target, x, y, z);
      const baseOffset = source.byteOffset + offset + skip;
      const expand = texture.bytes === 4 ? PACKED_16[type] : null;
      if (expand) {
        const out = new Uint8Array(width * height * depth * 4);
        const input = new DataView(source.buffer, baseOffset);
        for (let d = 0; d < depth; d++) for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) expand(input.getUint16(d * imageRows * rowBytes + r * rowBytes + c * 2, true), out, (d * height * width + r * width + c) * 4);
        this.queue.writeTexture({ texture: texture.gpu, mipLevel: level, origin: [origin.x, origin.y, origin.z] }, out, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, depth]);
        return;
      }
      if (channels === 3 && texture.bytes === 4) {
        const out = new Uint8Array(width * height * depth * 4);
        const input = new Uint8Array(source.buffer, baseOffset);
        for (let d = 0; d < depth; d++) for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
          const from = d * imageRows * rowBytes + r * rowBytes + c * pixel;
          const to = (d * height * width + r * width + c) * 4;
          out[to] = input[from];
          out[to + 1] = input[from + 1];
          out[to + 2] = input[from + 2];
          out[to + 3] = 255;
        }
        this.queue.writeTexture({ texture: texture.gpu, mipLevel: level, origin: [origin.x, origin.y, origin.z] }, out, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, depth]);
        return;
      }
      const available = source.buffer.byteLength - baseOffset;
      const needed = (depth - 1) * imageRows * rowBytes + (height - 1) * rowBytes + width * pixel;
      if (needed > available) {
        this.noteError(`upload past the end of its data: ${needed} > ${available}`);
        return;
      }
      this.queue.writeTexture(
        { texture: texture.gpu, mipLevel: level, origin: [origin.x, origin.y, origin.z] },
        new Uint8Array(source.buffer, baseOffset, needed),
        { offset: 0, bytesPerRow: rowBytes, rowsPerImage: imageRows },
        [width, height, depth],
      );
    }

    uploadImage(texture, target, level, x, y, z, image) {
      const origin = this.uploadTarget(texture, target, x, y, z);
      try {
        this.queue.copyExternalImageToTexture({ source: image, flipY: false }, { texture: texture.gpu, mipLevel: level, origin: [origin.x, origin.y, origin.z] }, [image.width, image.height]);
      } catch (error) {
        this.noteError(`image upload failed: ${error.message}`);
      }
    }

    uploadCompressed(texture, target, level, x, y, z, width, height, depth, data, srcOffset, length) {
      if (!texture || !texture.gpu || level >= texture.levels || !width || !height || !depth) return;
      if (texture.stamp === this.encoderStamp) this.flushSubmit();
      const bytes = this.bytesOf(data, srcOffset, length);
      if (!bytes) return;
      const origin = this.uploadTarget(texture, target, x, y, z);
      const levelWidth = Math.max(1, (texture.gpu.width) >> level);
      const levelHeight = Math.max(1, (texture.gpu.height) >> level);
      const w = Math.min((width + 3) & ~3, Math.max((levelWidth + 3) & ~3, 4) - origin.x);
      const h = Math.min((height + 3) & ~3, Math.max((levelHeight + 3) & ~3, 4) - origin.y);
      const rows = Math.ceil(h / 4);
      const rowBytes = Math.ceil(w / 4) * texture.blockBytes;
      this.queue.writeTexture(
        { texture: texture.gpu, mipLevel: level, origin: [origin.x, origin.y, origin.z] },
        bytes,
        { offset: 0, bytesPerRow: rowBytes, rowsPerImage: rows },
        [w, h, depth],
      );
    }

    texImage2D(target, level, internalformat, a3, a4, a5, a6, a7, a8, a9) {
      const texture = this.boundTexture(target);
      if (!texture) return;
      if (a6 === undefined) {
        const image = a5;
        const format = SIMPLE_FORMATS[internalformat] ? internalformat : 0x8058;
        if (!texture.gpu || texture.width !== image.width || texture.height !== image.height) this.allocate(texture, target === GLE.TEXTURE_2D ? target : GLE.TEXTURE_CUBE_MAP, format, image.width, image.height, 1, 1, false);
        this.uploadImage(texture, target, level, 0, 0, 0, image);
        return;
      }
      const width = a3, height = a4, format = a6, type = a7, data = a8, offset = a9;
      const code = this.sizedFormat(internalformat, format, type);
      const parent = target >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && target < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6 ? GLE.TEXTURE_CUBE_MAP : target;
      if (level === 0 && (!texture.gpu || texture.width !== width || texture.height !== height || texture.formatCode !== code)) this.allocate(texture, parent, code, width, height, 1, mipCount(width, height), false);
      if (data !== null && data !== undefined) this.upload(texture, target, level, 0, 0, 0, width, height, 1, format, type, data, offset);
    }
    sizedFormat(internal, format, type) {
      if (internal !== 0x1908 && internal !== 0x1907 && internal !== 0x1903 && internal !== 0x8227) return internal;
      if (type === GLE.HALF_FLOAT) return internal === 0x1903 ? 0x822D : internal === 0x8227 ? 0x822F : 0x881A;
      if (type === GLE.FLOAT) return internal === 0x1903 ? 0x822E : internal === 0x8227 ? 0x8230 : 0x8814;
      return internal === 0x1903 ? 0x8229 : internal === 0x8227 ? 0x822B : 0x8058;
    }
    texImage3D(target, level, internalformat, width, height, depth, border, format, type, data, offset) {
      const texture = this.boundTexture(target);
      if (!texture) return;
      const code = this.sizedFormat(internalformat, format, type);
      if (level === 0 && (!texture.gpu || texture.width !== width || texture.height !== height || texture.depth !== depth || texture.formatCode !== code)) this.allocate(texture, target, code, width, height, depth, target === GLE.TEXTURE_3D ? mipCount(width, height, depth) : mipCount(width, height), false);
      if (data !== null && data !== undefined) this.upload(texture, target, level, 0, 0, 0, width, height, depth, format, type, data, offset);
    }
    texSubImage2D(target, level, x, y, a4, a5, a6, a7, a8, a9) {
      const texture = this.boundTexture(target);
      if (a7 === undefined) {
        this.uploadImage(texture, target, level, x, y, 0, a6);
        return;
      }
      this.upload(texture, target, level, x, y, 0, a4, a5, 1, a6, a7, a8, a9);
    }
    texSubImage3D(target, level, x, y, z, width, height, depth, format, type, data, offset) {
      this.upload(this.boundTexture(target), target, level, x, y, z, width, height, depth, format, type, data, offset);
    }
    compressedTexImage2D(target, level, internalformat, width, height, border, data, offset, length) {
      const texture = this.boundTexture(target);
      if (!texture) return;
      const parent = target >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && target < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6 ? GLE.TEXTURE_CUBE_MAP : target;
      if (!texture.gpu || (level === 0 && (texture.width !== width || texture.height !== height || texture.formatCode !== internalformat))) this.allocate(texture, parent, internalformat, width, height, 1, mipCount(width, height), true);
      this.uploadCompressed(texture, target, level, 0, 0, 0, width, height, 1, data, offset, length);
    }
    compressedTexImage3D(target, level, internalformat, width, height, depth, border, data, offset, length) {
      const texture = this.boundTexture(target);
      if (!texture) return;
      if (!texture.gpu || level === 0) this.allocate(texture, target, internalformat, width, height, depth, mipCount(width, height), true);
      this.uploadCompressed(texture, target, level, 0, 0, 0, width, height, depth, data, offset, length);
    }
    compressedTexSubImage2D(target, level, x, y, width, height, format, data, offset, length) {
      this.uploadCompressed(this.boundTexture(target), target, level, x, y, 0, width, height, 1, data, offset, length);
    }
    compressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, data, offset, length) {
      this.uploadCompressed(this.boundTexture(target), target, level, x, y, z, width, height, depth, data, offset, length);
    }

    generateMipmap(target) {
      const texture = this.boundTexture(target);
      if (!texture || !texture.gpu || texture.levels < 2 || texture.compressed || texture.isDepth) return;
      this.finishPass();
      const encoder = this.ensureEncoder();
      const helper = this.mipHelper(texture.format);
      if (!helper) return;
      const layers = texture.target === GLE.TEXTURE_3D ? 1 : texture.depth;
      for (let layer = 0; layer < layers; layer++) {
        for (let level = 1; level < texture.levels; level++) {
          const source = texture.gpu.createView({ dimension: '2d', baseMipLevel: level - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
          const target2 = texture.gpu.createView({ dimension: '2d', baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
          const group = this.device.createBindGroup({ layout: helper.layout, entries: [{ binding: 0, resource: { buffer: this.blitRectBuffer() } }, { binding: 1, resource: this.linearClamp() }, { binding: 2, resource: source }] });
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target2, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
          pass.setPipeline(helper.pipeline);
          pass.setBindGroup(0, group);
          pass.draw(4);
          pass.end();
        }
      }
      texture.stamp = this.encoderStamp;
    }

    blitRectBuffer() {
      if (!this.fullRect) {
        this.fullRect = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
        new Float32Array(this.fullRect.getMappedRange()).set([0, 0, 1, 1]);
        this.fullRect.unmap();
      }
      return this.fullRect;
    }

    linearClamp() {
      if (!this.linearSampler) this.linearSampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
      return this.linearSampler;
    }

    mipHelper(format) {
      const key = `mip:${format}`;
      let helper = this.helpers.get(key);
      if (helper) return helper;
      const module = this.shared.module(BLIT_WGSL);
      const sampleType = /sint$/.test(format) ? 'sint' : /uint$/.test(format) ? 'uint' : 'float';
      if (sampleType !== 'float') return null;
      const layout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ] });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-strip' },
      });
      helper = { layout, pipeline };
      this.helpers.set(key, helper);
      return helper;
    }

    createFramebuffer() { return { id: this.id(), attachments: new Map(), drawBuffers: [GLE.COLOR_ATTACHMENT0], version: 1, pending: new Map() }; }
    deleteFramebuffer(fb) {
      if (this.drawFb === fb) this.bindFramebuffer(GLE.DRAW_FRAMEBUFFER, null);
      if (this.readFb === fb) this.readFb = null;
    }
    saveBindings() {
      return {
        arrayBuffer: this.arrayBuffer, uniformBuffer: this.uniformBuffer, unpackBuffer: this.unpackBuffer, packBuffer: this.packBuffer, copyRead: this.copyRead, copyWrite: this.copyWrite,
        ubo: this.uboBindings.map(binding => binding && { ...binding }),
        vao: this.vao, element: this.vao.element, attribs: this.vao.attribs.map(attrib => attrib && { ...attrib }),
        activeUnit: this.activeUnit, units: this.units.map(unit => unit && { ...unit }), unpack: { ...this.unpack },
        program: this.program, renderbuffer: this.renderbuffer, readFb: this.readFb, drawFb: this.drawFb,
        enabled: new Map(this.enabled), blendSrc: [...this.blendSrc], blendDst: [...this.blendDst], blendOp: [...this.blendOp], blendConstant: [...this.blendConstant],
        colorMaskBits: this.colorMaskBits, depthWrite: this.depthWrite, depthCompare: this.depthCompare, cullMode: this.cullMode, frontFaceCw: this.frontFaceCw,
        stencil: { ...this.stencil }, stencilBack: { ...this.stencilBack }, polygon: { ...this.polygon }, viewportRect: [...this.viewportRect], scissorRect: [...this.scissorRect],
        clearColorValue: [...this.clearColorValue], clearDepthValue: this.clearDepthValue, clearStencilValue: this.clearStencilValue,
      };
    }
    restoreBindings(saved) {
      this.finishPass();
      const { ubo, element, attribs, units, ...rest } = saved;
      Object.assign(this, rest);
      this.uboBindings = ubo;
      this.units = units;
      this.vao.element = element;
      this.vao.attribs = attribs;
      this.rasterDirty = true;
      this.pipelineDirty = true;
      this.texturesDirty = true;
      this.vertexDirty = true;
      this.viewDirty = true;
    }
    bindFramebuffer(target, fb) {
      if (target === GLE.FRAMEBUFFER || target === GLE.DRAW_FRAMEBUFFER) {
        if (this.drawFb !== fb) {
          this.finishPass();
          this.drawFb = fb;
          this.pipelineDirty = true;
          this.viewDirty = true;
        }
      }
      if (target === GLE.FRAMEBUFFER || target === GLE.READ_FRAMEBUFFER) this.readFb = fb;
    }
    currentFb() { return this.drawFb || this.defaultFb; }
    framebufferFor(target) {
      if (target === GLE.READ_FRAMEBUFFER) return this.readFb || this.defaultFb;
      return this.currentFb();
    }
    framebufferTexture2D(target, attachment, textarget, texture, level) {
      const fb = this.framebufferFor(target);
      if (fb === this.currentFb()) this.finishPass();
      const layer = textarget >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && textarget < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6 ? textarget - GLE.TEXTURE_CUBE_MAP_POSITIVE_X : 0;
      this.setAttachment(fb, attachment, texture ? { texture, level, layer } : null);
    }
    framebufferTextureLayer(target, attachment, texture, level, layer) {
      const fb = this.framebufferFor(target);
      if (fb === this.currentFb()) this.finishPass();
      this.setAttachment(fb, attachment, texture ? { texture, level, layer } : null);
    }
    framebufferRenderbuffer(target, attachment, rbTarget, renderbuffer) {
      const fb = this.framebufferFor(target);
      if (fb === this.currentFb()) this.finishPass();
      this.setAttachment(fb, attachment, renderbuffer ? { texture: renderbuffer, level: 0, layer: 0 } : null);
    }
    setAttachment(fb, attachment, value) {
      if (value) fb.attachments.set(attachment, value);
      else fb.attachments.delete(attachment);
      fb.version++;
      if (fb === this.currentFb()) this.pipelineDirty = true;
    }
    checkFramebufferStatus() { return GLE.FRAMEBUFFER_COMPLETE; }
    drawBuffers(list) {
      const fb = this.currentFb();
      const next = Array.from(list);
      if (next.length === fb.drawBuffers.length && next.every((value, i) => value === fb.drawBuffers[i])) return;
      this.finishPass();
      fb.drawBuffers = next;
      fb.version++;
      this.pipelineDirty = true;
    }
    invalidateFramebuffer(target, attachments) {
      const fb = this.framebufferFor(target);
      for (const attachment of attachments) {
        const code = attachment === 0x1800 ? GLE.COLOR_ATTACHMENT0 : attachment === 0x1801 ? GLE.DEPTH_ATTACHMENT : attachment;
        const value = fb.attachments.get(code) || (code === GLE.DEPTH_ATTACHMENT ? fb.attachments.get(GLE.DEPTH_STENCIL_ATTACHMENT) : null);
        if (value) value.invalidated = true;
      }
    }
    invalidateSubFramebuffer() {}
    createRenderbuffer() { return { id: this.id(), isRenderbuffer: true, gpu: null, format: null, width: 0, height: 0, depth: 1, levels: 1, sampleCount: 1, params: {}, views: new Map(), attachViews: new Map(), stamp: 0 }; }
    deleteRenderbuffer(rb) {
      if (rb && rb.gpu) this.retire(rb.gpu);
    }
    bindRenderbuffer(target, rb) { this.renderbuffer = rb; }
    renderbufferStorage(target, internalformat, width, height) { this.renderbufferStorageMultisample(target, 0, internalformat, width, height); }
    renderbufferStorageMultisample(target, samples, internalformat, width, height) {
      const rb = this.renderbuffer;
      if (!rb) return;
      if (rb.gpu) this.retire(rb.gpu);
      const depth = DEPTH_FORMATS[internalformat];
      const entry = depth ? [depth[0]] : SIMPLE_FORMATS[internalformat];
      if (!entry) {
        this.noteError(`unknown renderbuffer format 0x${internalformat.toString(16)}`);
        return;
      }
      const sampleCount = samples > 1 ? 4 : 1;
      let usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
      if (sampleCount === 1) usage |= GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
      else usage |= GPUTextureUsage.TEXTURE_BINDING;
      rb.gpu = this.device.createTexture({ size: [width, height], format: entry[0], sampleCount, usage });
      rb.format = entry[0];
      rb.width = width;
      rb.height = height;
      rb.sampleCount = sampleCount;
      rb.isDepth = !!depth;
      rb.hasStencil = depth ? depth[1] : false;
      rb.attachViews = new Map();
    }

    attachmentView(entry) {
      const texture = entry.texture;
      const key = entry.level * 4096 + entry.layer;
      let view = texture.attachViews.get(key);
      if (!view) {
        const dimension3d = texture.target === GLE.TEXTURE_3D;
        view = texture.gpu.createView(dimension3d || texture.isRenderbuffer ? { dimension: dimension3d ? '3d' : '2d' } : { dimension: '2d', baseMipLevel: entry.level, mipLevelCount: 1, baseArrayLayer: entry.layer, arrayLayerCount: 1 });
        texture.attachViews.set(key, view);
      }
      return view;
    }

    fbColorSlots(fb) {
      if (fb.colorVersion === fb.version) return fb.colorSlots;
      const slots = [];
      fb.drawBuffers.forEach((value, index) => {
        if (value === GLE.NONE) {
          slots.push(null);
          return;
        }
        const code = value === GLE.BACK ? GLE.COLOR_ATTACHMENT0 : value;
        slots.push(fb.attachments.get(code) || null);
      });
      while (slots.length && !slots[slots.length - 1]) slots.pop();
      fb.colorSlots = slots;
      fb.colorVersion = fb.version;
      fb.depthEntry = fb.attachments.get(GLE.DEPTH_STENCIL_ATTACHMENT) || fb.attachments.get(GLE.DEPTH_ATTACHMENT) || fb.attachments.get(GLE.STENCIL_ATTACHMENT) || null;
      fb.signature = `${slots.map(slot => (slot ? slot.texture.format : '-')).join(',')}|${fb.depthEntry ? fb.depthEntry.texture.format : ''}|${(slots.find(Boolean) || fb.depthEntry || { texture: { sampleCount: 1 } }).texture.sampleCount}`;
      return slots;
    }

    fbSize(fb) {
      this.fbColorSlots(fb);
      const first = fb.colorSlots.find(Boolean) || fb.depthEntry;
      if (!first) return [this.canvas.width, this.canvas.height];
      const t = first.texture;
      const shift = t.isRenderbuffer ? 0 : first.level;
      return [Math.max(1, t.width >> shift), Math.max(1, t.height >> shift)];
    }

    ensureEncoder() {
      if (!this.encoder) this.encoder = this.device.createCommandEncoder();
      return this.encoder;
    }

    ensurePass() {
      if (this.pass) return this.pass;
      if (this.currentFb().isDefault && this.ensureBackbuffer()) this.pipelineDirty = true;
      this.passId = (this.passId || 0) + 1;
      const fb = this.currentFb();
      const slots = this.fbColorSlots(fb);
      const colorAttachments = slots.map((slot, index) => {
        if (!slot) return null;
        const pending = fb.pending.get(index);
        const clear = pending || slot.invalidated;
        slot.invalidated = false;
        slot.texture.stamp = this.encoderStamp;
        slot.texture.attachedPass = this.passId;
        return { view: this.attachmentView(slot), loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: pending || [0, 0, 0, 0] };
      });
      const descriptor = { colorAttachments };
      if (fb.depthEntry) {
        const entry = fb.depthEntry;
        entry.texture.stamp = this.encoderStamp;
        entry.texture.attachedPass = this.passId;
        const depthPending = fb.pending.get('depth');
        const stencilPending = fb.pending.get('stencil');
        const attach = {
          view: this.attachmentView(entry),
          depthLoadOp: depthPending !== undefined || entry.invalidated ? 'clear' : 'load',
          depthStoreOp: 'store',
          depthClearValue: depthPending !== undefined ? depthPending : 1,
        };
        if (entry.texture.hasStencil) {
          attach.stencilLoadOp = stencilPending !== undefined || entry.invalidated ? 'clear' : 'load';
          attach.stencilStoreOp = 'store';
          attach.stencilClearValue = stencilPending !== undefined ? stencilPending : 0;
        }
        entry.invalidated = false;
        descriptor.depthStencilAttachment = attach;
      }
      fb.pending.clear();
      if (this.timing && this.timing.used + 2 <= this.timing.capacity) {
        const index = this.timing.used;
        this.timing.used += 2;
        this.timing.labels.push(fb.signature);
        descriptor.timestampWrites = { querySet: this.timing.querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
        this.timing.draws.push(0);
      }
      this.pass = this.ensureEncoder().beginRenderPass(descriptor);
      this.passSize = this.fbSize(fb);
      this.stats.passes++;
      this.boundPipeline = null;
      this.boundVertexBuffers.length = 0;
      this.boundVertexOffsets.length = 0;
      this.boundIndex = null;
      this.boundGroup1 = null;
      this.boundGroup0 = null;
      this.boundStencilRef = -1;
      this.boundBlendConstant = null;
      this.viewDirty = true;
      this.texturesDirty = true;
      this.vertexDirty = true;
      return this.pass;
    }

    endPass() {
      if (this.pass) {
        this.pass.end();
        this.pass = null;
      }
    }

    finishPass() {
      const fb = this.drawFb || this.defaultFb;
      if (!this.pass && fb && fb.pending && fb.pending.size) this.ensurePass();
      this.endPass();
    }

    flushRing() {
      if (this.ringCursor > this.ringFlushed) {
        this.queue.writeBuffer(this.ring, ARENA_BYTES + this.ringFlushed, this.ringCpu, this.ringFlushed, this.ringCursor - this.ringFlushed);
        this.ringFlushed = this.ringCursor;
      }
      const dirty = this.arenaDirty;
      for (let i = 0; i < dirty.length; i++) {
        const buffer = dirty[i];
        if (buffer.arenaBase >= 0 && buffer.dirtyEnd > buffer.dirtyStart) this.writeArena(buffer, buffer.dirtyStart, buffer.dirtyEnd);
        buffer.dirtyStart = buffer.dirtyEnd = 0;
        buffer.arenaListed = false;
      }
      dirty.length = 0;
    }

    writeArena(buffer, start, end) {
      const lo = start & ~3;
      const hi = (end + 3) & ~3;
      this.queue.writeBuffer(this.ring, buffer.arenaBase + lo, buffer.cpu, lo, hi - lo);
      this.stats.arenaBytes += hi - lo;
    }

    attachArena(buffer) {
      const slot = (buffer.cpu.length + ARENA_PADDING + 255) & ~255;
      const free = this.arenaFree.get(slot);
      let base = -1;
      if (free && free.length) base = free.pop();
      else if (this.arenaCursor + slot <= ARENA_BYTES) {
        base = this.arenaCursor;
        this.arenaCursor += slot;
      }
      buffer.arenaBase = base;
      buffer.arenaSlot = slot;
      buffer.arenaStamp = 0;
      buffer.writeEnd = 0;
      buffer.usedEnd = 0;
      buffer.conflict = false;
      buffer.dirtyStart = buffer.dirtyEnd = 0;
      buffer.arenaListed = false;
      if (base >= 0) this.markDirty(buffer, 0, buffer.cpu.length);
    }

    releaseArena(buffer) {
      if (buffer.arenaBase >= 0) this.arenaRetired.push(buffer.arenaSlot, buffer.arenaBase);
      buffer.arenaBase = undefined;
      buffer.conflict = false;
    }

    markDirty(buffer, start, end) {
      if (buffer.dirtyEnd > buffer.dirtyStart) {
        if (start < buffer.dirtyStart) buffer.dirtyStart = start;
        if (end > buffer.dirtyEnd) buffer.dirtyEnd = end;
      } else {
        buffer.dirtyStart = start;
        buffer.dirtyEnd = end;
      }
      if (!buffer.arenaListed) {
        buffer.arenaListed = true;
        this.arenaDirty.push(buffer);
      }
    }

    noteArenaWrite(buffer, start, end) {
      if (buffer.arenaStamp !== this.encoderStamp) {
        buffer.arenaStamp = this.encoderStamp;
        buffer.writeEnd = 0;
        buffer.usedEnd = 0;
      }
      if (buffer.conflict) {
        if (start < buffer.deferStart) buffer.deferStart = start;
        if (end > buffer.deferEnd) buffer.deferEnd = end;
        return;
      }
      if (start < buffer.usedEnd) {
        if (buffer.dirtyEnd > buffer.dirtyStart) {
          this.writeArena(buffer, buffer.dirtyStart, buffer.dirtyEnd);
          buffer.dirtyStart = buffer.dirtyEnd = 0;
        }
        buffer.conflict = true;
        buffer.deferStart = start;
        buffer.deferEnd = end;
        this.arenaConflicts.push(buffer);
        return;
      }
      if (end > buffer.writeEnd) buffer.writeEnd = end;
      this.markDirty(buffer, start, end);
    }

    settleArena() {
      const conflicts = this.arenaConflicts;
      for (let i = 0; i < conflicts.length; i++) {
        const buffer = conflicts[i];
        if (buffer.arenaBase >= 0 && buffer.conflict) this.writeArena(buffer, buffer.deferStart, buffer.deferEnd);
        buffer.conflict = false;
      }
      conflicts.length = 0;
      const retired = this.arenaRetired;
      for (let i = 0; i < retired.length; i += 2) {
        let free = this.arenaFree.get(retired[i]);
        if (!free) this.arenaFree.set(retired[i], free = []);
        free.push(retired[i + 1]);
      }
      retired.length = 0;
    }

    flushSubmit() {
      this.endPass();
      this.flushRing();
      if (this.encoder) {
        this.queue.submit([this.encoder.finish()]);
        this.encoder = null;
        this.stats.submits++;
      }
      this.settleArena();
      this.encoderStamp++;
      if (this.retired && this.retired.length) {
        const list = this.retired;
        this.retired = [];
        for (const item of list) item.destroy();
      }
      this.texturesDirty = true;
      this.vertexDirty = true;
      this.boundIndex = null;
    }

    clear(mask) {
      const fb = this.currentFb();
      if (mask & GLE.COLOR_BUFFER_BIT) {
        this.fbColorSlots(fb).forEach((slot, index) => {
          if (slot) this.clearColorSlot(fb, index, this.clearColorValue);
        });
      }
      if (mask & GLE.DEPTH_BUFFER_BIT && this.depthWrite) this.clearDepthSlot(fb, this.clearDepthValue, null);
      if (mask & GLE.STENCIL_BUFFER_BIT) this.clearDepthSlot(fb, null, this.clearStencilValue);
    }

    clearBufferfv(buffer, drawbuffer, values, offset) {
      const fb = this.currentFb();
      const at = offset || 0;
      if (buffer === GLE.COLOR) {
        this.fbColorSlots(fb);
        if (fb.colorSlots[drawbuffer]) this.clearColorSlot(fb, drawbuffer, [values[at], values[at + 1], values[at + 2], values[at + 3]]);
      } else if (buffer === GLE.DEPTH && this.depthWrite) this.clearDepthSlot(fb, values[at], null);
    }
    clearBufferiv(buffer, drawbuffer, values, offset) {
      const fb = this.currentFb();
      const at = offset || 0;
      if (buffer === GLE.STENCIL) this.clearDepthSlot(fb, null, values[at]);
      else {
        this.fbColorSlots(fb);
        if (fb.colorSlots[drawbuffer]) this.clearColorSlot(fb, drawbuffer, [values[at], values[at + 1], values[at + 2], values[at + 3]]);
      }
    }
    clearBufferuiv(buffer, drawbuffer, values, offset) { this.clearBufferiv(buffer, drawbuffer, values, offset); }
    clearBufferfi(buffer, drawbuffer, depth, stencil) {
      const fb = this.currentFb();
      this.clearDepthSlot(fb, this.depthWrite ? depth : null, stencil);
    }

    scissorCovers(fb) {
      if (!this.enabled.get(GLE.SCISSOR_TEST)) return true;
      const [w, h] = this.fbSize(fb);
      const [x, y, sw, sh] = this.scissorRect;
      return x <= 0 && y <= 0 && x + sw >= w && y + sh >= h;
    }

    clearColorSlot(fb, index, value) {
      if (this.scissorCovers(fb) && this.colorMaskBits === 15) {
        this.endPass();
        fb.pending.set(index, value);
        return;
      }
      this.drawClear(fb, index, value, null);
    }

    clearDepthSlot(fb, depth, stencil) {
      this.fbColorSlots(fb);
      if (!fb.depthEntry) return;
      if (this.scissorCovers(fb)) {
        this.endPass();
        if (depth !== null) fb.pending.set('depth', depth);
        if (stencil !== null && fb.depthEntry.texture.hasStencil) fb.pending.set('stencil', stencil);
        return;
      }
      this.drawClear(fb, -1, null, depth, stencil);
    }

    drawClear(fb, index, value, depth, stencil = null) {
      if (this.ringCursor + UBO_ALIGN > RING_BYTES) this.wrapRing();
      const pass = this.ensurePass();
      const clearsStencil = stencil !== null && !!fb.depthEntry && fb.depthEntry.texture.hasStencil;
      const helper = this.clearHelper(fb, index, depth !== null, clearsStencil);
      const offset = this.reserveRing(32);
      const floats = new Float32Array(8);
      if (value) floats.set(value);
      floats[4] = depth === null ? 0 : depth;
      this.ringCpu.set(new Uint8Array(floats.buffer), offset);
      pass.setPipeline(helper.pipeline);
      this.boundPipeline = null;
      this.boundGroup0 = null;
      pass.setBindGroup(0, this.clearBindGroup(helper), [ARENA_BYTES + offset]);
      this.applyViewport(pass);
      pass.setViewport(0, 0, this.passSize[0], this.passSize[1], 0, 1);
      if (clearsStencil) {
        pass.setStencilReference(stencil & 0xff);
        this.boundStencilRef = -1;
      }
      pass.draw(3);
      this.viewDirty = true;
      this.texturesDirty = true;
      this.vertexDirty = true;
    }

    clearBindGroup(helper) {
      if (!helper.group || helper.ring !== this.ring) {
        helper.group = this.device.createBindGroup({ layout: helper.layout, entries: [{ binding: 0, resource: { buffer: this.ring, size: 32 } }] });
        helper.ring = this.ring;
      }
      return helper.group;
    }

    clearHelper(fb, index, depth, stencil = false) {
      this.fbColorSlots(fb);
      const key = `clear:${fb.signature}:${index}:${depth}:${stencil ? this.stencil.write & 0xff : -1}:${this.colorMaskBits}`;
      let helper = this.helpers.get(key);
      if (helper) return helper;
      const layout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } }] });
      const module = this.shared.module(CLEAR_WGSL);
      const targets = fb.colorSlots.map((slot, i) => (slot ? { format: slot.texture.format, writeMask: i === index ? this.colorMaskBits : 0 } : null));
      const descriptor = {
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets },
        primitive: { topology: 'triangle-list' },
        multisample: { count: this.firstSampleCount(fb) },
      };
      if (fb.depthEntry) {
        descriptor.depthStencil = { format: fb.depthEntry.texture.format, depthWriteEnabled: depth, depthCompare: 'always' };
        if (stencil) {
          const face = { compare: 'always', failOp: 'replace', depthFailOp: 'replace', passOp: 'replace' };
          Object.assign(descriptor.depthStencil, { stencilFront: face, stencilBack: face, stencilReadMask: 0xff, stencilWriteMask: this.stencil.write & 0xff });
        }
      }
      helper = { layout, pipeline: this.device.createRenderPipeline(descriptor) };
      this.helpers.set(key, helper);
      return helper;
    }

    firstSampleCount(fb) {
      this.fbColorSlots(fb);
      const first = fb.colorSlots.find(Boolean) || fb.depthEntry;
      return first ? first.texture.sampleCount : 1;
    }

    wrapRing() {
      this.flushSubmit();
      this.ringCursor = 0;
      this.ringFlushed = 0;
      this.ringEpoch++;
    }

    reserveRing(size) {
      const aligned = (size + UBO_ALIGN - 1) & ~(UBO_ALIGN - 1);
      const offset = this.ringCursor;
      this.ringCursor += aligned;
      this.stats.ringBytes += aligned;
      return offset;
    }

    resolveUbo(binding, size) {
      const buffer = binding && binding.buffer;
      if (!buffer || !buffer.cpu) return ARENA_BYTES + this.reserveRing(size);
      const offset = binding.offset;
      if (buffer.arenaBase === undefined) this.attachArena(buffer);
      if (buffer.arenaBase >= 0 && !buffer.conflict && offset + size <= buffer.arenaSlot && offset % this.uboAlign === 0) {
        if (buffer.arenaStamp !== this.encoderStamp) {
          buffer.arenaStamp = this.encoderStamp;
          buffer.writeEnd = 0;
          buffer.usedEnd = 0;
        }
        const end = offset < buffer.writeEnd ? buffer.writeEnd : offset + size;
        if (end > buffer.usedEnd) buffer.usedEnd = end;
        return buffer.arenaBase + offset;
      }
      if (binding.memoBuffer === buffer && binding.memoOffset === offset && binding.memoSeq === buffer.seq && binding.memoEpoch === this.ringEpoch && binding.memoSize >= size) return binding.memoRing;
      const ring = ARENA_BYTES + this.copyUbo(buffer, offset, size);
      binding.memoBuffer = buffer;
      binding.memoOffset = offset;
      binding.memoSeq = buffer.seq;
      binding.memoEpoch = this.ringEpoch;
      binding.memoSize = size;
      binding.memoRing = ring;
      return ring;
    }

    fullbrightUbo(binding, size, override) {
      const buffer = binding && binding.buffer;
      if (!buffer || !buffer.cpu) return this.resolveUbo(binding, size);
      const offset = binding.offset;
      const seq = this.rangeSeq(buffer, offset, size);
      const memo = binding.fullbright;
      if (memo && memo.cpu === buffer.cpu && memo.offset === offset && memo.seq === seq && memo.epoch === this.ringEpoch && memo.size >= size && memo.override === override) return memo.ring;
      const length = Math.max(Math.min(offset + size, buffer.size) - offset, 0);
      const ring = this.reserveRing(Math.max(length, 16));
      this.ringCpu.set(buffer.cpu.subarray(offset, offset + length), ring);
      override.apply(new Float32Array(this.ringCpu.buffer, ring, length >> 2));
      binding.fullbright = { cpu: buffer.cpu, offset, seq, epoch: this.ringEpoch, size, override, ring: ARENA_BYTES + ring };
      return ARENA_BYTES + ring;
    }

    copyUbo(buffer, offset, size) {
      const cache = buffer.cache;
      const granules = buffer.granules;
      const cached = cache.get(offset);
      if (cached && cached.epoch === this.ringEpoch && cached.size >= size) {
        const last = cached.lastGranule;
        let clean = true;
        for (let g = offset >> GRANULE_SHIFT; g <= last; g++) {
          if (granules[g] > cached.seq) {
            clean = false;
            break;
          }
        }
        if (clean) return cached.ring;
      }
      const end = Math.min(offset + size, buffer.size);
      const first = offset >> GRANULE_SHIFT;
      const ring = this.reserveRing(Math.max(end - offset, 16));
      if (end > offset) this.ringCpu.set(buffer.cpu.subarray(offset, end), ring);
      const lastGranule = end > offset ? (end - 1) >> GRANULE_SHIFT : first;
      if (cached) {
        cached.epoch = this.ringEpoch;
        cached.size = size;
        cached.seq = buffer.seq;
        cached.ring = ring;
        cached.lastGranule = lastGranule;
      } else cache.set(offset, { epoch: this.ringEpoch, size, seq: buffer.seq, ring, lastGranule });
      return ring;
    }

    group0Layout(program) {
      const key = program.blocks.map(b => `${b.binding}:${b.size}`).join(',');
      let entry = this.groupLayouts.get(key);
      if (!entry) {
        const layout = this.device.createBindGroupLayout({ entries: program.blocks.map(b => ({ binding: b.binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: b.size } })) });
        const group = this.device.createBindGroup({ layout, entries: program.blocks.map(b => ({ binding: b.binding, resource: { buffer: this.ring, size: b.size } })) });
        entry = { layout, group, key };
        this.groupLayouts.set(key, entry);
      }
      return entry;
    }

    group1Layout(program, classKey) {
      const key = `${program.textures.map(t => `${t.dimension}${t.kind}${t.visibility}`).join(',')}|${classKey}`;
      let layout = this.groupLayouts.get(key);
      if (!layout) {
        const entries = [];
        program.textures.forEach((t, i) => {
          const unfilterable = classKey[i] === 'u';
          const sampleType = t.kind === 'i32' ? 'sint' : t.kind === 'u32' ? 'uint' : unfilterable ? 'unfilterable-float' : 'float';
          entries.push({ binding: t.imageBinding, visibility: t.visibility, texture: { sampleType, viewDimension: t.dimension } });
          entries.push({ binding: t.samplerBinding, visibility: t.visibility, sampler: { type: t.kind !== 'f32' || unfilterable ? 'non-filtering' : 'filtering' } });
        });
        layout = { layout: this.device.createBindGroupLayout({ entries }), key };
        this.groupLayouts.set(key, layout);
      }
      return layout;
    }

    dummyTexture(dimension, kind) {
      const key = `${dimension}:${kind}`;
      let view = this.dummyTextures.get(key);
      if (view) return view;
      const format = kind === 'i32' ? 'rgba32sint' : kind === 'u32' ? 'rgba32uint' : 'rgba8unorm';
      const layers = dimension === 'cube' ? 6 : 1;
      const gpu = this.device.createTexture({ size: [1, 1, layers], format, dimension: dimension === '3d' ? '3d' : '2d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const pixel = format === 'rgba8unorm' ? new Uint8Array([0, 0, 0, 255]) : new Uint8Array(16);
      for (let layer = 0; layer < layers; layer++) this.queue.writeTexture({ texture: gpu, origin: [0, 0, layer] }, pixel, { bytesPerRow: pixel.length }, [1, 1, 1]);
      view = gpu.createView({ dimension });
      this.dummyTextures.set(key, view);
      return view;
    }

    textureView(texture, dimension) {
      if (texture.quickView && texture.quickDimension === dimension && texture.quickViews === texture.views) return texture.quickView;
      const view = this.buildTextureView(texture, dimension);
      texture.quickView = view;
      texture.quickDimension = dimension;
      texture.quickViews = texture.views;
      return view;
    }

    buildTextureView(texture, dimension) {
      const base = texture.params[GLE.TEXTURE_BASE_LEVEL] || 0;
      const maxParam = texture.params[GLE.TEXTURE_MAX_LEVEL];
      const top = maxParam === undefined ? texture.levels - 1 : Math.min(maxParam, texture.levels - 1);
      const start = Math.min(base, texture.levels - 1);
      const key = `${dimension}:${start}:${top}`;
      let view = texture.views.get(key);
      if (!view) {
        const descriptor = { dimension, baseMipLevel: start, mipLevelCount: Math.max(1, top - start + 1) };
        if (texture.isDepth) descriptor.aspect = 'depth-only';
        view = texture.gpu.createView(descriptor);
        view.__id = this.id();
        texture.views.set(key, view);
      }
      return view;
    }

    samplerFor(texture, forceNearest) {
      if (texture.samplerKey !== null && texture.samplerNearest === forceNearest) return texture.samplerObject;
      const p = texture.params;
      const min = p[GLE.TEXTURE_MIN_FILTER] === undefined ? GLE.NEAREST_MIPMAP_LINEAR : p[GLE.TEXTURE_MIN_FILTER];
      const mag = p[GLE.TEXTURE_MAG_FILTER] === undefined ? GLE.LINEAR : p[GLE.TEXTURE_MAG_FILTER];
      const minLinear = !forceNearest && (min === GLE.LINEAR || min === GLE.LINEAR_MIPMAP_NEAREST || min === GLE.LINEAR_MIPMAP_LINEAR);
      const magLinear = !forceNearest && mag === GLE.LINEAR;
      const mipLinear = !forceNearest && (min === GLE.NEAREST_MIPMAP_LINEAR || min === GLE.LINEAR_MIPMAP_LINEAR);
      const noMips = min === GLE.NEAREST || min === GLE.LINEAR;
      const lodMin = Math.max(0, p[GLE.TEXTURE_MIN_LOD] || 0);
      const lodMax = noMips ? lodMin : Math.min(32, p[GLE.TEXTURE_MAX_LOD] === undefined ? 32 : p[GLE.TEXTURE_MAX_LOD]);
      const anisotropy = minLinear && magLinear && mipLinear ? Math.max(1, Math.min(16, Math.floor(p[GLE.TEXTURE_MAX_ANISOTROPY] || 1))) : 1;
      const key = [minLinear, magLinear, mipLinear, p[GLE.TEXTURE_WRAP_S], p[GLE.TEXTURE_WRAP_T], p[GLE.TEXTURE_WRAP_R], lodMin, lodMax, anisotropy].join();
      let sampler = this.samplers.get(key);
      if (!sampler) {
        sampler = this.device.createSampler({
          minFilter: minLinear ? 'linear' : 'nearest',
          magFilter: magLinear ? 'linear' : 'nearest',
          mipmapFilter: mipLinear ? 'linear' : 'nearest',
          addressModeU: WRAP[p[GLE.TEXTURE_WRAP_S]] || 'repeat',
          addressModeV: WRAP[p[GLE.TEXTURE_WRAP_T]] || 'repeat',
          addressModeW: WRAP[p[GLE.TEXTURE_WRAP_R]] || 'repeat',
          lodMinClamp: lodMin,
          lodMaxClamp: Math.max(lodMin, lodMax),
          maxAnisotropy: anisotropy,
        });
        sampler.__id = this.id();
        this.samplers.set(key, sampler);
      }
      texture.samplerKey = key;
      texture.samplerObject = sampler;
      texture.samplerNearest = forceNearest;
      return sampler;
    }

    nearestSampler() {
      if (!this.plainNearest) {
        this.plainNearest = this.device.createSampler({ minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
        this.plainNearest.__id = this.id();
      }
      return this.plainNearest;
    }

    resolveTextures(program) {
      const list = program.textures;
      let classKey = '';
      let bindKey = '';
      const resolved = program.resolved || (program.resolved = []);
      const sources = program.resolvedTextures || (program.resolvedTextures = []);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const unitIndex = program.samplerUnits.get(t.name) || 0;
        const unit = this.units[unitIndex];
        const target = t.dimension === 'cube' ? GLE.TEXTURE_CUBE_MAP : t.dimension === '3d' ? GLE.TEXTURE_3D : t.dimension === '2d-array' ? GLE.TEXTURE_2D_ARRAY : GLE.TEXTURE_2D;
        const texture = unit ? unit[target] : null;
        let view, sampler, unfilterable = false;
        sources[i] = null;
        const gridSlot = program.usesLightGrid && this.gridSlot ? (t.name === 'Texture12Texture' ? this.gridSlot.gridView : t.name === 'Texture13Texture' ? this.gridSlot.indexView : null) : null;
        if (gridSlot) {
          view = gridSlot;
          sampler = this.nearestSampler();
        } else if (texture && texture.gpu && !texture.deleted && texture.attachedPass !== this.passId) {
          texture.stamp = this.encoderStamp;
          sources[i] = texture;
          unfilterable = texture.sampleKind === 'unfilterable-float';
          view = this.textureView(texture, t.dimension);
          sampler = t.kind !== 'f32' || unfilterable ? this.nearestSampler() : this.samplerFor(texture, false);
        } else {
          view = this.dummyTexture(t.dimension, t.kind);
          if (!view.__id) view.__id = this.id();
          sampler = this.nearestSampler();
        }
        resolved[i * 2] = view;
        resolved[i * 2 + 1] = sampler;
        classKey += unfilterable ? 'u' : 'f';
        bindKey += `${view.__id}.${sampler.__id},`;
      }
      program.classKey = classKey;
      program.bindKey = bindKey;
    }

    group1For(program) {
      if (!program.groups) program.groups = new Map();
      const key = `${program.classKey}|${program.bindKey}`;
      let group = program.groups.get(key);
      if (!group) {
        const layout = this.group1Layout(program, program.classKey);
        const entries = [];
        program.textures.forEach((t, i) => {
          entries.push({ binding: t.imageBinding, resource: program.resolved[i * 2] });
          entries.push({ binding: t.samplerBinding, resource: program.resolved[i * 2 + 1] });
        });
        group = this.device.createBindGroup({ layout: layout.layout, entries });
        program.groups.set(key, group);
        for (const texture of program.resolvedTextures) if (texture) (texture.groupRefs || (texture.groupRefs = [])).push(program.groups, key);
        this.stats.bindGroups++;
      }
      return group;
    }

    computeRasterKey() {
      const e = this.enabled;
      const s = this.stencil;
      const blend = e.get(GLE.BLEND) ? `${this.blendSrc[0]},${this.blendDst[0]},${this.blendSrc[1]},${this.blendDst[1]},${this.blendOp[0]},${this.blendOp[1]}` : '-';
      const depth = e.get(GLE.DEPTH_TEST) ? `${this.depthCompare},${this.depthWrite ? 1 : 0}` : '-';
      const b = this.stencilBack;
      const stencil = e.get(GLE.STENCIL_TEST) ? `${s.func},${s.mask},${s.fail},${s.zfail},${s.zpass},${s.write},${b.func},${b.fail},${b.zfail},${b.zpass}` : '-';
      const cull = e.get(GLE.CULL_FACE) ? this.cullMode : '-';
      const offset = e.get(GLE.POLYGON_OFFSET_FILL) ? `${this.polygon.factor},${this.polygon.units},${this.polygon.clamp}` : '-';
      this.rasterKey = `${blend}|${depth}|${stencil}|${cull}|${this.frontFaceCw ? 1 : 0}|${offset}|${this.colorMaskBits}|${e.get(GLE.DEPTH_CLAMP) ? 1 : 0}`;
      this.rasterDirty = false;
      this.pipelineDirty = true;
    }

    vertexShape(program) {
      const attribs = this.vao.attribs;
      const inputs = program.vsInputs;
      const shape = program.vertexShapeNow || (program.vertexShapeNow = new Int32Array(inputs.length * 4));
      for (let i = 0; i < inputs.length; i++) {
        const a = attribs[inputs[i].location];
        const at = i * 4;
        if (!a || !a.enabled || !a.buffer || !a.buffer.gpu) {
          shape[at] = -1;
          shape[at + 1] = 0;
          shape[at + 2] = 0;
          shape[at + 3] = -1;
          continue;
        }
        const stride = a.stride;
        shape[at] = a.size | (a.type << 4) | (a.normalized ? 1 << 24 : 0) | (a.divisor > 0 ? 1 << 25 : 0);
        shape[at + 1] = stride;
        shape[at + 2] = stride ? a.offset % stride : 0;
        let group = i;
        for (let k = 0; k < i; k++) {
          const other = attribs[inputs[k].location];
          if (other && shape[k * 4] >= 0 && other.buffer === a.buffer && other.stride === stride && (!stride || other.offset - shape[k * 4 + 2] === a.offset - shape[at + 2]) && (other.divisor > 0) === (a.divisor > 0)) {
            group = k;
            break;
          }
        }
        shape[at + 3] = group;
      }
      return shape;
    }

    computeVertexLayout(program) {
      const shape = this.vertexShape(program);
      const cached = program.vertexCache;
      if (cached && cached.shape.length === shape.length) {
        let same = true;
        for (let i = 0; i < shape.length; i++) {
          if (cached.shape[i] !== shape[i]) {
            same = false;
            break;
          }
        }
        if (same) {
          const attribs = this.vao.attribs;
          const slots = cached.slots;
          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.owner < 0) continue;
            const a = attribs[slot.owner];
            slot.buffer = a.buffer;
            slot.offset = a.stride ? a.offset - (a.offset % a.stride) : a.offset;
          }
          this.vertexSlots = slots;
          this.vertexKey = cached.key;
          this.vertexSignature = cached.signature;
          this.vertexDirty = false;
          return;
        }
      }
      this.vertexSlots = [];
      this.buildVertexLayout(program);
      for (const slot of this.vertexSlots) {
        slot.owner = slot.attributes.length && slot.buffer !== this.zeroAttrib ? slot.attributes[0].shaderLocation : -1;
      }
      program.vertexCache = { shape: shape.slice(), slots: this.vertexSlots, key: this.vertexKey, signature: this.vertexSignature };
    }

    buildVertexLayout(program) {
      const attribs = this.vao.attribs;
      const inputs = program.vsInputs;
      const slots = this.vertexSlots;
      let key = '';
      let signature = '';
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const a = attribs[input.location];
        if (!a || !a.enabled || !a.buffer || !a.buffer.gpu) {
          key += `${input.location}:z;`;
          while (signature.length <= input.location) signature += 'f';
          slots.push({ buffer: this.zeroAttrib, offset: 0, stride: 0, attributes: [{ shaderLocation: input.location, format: 'float32x4', offset: 0 }], instance: false });
          continue;
        }
        const format = a.formatCache && a.formatSize === a.size && a.formatType === a.type && a.formatNorm === a.normalized ? a.formatCache : (a.formatCache = vertexFormat(a.size, a.type, a.normalized, a.integer), a.formatSize = a.size, a.formatType = a.type, a.formatNorm = a.normalized, a.formatCache);
        const kind = attributeShaderKind(format);
        while (signature.length <= input.location) signature += 'f';
        signature = signature.slice(0, input.location) + kind + signature.slice(input.location + 1);
        const stride = a.stride || this.formatBytes(format);
        const base = stride ? a.offset - (a.offset % stride) : a.offset;
        const relative = a.offset - base;
        let slot = null;
        for (let k = 0; k < slots.length; k++) {
          const s = slots[k];
          if (s.buffer === a.buffer && s.stride === stride && s.offset === base && s.instance === (a.divisor > 0)) {
            slot = s;
            break;
          }
        }
        if (!slot) {
          slot = { buffer: a.buffer, offset: base, stride, attributes: [], instance: a.divisor > 0 };
          slots.push(slot);
        }
        slot.attributes.push({ shaderLocation: input.location, format, offset: relative });
      }
      for (const s of slots) key += `${s.stride},${s.instance ? 1 : 0}:${s.attributes.map(a => `${a.shaderLocation}.${a.format}.${a.offset}`).join('/')};`;
      this.vertexKey = key;
      this.vertexSignature = signature;
      this.vertexDirty = false;
    }

    formatBytes(format) {
      const m = /(\d+)x?(\d*)$/.exec(format);
      if (!m) return 4;
      const count = m[2] ? Number(m[2]) : 1;
      const bits = /(\d+)/.exec(format)[1];
      return Number(bits) / 8 * count;
    }

    pipelineFor(program, fb, mode) {
      const classKey = program.classKey;
      const key = `${program.id}|${this.vertexKey}|${this.vertexSignature}|${this.rasterKey}|${fb.signature}|${classKey}|${mode}`;
      let pipeline = this.pipelines.get(key);
      if (pipeline) return pipeline;
      const e = this.enabled;
      const layoutKey = `${program.group0.key}#${program.textures.map(t => `${t.dimension}${t.kind}${t.visibility}`).join(',')}|${classKey}`;
      let layout = this.pipelineLayouts.get(layoutKey);
      if (!layout) {
        layout = this.device.createPipelineLayout({ bindGroupLayouts: [program.group0.layout, this.group1Layout(program, classKey).layout] });
        this.pipelineLayouts.set(layoutKey, layout);
      }
      const buffers = this.vertexSlots.map(s => ({ arrayStride: s.stride, stepMode: s.instance ? 'instance' : 'vertex', attributes: s.attributes }));
      const blendOn = e.get(GLE.BLEND);
      const blendPart = i => {
        const operation = BLEND_OPS[this.blendOp[i]] || 'add';
        const minMax = operation === 'min' || operation === 'max';
        return { srcFactor: minMax ? 'one' : BLEND_FACTORS[this.blendSrc[i]], dstFactor: minMax ? 'one' : BLEND_FACTORS[this.blendDst[i]], operation };
      };
      const blend = blendOn ? { color: blendPart(0), alpha: blendPart(1) } : undefined;
      const targets = fb.colorSlots.map((slot, index) => {
        if (!slot) return null;
        const target = { format: slot.texture.format, writeMask: program.fsOutputs.has(index) ? this.colorMaskBits : 0 };
        const blendable = !/32float|sint$|uint$/.test(slot.texture.format);
        if (blend && blendable && program.fsOutputs.has(index)) target.blend = blend;
        return target;
      });
      const depthOnly = DEPTH_ONLY_PIPELINES && !fb.colorSlots.length && !!fb.depthEntry && !program.fsWritesDepth;
      const descriptor = {
        layout,
        vertex: { module: this.vsModule(program, this.vertexSignature, depthOnly), entryPoint: 'main', buffers },
        primitive: {
          topology: TOPOLOGY[mode] || 'triangle-list',
          frontFace: this.frontFaceCw ? 'ccw' : 'cw',
          cullMode: e.get(GLE.CULL_FACE) ? (this.cullMode === 0x0404 ? 'front' : this.cullMode === GLE.BACK ? 'back' : 'none') : 'none',
        },
        multisample: { count: this.firstSampleCount(fb) },
      };
      if (!depthOnly) descriptor.fragment = { module: program.fsModule, entryPoint: 'main', targets };
      if (mode === 5 || mode === 3) descriptor.primitive.stripIndexFormat = this.currentIndexFormat || 'uint16';
      if (this.depthClamp && e.get(GLE.DEPTH_CLAMP)) descriptor.primitive.unclippedDepth = true;
      if (fb.depthEntry) {
        const s = this.stencil;
        const stencilOn = e.get(GLE.STENCIL_TEST) && fb.depthEntry.texture.hasStencil;
        const face = stencilOn ? { compare: COMPARE[s.func], failOp: STENCIL_OPS[s.fail], depthFailOp: STENCIL_OPS[s.zfail], passOp: STENCIL_OPS[s.zpass] } : { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' };
        const depthOn = e.get(GLE.DEPTH_TEST);
        descriptor.depthStencil = {
          format: fb.depthEntry.texture.format,
          depthWriteEnabled: !!(depthOn && this.depthWrite),
          depthCompare: depthOn ? COMPARE[this.depthCompare] : 'always',
          stencilFront: face,
          stencilBack: stencilOn ? { compare: COMPARE[this.stencilBack.func], failOp: STENCIL_OPS[this.stencilBack.fail], depthFailOp: STENCIL_OPS[this.stencilBack.zfail], passOp: STENCIL_OPS[this.stencilBack.zpass] } : face,
          stencilReadMask: stencilOn ? s.mask & 0xff : 0xff,
          stencilWriteMask: stencilOn ? s.write & 0xff : 0,
        };
        if (e.get(GLE.POLYGON_OFFSET_FILL) && mode >= 4) {
          descriptor.depthStencil.depthBias = Math.round(this.polygon.units);
          descriptor.depthStencil.depthBiasSlopeScale = this.polygon.factor;
          descriptor.depthStencil.depthBiasClamp = this.polygon.clamp;
        }
      }
      try {
        pipeline = this.device.createRenderPipeline(descriptor);
      } catch (error) {
        this.noteError(`pipeline: ${error.message}`);
        pipeline = null;
      }
      this.pipelines.set(key, pipeline);
      this.stats.pipelines++;
      return pipeline;
    }

    originFlip(fb, height, y, h) {
      if (!this.integrated || h >= height) return y;
      this.fbColorSlots(fb);
      return !fb.colorSlots.length && fb.depthEntry ? height - y - h : y;
    }

    applyViewport(pass) {
      const [tw, th] = this.passSize;
      const fb = this.currentFb();
      const [vx, rawVy, vw, vh] = this.viewportRect;
      const vy = this.originFlip(fb, th, rawVy, vh);
      pass.setViewport(vx, vy, Math.max(vw, 1), Math.max(vh, 1), 0, 1);
      if (this.enabled.get(GLE.SCISSOR_TEST)) {
        const [sx, rawSy, sw, sh] = this.scissorRect;
        const sy = this.originFlip(fb, th, rawSy, sh);
        const left = Math.min(Math.max(sx, 0), tw);
        const top = Math.min(Math.max(sy, 0), th);
        const right = Math.min(Math.max(sx + sw, 0), tw);
        const bottom = Math.min(Math.max(sy + sh, 0), th);
        pass.setScissorRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
      } else pass.setScissorRect(0, 0, tw, th);
      this.viewDirty = false;
    }

    rangeSeq(buffer, offset, size) {
      const granules = buffer.granules;
      const last = Math.min((offset + size - 1) >> GRANULE_SHIFT, granules.length - 1);
      let seq = 0;
      for (let g = offset >> GRANULE_SHIFT; g <= last; g++) if (granules[g] > seq) seq = granules[g];
      return seq;
    }

    updateLightGrid() {
      const core = window.__webbloxLightGridCore;
      const globals = this.uboBindings[0];
      const lightBinding = this.uboBindings[6];
      if (!core || !globals || !lightBinding || !globals.buffer || !lightBinding.buffer || !globals.buffer.cpu || !lightBinding.buffer.cpu) return;
      const unit12 = this.units[12] && this.units[12][GLE.TEXTURE_3D];
      const unit13 = this.units[13] && this.units[13][GLE.TEXTURE_3D];
      if (!unit12 || !unit13 || !unit12.gpu || !unit13.gpu) return;
      const froxelAt = globals.offset + core.FROXEL_ROW * 16;
      if (!lightBinding.buffer.cpu || lightBinding.offset >= lightBinding.buffer.cpu.length) return;
      const lightBytes = Math.min(core.MAX_LIGHTS * core.LIGHT_STRIDE * 16, lightBinding.buffer.cpu.length - lightBinding.offset) & ~15;
      const globalsSeq = this.rangeSeq(globals.buffer, froxelAt, 64);
      const lightSeq = this.rangeSeq(lightBinding.buffer, lightBinding.offset, lightBytes);
      const memo = this.gridMemo;
      if (memo && memo.globals === globals.buffer && memo.globalsSeq === globalsSeq && memo.globalsOffset === globals.offset && memo.lights === lightBinding.buffer && memo.lightSeq === lightSeq && memo.lightOffset === lightBinding.offset) return;
      this.gridMemo = { globals: globals.buffer, globalsSeq, globalsOffset: globals.offset, lights: lightBinding.buffer, lightSeq, lightOffset: lightBinding.offset };
      const lightCpu = lightBinding.buffer.cpu;
      if (froxelAt + 64 > globals.buffer.cpu.length) return;
      const froxel = new Float32Array(globals.buffer.cpu.buffer, globals.buffer.cpu.byteOffset + froxelAt, 16);
      if (froxel[15] === 0 && froxel[12] === 0) return;
      const lights = new Float32Array(lightCpu.buffer, lightCpu.byteOffset + lightBinding.offset, lightBytes >> 2);
      const count = core.lightCount(lights);
      if (this.gridSlot && core.sameInputs(froxel, lights, count)) return;
      if (!this.gridSlot) core.sameInputs(froxel, lights, count);
      const capacity = Math.max(unit13.depth, GRID_INDEX_CAPACITY);
      const result = core.cull(froxel, lights, count, unit12.width, unit12.height, unit12.depth, capacity);
      const ring = this.gridRing || (this.gridRing = { next: 0, slots: [] });
      let slot = ring.slots[ring.next];
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
      if (!slot || slot.width !== unit12.width || slot.height !== unit12.height || slot.slices !== unit12.depth || slot.capacity !== capacity) {
        const grid = this.device.createTexture({ size: [unit12.width, unit12.height, unit12.depth], dimension: '3d', format: 'r32sint', usage });
        const index = this.device.createTexture({ size: [unit13.width, unit13.height, capacity], dimension: '3d', format: 'r16sint', usage });
        slot = { grid, index, width: unit12.width, height: unit12.height, slices: unit12.depth, capacity, gridView: grid.createView({ dimension: '3d' }), indexView: index.createView({ dimension: '3d' }), stamp: 0 };
        slot.gridView.__id = this.id();
        slot.indexView.__id = this.id();
        ring.slots[ring.next] = slot;
      }
      ring.next = (ring.next + 1) % 6;
      if (slot.stamp === this.encoderStamp) this.flushSubmit();
      slot.stamp = this.encoderStamp;
      this.queue.writeTexture({ texture: slot.grid }, result.grid, { bytesPerRow: slot.width * 4, rowsPerImage: slot.height }, [slot.width, slot.height, slot.slices]);
      const depth = Math.min(result.depth, slot.capacity);
      this.queue.writeTexture({ texture: slot.index }, result.index.subarray(0, slot.width * slot.height * depth), { bytesPerRow: slot.width * 2, rowsPerImage: slot.height }, [slot.width, slot.height, depth]);
      this.gridSlot = slot;
      this.texturesDirty = true;
    }

    prepareDraw(mode) {
      const program = this.program;
      if (!program || !program.linked) return null;
      if (!program.ready) this.prepareProgram(program);
      if (program.broken) {
        this.stats.missingPrograms++;
        if (!program.reportedBroken) {
          program.reportedBroken = true;
          this.noteError(`no WGSL for a shader in program ${program.id}: ${(!program.vs.wgsl ? program.vs : program.fs).source.slice(0, 200)}`);
        }
        return null;
      }
      if (this.ringCursor + program.ringNeed > RING_BYTES) this.wrapRing();
      const fb = this.currentFb();
      this.fbColorSlots(fb);
      if (window.__webgpuSkipTarget && window.__webgpuSkipTarget.test(fb.signature)) return null;
      if (!fb.colorSlots.length && !fb.depthEntry) {
        this.stats.skipped++;
        return null;
      }
      if (program.usesLightGrid) this.updateLightGrid();
      const pass = this.pass || this.ensurePass();
      if (this.rasterDirty) this.computeRasterKey();
      if (this.vertexDirty) {
        const before = this.vertexKey;
        const signature = this.vertexSignature;
        this.computeVertexLayout(program);
        if (before !== this.vertexKey || signature !== this.vertexSignature) this.pipelineDirty = true;
      }
      if (this.texturesDirty) {
        const classBefore = program.classKey;
        this.resolveTextures(program);
        if (classBefore !== program.classKey) this.pipelineDirty = true;
        const group = this.group1For(program);
        if (group !== this.boundGroup1) {
          pass.setBindGroup(1, group);
          this.boundGroup1 = group;
        }
        this.texturesDirty = false;
      }
      if (this.pipelineDirty || this.lastMode !== mode || this.lastFbVersion !== fb.version || this.lastFb !== fb) {
        const pipeline = this.pipelineFor(program, fb, mode);
        this.currentPipeline = pipeline;
        this.pipelineDirty = false;
        this.lastMode = mode;
        this.lastFb = fb;
        this.lastFbVersion = fb.version;
      }
      const pipeline = this.currentPipeline;
      if (!pipeline) {
        this.stats.skipped++;
        return null;
      }
      if (pipeline !== this.boundPipeline) {
        pass.setPipeline(pipeline);
        this.boundPipeline = pipeline;
      }
      if (this.viewDirty) this.applyViewport(pass);
      if (this.boundBlendConstant !== this.blendConstant) {
        pass.setBlendConstant(this.blendConstant);
        this.boundBlendConstant = this.blendConstant;
      }
      const blocks = program.blocks;
      const offsets = program.offsets;
      const lastOffsets = this.boundOffsets;
      const fullbright = window.__webbloxFullbright ? program.fullbrightOverride : null;
      let offsetsChanged = this.boundGroup0 !== program.group0.group || lastOffsets.length < blocks.length;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const binding = this.uboBindings[block.binding];
        const offset = fullbright && fullbright.block === block.binding ? this.fullbrightUbo(binding, block.size, fullbright) : this.resolveUbo(binding, block.size);
        offsets[i] = offset;
        if (!offsetsChanged && lastOffsets[i] !== offset) offsetsChanged = true;
      }
      if (offsetsChanged) {
        pass.setBindGroup(0, program.group0.group, offsets, 0, offsets.length);
        this.boundGroup0 = program.group0.group;
        if (lastOffsets.length < offsets.length) this.boundOffsets = new Uint32Array(offsets.length * 2);
        this.boundOffsets.set(offsets);
      }
      const slots = this.vertexSlots;
      const boundBuffers = this.boundVertexBuffers;
      const boundBufferOffsets = this.boundVertexOffsets;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const gpu = s.buffer.gpu || s.buffer;
        if (boundBuffers[i] !== gpu || boundBufferOffsets[i] !== s.offset) {
          pass.setVertexBuffer(i, gpu, s.offset);
          boundBuffers[i] = gpu;
          boundBufferOffsets[i] = s.offset;
        }
        if (s.buffer.usedStamp !== undefined) s.buffer.usedStamp = this.encoderStamp;
      }
      if (this.enabled.get(GLE.STENCIL_TEST) && this.boundStencilRef !== this.stencil.ref) {
        pass.setStencilReference(this.stencil.ref & 0xff);
        this.boundStencilRef = this.stencil.ref;
      }
      return pass;
    }

    vertexRangeOk(vertices, instances) {
      const slots = this.vertexSlots;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.stride) continue;
        const steps = s.instance ? instances : vertices;
        if (steps < 1) continue;
        if (s.lastEnd === undefined) {
          s.lastEnd = 0;
          for (const attribute of s.attributes) s.lastEnd = Math.max(s.lastEnd, attribute.offset + this.formatBytes(attribute.format));
        }
        if (s.offset + (steps - 1) * s.stride + s.lastEnd > s.buffer.size) return false;
      }
      return true;
    }

    drawElements(mode, count, type, offset) { this.drawElementsInstanced(mode, count, type, offset, 1); }
    drawElementsInstanced(mode, count, type, offset, instances) {
      if (!count || !instances) return;
      const format = type === GLE.UNSIGNED_INT ? 'uint32' : 'uint16';
      if (this.currentIndexFormat !== format) {
        this.currentIndexFormat = format;
        if (mode === 5 || mode === 3) this.pipelineDirty = true;
      }
      const pass = this.prepareDraw(mode);
      if (!pass) return;
      const element = this.vao.element;
      const indexBytes = format === 'uint32' ? 4 : 2;
      if (!element || !element.gpu || offset % indexBytes || offset + count * indexBytes > element.size || !this.vertexRangeOk(-1, instances)) {
        this.stats.skipped++;
        return;
      }
      if (this.boundIndex !== element.gpu || this.boundIndexFormat !== format) {
        pass.setIndexBuffer(element.gpu, format);
        this.boundIndex = element.gpu;
        this.boundIndexFormat = format;
      }
      element.usedStamp = this.encoderStamp;
      pass.drawIndexed(count, instances, offset / indexBytes);
      this.stats.draws++;
      if (this.timing && this.timing.draws.length) this.timing.draws[this.timing.draws.length - 1]++;
      this.markPresent();
    }
    drawArrays(mode, first, count) { this.drawArraysInstanced(mode, first, count, 1); }
    drawArraysInstanced(mode, first, count, instances) {
      if (!count || !instances) return;
      const pass = this.prepareDraw(mode);
      if (!pass) return;
      if (!this.vertexRangeOk(first + count, instances)) {
        this.stats.skipped++;
        return;
      }
      pass.draw(count, instances, first, 0);
      this.stats.draws++;
      this.markPresent();
    }
    drawRangeElements(mode, start, end, count, type, offset) { this.drawElementsInstanced(mode, count, type, offset, 1); }

    copyTexSubImage2D(target, level, xOffset, yOffset, x, y, width, height) {
      const destination = this.boundTexture(target);
      const fb = this.readFb || this.defaultFb;
      const source = this.colorSource(fb);
      if (!destination || !destination.gpu || !source || !source.texture.gpu) return;
      this.finishPass();
      const layer = target >= GLE.TEXTURE_CUBE_MAP_POSITIVE_X && target < GLE.TEXTURE_CUBE_MAP_POSITIVE_X + 6 ? target - GLE.TEXTURE_CUBE_MAP_POSITIVE_X : 0;
      if (source.texture.format !== destination.format) {
        this.noteError(`copyTexSubImage2D between ${source.texture.format} and ${destination.format}`);
        return;
      }
      this.ensureEncoder().copyTextureToTexture(
        { texture: source.texture.gpu, mipLevel: source.level, origin: [x, y, source.layer] },
        { texture: destination.gpu, mipLevel: level, origin: [xOffset, yOffset, layer] },
        [width, height, 1],
      );
      destination.stamp = this.encoderStamp;
      source.texture.stamp = this.encoderStamp;
    }

    copyTexSubImage3D(target, level, xOffset, yOffset, zOffset, x, y, width, height) {
      const destination = this.boundTexture(target);
      const source = this.colorSource(this.readFb || this.defaultFb);
      if (!destination || !destination.gpu || !source) return;
      this.finishPass();
      this.ensureEncoder().copyTextureToTexture(
        { texture: source.texture.gpu, mipLevel: source.level, origin: [x, y, source.layer] },
        { texture: destination.gpu, mipLevel: level, origin: [xOffset, yOffset, zOffset] },
        [width, height, 1],
      );
      destination.stamp = this.encoderStamp;
    }

    colorSource(fb) {
      this.fbColorSlots(fb);
      return fb.attachments.get(GLE.COLOR_ATTACHMENT0) || null;
    }

    blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
      const readFb = this.readFb || this.defaultFb;
      const drawFb = this.currentFb();
      this.fbColorSlots(readFb);
      this.fbColorSlots(drawFb);
      this.finishPass();
      if (mask & GLE.COLOR_BUFFER_BIT) {
        const source = readFb.attachments.get(GLE.COLOR_ATTACHMENT0);
        const target = drawFb.colorSlots.find(Boolean);
        if (source && target) this.blitColor(source, target, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, filter);
      }
      if (mask & GLE.DEPTH_BUFFER_BIT && readFb.depthEntry && drawFb.depthEntry) this.blitDepth(readFb.depthEntry, drawFb.depthEntry, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1);
    }

    depthBlitHelper(multisampled, format, sampleCount) {
      const key = `depthblit:${multisampled}:${format}:${sampleCount}`;
      let helper = this.helpers.get(key);
      if (helper) return helper;
      const module = this.shared.module(`struct P { offset: vec2f, scale: vec2f };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var t: ${multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i & 2u) * 2 - 1), 0.0, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> @builtin(frag_depth) f32 {
  return textureLoad(t, vec2i(p.offset + at.xy * p.scale), 0);
}`);
      helper = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format, depthWriteEnabled: true, depthCompare: 'always' },
        multisample: { count: sampleCount },
      });
      this.helpers.set(key, helper);
      return helper;
    }

    blitDepth(source, target, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1) {
      const from = source.texture;
      const to = target.texture;
      if (!from.gpu || !to.gpu || from === to) return;
      const sw = sx1 - sx0, sh = sy1 - sy0, dw = dx1 - dx0, dh = dy1 - dy0;
      if (!sw || !sh || !dw || !dh) return;
      const scaleX = sw / dw, scaleY = sh / dh;
      const buffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Float32Array(buffer.getMappedRange()).set([sx0 - dx0 * scaleX, sy0 - dy0 * scaleY, scaleX, scaleY]);
      buffer.unmap();
      this.retire(buffer);
      const pipeline = this.depthBlitHelper(from.sampleCount > 1, to.format, to.sampleCount);
      const descriptor = { dimension: '2d', aspect: 'depth-only' };
      if (!from.isRenderbuffer) Object.assign(descriptor, { baseMipLevel: source.level, mipLevelCount: 1, baseArrayLayer: source.layer, arrayLayerCount: 1 });
      const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: from.gpu.createView(descriptor) }] });
      const attachment = { view: this.attachmentView(target), depthLoadOp: 'load', depthStoreOp: 'store' };
      if (to.hasStencil) Object.assign(attachment, { stencilLoadOp: 'load', stencilStoreOp: 'store' });
      const pass = this.ensureEncoder().beginRenderPass({ colorAttachments: [], depthStencilAttachment: attachment });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.setViewport(Math.min(dx0, dx1), Math.min(dy0, dy1), Math.abs(dw), Math.abs(dh), 0, 1);
      pass.draw(3);
      pass.end();
      from.stamp = this.encoderStamp;
      to.stamp = this.encoderStamp;
    }

    blitColor(source, target, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, filter) {
      const encoder = this.ensureEncoder();
      const from = source.texture;
      const to = target.texture;
      const sw = sx1 - sx0, sh = sy1 - sy0, dw = dx1 - dx0, dh = dy1 - dy0;
      if (from.sampleCount > 1 && to.sampleCount === 1 && from.format === to.format) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.attachmentView(source), resolveTarget: this.attachmentView(target), loadOp: 'load', storeOp: 'store' }] });
        pass.end();
        return;
      }
      if (sw === dw && sh === dh && sw > 0 && sh > 0 && from.format === to.format && from.sampleCount === to.sampleCount) {
        encoder.copyTextureToTexture(
          { texture: from.gpu, mipLevel: source.level, origin: [sx0, sy0, source.layer] },
          { texture: to.gpu, mipLevel: target.level, origin: [dx0, dy0, target.layer] },
          [sw, sh, 1],
        );
        return;
      }
      const helper = this.mipHelper(to.format);
      if (!helper) return;
      const fromW = Math.max(1, from.width >> source.level);
      const fromH = Math.max(1, from.height >> source.level);
      const startX = dw < 0 ? sx1 : sx0;
      const startY = dh < 0 ? sy1 : sy0;
      const rect = new Float32Array([startX / fromW, startY / fromH, (dw < 0 ? -sw : sw) / fromW, (dh < 0 ? -sh : sh) / fromH]);
      const buffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Float32Array(buffer.getMappedRange()).set(rect);
      buffer.unmap();
      this.retire(buffer);
      const group = this.device.createBindGroup({ layout: helper.layout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: filter === GLE.NEAREST ? this.nearestSampler() : this.linearClamp() }, { binding: 2, resource: this.attachmentView(source) }] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.attachmentView(target), loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(helper.pipeline);
      pass.setBindGroup(0, group);
      pass.setViewport(Math.min(dx0, dx1), Math.min(dy0, dy1), Math.abs(dw), Math.abs(dh), 0, 1);
      pass.draw(4);
      pass.end();
    }

    readPixels(x, y, width, height, format, type, pixels, offset) {
      this.stats.readPixels++;
      if (!width || !height) return;
      const target = this.readTarget(pixels, offset, width * height * 4);
      if (!target) return;
      const source = this.colorSource(this.readFb || this.defaultFb);
      if (format !== 0x1908 || type !== GLE.UNSIGNED_BYTE || !source || !source.texture.gpu || source.texture.sampleCount > 1 || !/^(rgba8unorm|bgra8unorm)/.test(source.texture.format)) {
        target.fill(0);
        this.noteError(`readPixels unsupported: format ${format} type ${type} source ${source ? source.texture.format : 'none'}`);
        return;
      }
      const rows = this.readThroughCanvas(source, x, y, width, height);
      if (rows) target.set(rows);
      else target.fill(0);
    }

    async readPixelsInto(x, y, width, height, format, type, claim) {
      this.stats.readPixels++;
      const source = this.colorSource(this.readFb || this.defaultFb);
      const texture = source && source.texture;
      const readable = format === 0x1908 && type === GLE.UNSIGNED_BYTE && !!texture && !!texture.gpu && texture.sampleCount === 1 && /^(rgba8unorm|bgra8unorm)/.test(texture.format);
      if (!readable) this.noteError(`readPixels unsupported: format ${format} type ${type} source ${texture ? texture.format : 'none'}`);
      const left = Math.max(x, 0);
      const top = Math.max(y, 0);
      const copyWidth = readable ? Math.min(x + width, Math.max(1, texture.width >> source.level)) - left : 0;
      const copyHeight = readable ? Math.min(y + height, Math.max(1, texture.height >> source.level)) - top : 0;
      if (copyWidth <= 0 || copyHeight <= 0) {
        const target = claim();
        if (target) target.fill(0);
        return;
      }
      this.finishPass();
      const bytesPerRow = (copyWidth * 4 + 255) & ~255;
      const buffer = this.device.createBuffer({ size: bytesPerRow * copyHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      this.ensureEncoder().copyTextureToBuffer({ texture: texture.gpu, mipLevel: source.level, origin: [left, top, source.layer] }, { buffer, bytesPerRow }, [copyWidth, copyHeight, 1]);
      this.flushSubmit();
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const target = claim();
        if (!target) return;
        target.fill(0);
        const mapped = new Uint8Array(buffer.getMappedRange());
        const rowBytes = copyWidth * 4;
        for (let row = 0; row < copyHeight; row++) {
          const to = (row + top - y) * width * 4 + (left - x) * 4;
          if (to + rowBytes > target.length) break;
          target.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), to);
        }
        if (texture.format.startsWith('bgra')) {
          for (let i = 0; i + 3 < target.length; i += 4) {
            const blue = target[i];
            target[i] = target[i + 2];
            target[i + 2] = blue;
          }
        }
      } finally {
        buffer.destroy();
      }
    }

    readTarget(pixels, offset, size) {
      if (ArrayBuffer.isView(pixels)) {
        const start = pixels.byteOffset + (offset || 0) * (pixels.BYTES_PER_ELEMENT || 1);
        return new Uint8Array(pixels.buffer, start, Math.min(size, pixels.buffer.byteLength - start));
      }
      if (typeof pixels === 'number' && this.packBuffer && this.packBuffer.cpu) return this.packBuffer.cpu.subarray(pixels, pixels + size);
      return null;
    }

    readThroughCanvas(source, x, y, width, height) {
      const texture = source.texture;
      const fullWidth = Math.max(1, texture.width >> source.level);
      const fullHeight = Math.max(1, texture.height >> source.level);
      const read = this.readHelper || (this.readHelper = this.makeReadHelper());
      if (read.canvas.width !== fullWidth || read.canvas.height !== fullHeight) {
        read.canvas.width = fullWidth;
        read.canvas.height = fullHeight;
        read.output.width = fullWidth;
        read.output.height = fullHeight;
      }
      this.finishPass();
      const encoder = this.ensureEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: read.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(read.pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: read.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.attachmentView(source) }] }));
      pass.draw(3);
      pass.end();
      this.flushSubmit();
      try {
        read.context2d.drawImage(read.canvas, 0, 0);
        return read.context2d.getImageData(x, y, width, height).data;
      } catch (error) {
        this.noteError(`readPixels failed: ${error.message}`);
        return null;
      }
    }

    makeReadHelper() {
      const canvas = new OffscreenCanvas(1, 1);
      const output = new OffscreenCanvas(1, 1);
      const context = canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device: this.device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const module = this.shared.module(`@group(0) @binding(0) var t: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i & 1u) * 4.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(t, vec2i(p.xy), 0); }`);
      const pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
      return { canvas, output, context, pipeline, context2d: output.getContext('2d', { willReadFrequently: true }) };
    }

    fenceSync() {
      return { id: this.id() };
    }
    clientWaitSync(sync, flags, timeout) {
      if (this.framesInFlight < MAX_FRAMES_IN_FLIGHT) return GLE.ALREADY_SIGNALED;
      return timeout > 0 ? GLE.CONDITION_SATISFIED : GLE.TIMEOUT_EXPIRED;
    }
    waitSync() {}
    deleteSync() {}
    getSyncParameter(sync, pname) {
      if (pname === 0x9114) return this.framesInFlight < MAX_FRAMES_IN_FLIGHT ? 0x9119 : 0x9118;
      return 0;
    }

    markPresent() {
      if (this.pendingPresent || this.drawFb || !this.autoPresent) return;
      this.pendingPresent = true;
      if (!this.inIteration) queueMicrotask(() => { if (this.pendingPresent && !this.inIteration) this.present(); });
    }

    frameEnd() {
      this.inIteration = false;
      if (this.pendingPresent) this.present();
    }

    presentHelper() {
      if (this.presentPipeline) return this.presentPipeline;
      const module = this.shared.module(`struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let x = f32(i32(i & 1u) * 2);
  let y = f32(i32(i & 2u));
  var out: V;
  out.pos = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}
@fragment fn fs(in: V) -> @location(0) vec4f { return vec4f(textureSampleLevel(t, s, in.uv, 0.0).rgb, 1.0); }`);
      this.presentPipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.presentFormat }] }, primitive: { topology: 'triangle-strip' } });
      return this.presentPipeline;
    }

    present() {
      this.pendingPresent = false;
      this.finishPass();
      this.flushSubmit();
      if (this.lost) return;
      const canvasTexture = this.context.getCurrentTexture();
      const pipeline = this.presentHelper();
      if (this.presentSource !== this.backColor) {
        this.presentView = this.backColor.gpu.createView();
        this.presentGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.linearClamp() }, { binding: 1, resource: this.presentView }] });
        this.presentSource = this.backColor;
      }
      const encoder = this.ensureEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: canvasTexture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.presentGroup);
      pass.draw(4);
      pass.end();
      const sentAt = window.__webgpuMeasure ? performance.now() : 0;
      this.flushSubmit();
      this.stats.frames++;
      this.framesInFlight++;
      this.queue.onSubmittedWorkDone().then(() => {
        this.framesInFlight--;
        if (window.__webbloxFrameRelease) window.__webbloxFrameRelease();
        if (sentAt) (this.gpuLatency || (this.gpuLatency = [])).push(performance.now() - sentAt);
      });
    }

    __finish() {
      this.present();
      return this.queue.onSubmittedWorkDone();
    }

    __startTiming() {
      if (!this.device.features.has('timestamp-query')) return false;
      const capacity = 4096;
      this.timing = {
        capacity,
        used: 0,
        labels: [],
        draws: [],
        querySet: this.timing ? this.timing.querySet : this.device.createQuerySet({ type: 'timestamp', count: capacity }),
        resolve: this.timing ? this.timing.resolve : this.device.createBuffer({ size: capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
      };
      return true;
    }

    async __readTiming() {
      const timing = this.timing;
      if (!timing || !timing.used) return null;
      this.finishPass();
      const read = this.device.createBuffer({ size: timing.used * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = this.ensureEncoder();
      encoder.resolveQuerySet(timing.querySet, 0, timing.used, timing.resolve, 0);
      encoder.copyBufferToBuffer(timing.resolve, 0, read, 0, timing.used * 8);
      this.flushSubmit();
      await read.mapAsync(GPUMapMode.READ);
      const times = new BigUint64Array(read.getMappedRange());
      const passes = [];
      for (let i = 0; i < timing.labels.length; i++) passes.push({ label: timing.labels[i], draws: timing.draws[i], ms: Number(times[i * 2 + 1] - times[i * 2]) / 1e6, start: Number(times[i * 2]) / 1e6 });
      read.unmap();
      read.destroy();
      return passes;
    }

    async __capture() {
      this.finishPass();
      const w = this.backColor.width, h = this.backColor.height;
      const bytesPerRow = (w * 4 + 255) & ~255;
      const buffer = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      this.ensureEncoder().copyTextureToBuffer({ texture: this.backColor.gpu }, { buffer, bytesPerRow }, [w, h]);
      this.flushSubmit();
      await buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(buffer.getMappedRange());
      const canvas = new OffscreenCanvas(w, h);
      const context = canvas.getContext('2d');
      const image = context.createImageData(w, h);
      for (let row = 0; row < h; row++) {
        const from = row * bytesPerRow;
        const to = (h - 1 - row) * w * 4;
        image.data.set(raw.subarray(from, from + w * 4), to);
        for (let c = 3; c < w * 4; c += 4) image.data[to + c] = 255;
      }
      context.putImageData(image, 0, 0);
      buffer.unmap();
      buffer.destroy();
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const reader = new FileReader();
      return new Promise(resolve => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }
  }

  const loadTable = async base => {
    const [index, bytes] = await Promise.all([
      fetch(`${base}wgsl-index.json`).then(r => {
        if (!r.ok) throw new Error(`wgsl-index.json: ${r.status}`);
        return r.json();
      }),
      fetch(`${base}wgsl.txt`).then(r => {
        if (!r.ok) throw new Error(`wgsl.txt: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    return { index, bytes: new Uint8Array(bytes) };
  };

  let shared = null;

  const makeFacade = (gl, canvas) => {
    const facade = Object.create(WebGL2RenderingContext.prototype);
    gl.integrated = true;
    Object.defineProperty(facade, '__gpu', { value: gl });
    for (const name of Object.getOwnPropertyNames(GL.prototype)) {
      if (name === 'constructor' || name.startsWith('__') || name.startsWith('drawingBuffer')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(GL.prototype, name);
      if (typeof descriptor.value !== 'function' || !(name in facade)) continue;
      facade[name] = descriptor.value.bind(gl);
    }
    Object.defineProperty(facade, 'canvas', { get: () => canvas });
    Object.defineProperty(facade, 'drawingBufferWidth', { get: () => canvas.width });
    Object.defineProperty(facade, 'drawingBufferHeight', { get: () => canvas.height });
    Object.defineProperty(facade, 'drawingBufferColorSpace', { value: 'srgb', writable: true });
    return facade;
  };

  const rendererChoice = () => {
    window.__webbloxGlBuild = 'ttl-wasm-diag';
    const param = new URLSearchParams(location.search).get('renderer');
    if (param) return param;
    try {
      // A WebGPU failure only forces WebGL for two minutes (long enough for the fallback reload), then WebGPU is tried again.
      if (sessionStorage.getItem('webblox.webgpuFailed') && Date.now() - Number(sessionStorage.getItem('webblox.webgpuFailedAt') || 0) < 120000) return 'webgl';
      const saved = JSON.parse(localStorage.getItem('webblox.settings'));
      if (saved && typeof saved.renderer === 'string') return saved.renderer;
    } catch (error) {}
    return 'webgpu';
  };
  if (rendererChoice() === 'webgpu' && navigator.gpu && !window.__webgpuReplay) {
    window.__webbloxWebGPU = true;
  }

  const openDevice = async tableBase => {
    if (!navigator.gpu) throw new Error('WebGPU is not available');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    for (const feature of REQUIRED_FEATURES) if (!adapter.features.has(feature)) throw new Error(`adapter lacks ${feature}`);
    const requiredFeatures = [...REQUIRED_FEATURES, ...OPTIONAL_FEATURES.filter(f => adapter.features.has(f))];
    const requiredLimits = {};
    for (const key of ['minUniformBufferOffsetAlignment', 'maxBindGroups', 'maxBindingsPerBindGroup', 'maxDynamicUniformBuffersPerPipelineLayout', 'maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage', 'maxUniformBuffersPerShaderStage', 'maxVertexBuffers', 'maxVertexAttributes', 'maxTextureDimension2D', 'maxTextureDimension3D', 'maxTextureArrayLayers', 'maxBufferSize', 'maxColorAttachments', 'maxInterStageShaderVariables']) {
      if (adapter.limits[key] !== undefined) requiredLimits[key] = adapter.limits[key];
    }
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
    const table = await loadTable(tableBase || '/gen/');
    if (!window.__webbloxShaderKey) throw new Error('shader key script missing');
    shared = new Shared(device, table, window.__webbloxShaderKey);
    return device;
  };

  window.__webgpuCreate = async canvas => {
    const device = await openDevice();
    const gl = new GL(canvas, device, shared, {}, null);
    gl.integrated = true;
    gl.autoPresent = true;
    return gl;
  };

  window.__webgpuReady = async (canvas, attributes, options = {}) => {
    const device = await openDevice(options.tableBase);
    const probeCanvas = new OffscreenCanvas(1, 1);
    const probe = probeCanvas.getContext('webgl2');
    const getContext = canvas.getContext;
    let instance = null;
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    canvas.getContext = function (kind, attrs) {
      if (kind === 'webgl2') {
        if (!instance) {
          canvas.getContext = function (k, a) {
            if (k === 'webgl2') return instance;
            return nativeGetContext.call(canvas, k, a);
          };
          const gl = new GL(canvas, device, shared, attrs || attributes, probe);
          gl.autoPresent = options.autoPresent !== false;
          window.__webgpuGL = gl;
          instance = options.facade ? makeFacade(gl, canvas) : gl;
        }
        return instance;
      }
      return (getContext || nativeGetContext).call(canvas, kind, attrs);
    };
    return device;
  };
})();
