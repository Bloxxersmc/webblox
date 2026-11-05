(() => {
  'use strict';

  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  const RETRY_MS = [120, 250, 500, 1000, 1500, 2000];
  const TRANSITION_TIMEOUT_MS = 1000;
  const SUSPEND_DELAY_MS = 300;
  const ESCAPE_CHECK_MS = 80;
  const RECENT_ESCAPE_MS = 300;
  const RECENT_UNFOCUS_MS = 200;
  const OVERLAY_CHECK_MS = 250;
  const SPIKE_WINDOW_MS = 50;
  const SPIKE_PIXELS = 250;
  const STALE_MOVES = 2;
  const LOG_LIMIT = 60;
  const BUTTON_BIT = [1, 4, 2, 8, 16];
  const TEXT_INPUT_IDS = new Set(['input-container', 'input-input', 'input-textarea']);
  const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn']);

  let armed = new URLSearchParams(location.search).has('placeId');
  let wanted = false;
  let everCaptured = false;
  let requesting = false;
  let releasing = false;
  let suspended = false;
  let hold = false;
  let retryStep = 0;
  let retryTimer = 0;
  let suspendTimer = 0;
  let transitionTimer = 0;
  let overlayTimer = 0;
  let pressed = 0;
  let staleMoves = 0;
  let dragFromCanvas = false;
  let leavePending = false;
  let swallowRelease = false;
  let lockedAt = -Infinity;
  let lastEscape = -Infinity;
  let lastUnfocus = -Infinity;
  let cursorKnown = false;
  let cursorX = 0;
  let cursorY = 0;
  const log = [];

  const note = text => {
    log.push(`${Math.round(performance.now())} ${text}`);
    if (log.length > LOG_LIMIT) log.shift();
  };

  const isLocked = () => document.pointerLockElement === canvas;
  const buttonBit = button => BUTTON_BIT[button] || 0;
  const isEditable = node => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;

  const clearAt = (x, y) => {
    const element = document.elementFromPoint(x, y);
    return !element || element === canvas || TEXT_INPUT_IDS.has(element.id);
  };

  const surfaceClear = () => {
    const rect = canvas.getBoundingClientRect();
    if (!clearAt(rect.left + rect.width / 2, rect.top + rect.height / 2)) return false;
    return !cursorKnown || clearAt(cursorX, cursorY);
  };

  const moveCursor = (dx, dy) => {
    const rect = canvas.getBoundingClientRect();
    cursorX = Math.min(Math.max(cursorX + dx, rect.left), rect.right - 1);
    cursorY = Math.min(Math.max(cursorY + dy, rect.top), rect.bottom - 1);
  };

  const eventInit = event => ({
    bubbles: true,
    cancelable: true,
    clientX: cursorX,
    clientY: cursorY,
    screenX: event.screenX,
    screenY: event.screenY,
    movementX: event.movementX,
    movementY: event.movementY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  });

  const setSuspended = value => {
    if (suspended === value) return;
    suspended = value;
    canvas.style.cursor = value ? 'default' : '';
    note(value ? 'waiting for a click to capture the mouse' : 'capture settled');
  };

  const stopRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = 0;
    retryStep = 0;
  };

  const stopSuspendTimer = () => {
    clearTimeout(suspendTimer);
    suspendTimer = 0;
  };

  const flushLeave = () => {
    if (!leavePending || wanted || pressed || isLocked()) return;
    leavePending = false;
    canvas.dispatchEvent(new MouseEvent('mouseleave'));
  };

  const armTransition = () => {
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      note('lock change timed out');
      requesting = false;
      releasing = false;
      sync();
    }, TRANSITION_TIMEOUT_MS);
  };

  const lockFailed = reason => {
    if (!requesting) return;
    requesting = false;
    clearTimeout(transitionTimer);
    note(`lock denied: ${reason}`);
    if (!wanted || retryTimer || retryStep >= RETRY_MS.length) return;
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      sync();
    }, RETRY_MS[retryStep++]);
  };

  const requestLock = () => {
    if (wanted && !suspended && !suspendTimer) {
      suspendTimer = setTimeout(() => {
        suspendTimer = 0;
        if (wanted && !isLocked()) setSuspended(true);
      }, SUSPEND_DELAY_MS);
    }
    requesting = true;
    armTransition();
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(error => lockFailed(error && error.message));
    } catch (error) {
      lockFailed(error && error.message);
    }
  };

  function sync() {
    if (isLocked()) {
      stopRetry();
      stopSuspendTimer();
      hold = false;
      setSuspended(false);
      return;
    }
    if (requesting || releasing) return;
    if (!wanted) {
      stopRetry();
      stopSuspendTimer();
      setSuspended(false);
      flushLeave();
      return;
    }
    if (hold || !surfaceClear()) {
      setSuspended(true);
      return;
    }
    if (!retryTimer) requestLock();
  }

  const capture = () => {
    if (!armed || isLocked() || requesting || releasing || !surfaceClear()) return;
    hold = false;
    stopRetry();
    requestLock();
  };

  const setWanted = value => {
    if (wanted === value) return;
    wanted = value;
    if (value) armed = true;
    hold = false;
    stopRetry();
    note(value ? 'engine wants the mouse locked' : 'engine released the mouse');
    sync();
  };

  const gesture = () => {
    if (!wanted || isLocked()) return;
    hold = false;
    stopRetry();
    sync();
  };

  const injectEscape = () => {
    note('forwarding Escape to the engine');
    const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', init));
    document.dispatchEvent(new KeyboardEvent('keyup', init));
  };

  const browserTookLock = () => {
    note('browser dropped the lock');
    hold = true;
    const at = performance.now();
    setTimeout(() => {
      if (isLocked() || !document.hasFocus() || document.hidden) return;
      if (lastUnfocus >= at - RECENT_UNFOCUS_MS || lastEscape >= at - RECENT_ESCAPE_MS) return;
      injectEscape();
    }, ESCAPE_CHECK_MS);
  };

  const watchOverlays = () => {
    clearInterval(overlayTimer);
    overlayTimer = setInterval(() => {
      if (!isLocked() || releasing || surfaceClear()) return;
      note('page overlay opened, freeing the cursor');
      hold = true;
      releasing = true;
      armTransition();
      document.exitPointerLock();
    }, OVERLAY_CHECK_MS);
  };

  const releaseButtons = bits => {
    for (let button = 0; button < BUTTON_BIT.length; button++) {
      if (!(bits & BUTTON_BIT[button])) continue;
      pressed &= ~BUTTON_BIT[button];
      note(`button ${button} released without a mouseup`);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button, buttons: pressed, clientX: cursorX, clientY: cursorY }));
    }
    if (!pressed) dragFromCanvas = false;
    staleMoves = 0;
    flushLeave();
  };

  const unfocused = () => {
    lastUnfocus = performance.now();
    swallowRelease = false;
    if (pressed) releaseButtons(pressed);
  };

  document.addEventListener('pointerlockchange', () => {
    const locked = isLocked();
    const exiting = releasing;
    requesting = false;
    releasing = false;
    clearTimeout(transitionTimer);
    note(locked ? 'locked' : 'unlocked');
    if (locked) {
      lockedAt = performance.now();
      everCaptured = true;
      if (!cursorKnown) {
        const rect = canvas.getBoundingClientRect();
        cursorX = rect.left + rect.width / 2;
        cursorY = rect.top + rect.height / 2;
        cursorKnown = true;
      }
      watchOverlays();
    } else {
      clearInterval(overlayTimer);
      if (!exiting) browserTookLock();
    }
    sync();
  });

  window.addEventListener('pointerlockerror', event => {
    event.stopImmediatePropagation();
    lockFailed('pointerlockerror');
  }, true);

  window.addEventListener('contextmenu', event => {
    if (!isEditable(event.target) || wanted || isLocked()) event.preventDefault();
  }, true);

  window.addEventListener('mousedown', event => {
    if (!event.isTrusted) return;
    pressed |= buttonBit(event.button);
    staleMoves = 0;
    if (isLocked()) {
      event.stopImmediatePropagation();
      event.preventDefault();
      canvas.dispatchEvent(new MouseEvent('mousedown', eventInit(event)));
      return;
    }
    cursorX = event.clientX;
    cursorY = event.clientY;
    cursorKnown = true;
    const onCanvas = event.target === canvas;
    if (onCanvas) dragFromCanvas = true;
    if (suspended && event.button === 0 && onCanvas) {
      swallowRelease = true;
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    if (onCanvas) capture();
    gesture();
  }, true);

  window.addEventListener('mouseup', event => {
    if (!event.isTrusted) return;
    pressed &= ~buttonBit(event.button);
    staleMoves = 0;
    if (!pressed) dragFromCanvas = false;
    if (swallowRelease && event.button === 0) {
      swallowRelease = false;
      event.stopImmediatePropagation();
      return;
    }
    if (isLocked()) {
      event.stopImmediatePropagation();
      event.preventDefault();
      document.dispatchEvent(new MouseEvent('mouseup', eventInit(event)));
      return;
    }
    flushLeave();
  }, true);

  window.addEventListener('mousemove', event => {
    if (!event.isTrusted) return;
    const stale = pressed & ~event.buttons;
    if (stale && ++staleMoves >= STALE_MOVES) releaseButtons(stale);
    else if (!stale) staleMoves = 0;
    if (isLocked()) {
      event.stopImmediatePropagation();
      const spike = Math.abs(event.movementX) > SPIKE_PIXELS || Math.abs(event.movementY) > SPIKE_PIXELS;
      if (spike && performance.now() - lockedAt < SPIKE_WINDOW_MS) return;
      if (!wanted) moveCursor(event.movementX, event.movementY);
      canvas.dispatchEvent(new MouseEvent('mousemove', eventInit(event)));
      return;
    }
    cursorX = event.clientX;
    cursorY = event.clientY;
    cursorKnown = true;
    if (hold && wanted && !pressed) {
      event.stopImmediatePropagation();
      return;
    }
    if (dragFromCanvas && event.target !== canvas) canvas.dispatchEvent(new MouseEvent('mousemove', eventInit(event)));
  }, true);

  window.addEventListener('wheel', event => {
    if (!event.isTrusted || !isLocked()) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', { ...eventInit(event), deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode }));
  }, { capture: true, passive: false });

  window.addEventListener('mouseleave', event => {
    if (event.target !== canvas || !event.isTrusted) return;
    if (wanted || pressed || isLocked()) {
      leavePending = true;
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('mouseenter', event => {
    if (event.target === canvas) leavePending = false;
  }, true);

  window.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.code === 'Escape') {
      lastEscape = performance.now();
      return;
    }
    if (event.repeat || MODIFIER_KEYS.has(event.key)) return;
    if (wanted) gesture();
    else if (!everCaptured && !isEditable(document.activeElement)) capture();
  }, true);

  window.addEventListener('touchend', gesture, { capture: true, passive: true });

  window.addEventListener('blur', event => {
    if (event.target === window) unfocused();
  }, true);

  window.addEventListener('focus', event => {
    if (event.target === window) sync();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) unfocused();
    else sync();
  });

  (window.__webbloxImportPatches = window.__webbloxImportPatches || []).push(imports => {
    imports.emscripten_request_pointerlock = () => {
      setWanted(true);
      return 0;
    };
    imports.emscripten_exit_pointerlock = () => {
      setWanted(false);
      return 0;
    };
  });

  window.__webbloxMouse = {
    log,
    state: () => ({ armed, wanted, locked: isLocked(), everCaptured, requesting, releasing, suspended, hold, retryStep, pressed, leavePending, cursorX, cursorY }),
  };
})();
