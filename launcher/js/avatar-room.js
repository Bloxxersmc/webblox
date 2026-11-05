import * as THREE from '../vendor/three.module.js';

const ROOM_URL = (self.__WB||'/')+'assets/classic/avatar-room/';
const FRESH = { cache: 'no-cache' };
const SIMULATION_STEP = 0.1;
const MAX_FRAME_TIME = 0.1;
const PARTICLE_SCALE = 1;
const NEON_HDR = 5;
const BLOOM_THRESHOLD = '4.0';
const BLOOM_INTENSITY = '1.0';
const BLOOM_SIZE = 27;
const BLOOM_REFERENCE_HEIGHT = 1080;
const BLOOM_DOWNSCALE = 4;
const WARM_FILL = 0.12;
const STRAIGHT_ALPHA_MAP = `
  #ifdef USE_MAP
    diffuseColor *= texture2D( map, vUv );
  #endif`;
const NEON_EMISSION = 'totalEmissiveRadiance *= diffuseColor.rgb;';
const COLOR_CORRECTION = `
  float roomLuma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(roomLuma), gl_FragColor.rgb, 1.175);
  gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * 0.95 + 0.5 + 0.02;`;
const PARTICLE_VERTEX = `
  attribute vec3 iCenter;
  attribute float iSize;
  attribute vec4 iColor;
  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vec4 center = modelViewMatrix * vec4(iCenter, 1.0);
    center.xy += position.xy * iSize;
    vUv = position.xy + 0.5;
    vColor = iColor;
    gl_Position = projectionMatrix * center;
  }
`;
const PARTICLE_FRAGMENT = `
  uniform sampler2D map;
  uniform float lightEmission;
  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vec4 texel = texture2D(map, vUv);
    float alpha = texel.a * vColor.a;
    gl_FragColor = vec4(texel.rgb * vColor.rgb * alpha, alpha * (1.0 - lightEmission));
  }
`;
const QUAD_VERTEX = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const BRIGHT_FRAGMENT = `
  uniform sampler2D tInput;
  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(tInput, vUv).rgb;
    float peak = max(color.r, max(color.g, color.b));
    gl_FragColor = vec4(color * (max(peak - ${BLOOM_THRESHOLD}, 0.0) / (peak + 0.001) * ${BLOOM_INTENSITY}), 1.0);
  }
`;
const BLUR_FRAGMENT = `
  uniform sampler2D tInput;
  uniform vec2 blurStep;
  varying vec2 vUv;

  void main() {
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = -6; i <= 6; i++) {
      float weight = exp(-float(i * i) / 18.0);
      sum += texture2D(tInput, vUv + blurStep * float(i)).rgb * weight;
      total += weight;
    }
    gl_FragColor = vec4(sum / total, 1.0);
  }
`;
const COMPOSITE_FRAGMENT = `
  uniform sampler2D tInput;
  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(texture2D(tInput, vUv).rgb, 0.0);
  }
`;

