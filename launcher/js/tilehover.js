import { button, el, icon, link, play, state } from './core.js';

const SPRING = 2 * Math.PI * 6.5;
const PANEL_PADDING = 8;
const EXPAND_SIDE = 0;
const EXPAND_TOP = 0;
const ACTION_ROW = 48;
const EDGE_GAP = 8;
const REST = 0.001;
const SWIPE_HOLD = 200;

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const panels = new Map();
let active = null;
let frame = 0;
let last = 0;

function place(entry) {
  const { card, panel, art, details, aspect } = entry;
  const box = card.querySelector('.art').getBoundingClientRect();
  const progress = Math.max(0, entry.value);
  const artWidth = box.width + EXPAND_SIDE * 2 * progress;
  const width = artWidth + PANEL_PADDING * 2;
  const left = Math.min(Math.max(EDGE_GAP, box.left - PANEL_PADDING - EXPAND_SIDE * progress), innerWidth - width - EDGE_GAP);
  const fill = Math.min(1, progress * 3);
  panel.style.left = `${left + scrollX}px`;
  panel.style.top = `${box.top + scrollY - PANEL_PADDING - EXPAND_TOP * progress}px`;
  panel.style.width = `${width}px`;
  panel.style.height = `${artWidth / aspect + details.offsetHeight + PANEL_PADDING * 2 + (entry.goal ? ACTION_ROW * progress : 0)}px`;
  panel.style.background = `color-mix(in srgb, var(--raised) ${fill * 100}%, transparent)`;
  art.style.width = `${artWidth}px`;
  art.style.height = `${artWidth / aspect}px`;
}

function remove(entry) {
  entry.panel.remove();
  entry.card.classList.remove('tile-hovered');
  panels.delete(entry.card);
}

function step(now) {
  frame = 0;
  const seconds = Math.min(Math.max(now - last, 0) / 1000, 0.1);
  last = now;
  for (const entry of [...panels.values()]) {
    if (!entry.card.isConnected) {
      remove(entry);
      continue;
    }
    const offset = entry.value - entry.goal;
    const drift = entry.velocity + SPRING * offset;
    const decay = Math.exp(-SPRING * seconds);
    entry.value = entry.goal + (offset + drift * seconds) * decay;
    entry.velocity = (drift - SPRING * (offset + drift * seconds)) * decay;
    if (reduced.matches || (Math.abs(entry.value - entry.goal) < REST && Math.abs(entry.velocity) < REST)) {
      entry.value = entry.goal;
      entry.velocity = 0;
    }
    if (entry.value !== 0 || entry.goal !== 0) place(entry);
    else if (now >= entry.swipeUntil) remove(entry);
    else {
      entry.panel.style.visibility = 'hidden';
      entry.card.classList.remove('tile-hovered');
    }
  }
  if ([...panels.values()].some(entry => entry.value !== entry.goal || entry.swipeUntil > now)) frame = requestAnimationFrame(step);
}

function animate() {
  if (frame) return;
  last = performance.now();
  frame = requestAnimationFrame(step);
}

function build(card) {
  const source = card.querySelector('.art');
  const universe = source.dataset.universe;
  const game = state.games[universe];
  const box = source.getBoundingClientRect();
  const panel = el('div', `tile-hover${card.closest('.continue-row') ? ' continue-row' : ''}`);
  const open = link('tile-hover-open', `#/game/${universe}`);
  const art = el('span', 'tile-hover-art');
  const picture = el('img');
  picture.alt = '';
  picture.decoding = 'sync';
  picture.src = source.querySelector('img')?.src || '';
  art.append(picture);
  const details = el('span', 'tile-hover-details');
  details.append(...['.card-name', '.card-meta'].map(part => card.querySelector(part)).filter(Boolean).map(part => part.cloneNode(true)));
  open.append(art, details);
  open.addEventListener('click', clear);
  panel.append(open);
  if (game?.rootPlaceId) {
    const start = button('tile-hover-play');
    start.setAttribute('aria-label', `Play ${game.name || 'game'}`);
    start.append(icon('play-large', true));
    start.addEventListener('click', () => play(game.rootPlaceId));
    panel.append(start);
  }
  document.body.append(panel);
  card.classList.add('tile-hovered');
  const entry = { card, panel, art, details, aspect: box.width / box.height, value: 0, velocity: 0, goal: 0, swipeUntil: 0 };
  panel.addEventListener('wheel', event => {
    const row = card.closest('.row');
    if (!row || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    row.scrollLeft += event.deltaX;
    entry.swipeUntil = performance.now() + SWIPE_HOLD;
    animate();
  }, { passive: false });
  panels.set(card, entry);
  place(entry);
  return entry;
}

function setActive(card) {
  if (active === card) return;
  if (active && panels.has(active)) {
    const leaving = panels.get(active);
    leaving.goal = 0;
    leaving.panel.classList.add('tile-leaving');
  }
  active = card;
  if (card) {
    const entry = panels.get(card) || build(card);
    entry.goal = 1;
    entry.panel.classList.remove('tile-leaving');
    entry.panel.style.visibility = '';
    card.classList.add('tile-hovered');
  }
  animate();
}

function clear() {
  active = null;
  [...panels.values()].forEach(remove);
}

export function mountTileHover() {
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.tile-hover')) return;
    const card = target?.closest('.card');
    const usable = card?.querySelector('.art') && innerWidth > 640 && document.documentElement.dataset.theme !== 'xbox';
    setActive(usable ? card : null);
  });
  document.documentElement.addEventListener('pointerleave', () => setActive(null));
  window.addEventListener('scroll', event => {
    if (event.target !== document) setActive(null);
  }, { capture: true, passive: true });
  window.addEventListener('resize', clear);
  window.addEventListener('hashchange', clear);
  window.addEventListener('blur', () => setActive(null));
}
