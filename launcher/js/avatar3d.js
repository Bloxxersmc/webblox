import * as THREE from '../vendor/three.module.js';
import { api, wantsRoom } from './core.js';
import { loadRoom } from './avatar-room.js';

const UP = new THREE.Vector3(0, 1, 0);
const ROOM_FACING = Math.PI / 2;
const ROOM_FAR = 500;
const ROOM_NEAR = 0.5;
const ROOM_FOV = 50;
const ROOM_MIN_ZOOM = 5;
const ROOM_MAX_ZOOM = 35;
const ROOM_FOCUS_SCALE = 0.4;
const ROOM_ZOOM_RATIO = 6.188;
const ROOM_CATEGORY_ZOOM = 8.5;
const ROOM_CENTER_SCALE = -0.4;
const ROOM_CENTER_OFFSET = 40;
const ROOM_BASE_TOP_BAR = 64;
const ROOM_TOP_BAR = 104;
const ROOM_SCREEN_HEIGHT = 844;
const ROOM_SCREEN_VISIBLE = 0.69;
const ROOM_MAX_TILT = 0.11344640137963143;
const MDR_RANGE = '4.0';
const BLOOM_THRESHOLD = '2.0';
const BLOOM_INTENSITY = '1.0';
const BLOOM_ERODE = '0.8117';
const MAX_TOUCHES = { rotate: 1, dolly: 2, pan: 3 };
const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_DOLLY: 4, TOUCH_PAN: 5 };

THREE.ShaderChunk.map_fragment = `
  #ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vUv );
    diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a);
  #endif`;
THREE.ShaderChunk.roughnessmap_fragment = `
  float roughnessFactor = roughness;
  #ifdef USE_ROUGHNESSMAP
    vec4 texelRoughness = texture2D( roughnessMap, vUv );
    roughnessFactor = max(0.045, texelRoughness.g);
  #endif`;
THREE.ShaderChunk.metalnessmap_fragment = `
  float metalnessFactor = metalness;
  #ifdef USE_METALNESSMAP
    metalnessFactor = 0.0;
  #endif`;

function cdnUrl(value) {
  if (((!value.includes('rbxcdn.com') || !value.includes('roblox.com')) && value.startsWith('https://')) || value.includes('mats-thumbnails.roblox.com')) return value;
  let hash = 31;
  for (let i = 0; i < value.length; i++) hash ^= value.charCodeAt(i);
  return `https://t${hash % 8}.rbxcdn.com/${value}`;
}

// The single-file launcher has no proxy path for images; Roblox's CDN allows cross-origin loads.
const proxied = value => window.webbloxEmbed?.assetUrl(cdnUrl(value)) || `/__proxy__/${cdnUrl(value)}`;

async function fetchText(value) {
  const res = await fetch(proxied(value));
  if (!res.ok) throw new Error(`3D file answered ${res.status}`);
  return res.text();
}

function textureParams(value, params) {
  const out = { scale: new THREE.Vector2(1, 1), offset: new THREE.Vector2(0, 0) };
  const parts = value.split(/\s+/);
  let at = parts.indexOf('-bm');
  if (at >= 0) {
    params.bumpScale = parseFloat(parts[at + 1]);
    parts.splice(at, 2);
  }
  at = parts.indexOf('-s');
  if (at >= 0) {
    out.scale.set(parseFloat(parts[at + 1]), parseFloat(parts[at + 2]));
    parts.splice(at, 4);
  }
  at = parts.indexOf('-o');
  if (at >= 0) {
    out.offset.set(parseFloat(parts[at + 1]), parseFloat(parts[at + 2]));
    parts.splice(at, 4);
  }
  out.url = parts.join(' ').trim();
  return out;
}

function parseMtl(text) {
  const info = {};
  let current = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    const space = line.indexOf(' ');
    const key = (space >= 0 ? line.substring(0, space) : line).toLowerCase();
    const value = space >= 0 ? line.substring(space + 1).trim() : '';
    if (key === 'newmtl') {
      current = { name: value };
      info[value] = current;
    } else if (key === 'ka' || key === 'kd' || key === 'ks' || key === 'ke') {
      const parts = value.split(/\s+/, 3);
      current[key] = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
    } else {
      current[key] = value;
    }
  }
  return info;
}

class Materials {
  constructor(info) {
    this.info = info;
    this.made = {};
    this.loader = new THREE.TextureLoader();
  }

  create(name) {
    if (this.made[name] === undefined) this.make(name);
    return this.made[name];
  }

