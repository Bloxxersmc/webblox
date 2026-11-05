(() => {
  if (document.documentElement.dataset.loader !== '2014') return;

  const FONT_METRIC = 1.257;
  const VALID_TEXT_SIZES = [12, 14, 18, 24, 36, 48];
  const STAT_NAMES = ['Instances', 'Bricks', 'Connectors', 'Voxels'];
  const FORCE_REMOVAL_MS = 5000;
  const BACKGROUND_PAN_MS = 20000;
  const BLOCK_SIZE = 10;
  const BLOCK_Y = -BLOCK_SIZE * 3.5;
  const TWEEN_VELOCITY = 1500;
  const WAIT_MS = 33;
  const PLACEHOLDER_TITLE = 'Joining experience';

  const overlay = document.getElementById('loading-overlay');
  const thumbnailImage = document.getElementById('loading-background-image');
  const title = document.getElementById('loading-experience-title');
  const creator = document.getElementById('loading-experience-creator');
  const cancel = document.getElementById('loading-cancel');

  const div = (className, ...children) => {
    const node = document.createElement('div');
    node.className = className;
    node.append(...children);
    return node;
  };
  const label = (className, text) => {
    const node = div(className);
    node.textContent = text;
    return node;
  };

  const background = div('l14-background');
  const onYourWay = label('l14-text l14-regular', "You're on your way to");
  const prefix = label('l14-text l14-regular', 'By');
  const textContainer = div('l14-text-container', onYourWay, title, creator, prefix);
  const bottomActual = div('l14-bottom-actual', textContainer);
  const bottomBar = div('l14-bottom', bottomActual);
  const stats = div('l14-stats', ...STAT_NAMES.map(name => div('l14-stat', label('l14-stat-label', name), label('l14-stat-value', '0'))));
  const thumbnail = div('l14-thumbnail', div('l14-thumbnail-image', thumbnailImage), stats);
  const root = div(
    '',
    background,
    div('l14-vignette'),
    div('l14-top', div('l14-logo', label('l14-powered', 'Powered By'))),
    bottomBar,
    thumbnail,
    div('l14-close', cancel),
  );
  root.id = 'loader-2014';
  title.classList.add('l14-text', 'l14-bold');
  creator.classList.add('l14-text', 'l14-bold');
  overlay.after(root);

  const setTextSize = (node, size) => {
    node.style.fontSize = `${(size + 1) / FONT_METRIC}px`;
    node.style.lineHeight = `${size}px`;
  };

  const hasContent = () => {
    const name = title.textContent.trim();
    return Boolean(name) && name !== PLACEHOLDER_TITLE;
  };

  const recalculateTextSize = () => {
    const scale = Math.min(innerHeight / 800, 1);
    const index = Math.floor(scale * VALID_TEXT_SIZES.length) - 1;
    const previousIndex = index - 1;
    const size = index > 0 ? VALID_TEXT_SIZES[index] : VALID_TEXT_SIZES[0];
    const previousSize = index > 0 && previousIndex > 0 ? VALID_TEXT_SIZES[previousIndex] : VALID_TEXT_SIZES[0];
    setTextSize(onYourWay, previousSize);
    setTextSize(title, size);
    setTextSize(creator, size);
    setTextSize(prefix, size);
    let y = previousSize * (40 / 48);
    title.style.top = `${y}px`;
    y += size * (40 / 48);
    creator.style.top = `${y}px`;
    prefix.style.top = `${y}px`;
    prefix.style.right = `${creator.offsetWidth + 5}px`;
    const sizeScale = size / 48;
    bottomBar.style.height = `${300 * sizeScale}px`;
    bottomBar.style.top = `${innerHeight - 150 * sizeScale}px`;
    bottomActual.style.left = `${-130 * sizeScale}px`;
  };

  const recalculateSizes = () => {
    const scale = Math.min(Math.max(innerHeight / 630, 50 / 230), 1);
    const width = scale * 420;
    const height = scale * 230;
    thumbnail.style.width = `${width}px`;
    thumbnail.style.height = `${height}px`;
    thumbnail.style.left = `calc(50% - ${width / 2}px)`;
    thumbnail.style.top = `calc(50% - ${20 + height / 2}px)`;
    stats.hidden = innerHeight <= 500;
    root.classList.toggle('l14-ready', hasContent());
    recalculateTextSize();
  };

  const easings = {
    out: t => Math.sin((t * Math.PI) / 2),
    inOut: t => -(Math.cos(Math.PI * t) - 1) / 2,
  };

  const createBlock = () => {
    const node = div('l14-block');
    bottomBar.append(node);
    return {
      node,
      size: BLOCK_SIZE,
      position: { scale: 0, offset: -BLOCK_SIZE, y: BLOCK_Y },
      sizeTween: null,
      positionTween: null,
    };
  };
  const blocks = Array.from({ length: 6 }, createBlock);
  const tweenTime = () => innerWidth / 2 / TWEEN_VELOCITY;

  const tweenPosition = (block, scale, offset, y, easing, seconds, done) => {
    block.positionTween = {
      from: { ...block.position },
      to: { scale, offset, y },
      easing,
      start: performance.now(),
      duration: seconds * 1000,
      done,
    };
  };

  const tweenSizeAndPosition = (block, size, scale, offset, y, easing, seconds) => {
    tweenPosition(block, scale, offset, y, easing, seconds);
    block.sizeTween = { from: block.size, to: size, easing, start: performance.now(), duration: seconds * 1000 };
  };

  const yOffset = size => BLOCK_Y - size / 3;
  const mix = (from, to, t) => from + (to - from) * t;

  const stepBlocks = now => {
    for (const block of blocks) {
      if (block.positionTween) {
        const tween = block.positionTween;
        const elapsed = Math.min(1, (now - tween.start) / tween.duration);
        const t = easings[tween.easing](Math.max(0, elapsed));
        block.position = {
          scale: mix(tween.from.scale, tween.to.scale, t),
          offset: mix(tween.from.offset, tween.to.offset, t),
          y: mix(tween.from.y, tween.to.y, t),
        };
        if (elapsed >= 1) {
          block.positionTween = null;
          tween.done?.();
        }
      }
      if (block.sizeTween) {
        const tween = block.sizeTween;
        const elapsed = Math.min(1, (now - tween.start) / tween.duration);
        block.size = mix(tween.from, tween.to, easings[tween.easing](Math.max(0, elapsed)));
        if (elapsed >= 1) block.sizeTween = null;
      }
      block.node.style.width = `${block.size}px`;
      block.node.style.height = `${block.size}px`;
      block.node.style.transform = `translate(${block.position.scale * innerWidth + block.position.offset}px, ${block.position.y}px)`;
    }
  };

  let timers = [];
  let frame = 0;
  let exitTimer = 0;
  let pan = null;
  let exiting = false;

  const later = (seconds, run) => timers.push(setTimeout(run, seconds * 1000));

  function rightScreenExit() {
    const time = tweenTime();
    later(time * 3, () => {
      const size = blocks[5].size;
      const position = blocks[5].position;
      blocks[5].size = blocks[0].size;
      blocks[5].position = blocks[0].position;
      blocks[0].size = size;
      blocks[0].position = position;
      timers.push(setTimeout(() => {
        for (let i = 1; i <= 6; i++) {
          later(time * (i - 1) * 0.5, () => {
            tweenPosition(blocks[i - 1], 1, 0, BLOCK_Y, 'out', time);
            if (i === 6) {
              tweenSizeAndPosition(blocks[5], BLOCK_SIZE, 1, 0, BLOCK_Y, 'inOut', time);
              later(time * 1.1, leftScreenEntrance);
            } else {
              const size = BLOCK_SIZE * (4 - i * 0.5);
              tweenSizeAndPosition(blocks[5], size, 0.5, -size / 2, yOffset(size), 'inOut', time * 0.75);
            }
          });
        }
      }, WAIT_MS));
    });
  }

  function leftScreenEntrance() {
    const time = tweenTime();
    for (const block of blocks) {
      block.size = BLOCK_SIZE;
      block.position = { scale: 0, offset: -BLOCK_SIZE, y: BLOCK_Y };
      block.sizeTween = null;
      block.positionTween = null;
    }
    tweenPosition(blocks[0], 0.5, -BLOCK_SIZE / 2, BLOCK_Y, 'out', time, () => {
      for (let i = 1; i <= 6; i++) {
        later(time * (i - 1) * 0.5, () => {
          tweenPosition(blocks[i - 1], 0.5, -BLOCK_SIZE / 2, BLOCK_Y, 'out', time);
          const size = BLOCK_SIZE * (1 + i * 0.5);
          tweenSizeAndPosition(blocks[0], size, 0.5, -size / 2, yOffset(size), 'inOut', time * 0.75);
          if (i === 4) rightScreenExit();
        });
      }
    });
  }

  const tick = now => {
    stepBlocks(now);
    frame = requestAnimationFrame(tick);
  };

  const start = () => {
    root.hidden = false;
    pan?.cancel();
    pan = background.animate([{ transform: 'translateX(-33.3333%)' }, { transform: 'translateX(0)' }], {
      duration: BACKGROUND_PAN_MS,
      fill: 'forwards',
    });
    timers.forEach(clearTimeout);
    timers = [];
    leftScreenEntrance();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  };

  const remove = () => {
    root.hidden = true;
    pan?.cancel();
    pan = null;
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(frame);
  };

  new MutationObserver(recalculateSizes).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(recalculateSizes).observe(creator, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (overlay.classList.contains('loading-exiting')) {
      if (exiting) return;
      exiting = true;
      exitTimer = setTimeout(remove, FORCE_REMOVAL_MS);
    } else if (exiting) {
      exiting = false;
      clearTimeout(exitTimer);
      if (root.hidden) {
        start();
        recalculateSizes();
      }
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', recalculateSizes);

  Promise.all([
    document.fonts.load('18px "Source Sans 2014"'),
    document.fonts.load('700 18px "Source Sans 2014"'),
  ]).then(recalculateSizes, recalculateSizes);

  recalculateSizes();
  start();
})();
