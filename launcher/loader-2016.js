(() => {
  if (document.documentElement.dataset.loader !== '2016') return;

  const consoleMode = document.documentElement.dataset.loaderVariant === 'console';
  const GAMEPAD_B = 1;
  const FONT_METRIC = 1.257;
  const MIN_TEXT_SIZE = 8;
  const MAX_TEXT_SIZE = 96;
  const DOT_INTERVAL_MS = 200;
  const CLOSE_DELAY_MS = 5000;
  const CLOSE_FADE_MS = 1000 / 1.7;
  const EXIT_FADE_MS = 1000 / 1.8;
  const MOBILE_MAX_HEIGHT = 500;
  const PLACEHOLDER_TITLE = 'Joining experience';

  const overlay = document.getElementById('loading-overlay');
  const title = document.getElementById('loading-experience-title');
  const creator = document.getElementById('loading-experience-creator');
  const status = document.getElementById('status');
  const cancel = document.getElementById('loading-cancel');

  const div = (className, ...children) => {
    const node = document.createElement('div');
    node.className = className;
    node.append(...children);
    return node;
  };

  const background = div('l16-background');
  const texture = div('l16-texture');
  const circle = div('l16-circle');
  const loadingText = div('l16-loading');
  const placeBox = div('l16-place', title);
  const creatorBox = div('l16-creator', creator);
  const info = div('l16-info', placeBox, creatorBox);
  const root = div(
    '',
    background,
    texture,
    info,
    div('l16-message', status),
    div('l16-graphics', circle, loadingText),
    div('l16-close', cancel),
  );
  root.id = 'loader-2016';
  root.classList.toggle('l16-mobile', !consoleMode && matchMedia('(hover: none) and (pointer: coarse)').matches && innerHeight <= MOBILE_MAX_HEIGHT);
  root.classList.toggle('l16-console', consoleMode);
  loadingText.textContent = 'Loading...';
  overlay.after(root);

  const byText = div('l16-by-text');
  byText.textContent = 'By';
  const byBox = div('l16-by', byText);
  const cancelLabel = cancel.parentElement;
  const cancelText = div('l16-cancel-text');
  cancelText.textContent = 'Cancel';
  const consoleClose = document.createElement('button');
  consoleClose.type = 'button';
  consoleClose.className = 'l16-console-close';
  consoleClose.setAttribute('aria-label', 'Leave');
  consoleClose.hidden = true;
  consoleClose.addEventListener('click', () => window.__webbloxExit());
  if (consoleMode) {
    info.append(byBox, div('l16-creator-icon'));
    cancelLabel.classList.add('l16-cancel-label');
    root.append(cancelText, consoleClose);
    loadingText.hidden = true;
  }

  const setTextSize = (node, size) => {
    node.style.fontSize = `${(size + 1) / FONT_METRIC}px`;
    node.style.lineHeight = `${size}px`;
  };

  const scaleText = (node, box) => {
    if (!node.textContent.trim()) return;
    const available = box.clientHeight;
    let biggest = MIN_TEXT_SIZE;
    let min = biggest;
    let max = MAX_TEXT_SIZE;
    while (biggest <= max) {
      const mid = min + Math.floor((max - min) / 2);
      setTextSize(node, mid);
      if (node.offsetHeight <= available && biggest < mid) {
        biggest = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }
    setTextSize(node, biggest);
  };

  const hasContent = () => {
    const name = title.textContent.trim();
    return Boolean(name) && name !== PLACEHOLDER_TITLE;
  };

  const fitInfo = () => {
    root.classList.toggle('l16-ready', hasContent());
    root.classList.toggle('l16-has-creator', !creator.hidden);
    scaleText(title, placeBox);
    scaleText(creator, creatorBox);
    if (consoleMode) scaleText(byText, byBox);
  };

  let dots = '...';
  setInterval(() => {
    if (root.hidden || consoleMode) return;
    dots += '.';
    if (dots === '....') dots = '';
    loadingText.textContent = `Loading${dots}`;
  }, DOT_INTERVAL_MS);

  let closeTimer = 0;
  let closeFade = null;
  let hideTimer = 0;
  let fades = [];
  let exiting = false;

  const activateClose = () => cancel.classList.add('l16-active');

  let cancelled = false;
  let buttonDown = false;

  const consoleCancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancel.hidden = true;
    cancelText.textContent = 'Canceling...';
    cancelText.classList.add('l16-canceling');
    window.__webbloxExit();
  };

  const pollGamepads = () => {
    if (root.hidden || cancelled) return;
    const down = [...(navigator.getGamepads?.() || [])].some(pad => pad?.buttons[GAMEPAD_B]?.pressed);
    if (buttonDown && !down) {
      consoleCancel();
      return;
    }
    buttonDown = down;
    requestAnimationFrame(pollGamepads);
  };

  const showClose = () => {
    if (consoleMode) {
      consoleClose.hidden = false;
      return;
    }
    clearTimeout(closeTimer);
    closeFade?.cancel();
    closeFade = null;
    cancel.style.opacity = '1';
    activateClose();
  };

  const scheduleClose = () => {
    closeTimer = setTimeout(() => {
      closeFade = cancel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_FADE_MS, fill: 'forwards' });
      closeFade.onfinish = activateClose;
    }, CLOSE_DELAY_MS);
  };

  const exit = () => {
    if (exiting) return;
    exiting = true;
    root.classList.add('l16-leaving');
    fades = [background, texture, info, circle].map(node => node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: EXIT_FADE_MS,
      fill: 'forwards',
    }));
    hideTimer = setTimeout(() => {
      root.hidden = true;
      clearTimeout(closeTimer);
    }, EXIT_FADE_MS);
  };

  const restart = () => {
    exiting = false;
    clearTimeout(hideTimer);
    fades.forEach(fade => fade.cancel());
    fades = [];
    root.hidden = false;
    root.classList.remove('l16-leaving');
    if (consoleMode) pollGamepads();
  };

  new MutationObserver(fitInfo).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(fitInfo).observe(creator, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (overlay.classList.contains('loading-failed')) showClose();
    if (overlay.classList.contains('loading-exiting')) exit();
    else if (exiting) restart();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', fitInfo);

  Promise.all([
    document.fonts.load('18px "Source Sans 2016"'),
    document.fonts.load('700 18px "Source Sans 2016"'),
  ]).then(fitInfo, fitInfo);

  fitInfo();
  if (consoleMode) {
    cancel.addEventListener('click', consoleCancel);
    pollGamepads();
  } else {
    scheduleClose();
  }
})();