  make(name) {
    const info = this.info[name];
    const params = { name, side: THREE.FrontSide };
    const setMap = (kind, value) => {
      if (params[kind]) return;
      const options = textureParams(value, params);
      const texture = this.loader.load(proxied(options.url));
      texture.repeat.copy(options.scale);
      texture.offset.copy(options.offset);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (kind === 'specularMap') {
        params.metalnessMap = texture;
        params.roughnessMap = texture;
      } else {
        params[kind] = texture;
      }
    };
    for (const key of Object.keys(info || {})) {
      const value = info[key];
      if (value === '') continue;
      switch (key.toLowerCase()) {
        case 'kd':
          params.color = new THREE.Color().fromArray(value);
          break;
        case 'ke':
          params.emissive = new THREE.Color().fromArray(value);
          break;
        case 'map_kd':
          setMap('map', value);
          break;
        case 'map_ks':
        case 'map_ns':
          setMap('specularMap', value);
          break;
        case 'map_ke':
          setMap('emissiveMap', value);
          break;
        case 'norm':
        case 'map_bump':
        case 'bump':
          setMap('normalMap', value);
          break;
        case 'd': {
          const opacity = parseFloat(value);
          if (opacity < 1) {
            params.opacity = opacity;
            params.transparent = true;
          }
          break;
        }
        case 'tr': {
          const clear = parseFloat(value);
          if (clear > 0) {
            params.opacity = 1 - clear;
            params.transparent = true;
          }
          break;
        }
        case 'rbx_alphamode':
          params.userData = { ...params.userData, rbx_alphamode: value };
          break;
        case 'rbx_doublesided':
          if (value === '1') params.side = THREE.DoubleSide;
          break;
        case 'rbx_color': {
          const parts = value.split(/\s+/).map(parseFloat);
          if (parts.length === 3 && parts.every(Number.isFinite)) params.userData = { ...params.userData, rbx_color: new THREE.Color(parts[0], parts[1], parts[2]) };
          break;
        }
        default:
      }
    }
    params.metalness = 0;
    params.roughness = 1;
    this.made[name] = new THREE.MeshStandardMaterial(params);
  }
}

class ObjState {
  constructor() {
    this.objects = [];
    this.object = {};
    this.vertices = [];
    this.normals = [];
    this.colors = [];
    this.uvs = [];
    this.materials = {};
    this.startObject('', false);
  }

  startObject(name, fromDeclaration) {
    if (this.object && this.object.fromDeclaration === false) {
      this.object.name = name;
      this.object.fromDeclaration = fromDeclaration !== false;
      return;
    }
    const previous = this.object?.finalize ? this.object.finalize() : undefined;
    if (this.object?.finalize) this.object.finalize(true);
    this.object = {
      name: name || '',
      fromDeclaration: fromDeclaration !== false,
      geometry: { vertices: [], normals: [], colors: [], uvs: [], hasUVIndices: false },
      materials: [],
      smooth: true,
      startMaterial(materialName) {
        const last = this.finalize(false);
        if (last && (last.inherited || last.groupCount <= 0)) this.materials.splice(last.index, 1);
        const material = {
          index: this.materials.length,
          name: materialName || '',
          smooth: last !== undefined ? last.smooth : this.smooth,
          groupStart: last !== undefined ? last.groupEnd : 0,
          groupEnd: -1,
          groupCount: -1,
          inherited: false,
        };
        this.materials.push(material);
        return material;
      },
      current() {
        return this.materials[this.materials.length - 1];
      },
      finalize(end) {
        const material = this.current();
        if (material && material.groupEnd === -1) {
          material.groupEnd = this.geometry.vertices.length / 3;
          material.groupCount = material.groupEnd - material.groupStart;
          material.inherited = false;
        }
        if (end && this.materials.length > 1) {
          for (let i = this.materials.length - 1; i >= 0; i--) {
            if (this.materials[i].groupCount <= 0) this.materials.splice(i, 1);
          }
        }
        if (end && this.materials.length === 0) this.materials.push({ name: '', smooth: this.smooth });
        return material;
      },
    };
    if (previous?.name) {
      this.object.materials.push({ index: 0, name: previous.name, smooth: previous.smooth, groupStart: 0, groupEnd: -1, groupCount: -1, inherited: true });
    }
    this.objects.push(this.object);
  }

