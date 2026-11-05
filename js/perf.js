(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const flag = (name, fallback) => {
    const v = params.get(name);
    if (v === null) return fallback;
    return !/^(0|false|no|off)$/i.test(v);
  };
  const num = (name, fallback) => {
    const v = parseFloat(params.get(name));
    return Number.isFinite(v) ? v : fallback;
  };

  const FORCED = {
    powerPreference: 'high-performance',
    antialias: flag('msaa', false),
    alpha: flag('alpha', false),
    premultipliedAlpha: false,
    depth: true,
    stencil: flag('stencil', true),
    preserveDrawingBuffer: false,
    desynchronized: flag('desync', false),
    failIfMajorPerformanceCaveat: false,
  };

  const nativeRafGlobal = window.requestAnimationFrame.bind(window);

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
    if (type !== 'webgl2' || this.id !== 'canvas') {
      return nativeGetContext.call(this, type, attrs);
    }
    return nativeGetContext.call(this, type, { ...(attrs || {}), ...FORCED });
  };

  const GAMEPAD_SAMPLE_MS = 8;
  const nativeGamepads = navigator.getGamepads && navigator.getGamepads.bind(navigator);
  if (nativeGamepads) {
    let pads = null;
    let sampledAt = -Infinity;
    navigator.getGamepads = () => {
      const now = performance.now();
      if (pads === null || now - sampledAt >= GAMEPAD_SAMPLE_MS) {
        sampledAt = now;
        pads = nativeGamepads();
      }
      return pads;
    };
  }

  let savedFps = 60;
  try {
    const saved = JSON.parse(localStorage.getItem('webblox.settings'));
    if (saved && typeof saved.fps === 'number' && saved.fps >= 0) savedFps = saved.fps;
  } catch (e) {}
  let capFps = num('fps', savedFps);
  window.__webbloxFps = capFps;
  let capActive = false;
  let capInterval = capFps > 0 ? 1000 / capFps : 0;
  let effectiveCapHz = capFps;

  {
    const nativeRaf = nativeRafGlobal;
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let seq = 0;
    let queue = [];
    let scheduled = false;
    let lastRun = 0;

    const tick = ts => {
      scheduled = false;
      if (!capActive || ts - lastRun >= capInterval - 0.75) {
        lastRun = capActive && ts - lastRun < capInterval * 2 ? lastRun + capInterval : ts;
        const run = queue;
        queue = [];
        for (const item of run) {
          try { item.cb(ts); } catch (err) { setTimeout(() => { throw err; }); }
        }
      }
      if (queue.length) schedule();
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      nativeRaf(tick);
    };

    window.requestAnimationFrame = cb => {
      const id = ++seq;
      queue.push({ id, cb });
      schedule();
      return id;
    };
    window.cancelAnimationFrame = id => {
      queue = queue.filter(item => item.id !== id);
    };
    window.__webbloxCap = { fps: capFps, cancel: nativeCancel };
    capActive = capFps > 0;
  }

  window.__webbloxSetFps = fps => {
    if (!(fps >= 0)) return;
    capFps = fps;
    window.__webbloxFps = fps;
    window.__webbloxCap.fps = fps;
    capActive = fps > 0;
    capInterval = capActive ? 1000 / fps : 0;
    effectiveCapHz = fps;
    if (displayKnown) retuneCap(1000 / displayMs);
  };

  {
    const channel = new MessageChannel();
    const REAL_FRAME_MS = 0.3;
    const ENGINE_MAX_MS = 1000 / 240;
    let pending = null;
    let slowFrames = 0;
    let lastStart = 0;
    let retryUntil = 0;
    let due = 0;
    let held = null;
    let heldSince = 0;
    let timerRun = null;
    let timerAt = 0;
    let timerArmed = false;
    channel.port1.onmessage = () => {
      const run = pending;
      pending = null;
      if (run) run();
    };
    const soon = run => {
      pending = run;
      channel.port2.postMessage(0);
    };
    const delayed = (run, ms) => {
      if (window.scheduler && scheduler.postTask) scheduler.postTask(run, { delay: ms, priority: 'user-blocking' });
      else setTimeout(run, ms);
    };
    const timerChannel = new MessageChannel();
    const armTimer = () => {
      timerArmed = false;
      if (!timerRun) return;
      const left = timerAt - performance.now();
      if (left <= 0.2) {
        const run = timerRun;
        timerRun = null;
        run();
        return;
      }
      timerArmed = true;
      if (left > 1.5) delayed(armTimer, left - 1);
      else timerChannel.port2.postMessage(0);
    };
    timerChannel.port1.onmessage = armTimer;
    const waitUntil = (at, run) => {
      timerRun = run;
      timerAt = at;
      if (!timerArmed) armTimer();
    };
    const pastDisplay = () => !capActive || capInterval < displayMs * 0.9;
    window.__webbloxFrameLate = (ms, run) => {
      const now = performance.now();
      const drew = ms >= REAL_FRAME_MS;
      if (drew) noteFrame(now);
      if (document.hidden) return;
      const free = pastDisplay();
      if (!free && !window.__webbloxWebGPU) {
        if (drew) lastStart = now - ms;
        return;
      }
      const period = capActive ? capInterval : ENGINE_MAX_MS;
      if (drew) {
        lastStart = now - ms;
        due = free && due + period > now - period ? due + period : lastStart + period;
        retryUntil = Math.max(now, due) + 4;
        slowFrames = ms >= period - 1 ? Math.min(slowFrames + 1, 30) : Math.max(slowFrames - 1, 0);
      }
      if (!free && !slowFrames) return;
      if (due - now > 0.2) {
        waitUntil(due, run);
        return;
      }
      if (now < retryUntil) soon(run);
    };
    window.__webbloxFrameHold = run => {
      const now = performance.now();
      if (!document.hidden) {
        if (pastDisplay() && now < due - 0.5) return true;
        if (capActive && capInterval > 90 && now < lastStart + capInterval - 2) return true;
      }
      const gl = window.__webgpuGL;
      if (!gl || gl.framesInFlight < (gl.frameLimit || 3) || document.hidden) {
        held = null;
        return false;
      }
      if (!held) heldSince = now;
      if (now - heldSince > 250) {
        held = null;
        return false;
      }
      held = run;
      return true;
    };
    window.__webbloxFrameRelease = () => {
      const run = held;
      held = null;
      if (run) soon(run);
    };
  }

  const SAMPLE_LIMIT = 480;
  const samples = new Float32Array(SAMPLE_LIMIT);
  const engineSamples = new Float32Array(SAMPLE_LIMIT);
  let sampleCount = 0;
  let sampleHead = 0;
  let lastFrameAt = 0;
  let firstFrameAt = 0;
  let frameNumber = 0;
  let hitches = 0;
  let worstFrameMs = 0;

  function pushSample(ms) {
    samples[sampleHead] = ms;
    engineSamples[sampleHead] = engineRenderMs();
    sampleHead = (sampleHead + 1) % SAMPLE_LIMIT;
    if (sampleCount < SAMPLE_LIMIT) sampleCount++;
  }

  let engineMsCached = 0;
  let engineMsAt = 0;
  function engineRenderMs() {
    const now = performance.now();
    if (now - engineMsAt < 100) return engineMsCached;
    engineMsAt = now;
    const M = window.Module;
    try {
      const v = M && typeof M.get_render_time_ms === 'function' ? M.get_render_time_ms() : 0;
      engineMsCached = Number.isFinite(v) && v > 0 && v < 500 ? v : 0;
    } catch {
      engineMsCached = 0;
    }
    return engineMsCached;
  }

  function percentileOf(buf, p) {
    if (!sampleCount) return 0;
    const copy = Array.prototype.slice.call(buf, 0, sampleCount).sort((a, b) => a - b);
    return copy[Math.min(copy.length - 1, Math.floor(copy.length * p))];
  }

  function noteFrame(ts) {
    if (lastFrameAt) {
      const dt = ts - lastFrameAt;
      if (dt > 0 && dt < 1000) {
        pushSample(dt);
        frameNumber++;
        if (dt > worstFrameMs) worstFrameMs = dt;
        if (dt > 34) hitches++;
      }
    } else {
      firstFrameAt = ts;
    }
    lastFrameAt = ts;
  }

  const rawDeltas = [];
  let displayMs = 1000 / 60;
  let displayKnown = false;

  const probe = ts => {
    if (lastProbeAt) {
      const dt = ts - lastProbeAt;
      if (dt > 1 && dt < 100) rawDeltas.push(dt);
    }
    lastProbeAt = ts;
    if (rawDeltas.length >= 60) {
      const sorted = [...rawDeltas].sort((a, b) => a - b);
      displayMs = sorted[Math.floor(sorted.length / 2)];
      displayKnown = true;
      retuneCap(1000 / displayMs);
      return;
    }
    nativeRafGlobal(probe);
  };
  let lastProbeAt = 0;
  nativeRafGlobal(probe);

  function chooseCapHz(refreshHz, target) {
    if (!(refreshHz > 0)) return target;
    if (Math.abs(refreshHz - target) <= target * 0.03) return refreshHz;
    if (refreshHz < target) return target;
    const lo = target * 0.9;
    const hi = target * 1.2;
    let best = 0;
    for (let d = 1; d <= 12; d++) {
      const hz = refreshHz / d;
      if (!(hz >= lo && hz <= hi)) continue;
      if (!best || Math.abs(hz - target) < Math.abs(best - target)) best = hz;
    }
    return best || target;
  }

  function retuneCap(refreshHz) {
    if (!capActive) return;
    const hz = chooseCapHz(refreshHz, capFps);
    effectiveCapHz = hz;
    capInterval = 1000 / hz;
    const how = hz > refreshHz * 1.03 ? 'past the display' : Math.abs(refreshHz / Math.round(refreshHz / hz) - hz) < 0.5 ? 'even divisor' : 'repeat cadence';
    console.log(`[perf] frame cap ${capFps} on a ${refreshHz.toFixed(0)} Hz display -> ${hz.toFixed(0)} fps (${how})`);
  }

  function budgetMs() {
    return capActive ? capInterval : displayMs;
  }

  const canvas = document.getElementById('canvas');
  const pinned = num('scale', null);
  const adaptive = flag('adaptive', false) && pinned === null;
  const MIN_RATIO = 0.5;
  const MAX_RATIO = 1.31;
  const STORE_KEY = 'local.renderRatio';

  try { localStorage.removeItem(STORE_KEY); } catch {}

  let ratio = pinned !== null ? clamp(pinned, MIN_RATIO, 2) : 0;
  let capRatio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
  let installed = false;
  let lastChangeAt = 0;
  let stableWindows = 0;
  let resizeNudgePending = false;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function nudgeResize() {
    if (!canvas || resizeNudgePending) return;
    resizeNudgePending = true;
    const had = canvas.style.paddingRight;
    canvas.style.paddingRight = '1px';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      canvas.style.paddingRight = had;
      resizeNudgePending = false;
    }));
  }

  function installRatioHook() {
    const M = window.Module;
    if (!M || typeof M.getEffectiveDevicePixelRatio !== 'function') return false;
    const base = M.getEffectiveDevicePixelRatio();
    if (!(base > 0)) return false;
    capRatio = Math.min(base, window.devicePixelRatio || 1, MAX_RATIO);
    if (!ratio) ratio = capRatio;
    ratio = clamp(ratio, MIN_RATIO, capRatio);
    M.getEffectiveDevicePixelRatio = () => ratio;
    installed = true;
    if (Math.abs(ratio - base) > 0.01) nudgeResize();
    return true;
  }

  const wantsHook = adaptive || pinned !== null;
  if (wantsHook) {
    const hookPoll = setInterval(() => {
      if (installRatioHook()) clearInterval(hookPoll);
    }, 200);
    setTimeout(() => clearInterval(hookPoll), 60000);
  }

  const governor = setInterval(() => {
    if (!adaptive || !installed || sampleCount < 60) return;
    if (performance.now() - firstFrameAt < 4000) return;
    if (performance.now() - lastChangeAt < 1200) return;

    const budget = budgetMs();
    const cost = percentileOf(engineSamples, 0.95);
    if (!(cost > 0)) {
      if (!governor.warned) {
        governor.warned = true;
        console.warn('[perf] adaptive resolution idle: engine render time unavailable');
      }
      return;
    }

    if (cost > budget && ratio > MIN_RATIO) {
      ratio = clamp(ratio * 0.85, MIN_RATIO, capRatio);
      stableWindows = 0;
      apply('down', cost);
    } else if (cost < budget * 0.7) {
      if (++stableWindows >= 3 && ratio < capRatio) {
        ratio = clamp(ratio * 1.06, MIN_RATIO, capRatio);
        stableWindows = 0;
        apply('up', cost);
      }
    } else {
      stableWindows = 0;
    }
  }, 1000);

  function apply(direction, cost) {
    lastChangeAt = performance.now();
    try {
      nudgeResize();
      console.log(`[perf] renderScale ${direction} -> ${ratio.toFixed(3)} (cost ${cost.toFixed(1)}ms, budget ${budgetMs().toFixed(1)}ms)`);
    } catch {}
  }

  function gpuInfo() {
    try {
      const gl = canvas && (canvas.getContext('webgl2') || null);
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        attributes: gl.getContextAttributes(),
      };
    } catch { return null; }
  }

  function report() {
    const frame = {
      fps: +(1000 / Math.max(0.001, percentileOf(samples, 0.5))).toFixed(1),
      p50: +percentileOf(samples, 0.5).toFixed(2),
      p95: +percentileOf(samples, 0.95).toFixed(2),
      p99: +percentileOf(samples, 0.99).toFixed(2),
      onePercentLowFps: percentileOf(samples, 0.99) ? +(1000 / percentileOf(samples, 0.99)).toFixed(1) : 0,
      samples: sampleCount,
      frames: frameNumber,
      hitches,
      worstFrameMs: +worstFrameMs.toFixed(1),
    };
    const engineP50 = percentileOf(engineSamples, 0.5);
    return {
      frame,
      engineRenderMs: engineP50 ? +engineP50.toFixed(2) : null,
      budgetMs: +budgetMs().toFixed(2),
      displayMs: +displayMs.toFixed(2),
      displayHz: +(1000 / displayMs).toFixed(0),
      displayKnown,
      cappedFps: capActive ? +effectiveCapHz.toFixed(1) : null,
      renderRatio: installed ? +ratio.toFixed(3) : null,
      capRatio: +capRatio.toFixed(3),
      devicePixelRatio: window.devicePixelRatio || 1,
      adaptive,
      installed,
      canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null,
      gpu: gpuInfo(),
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      longTasks: report.__longTasks || 0,
    };
  }
  window.perfReport = report;
  window.perfReset = () => {
    sampleCount = 0; sampleHead = 0;
    hitches = 0; worstFrameMs = 0; frameNumber = 0;
  };

  try {
    new PerformanceObserver(list => {
      report.__longTasks = (report.__longTasks || 0) + list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  } catch {}

  if (flag('hud', false)) {
    const hud = document.createElement('div');
    hud.id = 'local-perf-hud';
    hud.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:200', 'pointer-events:none',
      'font:12px/1.4 ui-monospace,Consolas,monospace', 'color:#e9eef5',
      'background:rgba(10,16,24,.72)', 'padding:6px 9px', 'border-radius:6px',
      'white-space:pre', 'text-shadow:0 1px 2px rgba(0,0,0,.8)',
    ].join(';');
    const attach = () => {
      if (document.body) document.body.appendChild(hud);
      else requestAnimationFrame(attach);
    };
    attach();
    setInterval(() => {
      const r = report();
      hud.textContent =
        `${r.frame.fps.toFixed(0)} fps  p95 ${r.frame.p95.toFixed(1)}ms  ${r.displayHz}Hz\n` +
        `engine ${r.engineRenderMs === null ? '—' : r.engineRenderMs.toFixed(2) + 'ms'} / budget ${r.budgetMs.toFixed(1)}ms\n` +
        `ratio ${r.renderRatio === null ? 'native' : r.renderRatio}  ${r.canvas ? r.canvas.width + 'x' + r.canvas.height : ''}  hitches ${r.frame.hitches}`;
    }, 250);
  }

  console.log('[perf] context forced:', JSON.stringify(FORCED));
  console.log('[perf] adaptive resolution:', adaptive ? 'on' : 'off',
    '| frame cap:', capActive ? capFps + ' fps requested' : 'off',
    '| perfReport() for numbers');
})();
