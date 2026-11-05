(() => {
  if (document.documentElement.dataset.loader !== '2020') return;

  const FONT_METRIC = 1.257;
  const MIN_TEXT_SIZE = 8;
  const MAX_TEXT_SIZE = 96;
  const TURN_MS = 2000;
  const TURN_SAMPLES = 120;
  const CLOSE_DELAY_MS = 5000;
  const CLOSE_FADE_MS = 1000 / 1.7;
  const EXIT_FADE_MS = 1000 / 1.8;
  const PLACEHOLDER_TITLE = 'Joining experience';

  const variant = document.documentElement.dataset.loaderVariant;
  const overlay = document.getElementById('loading-overlay');
  const thumbnail = document.getElementById('loading-background-image');
  const iconShell = document.getElementById('loading-icon-shell');
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

  const background = div('l20-background');
  const spinner = div('l20-spinner');
  const placeBox = div('l20-place', title);
  const creatorBox = div('l20-creator', creator);
  const messageBox = div('l20-message-line', status);
  const art = variant === 'icon' ? iconShell : div('l20-thumbnail', thumbnail);
  const info = div('l20-info', art, placeBox, creatorBox, div('l20-message', messageBox));
  const root = div('', background, info, div('l20-graphics', spinner), div('l20-close', cancel));
  root.id = 'loader-2020';
  overlay.after(root);

  const turn = progress => {
    if (progress < 0.5) return 4 * progress ** 3;
    return 1 - (2 - 2 * progress) ** 3 / 2;
  };

  const frames = [];
  for (let step = 0; step <= TURN_SAMPLES; step++) frames.push({ rotate: `${turn(step / TURN_SAMPLES) * 360}deg` });
  spinner.animate(frames, { duration: TURN_MS, iterations: Infinity }).currentTime = Date.now() % TURN_MS;

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

  const fitText = () => {
    root.classList.toggle('l20-ready', hasContent());
    scaleText(title, placeBox);
    scaleText(creator, creatorBox);
    scaleText(status, messageBox);
  };

  let closeTimer = 0;
  let closeFade = null;
  let hideTimer = 0;
  let fades = [];
  let exiting = false;

  const activateClose = () => cancel.classList.add('l20-active');

  const showClose = () => {
    clearTimeout(closeTimer);
    closeFade?.cancel();
    closeFade = null;
    cancel.style.opacity = '1';
    activateClose();
  };

  closeTimer = setTimeout(() => {
    closeFade = cancel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_FADE_MS, fill: 'forwards' });
    closeFade.onfinish = activateClose;
  }, CLOSE_DELAY_MS);

  const exit = () => {
    if (exiting) return;
    exiting = true;
    root.classList.add('l20-leaving');
    fades = [background, info, spinner.parentElement].map(node => node.animate([{ opacity: 1 }, { opacity: 0 }], {
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
    root.classList.remove('l20-leaving');
  };

  const watched = { childList: true, characterData: true, subtree: true };
  new MutationObserver(fitText).observe(title, watched);
  new MutationObserver(fitText).observe(status, watched);
  new MutationObserver(fitText).observe(creator, { ...watched, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (overlay.classList.contains('loading-failed')) showClose();
    if (overlay.classList.contains('loading-exiting')) exit();
    else if (exiting) restart();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', fitText);

  Promise.all([
    document.fonts.load('18px "Source Sans 2020"'),
    document.fonts.load(`${variant === 'white' ? 700 : 300} 18px "Source Sans 2020"`),
  ]).then(fitText, fitText);

  fitText();
})();