async function loadTexture(name, tiled, loader) {
  const texture = await loader.loadAsync(`${ROOM_URL}${name}`);
  texture.flipY = false;
  if (tiled) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function sample(sequence, time, spread) {
  let index = 0;
  while (index < sequence.length - 2 && time > sequence[index + 1][0]) index++;
  const from = sequence[index];
  const to = sequence[index + 1];
  const blend = (time - from[0]) / Math.max(to[0] - from[0], 1e-5);
  const value = from[1] + (to[1] - from[1]) * blend;
  const envelope = from[2] + (to[2] - from[2]) * blend;
  return value + envelope * spread;
}

function sampleColor(sequence, time, out) {
  let index = 0;
  while (index < sequence.length - 2 && time > sequence[index + 1][0]) index++;
  const from = sequence[index];
  const to = sequence[index + 1];
  const blend = (time - from[0]) / Math.max(to[0] - from[0], 1e-5);
  for (let channel = 0; channel < 3; channel++) out[channel] = from[channel + 1] + (to[channel + 1] - from[channel + 1]) * blend;
}

const between = ([low, high]) => low + (high - low) * Math.random();

function createEmitter(entry, map) {
  const capacity = Math.ceil(entry.rate * entry.lifetime[1]) + 1;
  const quad = new THREE.PlaneGeometry(1, 1);
  const shape = new THREE.InstancedBufferGeometry();
  shape.index = quad.index;
  shape.setAttribute('position', quad.attributes.position);
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const sizes = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  shape.setAttribute('iCenter', centers);
  shape.setAttribute('iSize', sizes);
  shape.setAttribute('iColor', colors);
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, lightEmission: { value: entry.lightEmission } },
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(shape, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const particles = [];
  const color = [0, 0, 0];
  let owed = 0;
  const { rotation: r, position: origin, box, direction, speed, spread, acceleration, drag } = entry;
  const toWorld = (x, y, z) => [
    r[0] * x + r[1] * y + r[2] * z,
    r[3] * x + r[4] * y + r[5] * z,
    r[6] * x + r[7] * y + r[8] * z,
  ];
  const spawn = () => {
    const local = box.map(size => (Math.random() - 0.5) * size);
    const start = toWorld(...local).map((value, axis) => value + origin[axis]);
    const yaw = (between([-spread[0], spread[0]]) * Math.PI) / 180;
    const pitch = (between([-spread[1], spread[1]]) * Math.PI) / 180;
    const facing = new THREE.Vector3(...direction).applyEuler(new THREE.Euler(pitch, 0, yaw));
    const aim = toWorld(facing.x, facing.y, facing.z);
    const pace = between(speed);
    return {
      position: start,
      velocity: aim.map(value => value * pace),
      age: 0,
      lifetime: between(entry.lifetime),
      spread: Math.random() * 2 - 1,
    };
  };
  const simulate = delta => {
    owed += entry.rate * delta;
    while (owed >= 1 && particles.length < capacity) {
      particles.push(spawn());
      owed -= 1;
    }
    owed = Math.min(owed, 1);
    const damping = Math.exp(-drag * delta);
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.age += delta;
      if (particle.age >= particle.lifetime) {
        particles.splice(index, 1);
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        particle.velocity[axis] = (particle.velocity[axis] + acceleration[axis] * delta) * damping;
        particle.position[axis] += particle.velocity[axis] * delta;
      }
    }
  };
  const write = () => {
    particles.forEach((particle, index) => {
      const time = particle.age / particle.lifetime;
      centers.setXYZ(index, ...particle.position);
      sizes.setX(index, Math.max(sample(entry.size, time, particle.spread), 0) * PARTICLE_SCALE);
      sampleColor(entry.color, time, color);
      const opacity = 1 - Math.min(Math.max(sample(entry.transparency, time, particle.spread), 0), 1);
      colors.setXYZW(index, color[0], color[1], color[2], opacity);
    });
    centers.needsUpdate = true;
    sizes.needsUpdate = true;
    colors.needsUpdate = true;
    shape.instanceCount = particles.length;
  };
  for (let elapsed = 0; elapsed < entry.lifetime[1]; elapsed += SIMULATION_STEP) simulate(SIMULATION_STEP);
  write();
  return {
    mesh,
    advance: delta => {
      simulate(delta);
      write();
    },
    dispose: () => {
      quad.dispose();
      shape.dispose();
      material.dispose();
    },
  };
}

