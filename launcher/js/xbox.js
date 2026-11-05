import { el, link, state, thumbnails } from './core.js';

const BASE = (self.__WB||'/')+'launcher/xbox/';
const SOUND_KEY = 'webblox.launcher.xbox.sound';
const MUSIC_VOLUME = 0.33;
const MUSIC_FADE = 1;
const MOVE_GAP_MS = 60;
const SELECTABLE = 'a, button, select, input, summary, label.theme-card';
const PURCHASE = /bought|purchased/i;
const PAGE_NAMES = { '': 'Home', '#/': 'Home', '#/charts': 'Charts', '#/avatar': 'Avatar', '#/marketplace': 'Marketplace', '#/chat': 'Chat', '#/friends': 'Friends', '#/communities': 'Communities', '#/settings': 'Settings' };

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const active = () => document.documentElement.dataset.theme === 'xbox';

let context = null;
let musicGain = null;
let musicSource = null;
let musicLoading = false;
let unlocked = false;
let lastSelection = null;
let lastMove = 0;
let previousHash = null;
const buffers = {};

function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function load(name) {
  buffers[name] ||= fetch(`${BASE}sounds/${name}`).then(response => response.arrayBuffer()).then(data => context.decodeAudioData(data));
  return buffers[name];
}

async function play(name) {
  if (!active() || !unlocked || !context || !soundEnabled() || document.hidden) return;
  try {
    const source = context.createBufferSource();
    source.buffer = await load(name);
    source.connect(context.destination);
    source.start();
  } catch (err) {
    console.warn('[launcher] sound failed:', name, err.message);
  }
}

async function syncMusic() {
  if (!context) return;
  const wanted = active() && soundEnabled();
  if (document.hidden || !active()) context.suspend().catch(() => {});
  else context.resume().catch(() => {});
  const gain = musicGain.gain;
  gain.cancelScheduledValues(context.currentTime);
  gain.setValueAtTime(gain.value, context.currentTime);
  gain.linearRampToValueAtTime(wanted ? MUSIC_VOLUME : 0, context.currentTime + (wanted ? MUSIC_FADE : 0.25));
  if (!wanted || musicSource || musicLoading) return;
  musicLoading = true;
  try {
    const buffer = await load('RobloxMusic.ogg');
    musicSource = context.createBufferSource();
    musicSource.buffer = buffer;
    musicSource.loop = true;
    musicSource.connect(musicGain);
    musicSource.start();
  } catch (err) {
    console.warn('[launcher] music failed:', err.message);
  }
  musicLoading = false;
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  context = new AudioContext();
  musicGain = context.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(context.destination);
  syncMusic();
}

function select(target) {
  const selection = target instanceof Element ? target.closest(SELECTABLE) : null;
  if (selection && lastSelection && selection !== lastSelection) {
    const now = performance.now();
    if (now - lastMove > MOVE_GAP_MS) {
      lastMove = now;
      play('MoveSelection.mp3');
    }
  }
  lastSelection = selection;
}

function watchSounds() {
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') select(event.target);
  });
  document.addEventListener('focusin', event => {
    if (event.target.matches?.(':focus-visible')) select(event.target);
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(SELECTABLE)) return;
    play(target.closest('#me button') ? 'SideMenuSlideIn.mp3' : 'ButtonPress.mp3');
  });
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function open() {
    play('OverlayOpen.mp3');
    return showModal.call(this);
  };
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.classList?.contains('bad')) play('Error.mp3');
        else play(PURCHASE.test(node.textContent) ? 'PurchaseSuccess.mp3' : 'PopUp.mp3');
      }
    }
  }).observe(document.getElementById('toasts'), { childList: true });
}

function mountSoundToggle() {
  const sound = el('button', 'xbox-sound');
  sound.type = 'button';
  const paint = () => {
    const on = soundEnabled();
    sound.textContent = on ? 'Sound on' : 'Sound off';
    sound.setAttribute('aria-pressed', String(on));
  };
  sound.addEventListener('click', () => {
    try {
      localStorage.setItem(SOUND_KEY, soundEnabled() ? 'off' : 'on');
    } catch {}
    paint();
    syncMusic();
  });
  paint();
  document.body.append(sound);
}

let backdrop = null;
let video = null;

function syncBackground() {
  const wanted = active() && !reduced.matches && !document.hidden;
  if (wanted && !video) {
    video = el('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';
    video.tabIndex = -1;
    video.setAttribute('aria-hidden', 'true');
    video.src = `${BASE}background.webm`;
    backdrop.append(video);
    video.play().catch(() => {});
  } else if (active() && wanted) {
    video.play().catch(() => {});
  } else if (video && !active()) {
    video.pause();
    video.remove();
    video = null;
  } else if (video) {
    video.pause();
  }
}

let profile = null;
let profileName = null;
let profileImage = null;
let profileFor = null;

export async function renderXboxProfile() {
  if (!profile || !state.me) return;
  profileName.textContent = state.me.name || '';
  if (!active() || profileFor === state.me.id) return;
  profileFor = state.me.id;
  try {
    const images = await thumbnails([{ key: 'me', request: { targetId: Number(state.me.id), type: 'Avatar', size: '420x420' } }]);
    if (images.me) profileImage.src = images.me;
  } catch (err) {
    profileFor = null;
    console.warn('[launcher] profile image failed:', err.message);
  }
}

function mountProfile() {
  profile = el('section', 'xbox-profile');
  profile.setAttribute('aria-label', 'Your avatar');
  profileName = el('h2', 'xbox-profile-name');
  const edit = link('xbox-profile-link', '#/avatar');
  edit.setAttribute('aria-label', 'Edit avatar');
  profileImage = el('img');
  profileImage.alt = '';
  edit.append(profileImage);
  profile.append(profileName, edit);
  document.getElementById('layout').prepend(profile);
}

function transition({ detail: { from, to } }) {
  if (!active() || from === null) return;
  if (from.startsWith('#/chat') && to.startsWith('#/chat')) return;
  play('ScreenChange.mp3');
  if (reduced.matches) return;
  document.getElementById('content').animate(
    [{ opacity: 0, transform: 'translateX(60px)' }, { opacity: 1, transform: 'none' }],
    { duration: 400, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
  );
}

export const previousPageName = () => PAGE_NAMES[previousHash] || 'Back';

export function mountXbox() {
  window.addEventListener('hashchange', event => {
    previousHash = new URL(event.oldURL).hash;
  });
  backdrop = el('div', 'xbox-bg');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.prepend(backdrop);
  mountSoundToggle();
  mountProfile();
  watchSounds();
  window.addEventListener('launcher-page', transition);
  const sync = () => {
    syncBackground();
    syncMusic();
    renderXboxProfile();
  };
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  sync();
}
