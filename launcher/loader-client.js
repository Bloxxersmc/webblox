(() => {
  const { loader, loaderVariant: variant } = document.documentElement.dataset;
  if (loader !== 'classic' || !['client-2023', 'client-2022'].includes(variant)) return;

  const launch = variant === 'client-2022';
  const FONT_METRIC = launch ? 1.2 : 1.26;
  const THUMBNAIL_WIDTH = 768;
  const THUMBNAIL_HEIGHT = 432;
  const THUMBNAIL_WIDTH_RATIO = 1.5;
  const THUMBNAIL_SPEED = 0.05;
  const CLOSE_DELAY_MS = 5000;
  const ICON_BREAKPOINT = 1024;
  const ICON_MIN = 150;
  const ICON_MAX = 256;
  const ICON_LAUNCH = 150;
  const FADE_MS = 600;
  const EXIT_SCALE = 0.6;
  const STEP_ICON_MS = 1000;
  const STEP_TEXT_MS = 500;
  const STEP_EXIT_MS = 500;
  const PLACE_SIZE_LAUNCH = [12, 48];
  const CREATOR_SIZE_LAUNCH = [12, 24];
  const PLACEHOLDER_TITLE = 'Joining experience';

  const overlay = document.getElementById('loading-overlay');
  const thumbnail = document.getElementById('loading-background-image');
  const iconShell = document.getElementById('loading-icon-shell');
  const icon = document.getElementById('loading-experience-icon');
  const title = document.getElementById('loading-experience-title');
  const creator = document.getElementById('loading-experience-creator');
  const badge = document.getElementById('loading-verified-badge');
  const status = document.getElementById('status');
  const cancel = document.getElementById('loading-cancel');
  const mobile = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const reduced = !launch && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const div = (className, ...children) => {
    const node = document.createElement('div');
    node.className = className;
    node.append(...children);
    return node;
  };

  const background = div('lc-background', thumbnail);
  const infoBackground = div('lc-info-background');
  const placeBox = div('lc-place', title);
  const creatorBox = div('lc-creator', creator, badge);
  const textLayout = div('lc-text', placeBox, creatorBox);
  const shimmer = div('lc-shimmer');
  iconShell.prepend(shimmer);
  const info = div('lc-info', infoBackground, iconShell, textLayout);
  const server = div('lc-server', status);
  const close = div('lc-close', cancel);
  const content = div('lc-content', info, server, close);
  if (reduced) content.append(div('lc-spinner'));
  const root = div('', background, div('lc-gradient'), content);
  root.id = 'loader-client';
  root.classList.add(launch ? 'lc-launch' : 'lc-current');
  root.classList.toggle('lc-mobile', mobile);
  overlay.after(root);

  const placeSize = () => (mobile ? 20 : 36);
  const creatorSize = () => 20;

  const setTextSize = (node, size) => {
    node.style.fontSize = `${size / FONT_METRIC}px`;
    node.style.lineHeight = `${size}px`;
  };

  const fitText = (node, box, min, max) => {
    if (!node.textContent.trim()) return;
    const available = box.clientHeight;
    for (let size = max; size >= min; size--) {
      setTextSize(node, size);
      if (node.offsetHeight <= available) return;
    }
  };

  const iconSize = () => {
    if (launch) return ICON_LAUNCH;
    const scaled = (Math.max(innerWidth, innerHeight) / ICON_BREAKPOINT) * ICON_MIN;
    return Math.min(ICON_MAX, Math.max(ICON_MIN, scaled));
  };

  const hasContent = () => {
    const name = title.textContent.trim();
    return Boolean(name) && name !== PLACEHOLDER_TITLE;
  };

  let panning = null;
  let exiting = false;
  let enterDone = false;
  let exitQueued = false;
  let timers = [];
  let closeTimer = 0;

  const later = (ms, run) => timers.push(setTimeout(run, ms));

  const layoutThumbnail = () => {
    let width = innerWidth * THUMBNAIL_WIDTH_RATIO;
    let height = (width / THUMBNAIL_WIDTH) * THUMBNAIL_HEIGHT;
    const scaleByHeight = launch
      ? width < THUMBNAIL_WIDTH && innerHeight > THUMBNAIL_HEIGHT
      : innerHeight > height;
    if (scaleByHeight) {
      width = (innerHeight / THUMBNAIL_HEIGHT) * THUMBNAIL_WIDTH;
      height = innerHeight;
    }
    thumbnail.style.width = `${width}px`;
    thumbnail.style.height = `${height}px`;
    panning?.cancel();
    panning = null;
    const reach = Math.abs(width / innerWidth / 2 - 0.5);
    if (reduced || !reach) return;
    const travel = reach * innerWidth;
    panning = thumbnail.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: `translateX(${travel}px)`, offset: 0.25 },
        { transform: `translateX(${-travel}px)`, offset: 0.75 },
        { transform: 'translateX(0)', offset: 1 },
      ],
      { duration: ((reach * 4) / THUMBNAIL_SPEED) * 1000, iterations: Infinity },
    );
  };

  const layout = () => {
    root.classList.toggle('lc-ready', hasContent());
    const size = iconSize();
    iconShell.style.width = `${size}px`;
    iconShell.style.height = `${size}px`;
    textLayout.style.marginTop = `${size / 2}px`;
    if (launch) {
      fitText(title, placeBox, ...PLACE_SIZE_LAUNCH);
      fitText(creator, creatorBox, ...CREATOR_SIZE_LAUNCH);
      fitText(status, server, 8, 12);
    } else {
      setTextSize(title, placeSize());
      setTextSize(creator, creatorSize());
      setTextSize(status, 12);
    }
  };

  const run = (node, frames, startMs, durationMs) => node.animate(frames, {
    delay: startMs,
    duration: durationMs,
    easing: 'linear',
    fill: 'both',
  });

  const opacity = (node, from, to, startMs, durationMs) => run(node, [{ opacity: from }, { opacity: to }], startMs, durationMs);

  const sizeFrames = (from, to) => [
    { width: `${from}px`, height: `${from}px` },
    { width: `${to}px`, height: `${to}px` },
  ];

  const enter = () => {
    const size = iconSize();
    if (launch) {
      opacity(thumbnail.parentElement, 0, 1, 0, STEP_ICON_MS);
      opacity(icon, 0, 1, 0, STEP_ICON_MS);
      run(iconShell, sizeFrames(size * 0.5, size), 0, STEP_ICON_MS);
      opacity(placeBox, 0, 1, STEP_ICON_MS, STEP_TEXT_MS);
      opacity(creatorBox, 0, 1, STEP_ICON_MS + STEP_TEXT_MS, STEP_TEXT_MS);
      later(STEP_ICON_MS + STEP_TEXT_MS * 2, finishEnter);
      return;
    }
    opacity(thumbnail.parentElement, 0, 1, 0, FADE_MS);
    opacity(infoBackground, 0, 0.8, 0, FADE_MS);
    opacity(iconShell, 0, 1, 0, FADE_MS);
    opacity(placeBox, 0, 1, 0, FADE_MS);
    opacity(creatorBox, 0, 1, 0, FADE_MS);
    later(FADE_MS, finishEnter);
  };

  function finishEnter() {
    enterDone = true;
    if (exitQueued) leave();
  }

  function hide() {
    root.hidden = true;
    panning?.cancel();
    panning = null;
    clearTimeout(closeTimer);
  }

  function leave() {
    exitQueued = false;
    root.classList.add('lc-leaving');
    const size = iconSize();
    if (launch) {
      opacity(creatorBox, 1, 0, 0, STEP_EXIT_MS);
      opacity(placeBox, 1, 0, STEP_EXIT_MS, STEP_EXIT_MS);
      opacity(infoBackground, 0.2, 0, STEP_EXIT_MS, STEP_EXIT_MS);
      opacity(icon, 1, 0, STEP_EXIT_MS * 2, STEP_EXIT_MS);
      opacity(thumbnail.parentElement, 1, 0, STEP_EXIT_MS * 2, STEP_EXIT_MS);
      run(iconShell, sizeFrames(size, 0), STEP_EXIT_MS * 2, STEP_EXIT_MS);
      later(STEP_EXIT_MS * 3, hide);
      return;
    }
    opacity(thumbnail.parentElement, 1, 0, 0, FADE_MS);
    opacity(infoBackground, 0.8, 0, 0, FADE_MS);
    opacity(iconShell, 1, 0, 0, FADE_MS);
    opacity(placeBox, 1, 0, 0, FADE_MS);
    opacity(creatorBox, 1, 0, 0, FADE_MS);
    run(iconShell, sizeFrames(size, size * EXIT_SCALE), 0, FADE_MS);
    for (const [node, full] of [[title, placeSize()], [creator, creatorSize()]]) {
      run(node, [
        { fontSize: `${full / FONT_METRIC}px`, lineHeight: `${full}px` },
        { fontSize: `${(full * EXIT_SCALE) / FONT_METRIC}px`, lineHeight: `${full * EXIT_SCALE}px` },
      ], 0, FADE_MS);
    }
    later(FADE_MS, hide);
  }

  const start = () => {
    timers.forEach(clearTimeout);
    timers = [];
    root.getAnimations({ subtree: true }).forEach(animation => {
      if (!animation.animationName) animation.cancel();
    });
    root.hidden = false;
    root.classList.remove('lc-leaving');
    enterDone = false;
    exitQueued = false;
    layout();
    layoutThumbnail();
    enter();
  };

  const exit = () => {
    if (exiting) return;
    exiting = true;
    if (enterDone) leave();
    else exitQueued = true;
  };

  const watched = { childList: true, characterData: true, subtree: true };
  new MutationObserver(layout).observe(title, watched);
  new MutationObserver(layout).observe(status, watched);
  new MutationObserver(layout).observe(creator, { ...watched, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (overlay.classList.contains('loading-exiting')) exit();
    else if (exiting) {
      exiting = false;
      start();
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => {
    layout();
    layoutThumbnail();
  });

  document.fonts.load(`500 18px "${launch ? 'Gotham 2022' : 'Builder Sans'}"`).then(layout, layout);

  closeTimer = setTimeout(() => root.classList.add('lc-close-on'), CLOSE_DELAY_MS);
  start();
})();