function createBloom(room) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  triangle.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const pass = (fragmentShader, uniforms, options = {}) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null }, ...uniforms },
      vertexShader: QUAD_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      ...options,
    });
    const mesh = new THREE.Mesh(triangle, material);
    mesh.frustumCulled = false;
    return { material, mesh };
  };
  const bright = pass(BRIGHT_FRAGMENT);
  const blur = pass(BLUR_FRAGMENT, { blurStep: { value: new THREE.Vector2() } });
  const composite = pass(COMPOSITE_FRAGMENT, {}, {
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const black = new THREE.MeshBasicMaterial({ color: 0 });
  const size = new THREE.Vector2();
  const hidden = [];
  room.traverse(node => {
    if (node.isMesh && node.material.transparent && (node.material.opacity < 1 || node.material.isShaderMaterial)) hidden.push(node);
  });
  let targets = null;
  const makeTargets = (width, height) => {
    targets?.forEach(target => target.dispose());
    const small = [Math.max(1, Math.floor(width / BLOOM_DOWNSCALE)), Math.max(1, Math.floor(height / BLOOM_DOWNSCALE))];
    const options = { type: THREE.HalfFloatType, format: THREE.RGBAFormat };
    targets = [
      new THREE.WebGLRenderTarget(width, height, options),
      new THREE.WebGLRenderTarget(small[0], small[1], { ...options, depthBuffer: false }),
      new THREE.WebGLRenderTarget(small[0], small[1], { ...options, depthBuffer: false }),
    ];
  };
  const draw = (renderer, { mesh }, target) => {
    renderer.setRenderTarget(target);
    renderer.render(mesh, camera);
  };
  return {
    render: (renderer, scene, view) => {
      renderer.getDrawingBufferSize(size);
      if (!size.x || !size.y) return;
      if (!targets || targets[0].width !== size.x || targets[0].height !== size.y) makeTargets(size.x, size.y);
      const [emission, one, two] = targets;
      const { background, onBeforeRender, onAfterRender } = scene;
      const autoClear = renderer.autoClear;
      scene.background = null;
      scene.onBeforeRender = () => {};
      scene.onAfterRender = () => {};
      hidden.forEach(node => { node.visible = false; });
      renderer.autoClear = true;
      scene.overrideMaterial = black;
      renderer.setRenderTarget(emission);
      renderer.render(scene, view);
      scene.overrideMaterial = null;
      hidden.forEach(node => { node.visible = true; });
      renderer.autoClear = false;
      view.layers.set(1);
      renderer.render(scene, view);
      view.layers.set(0);
      scene.background = background;
      scene.onBeforeRender = onBeforeRender;
      scene.onAfterRender = onAfterRender;
      renderer.autoClear = true;
      bright.material.uniforms.tInput.value = emission.texture;
      draw(renderer, bright, one);
      const reach = (BLOOM_SIZE * (size.y / BLOOM_REFERENCE_HEIGHT)) / BLOOM_DOWNSCALE / 3;
      blur.material.uniforms.tInput.value = one.texture;
      blur.material.uniforms.blurStep.value.set(reach / one.width, 0);
      draw(renderer, blur, two);
      blur.material.uniforms.tInput.value = two.texture;
      blur.material.uniforms.blurStep.value.set(0, reach / one.height);
      draw(renderer, blur, one);
      composite.material.uniforms.tInput.value = one.texture;
      renderer.autoClear = false;
      draw(renderer, composite, null);
      renderer.autoClear = autoClear;
    },
    dispose: () => {
      targets?.forEach(target => target.dispose());
      triangle.dispose();
      black.dispose();
      [bright, blur, composite].forEach(({ material }) => material.dispose());
    },
  };
}

export async function loadRoom() {
  const [manifest, geometry] = await Promise.all([
    fetch(`${ROOM_URL}room.json`, FRESH).then(response => response.json()),
    fetch(`${ROOM_URL}room.bin`, FRESH).then(response => response.arrayBuffer()),
  ]);
  const room = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const textures = new Map();
  const needed = [
    ...manifest.batches.filter(entry => entry.texture).map(entry => [entry.texture, entry.tiled]),
    ...manifest.emitters.map(entry => [entry.texture, false]),
  ];
  await Promise.all(needed.map(async ([name, tiled]) => {
    const key = `${name}|${tiled}`;
    if (textures.has(key)) return;
    textures.set(key, null);
    textures.set(key, await loadTexture(name, tiled, loader));
  }));
  for (const entry of manifest.batches) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geometry, entry.positions, entry.count * 3), 3));
    shape.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry, entry.normals, entry.count * 3), 3));
    shape.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry, entry.uvs, entry.count * 2), 2));
    shape.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry, entry.colors, entry.count * 3), 3));
    const key = `${entry.texture}|${entry.tiled}`;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      map: entry.texture ? textures.get(key) : null,
      transparent: entry.opacity < 1 || Boolean(entry.texture),
      opacity: entry.opacity,
      alphaTest: entry.texture ? 0.01 : 0,
      depthWrite: !entry.texture && entry.opacity === 1,
    });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', STRAIGHT_ALPHA_MAP)
        .replace('#include <emissivemap_fragment>', NEON_EMISSION)
        .replace('#include <dithering_fragment>', COLOR_CORRECTION);
    };
    if (entry.neon) material.emissive = new THREE.Color(1, 1, 1);
    room.add(new THREE.Mesh(shape, material));
    if (entry.neon && entry.opacity === 1) {
      const glow = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(NEON_HDR, NEON_HDR, NEON_HDR) }));
      glow.layers.set(1);
      room.add(glow);
    }
  }
  room.add(new THREE.AmbientLight(0xfff0c8, WARM_FILL));
  for (const light of manifest.lights) {
    const point = new THREE.PointLight(new THREE.Color(...light.color), light.brightness, light.range, 1);
    point.position.set(...light.position);
    room.add(point);
  }
  const emitters = manifest.emitters.map(entry => createEmitter(entry, textures.get(`${entry.texture}|false`)));
  emitters.forEach(emitter => room.add(emitter.mesh));
  const bloom = createBloom(room);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = performance.now();
  const dispose = () => {
    for (const texture of textures.values()) texture.dispose();
    emitters.forEach(emitter => emitter.dispose());
    bloom.dispose();
    room.traverse(node => {
      if (!node.isMesh || node.material.isShaderMaterial) return;
      node.geometry.dispose();
      node.material.dispose();
    });
  };
  return {
    room,
    dispose,
    advance: () => {
      const now = performance.now();
      const delta = Math.min((now - last) / 1000, MAX_FRAME_TIME);
      last = now;
      if (!still) emitters.forEach(emitter => emitter.advance(delta));
    },
    bloom: (renderer, scene, camera) => bloom.render(renderer, scene, camera),
  };
}