  addFace(a, b, c, ua, ub, uc, na, nb, nc) {
    const positionIndex = value => {
      const index = parseInt(value, 10);
      return (index >= 0 ? index - 1 : index + this.vertices.length / 3) * 3;
    };
    const normalIndex = value => {
      const index = parseInt(value, 10);
      return (index >= 0 ? index - 1 : index + this.normals.length / 3) * 3;
    };
    const uvIndex = value => {
      const index = parseInt(value, 10);
      return (index >= 0 ? index - 1 : index + this.uvs.length / 2) * 2;
    };
    const { geometry } = this.object;
    const ia = positionIndex(a);
    const ib = positionIndex(b);
    const ic = positionIndex(c);
    for (const i of [ia, ib, ic]) geometry.vertices.push(this.vertices[i], this.vertices[i + 1], this.vertices[i + 2]);
    for (const i of [ia, ib, ic]) {
      if (this.colors[i] !== undefined) {
        const at = (i / 3) * 4;
        geometry.colors.push(this.colors[at], this.colors[at + 1], this.colors[at + 2], this.colors[at + 3]);
      }
    }
    if (na !== undefined && na !== '') {
      for (const i of [normalIndex(na), normalIndex(nb), normalIndex(nc)]) geometry.normals.push(this.normals[i], this.normals[i + 1], this.normals[i + 2]);
    } else {
      const pa = new THREE.Vector3().fromArray(this.vertices, ia);
      const pb = new THREE.Vector3().fromArray(this.vertices, ib);
      const pc = new THREE.Vector3().fromArray(this.vertices, ic);
      const normal = new THREE.Vector3().subVectors(pc, pb).cross(new THREE.Vector3().subVectors(pa, pb)).normalize();
      for (let i = 0; i < 3; i++) geometry.normals.push(normal.x, normal.y, normal.z);
    }
    if (ua !== undefined && ua !== '') {
      for (const i of [uvIndex(ua), uvIndex(ub), uvIndex(uc)]) geometry.uvs.push(this.uvs[i], this.uvs[i + 1]);
      geometry.hasUVIndices = true;
    } else {
      geometry.uvs.push(0, 0, 0, 0, 0, 0);
    }
  }
}

function tintMaterial(material, hasVertexAlpha) {
  const transparent = hasVertexAlpha || material.userData.rbx_alphamode === 'transparent';
  if (transparent) {
    material.alphaTest = 0.05;
    material.transparent = true;
    if (hasVertexAlpha && material.map) {
      material.map.wrapS = THREE.ClampToEdgeWrapping;
      material.map.wrapT = THREE.ClampToEdgeWrapping;
      material.map.needsUpdate = true;
    }
  }
  const tint = material.userData?.rbx_color;
  if (!transparent && !tint) return;
  const mode = material.userData.rbx_alphamode || 'overlay';
  const blendMode = tint && mode !== 'transparent' ? (mode === 'tintmask' ? 1 : 2) : 0;
  material.onBeforeCompile = shader => {
    shader.uniforms.rbxColor = { value: tint || new THREE.Color(1, 1, 1) };
    shader.uniforms.rbxBlendMode = { value: blendMode };
    shader.fragmentShader = `
      uniform vec3 rbxColor;
      uniform int rbxBlendMode;
      ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vUv );
        vec3 tintAlbedo = sampledDiffuseColor.rgb * rbxColor;
        if (rbxBlendMode == 0) {
          diffuseColor.rgb = tintAlbedo;
        } else if (rbxBlendMode == 1) {
          diffuseColor.rgb = mix(sampledDiffuseColor.rgb, tintAlbedo, sampledDiffuseColor.a);
        } else {
          diffuseColor.rgb = mix(diffuseColor.rgb, tintAlbedo, sampledDiffuseColor.a);
        }
        #ifdef USE_ALPHATEST
          diffuseColor.a = sampledDiffuseColor.a;
        #endif
      #endif`);
  };
}

const glows = material => Boolean(material.emissiveMap && material.emissive && Math.max(material.emissive.r, material.emissive.g, material.emissive.b) > 0);

function parseObj(text, materials) {
  const state = new ObjState();
  let source = text;
  if (source.indexOf('\r\n') !== -1) source = source.replace(/\r\n/g, '\n');
  if (source.indexOf('\\\n') !== -1) source = source.replace(/\\\n/g, '');
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    const first = line.charAt(0);
    if (first === 'v') {
      const parts = line.split(/\s+/);
      if (parts[0] === 'v') {
        state.vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        if (parts.length >= 7) state.colors.push(parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[6]), parts[7] !== undefined ? parseFloat(parts[7]) : 1);
        else state.colors.push(undefined, undefined, undefined, undefined);
      } else if (parts[0] === 'vn') {
        state.normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (parts[0] === 'vt') {
        state.uvs.push(parseFloat(parts[1]), parseFloat(parts[2]));
      }
    } else if (first === 'f') {
      const face = line.substring(1).trim().split(/\s+/).filter(Boolean).map(part => part.split('/'));
      const start = face[0];
      for (let i = 1; i < face.length - 1; i++) {
        const b = face[i];
        const c = face[i + 1];
        state.addFace(start[0], b[0], c[0], start[1], b[1], c[1], start[2], b[2], c[2]);
      }
    } else if (/^[og]\s*(.+)?/.test(line)) {
      state.startObject(line.substring(1).trim());
    } else if (/^usemtl /.test(line)) {
      state.object.startMaterial(line.substring(7).trim());
    } else if (first === 's') {
      const parts = line.split(' ');
      if (parts.length > 1) {
        const value = parts[1].trim().toLowerCase();
        state.object.smooth = value !== '0' && value !== 'off';
      } else {
        state.object.smooth = true;
      }
      const current = state.object.current();
      if (current) current.smooth = state.object.smooth;
    }
  }
  state.object.finalize?.(true);

  const group = new THREE.Group();
  let hasGlow = false;
  for (const object of state.objects) {
    const { geometry: source2, materials: slots } = object;
    if (!source2.vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(source2.vertices, 3));
    if (source2.normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source2.normals, 3));
    const hasColors = source2.colors.length > 0;
    const hasVertexAlpha = hasColors && source2.colors.some((value, i) => (i + 1) % 4 === 0 && value < 1);
    if (hasColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(source2.colors, 4));
    if (source2.hasUVIndices) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source2.uvs, 2));
    const made = slots.map(slot => {
      const key = `${slot.name}_${slot.smooth}_${hasColors}`;
      let material = state.materials[key];
      if (!material) {
        material = materials ? materials.create(slot.name) : new THREE.MeshPhongMaterial();
        material.name = slot.name;
        material.flatShading = !slot.smooth;
        material.vertexColors = hasColors;
        tintMaterial(material, hasVertexAlpha);
        state.materials[key] = material;
        if (glows(material)) hasGlow = true;
      }
      return material;
    });
    let mesh;
    if (made.length > 1) {
      slots.forEach((slot, i) => geometry.addGroup(slot.groupStart, slot.groupCount, i));
      mesh = new THREE.Mesh(geometry, made);
    } else {
      mesh = new THREE.Mesh(geometry, made[0]);
    }
    mesh.name = object.name;
    group.add(mesh);
  }
  return { group, hasGlow };
}

