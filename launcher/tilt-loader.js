(() => {
  if (document.documentElement.dataset.loader !== 'tilt') return;

  const pioneer = document.documentElement.dataset.loaderVariant === 'pioneer';

  const ART_DURATION = 1;
  const TEXT_DURATION = 0.8;
  const ART_DELAY = 0.3;
  const TITLE_DELAY = 0.1;
  const CASCADE = 0.6;
  const CLOSE_DURATION = 0.5;
  const ENTER_EXIT_HOLD = 1;
  const SETTLE = 0.1;
  const WOBBLE_ANGLE = 2.5;
  const WOBBLE_SPEED = 1;
  const WOBBLE_RATE = 0.28;
  const WOBBLE_PHASE = 0.9;
  const WOBBLE_GAIN = 1.4;
  const TILT_DEGREES = 15;
  const SLIDE = 8;
  const CREATOR_OPACITY = 0.6;
  const CLIP_UNTIL = 0.999;
  const SAMPLES_PER_SECOND = 60;
  const WOBBLE_SAMPLES = 180;
  const PLACEHOLDER_TITLE = 'Joining experience';
  const X_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7.29289 8.70711C6.90237 8.31658 6.90237 7.68342 7.29289 7.29289C7.68342 6.90237 8.31658 6.90237 8.70711 7.29289L16 14.5858L23.2929 7.29289C23.6834 6.90237 24.3166 6.90237 24.7071 7.29289C25.0976 7.68342 25.0976 8.31658 24.7071 8.70711L17.4142 16L24.7071 23.2929C25.0976 23.6834 25.0976 24.3166 24.7071 24.7071C24.3166 25.0976 23.6834 25.0976 23.2929 24.7071L16 17.4142L8.70711 24.7071C8.31658 25.0976 7.68342 25.0976 7.29289 24.7071C6.90237 24.3166 6.90237 23.6834 7.29289 23.2929L14.5858 16L7.29289 8.70711Z"/></svg>';
  const VERIFIED_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="10" width="14" height="12" fill="#f7f7f8"/><path fill="#335fff" fill-rule="evenodd" clip-rule="evenodd" d="M7.71886 4.48055C8.00425 3.41563 9.09923 2.78321 10.1642 3.06844L27.5196 7.71883C28.5846 8.00419 29.217 9.09915 28.9317 10.1641L24.2814 27.5196C23.996 28.5846 22.9011 29.217 21.836 28.9317L4.48058 24.2813C3.41565 23.9959 2.78315 22.901 3.06847 21.836L7.71886 4.48055ZM22.0607 11.9395C21.4749 11.3539 20.5253 11.3538 19.9396 11.9395L14.0001 17.879L12.0607 15.9395C11.4749 15.3539 10.5253 15.3538 9.93956 15.9395C9.35381 16.5253 9.35389 17.4748 9.93956 18.0606L12.9396 21.0606C13.5254 21.6463 14.4749 21.6464 15.0607 21.0606L22.0607 14.0606C22.6464 13.4749 22.6463 12.5253 22.0607 11.9395Z"/></svg>';

  const overlay = document.getElementById('loading-overlay');
  const iconShell = document.getElementById('loading-icon-shell');
  const title = document.getElementById('loading-experience-title');
  const creator = document.getElementById('loading-experience-creator');
  const badge = document.getElementById('loading-verified-badge');
  const status = document.getElementById('status');
  const cancel = document.getElementById('loading-cancel');

  const div = (className, ...children) => {
    const node = document.createElement('div');
    node.className = className;
    node.append(...children);
    return node;
  };

  const frame = div('tilt-frame');
  const cover = div('tilt-cover');
  const card = div('tilt-card', iconShell, cover);
  const subRow = div('tilt-sub-row', creator, badge);
  const titleWrap = div('tilt-title-wrap', title);
  const subWrap = div('tilt-sub-wrap', subRow);
  const safe = div(
    'tilt-safe tilt-unsettled',
    div(
      'tilt-layout',
      div('tilt-slot', div('tilt-lockup', div('tilt-keyart', frame, card), div('tilt-text', titleWrap, subWrap))),
      div('tilt-status', status),
      div('tilt-progress', div('tilt-track', div('tilt-shimmer'))),
    ),
    div('tilt-cancel', cancel),
  );
  const root = div('', div('tilt-overlay'), safe);
  root.id = 'tilt-loading';
  iconShell.prepend(div('tilt-skeleton'));
  if (pioneer) {
    root.classList.add('tilt-pioneer');
    const poweredBy = div('tilt-powered');
    poweredBy.textContent = 'Powered by';
    status.parentElement.append(div('tilt-footer', poweredBy, div('tilt-wordmark')));
    cancel.hidden = true;
  }
  cancel.innerHTML = X_ICON;
  badge.innerHTML = VERIFIED_ICON;
  overlay.after(root);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.min(1, Math.max(0, value));

  const curve = (x1, y1, x2, y2) => {
    const axis = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return x => {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (axis(x1, x2, mid) < x) low = mid;
        else high = mid;
      }
      return axis(y1, y2, (low + high) / 2);
    };
  };
  const ease = curve(0.2, 0, 0, 1);

  let mountedAt = 0;
  let frozenAt = null;
  const elapsed = now => (Math.min(now, frozenAt ?? now) - mountedAt) / 1000;
  const wobble = seconds => (reduced.matches
    ? 0
    : Math.sin(seconds * WOBBLE_SPEED * 2 * Math.PI * WOBBLE_RATE + WOBBLE_PHASE) * WOBBLE_ANGLE * WOBBLE_GAIN);
  const frameAngle = (reveal, seconds) => -TILT_DEGREES * reveal + wobble(seconds) * clamp(reveal);
  const artScale = reveal => Math.min(1, clamp(reveal) * 0.5 + 0.5);
  const slide = reveal => `0 ${(1 - clamp(reveal)) * SLIDE}px`;

  const tracks = {
    keyart: [
      [card, reveal => ({ rotate: `${TILT_DEGREES * clamp(reveal)}deg`, scale: artScale(reveal) })],
      [cover, reveal => ({ opacity: 1 - clamp(reveal) })],
    ],
    frame: [
      [frame, (reveal, seconds) => ({
        rotate: `${frameAngle(reveal, seconds)}deg`,
        scale: artScale(reveal),
        opacity: 1 - Math.min(1, (1 - clamp(reveal)) * 2),
      })],
    ],
    title: [[title, reveal => ({ opacity: clamp(reveal), translate: slide(reveal) })]],
    creator: [
      [subRow, reveal => ({ translate: slide(reveal) })],
      [creator, reveal => ({ opacity: clamp(reveal) * CREATOR_OPACITY })],
      [badge, reveal => ({ opacity: clamp(reveal) })],
    ],
  };
  const clips = { title: titleWrap, creator: subWrap };
  const channels = {};
  let timers = [];
  let rootFade = null;
  let settled = false;
  let settleTimer = 0;
  let cascaded = false;
  let titleStarted = false;
  let creatorStarted = false;
  let enterFired = false;
  let gateOpen = false;
  let dismissPending = false;
  let closing = false;

  const later = (seconds, run) => timers.push(setTimeout(run, seconds * 1000));

  const channelValue = (channel, now) => {
    if (!channel.seconds) return channel.to;
    return channel.from + (channel.to - channel.from) * ease(clamp((now - channel.start) / (channel.seconds * 1000)));
  };

  const stopChannel = channel => {
    channel.animations.forEach(animation => animation.cancel());
    channel.animations = [];
    clearTimeout(channel.unclip);
  };

  const tween = (name, to, seconds) => {
    const now = performance.now();
    const channel = channels[name];
    const from = channelValue(channel, now);
    stopChannel(channel);
    Object.assign(channel, { from, to, start: now, seconds });
    const duration = seconds * 1000;
    const steps = Math.max(2, Math.ceil(seconds * SAMPLES_PER_SECOND));
    for (const [node, paint] of tracks[name]) {
      const keyframes = [];
      for (let step = 0; step <= steps; step++) {
        const progress = step / steps;
        keyframes.push(paint(from + (to - from) * ease(progress), elapsed(now + duration * progress)));
      }
      channel.animations.push(node.animate(keyframes, { duration, fill: 'forwards' }));
    }
    const clip = clips[name];
    if (clip) {
      clip.classList.toggle('tilt-clip', to < CLIP_UNTIL || from < CLIP_UNTIL);
      if (to >= CLIP_UNTIL) channel.unclip = setTimeout(() => clip.classList.remove('tilt-clip'), duration);
    }
    if (name === 'frame' && to === 1 && !reduced.matches && frozenAt === null) {
      const period = 1000 / (WOBBLE_RATE * WOBBLE_SPEED);
      const startsAt = elapsed(now) + seconds;
      const keyframes = [];
      for (let step = 0; step <= WOBBLE_SAMPLES; step++) {
        keyframes.push({ rotate: `${frameAngle(1, startsAt + (step / WOBBLE_SAMPLES) * period / 1000)}deg` });
      }
      channel.animations.push(frame.animate(keyframes, { delay: duration, duration: period, iterations: Infinity }));
    }
  };

  const hasContent = () => {
    const name = title.textContent.trim();
    return Boolean(name) && name !== PLACEHOLDER_TITLE;
  };

  const syncContent = () => {
    root.classList.toggle('tilt-ready', hasContent());
    if (settled && cascaded) startTitle();
  };

  const releaseDismiss = () => {
    gateOpen = true;
    if (dismissPending) doDismiss();
  };

  const fireEnterComplete = () => {
    if (enterFired) return;
    enterFired = true;
    if (reduced.matches) releaseDismiss();
    else later(ENTER_EXIT_HOLD, releaseDismiss);
  };

  function startCreator() {
    if (creatorStarted || closing) return;
    creatorStarted = true;
    tween('creator', 1, TEXT_DURATION);
    later(TEXT_DURATION, fireEnterComplete);
  }

  function startTitle() {
    if (titleStarted || closing || !settled || !hasContent()) return;
    titleStarted = true;
    tween('title', 1, TEXT_DURATION);
    later(TITLE_DELAY, startCreator);
  }

  function hide() {
    rootFade?.cancel();
    rootFade = null;
    root.hidden = true;
  }

  function doDismiss() {
    if (closing) return;
    closing = true;
    timers.forEach(clearTimeout);
    timers = [];
    frozenAt = performance.now();
    root.classList.add('tilt-leaving');
    const fade = () => {
      const steps = Math.ceil(CLOSE_DURATION * SAMPLES_PER_SECOND);
      const keyframes = [];
      for (let step = 0; step <= steps; step++) keyframes.push({ opacity: 1 - ease(step / steps) });
      rootFade = root.animate(keyframes, { duration: CLOSE_DURATION * 1000, fill: 'forwards' });
      later(CLOSE_DURATION, hide);
    };
    if (reduced.matches) {
      Object.keys(channels).forEach(name => tween(name, 0, 0));
      fade();
    } else {
      Object.keys(channels).forEach(name => tween(name, 0, CLOSE_DURATION));
      later(CLOSE_DURATION, fade);
    }
  }

  const requestDismiss = () => {
    if (closing || dismissPending) return;
    if (reduced.matches || gateOpen) doDismiss();
    else dismissPending = true;
  };

  const start = () => {
    timers.forEach(clearTimeout);
    timers = [];
    rootFade?.cancel();
    rootFade = null;
    root.hidden = false;
    root.classList.remove('tilt-leaving');
    for (const name of Object.keys(tracks)) {
      if (channels[name]) stopChannel(channels[name]);
      channels[name] = { from: 0, to: 0, start: 0, seconds: 0, animations: [], unclip: 0 };
    }
    mountedAt = performance.now();
    frozenAt = null;
    cascaded = false;
    titleStarted = false;
    creatorStarted = false;
    enterFired = false;
    gateOpen = false;
    dismissPending = false;
    closing = false;
    syncContent();
    if (reduced.matches) {
      cascaded = true;
      titleStarted = true;
      creatorStarted = true;
      Object.keys(tracks).forEach(name => tween(name, 1, 0));
      fireEnterComplete();
      return;
    }
    tween('keyart', 1, ART_DURATION);
    later(ART_DELAY, () => tween('frame', 1, ART_DURATION));
    later(CASCADE, () => {
      cascaded = true;
      startTitle();
    });
    later(ART_DURATION, () => {
      if (!titleStarted) fireEnterComplete();
    });
  };

  const settle = () => {
    settled = false;
    safe.classList.add('tilt-unsettled');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settled = true;
      safe.classList.remove('tilt-unsettled');
      syncContent();
    }, SETTLE * 1000);
  };

  new MutationObserver(syncContent).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => {
    if (overlay.classList.contains('loading-exiting')) requestDismiss();
    else if (closing || dismissPending) start();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', settle);

  settle();
  start();
})();