const TONEMAP = `
  const vec4 TONEMAP_ABCD = vec4(0.88, 0.16, 1.34, 0.028);
  const float TONEMAP_E = 2.18;
  const float MDR_RANGE = ${MDR_RANGE};

  uniform sampler2D tFrame;
  uniform sampler2D tEmission;

  vec3 tonemap(vec3 x) {
    return x * (TONEMAP_ABCD.x * x + TONEMAP_ABCD.y) / (x * (TONEMAP_ABCD.x * x + TONEMAP_ABCD.z) + TONEMAP_ABCD.w) * TONEMAP_E;
  }

  vec3 inverseTonemap(vec3 y) {
    vec3 a = TONEMAP_ABCD.x * (y - TONEMAP_E);
    vec3 b = TONEMAP_ABCD.z * y - TONEMAP_E * TONEMAP_ABCD.y;
    vec3 c = TONEMAP_ABCD.w * y;
    return (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  }

  vec3 sceneColor(vec2 uv) {
    vec3 emission = texture2D(tEmission, uv).rgb;
    return min(inverseTonemap(texture2D(tFrame, uv).rgb) + emission * emission * MDR_RANGE, MDR_RANGE);
  }
`;

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BRIGHT_PASS = {
  uniforms: { tFrame: { value: null }, tEmission: { value: null }, frameTexel: { value: new THREE.Vector2() } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: `
    ${TONEMAP}
    uniform vec2 frameTexel;
    varying vec2 vUv;

    vec3 brightPass(vec3 color) {
      float maxColor = max(max(color.r, color.g), color.b);
      return color * (max(maxColor - ${BLOOM_THRESHOLD}, 0.0) / (maxColor + 0.001) * ${BLOOM_INTENSITY});
    }

    vec3 brightAt(int x, int y) {
      return brightPass(sceneColor(vUv + vec2(float(x) * 2.0 - 5.0, float(y) * 2.0 - 5.0) * frameTexel));
    }

    void main() {
      vec3 bright[36];
      for (int y = 0; y < 6; y++) {
        for (int x = 0; x < 6; x++) {
          bright[y * 6 + x] = brightAt(x, y);
        }
      }
      vec3 sum = vec3(0.0);
      for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
          vec3 eroded = min(bright[y * 6 + x], bright[(y + 2) * 6 + x + 2]);
          sum += mix(bright[(y + 1) * 6 + x + 1], eroded, ${BLOOM_ERODE});
        }
      }
      gl_FragColor = vec4(sum / 16.0, 1.0);
    }
  `,
};

const BLUR_PASS = {
  uniforms: { tInput: { value: null }, blurStep: { value: new THREE.Vector2() } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: `
    uniform sampler2D tInput;
    uniform vec2 blurStep;
    varying vec2 vUv;

    void main() {
      float w0 = exp(-0.5);
      float w1 = exp(-2.0);
      float offset = 1.0 + w1 / (w0 + w1);
      vec4 sum = texture2D(tInput, vUv)
        + (texture2D(tInput, vUv + blurStep * offset) + texture2D(tInput, vUv - blurStep * offset)) * (w0 + w1);
      gl_FragColor = sum / (1.0 + 2.0 * (w0 + w1));
    }
  `,
};

const COMPOSITE_PASS = {
  uniforms: { tFrame: { value: null }, tEmission: { value: null }, tBloom: { value: null } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: `
    ${TONEMAP}
    uniform sampler2D tBloom;
    varying vec2 vUv;

    void main() {
      vec3 color = clamp(tonemap(sceneColor(vUv) + texture2D(tBloom, vUv).rgb), 0.0, 1.0);
      float alpha = max(texture2D(tFrame, vUv).a, max(max(color.r, color.g), color.b));
      gl_FragColor = vec4(color, alpha);
    }
  `,
};

const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeometry = new THREE.BufferGeometry();
quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
quadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

function quad(pass) {
  const material = new THREE.ShaderMaterial({ ...pass, uniforms: THREE.UniformsUtils.clone(pass.uniforms) });
  material.blending = THREE.NoBlending;
  material.depthTest = false;
  material.depthWrite = false;
  const mesh = new THREE.Mesh(quadGeometry, material);
  return { material, render: renderer => renderer.render(mesh, quadCamera) };
}

function installGlow(scene) {
  const size = new THREE.Vector2();
  const clones = new Map();
  const saved = new Map();
  const bright = quad(BRIGHT_PASS);
  const blur = quad(BLUR_PASS);
  const composite = quad(COMPOSITE_PASS);
  let targets = null;
  let rendering = false;

  const emissionMaterial = original => {
    let entry = clones.get(original);
    if (!entry) {
      entry = { material: original.clone(), version: original.version };
      clones.set(original, entry);
    }
    const clone = entry.material;
    clone.copy(original);
    clone.fog = false;
    if (entry.version !== original.version) clone.needsUpdate = true;
    entry.version = original.version;
    if (!clone.emissive) {
      clone.color.setScalar(0);
      return clone;
    }
    if (!glows(original)) clone.emissive.setScalar(0);
    clone.onBeforeCompile = function (shader, renderer) {
      original.onBeforeCompile.call(this, shader, renderer);
      const tinted = shader.uniforms.rbxColor ? '#define RBX_TINTED_ALBEDO\n' : '';
      shader.fragmentShader = `${tinted}${shader.fragmentShader}`
        .replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec3 emissiveMapColor = texture2D(emissiveMap, vUv).rgb;
            #ifdef USE_MAP
              vec3 colorMap = max(texture2D(map, vUv).rgb, vec3(1.0 / 255.0));
              #ifdef RBX_TINTED_ALBEDO
                vec3 albedo = diffuseColor.rgb;
              #else
                vec3 albedo = colorMap;
              #endif
              totalEmissiveRadiance *= min(emissiveMapColor / colorMap, 1.0) * albedo * albedo;
            #else
              totalEmissiveRadiance *= emissiveMapColor;
            #endif
          #endif`)
        .replace('#include <output_fragment>', `gl_FragColor = vec4(sqrt(clamp(totalEmissiveRadiance / ${MDR_RANGE}, 0.0, 1.0)), diffuseColor.a);`);
    };
    clone.customProgramCacheKey = () => `${original.customProgramCacheKey()}-roblox-emission`;
    return clone;
  };

  const ensureTargets = (width, height) => {
    if (targets && targets.width === width && targets.height === height) return;
    targets?.dispose();
    const smallWidth = Math.max(1, Math.floor(width / 8));
    const smallHeight = Math.max(1, Math.floor(height / 8));
    const frame = new THREE.FramebufferTexture(width, height, THREE.RGBAFormat);
    frame.minFilter = THREE.LinearFilter;
    frame.magFilter = THREE.LinearFilter;
    const emission = new THREE.WebGLRenderTarget(width, height);
    const brightTarget = new THREE.WebGLRenderTarget(smallWidth, smallHeight, { depthBuffer: false });
    const blurred = new THREE.WebGLRenderTarget(smallWidth, smallHeight, { depthBuffer: false });
    targets = { width, height, frame, emission, bright: brightTarget, blurred, dispose: () => [frame, emission, brightTarget, blurred].forEach(item => item.dispose()) };
  };

  scene.onBeforeRender = () => {
    if (rendering) return;
    scene.traverse(node => {
      if (!node.material) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (glows(material) && !saved.has(material)) {
          saved.set(material, material.emissive.clone());
          material.emissive.setScalar(0);
        }
      }
    });
  };

  scene.onAfterRender = (renderer, _, camera) => {
    if (rendering) return;
    saved.forEach((color, material) => material.emissive.copy(color));
    saved.clear();
    const target = renderer.getRenderTarget();
    if (target) size.set(target.width, target.height);
    else renderer.getDrawingBufferSize(size);
    ensureTargets(size.x, size.y);
    renderer.copyFramebufferToTexture(new THREE.Vector2(0, 0), targets.frame);
    const background = scene.background;
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const originals = new Map();
    rendering = true;
    try {
      scene.traverse(node => {
        if (!node.material) return;
        originals.set(node, node.material);
        node.material = Array.isArray(node.material) ? node.material.map(emissionMaterial) : emissionMaterial(node.material);
      });
      scene.background = null;
      renderer.setClearColor(0, 0);
      renderer.autoClear = true;
      renderer.setRenderTarget(targets.emission);
      renderer.render(scene, camera);
      originals.forEach((material, node) => {
        node.material = material;
      });
      originals.clear();
      const brightUniforms = bright.material.uniforms;
      brightUniforms.tFrame.value = targets.frame;
      brightUniforms.tEmission.value = targets.emission.texture;
      brightUniforms.frameTexel.value.set(1 / size.x, 1 / size.y);
      renderer.setRenderTarget(targets.bright);
      bright.render(renderer);
      const blurUniforms = blur.material.uniforms;
      blurUniforms.tInput.value = targets.bright.texture;
      blurUniforms.blurStep.value.set(1 / targets.bright.width, 0);
      renderer.setRenderTarget(targets.blurred);
      blur.render(renderer);
      blurUniforms.tInput.value = targets.blurred.texture;
      blurUniforms.blurStep.value.set(0, 1 / targets.bright.height);
      renderer.setRenderTarget(targets.bright);
      blur.render(renderer);
      const compositeUniforms = composite.material.uniforms;
      compositeUniforms.tFrame.value = targets.frame;
      compositeUniforms.tEmission.value = targets.emission.texture;
      compositeUniforms.tBloom.value = targets.bright.texture;
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      composite.render(renderer);
    } finally {
      originals.forEach((material, node) => {
        node.material = material;
      });
      scene.background = background;
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColor, clearAlpha);
      rendering = false;
    }
  };

  return () => {
    scene.onBeforeRender = () => {};
    scene.onAfterRender = () => {};
    clones.forEach(entry => entry.material.dispose());
    targets?.dispose();
    [bright, blur, composite].forEach(pass => pass.material.dispose());
  };
}

class AvatarControls {
  constructor(camera, element, data, spin = null) {
    this.object = camera;
    this.element = element;
    this.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.autoRotateSpeed = 2;
    this.rotateSpeed = 1.5;
    this.zoomSpeed = 1.5;
    this.keyPanSpeed = 7;
    this.state = STATE.NONE;
    this.scale = 1;
    this.spherical = new THREE.Spherical();
    this.sphericalDelta = new THREE.Spherical();
    this.panOffset = new THREE.Vector3();
    this.rotateStart = new THREE.Vector2();
    this.rotateEnd = new THREE.Vector2();
    this.rotateDelta = new THREE.Vector2();
    this.panStart = new THREE.Vector2();
    this.panEnd = new THREE.Vector2();
    this.panDelta = new THREE.Vector2();
    this.dollyStart = new THREE.Vector2();
    this.dollyEnd = new THREE.Vector2();
    this.dollyDelta = new THREE.Vector2();
    const { max, min } = data.aabb;
    this.target = new THREE.Vector3(max.x, max.y, max.z).add(new THREE.Vector3(min.x, min.y, min.z)).multiplyScalar(0.5);
    const { position, direction } = data.camera;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(new THREE.Vector3(position.x, position.y, position.z).sub(new THREE.Vector3(direction.x, direction.y, direction.z)));
    this.spin = spin;
    if (spin) {
      this.autoRotate = false;
      this.center = this.target.clone().setY(0);
    }
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    element.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    element.addEventListener('mousedown', event => this.mouseDown(event), { signal });
    element.addEventListener('wheel', event => this.wheel(event), { signal, passive: false });
    element.addEventListener('touchstart', event => this.touchStart(event), { signal, passive: true });
    element.addEventListener('touchend', () => this.touchEnd(), { signal });
    element.addEventListener('touchmove', event => this.touchMove(event), { signal, passive: false });
    element.addEventListener('keydown', event => this.keyDown(event), { signal });
    document.addEventListener('mousemove', event => this.mouseMove(event), { signal });
    document.addEventListener('mouseup', () => this.mouseUp(), { signal });
    this.update();
  }

  frameRoom(floor, height) {
    this.center.copy(this.target).setY(0);
    this.target.copy(floor).setY(floor.y + height * ROOM_FOCUS_SCALE);
    this.object.fov = ROOM_FOV;
    this.roomRadius = ROOM_CATEGORY_ZOOM + height * ROOM_FOCUS_SCALE * ROOM_ZOOM_RATIO;
    const center = ROOM_CENTER_SCALE + (2 * (ROOM_CENTER_OFFSET + ROOM_TOP_BAR - ROOM_BASE_TOP_BAR)) / ROOM_SCREEN_HEIGHT;
    this.roomPitch = Math.atan(Math.tan((ROOM_FOV / 2) * (Math.PI / 180)) * center);
    this.maxRadius = this.roomRadius;
    this.update();
  }

  size() {
    const canvas = this.element.querySelector('canvas') || this.element;
    return { width: canvas.clientWidth || 500, height: canvas.clientHeight || 500 };
  }

  rotateBy(x, y) {
    this.rotateEnd.set(x, y);
    this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);
    const { width, height } = this.size();
    this.sphericalDelta.theta -= (2 * Math.PI * this.rotateDelta.x / width) * this.rotateSpeed;
    this.sphericalDelta.phi -= (2 * Math.PI * this.rotateDelta.y / height) * this.rotateSpeed;
    this.rotateStart.copy(this.rotateEnd);
    this.update();
  }

  panBy(x, y) {
    this.panEnd.set(x, y);
    this.panDelta.subVectors(this.panEnd, this.panStart);
    this.pan(this.panDelta.x, this.panDelta.y);
    this.panStart.copy(this.panEnd);
    this.update();
  }

  pan(x, y) {
    if (this.spin) return;
    const { width, height } = this.size();
    const distance = this.object.position.clone().sub(this.target).length() * Math.tan((this.object.fov / 2) * Math.PI / 180);
    this.panOffset.add(new THREE.Vector3().setFromMatrixColumn(this.object.matrix, 0).multiplyScalar(-(2 * x * distance) / width));
    this.panOffset.add(new THREE.Vector3().setFromMatrixColumn(this.object.matrix, 1).multiplyScalar((2 * y * distance) / height));
  }

  zoomScale() {
    return Math.pow(0.95, this.zoomSpeed);
  }

  mouseDown(event) {
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    if (event.button === 0) {
      this.rotateStart.set(event.clientX, event.clientY);
      this.state = STATE.ROTATE;
    } else if (event.button === 1) {
      this.dollyStart.set(event.clientX, event.clientY);
      this.state = STATE.DOLLY;
    } else if (event.button === 2) {
      this.panStart.set(event.clientX, event.clientY);
      this.state = STATE.PAN;
    }
  }

  mouseMove(event) {
    if (this.state === STATE.ROTATE) {
      event.preventDefault();
      this.rotateBy(event.clientX, event.clientY);
    } else if (this.state === STATE.DOLLY) {
      event.preventDefault();
      this.dollyEnd.set(event.clientX, event.clientY);
      this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);
      if (this.dollyDelta.y > 0) this.scale /= this.zoomScale();
      else if (this.dollyDelta.y < 0) this.scale *= this.zoomScale();
      this.dollyStart.copy(this.dollyEnd);
      this.update();
    } else if (this.state === STATE.PAN) {
      event.preventDefault();
      this.panBy(event.clientX, event.clientY);
    }
  }

  mouseUp() {
    if (this.state === STATE.ROTATE || this.state === STATE.DOLLY || this.state === STATE.PAN) this.state = STATE.NONE;
  }

  wheel(event) {
    if (this.state !== STATE.NONE && this.state !== STATE.ROTATE) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.deltaY < 0) this.scale *= this.zoomScale();
    else if (event.deltaY > 0) this.scale /= this.zoomScale();
    this.update();
  }

  keyDown(event) {
    const moves = { ArrowUp: [0, -this.keyPanSpeed], ArrowDown: [0, this.keyPanSpeed], ArrowLeft: [-this.keyPanSpeed, 0], ArrowRight: [this.keyPanSpeed, 0] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.pan(move[0], move[1]);
    this.update();
  }

  pinch(event) {
    const x = event.touches[0].pageX - event.touches[1].pageX;
    const y = event.touches[0].pageY - event.touches[1].pageY;
    return Math.sqrt(x * x + y * y);
  }

  touchStart(event) {
    const count = event.touches.length;
    if (count === MAX_TOUCHES.rotate) {
      this.rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
      this.state = STATE.TOUCH_ROTATE;
    } else if (count === MAX_TOUCHES.dolly) {
      this.dollyStart.set(0, this.pinch(event));
      this.state = STATE.TOUCH_DOLLY;
    } else if (count === MAX_TOUCHES.pan) {
      this.panStart.set(event.touches[0].pageX, event.touches[0].pageY);
      this.state = STATE.TOUCH_PAN;
    }
  }

  touchMove(event) {
    event.preventDefault();
    event.stopPropagation();
    const count = event.touches.length;
    if (count === MAX_TOUCHES.rotate && this.state === STATE.TOUCH_ROTATE) {
      this.rotateBy(event.touches[0].pageX, event.touches[0].pageY);
    } else if (count === MAX_TOUCHES.dolly && this.state === STATE.TOUCH_DOLLY) {
      this.dollyEnd.set(0, this.pinch(event));
      this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);
      if (this.dollyDelta.y > 0) this.scale *= this.zoomScale();
      else if (this.dollyDelta.y < 0) this.scale /= this.zoomScale();
      this.dollyStart.copy(this.dollyEnd);
      this.update();
    } else if (count === MAX_TOUCHES.pan && this.state === STATE.TOUCH_PAN) {
      this.panBy(event.touches[0].pageX, event.touches[0].pageY);
    } else if (count !== MAX_TOUCHES.rotate && count !== MAX_TOUCHES.dolly && count !== MAX_TOUCHES.pan) {
      this.state = STATE.NONE;
    }
  }

  touchEnd() {
    this.state = STATE.NONE;
  }

  update() {
    if (this.spin) {
      this.spin.rotation.y -= this.sphericalDelta.theta;
      this.spin.position.copy(this.center).sub(this.center.clone().applyAxisAngle(UP, this.spin.rotation.y));
      this.sphericalDelta.set(0, 0, 0);
      this.roomRadius = Math.max(ROOM_MIN_ZOOM, Math.min(this.maxRadius, this.roomRadius * this.scale));
      this.scale = 1;
      const zoom = Math.min(Math.max((this.roomRadius - ROOM_MIN_ZOOM) / (ROOM_MAX_ZOOM - ROOM_MIN_ZOOM), 0), 1);
      this.object.position.copy(this.target).add(new THREE.Vector3(0, this.roomRadius * Math.tan(zoom * ROOM_MAX_TILT), -this.roomRadius));
      this.object.lookAt(this.target);
      this.object.rotateX(this.roomPitch);
      return;
    }
    const offset = this.object.position.clone().sub(this.target);
    this.spherical.setFromVector3(offset);
    if (this.autoRotate && this.state === STATE.NONE) this.sphericalDelta.theta -= (2 * Math.PI / 60 / 60) * this.autoRotateSpeed;
    this.spherical.theta += this.sphericalDelta.theta;
    this.spherical.phi = Math.max(0, Math.min(Math.PI, this.spherical.phi + this.sphericalDelta.phi));
    this.spherical.makeSafe();
    this.spherical.radius *= this.scale;
    this.target.add(this.panOffset);
    offset.setFromSpherical(this.spherical);
    this.object.position.copy(this.target).add(offset);
    this.object.lookAt(this.target);
    this.sphericalDelta.set(0, 0, 0);
    this.scale = 1;
    this.panOffset.set(0, 0, 0);
  }

  dispose() {
    this.listeners.abort();
  }
}

export async function thumbnail3d(url, previous) {
  const meta = await api(url);
  if (meta.state !== 'Completed' || !meta.imageUrl || meta.imageUrl === previous) return null;
  return { url: meta.imageUrl, data: await api(meta.imageUrl) };
}

export async function mountAvatar3d(container, data, options = {}) {
  const [mtlText, objText] = await Promise.all([data.mtl?.trim() ? fetchText(data.mtl) : null, fetchText(data.obj)]);
  const materials = mtlText === null ? null : new Materials(parseMtl(mtlText));
  const { group, hasGlow } = parseObj(objText, materials);
  const { max } = data.aabb;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const size = () => [container.offsetWidth, container.offsetHeight];
  const camera = new THREE.PerspectiveCamera(data.camera.fov ?? 70, size()[0] / size()[1], 0.1, Math.max(4 * new THREE.Vector3(max.x, max.y, max.z).length(), 1000));
  const scene = new THREE.Scene();
  const roomed = options.room && wantsRoom() ? await loadRoom().catch(() => null) : null;
  scene.add(new THREE.AmbientLight(8882048));
  const key = new THREE.DirectionalLight(0xacacac);
  key.position.set(-0.671597898, 0.671597898, 0.312909544).normalize();
  scene.add(key);
  const fill = new THREE.DirectionalLight(4473924);
  fill.position.copy(key.position).negate().normalize();
  scene.add(fill);
  let floor = null;
  if (roomed) {
    const { min } = data.aabb;
    floor = new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    roomed.room.position.copy(floor);
    roomed.room.rotation.y = ROOM_FACING;
    scene.add(roomed.room);
    scene.background = new THREE.Color(1, 1, 1);
    camera.near = ROOM_NEAR;
    camera.far = Math.max(camera.far, ROOM_FAR);
    camera.updateProjectionMatrix();
  }
  scene.add(camera);
  scene.add(group);
  const releaseGlow = hasGlow ? installGlow(scene) : null;
  const controls = new AvatarControls(camera, container, data, roomed ? group : null);
  if (floor) controls.frameRoom(floor, max.y - data.aabb.min.y);
  const applySize = () => {
    const [width, height] = size();
    if (!width || !height) return;
    if (floor) {
      const screen = height / ROOM_SCREEN_VISIBLE;
      camera.aspect = width / screen;
      camera.setViewOffset(width, screen, 0, 0, width, height);
    } else {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
  };
  applySize();
  const observer = new ResizeObserver(applySize);
  observer.observe(container);
  let frame = 0;
  let stopped = false;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    releaseGlow?.();
    roomed?.dispose();
    group.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const map of [material.map, material.normalMap, material.emissiveMap, material.roughnessMap]) map?.dispose();
        material.dispose();
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    scene.clear();
  };
  const tick = () => {
    if (stopped) return;
    if (!container.isConnected) {
      dispose();
      return;
    }
    controls.update();
    roomed?.advance();
    renderer.render(scene, camera);
    roomed?.bloom(renderer, scene, camera);
    frame = requestAnimationFrame(tick);
  };
  return { canvas, start: tick, dispose };
}
