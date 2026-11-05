import { ICONS } from './icons.js';

export const state = { me: null, home: null, charts: null, art: {}, icons: {}, games: {}, counts: {}, faces: {}, names: {}, friends: [] };
export const sessionId = crypto.randomUUID();

const pageParams = new URLSearchParams(location.search);
export const wispMode = window.WEBLOX_MODE === 'wisp';
export const withMode = path => {
  const url = new URL(path, 'https://webblox.invalid');      // location.origin is "null" in a file
  for (const name of ['mode', 'wisp', 'flagset']) if (pageParams.has(name)) url.searchParams.set(name, pageParams.get(name));
  return url.pathname + url.search;
};
export const forgetWispSession = () => {
  try {
    localStorage.removeItem('cobalt-cookies');
  } catch {}
  location.replace(location.pathname + location.search);
};

export const ROBLOX_LAUNCHER = withMode('/?launcher=roblox');
const JOIN_COOKIE = 'launcher_join';
const IMAGE_CHUNK = 100;

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export const icon = (name, filled = false) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 32 32');
  node.setAttribute('fill', 'currentColor');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = ICONS[`${filled ? 'filled' : 'regular'}-${name}`] || ICONS[`regular-${name}`] || ICONS[`filled-${name}`];
  return node;
};
export const image = (src, alt = '', lazy = false) => {
  const node = el('img');
  node.alt = alt;
  node.decoding = 'async';
  if (lazy) node.loading = 'lazy';
  if (src) node.src = src;
  return node;
};
export const button = (className, text) => {
  const node = el('button', className, text);
  node.type = 'button';
  return node;
};
export const link = (className, href, text) => {
  const node = el('a', className, text);
  node.href = href;
  return node;
};
export const compact = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
export const longDate = value => new Date(value).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
export const timeAgo = value => {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return longDate(value);
};
export const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
export const robloxUrl = path => `https://www.roblox.com${path}`;

async function call(url, method, body, csrf, extra) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-TOKEN'] = csrf;
  return fetch(`/__proxy__/${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const TWO_STEP = 'https://twostepverification.roblox.com/v1/users';
const TWO_STEP_MEDIA = { Email: 'email', 0: 'email', SMS: 'sms', 1: 'sms', Authenticator: 'authenticator', 2: 'authenticator' };
const TWO_STEP_PROMPTS = {
  authenticator: 'Enter the 6-digit code from your authenticator app.',
  email: 'Roblox emailed you a 6-digit code. Enter it here.',
  sms: 'Roblox texted you a 6-digit code. Enter it here.',
};

function codeDialog(text, check) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'dialog');
    const form = el('form', 'code-form');
    const field = el('input', 'filter-search');
    field.inputMode = 'numeric';
    field.autocomplete = 'one-time-code';
    field.maxLength = 8;
    field.placeholder = 'Code';
    field.setAttribute('aria-label', 'Verification code');
    const problem = el('p', 'reason');
    problem.hidden = true;
    const cancel = button('more', 'Cancel');
    const accept = button('play', 'Verify');
    accept.type = 'submit';
    const row = el('div', 'dialog-actions');
    row.append(cancel, accept);
    form.append(field, problem, row);
    dialog.append(el('h2', '', '2-step verification'), el('p', '', text), form);
    const finish = value => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const code = field.value.replace(/\s/g, '');
      if (!code) return;
      accept.disabled = true;
      try {
        finish(await check(code));
      } catch (err) {
        problem.textContent = err.message || "That code didn't work.";
        problem.hidden = false;
        accept.disabled = false;
        field.select();
      }
    });
    document.body.append(dialog);
    dialog.showModal();
    field.focus();
  });
}

async function solveTwoStep(headers) {
  const challengeId = headers.get('rblx-challenge-id');
  const meta = JSON.parse(atob(headers.get('rblx-challenge-metadata')));
  const userId = meta.userId || state.me?.id;
  const actionType = meta.actionType || 'Generic';
  const config = await api(`${TWO_STEP}/${userId}/configuration?challengeId=${meta.challengeId}&actionType=${actionType}`).catch(() => ({}));
  const enabled = (config.methods || []).filter(m => m.enabled).map(m => TWO_STEP_MEDIA[m.mediaType]);
  const media = TWO_STEP_MEDIA[config.primaryMediaType] || enabled.find(Boolean);
  if (!media) throw new Error('Roblox asked for a verification method WebBlox does not support. Finish this on roblox.com.');
  if (media !== 'authenticator') await api(`${TWO_STEP}/${userId}/challenges/${media}/send-code`, { challengeId: meta.challengeId, actionType });
  const answer = await codeDialog(TWO_STEP_PROMPTS[media], async code => {
    const { verificationToken } = await api(`${TWO_STEP}/${userId}/challenges/${media}/verify`, { challengeId: meta.challengeId, actionType, code });
    return JSON.stringify({ verificationToken, rememberDevice: false, challengeId: meta.challengeId, actionType });
  });
  if (!answer) throw new Error('Verification was cancelled.');
  await api('https://apis.roblox.com/challenge/v1/continue', { challengeId, challengeType: 'twostepverification', challengeMetadata: answer });
  return { 'rblx-challenge-id': challengeId, 'rblx-challenge-type': 'twostepverification', 'rblx-challenge-metadata': btoa(answer) };
}

export async function send(url, method, body) {
  let csrf;
  let res = await call(url, method, body);
  if (res.status === 403 && res.headers.get('x-csrf-token')) {
    csrf = res.headers.get('x-csrf-token');
    res = await call(url, method, body, csrf);
  }
  if (res.status === 403 && res.headers.get('rblx-challenge-type') === 'twostepverification' && res.headers.get('rblx-challenge-metadata')) {
    res = await call(url, method, body, csrf, await solveTwoStep(res.headers));
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).errors?.[0]?.message || '';
    } catch {}
    const error = new Error(detail || `${new URL(url).pathname} answered ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const api = (url, body) => send(url, body === undefined ? 'GET' : 'POST', body);

export async function thumbnails(requests) {
  const out = {};
  await Promise.all(chunks(requests, IMAGE_CHUNK).map(async group => {
    const body = group.map(r => ({ requestId: r.key, format: 'Webp', isCircular: false, ...r.request }));
    const { data } = await api('https://thumbnails.roblox.com/v1/batch', body);
    for (const item of data || []) if (item.imageUrl) out[item.requestId] = item.imageUrl;
  }));
  return out;
}

export async function faces(ids) {
  const needed = [...new Set(ids)].filter(id => id && !state.faces[id]);
  if (needed.length) Object.assign(state.faces, await thumbnails(needed.map(id => ({ key: String(id), request: { targetId: Number(id), type: 'AvatarHeadShot', size: '150x150', includeProfileFrame: true } }))).catch(() => ({})));
  return state.faces;
}

export async function userNames(ids) {
  const needed = [...new Set(ids)].filter(id => id && !state.names[id]);
  await Promise.all(chunks(needed, 100).map(async group => {
    const { data } = await api('https://users.roblox.com/v1/users', { userIds: group.map(Number), excludeBannedUsers: false }).catch(() => ({}));
    for (const user of data || []) state.names[user.id] = { displayName: user.displayName, name: user.name, verified: user.hasVerifiedBadge };
  }));
  return state.names;
}

function wideAsset(game) {
  for (const layout of Object.values(game.layoutDataBySort || {})) {
    if (layout?.primaryMediaAsset?.wideImageAssetId) return layout.primaryMediaAsset.wideImageAssetId;
  }
  return game.primaryMediaAsset?.wideImageAssetId || null;
}

export async function gameArt(games) {
  const needed = games.filter(g => g && !state.art[g.universeId]);
  const wide = needed.filter(wideAsset);
  const plain = needed.filter(g => !wideAsset(g));
  const [assets, pages] = await Promise.all([
    thumbnails(wide.map(g => ({ key: String(g.universeId), request: { targetId: Number(wideAsset(g)), type: 'Asset', size: '768x432' } }))).catch(() => ({})),
    Promise.all(chunks(plain.map(g => g.universeId), 50).map(ids => api(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids.join(',')}&countPerUniverse=1&defaults=true&size=768x432&format=Webp&isCircular=false`).catch(() => ({ data: [] })))),
  ]);
  Object.assign(state.art, assets);
  for (const page of pages) {
    for (const item of page.data || []) {
      const url = item.thumbnails?.[0]?.imageUrl;
      if (url) state.art[item.universeId] = url;
    }
  }
  return state.art;
}

export function rememberGame(game) {
  if (game?.universeId) state.games[game.universeId] = { ...state.games[game.universeId], ...game };
}

export function leaveFor(url) {
  if (window.webbloxEmbed?.leave(url)) return;                // the single-file launcher's game frame
  document.body.append(el('div', 'leaving'));
  location.href = url;
}
export const play = placeId => leaveFor(withMode(`/?placeId=${placeId}`));
function joinWith(placeId, kind, value) {
  document.cookie = `${JOIN_COOKIE}=${placeId}:${kind}:${value}; Path=/; Max-Age=120; SameSite=Strict`;
  try { sessionStorage.setItem('webblox.launcherJoin', `${placeId}:${kind}:${value}:${Date.now()}`); } catch {}
  play(placeId);
}
export const joinServer = (placeId, serverId) => joinWith(placeId, 'g', serverId);
export const joinPrivate = (placeId, accessCode) => joinWith(placeId, 'p', accessCode);
export const clearJoin = () => {
  document.cookie = `${JOIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
  try { sessionStorage.removeItem('webblox.launcherJoin'); } catch {}
};

export function toast(text, bad = false) {
  const stack = document.getElementById('toasts');
  const item = el('div', `toast${bad ? ' bad' : ''}`, text);
  item.setAttribute('role', bad ? 'alert' : 'status');
  stack.append(item);
  if (stack.showPopover) {
    if (stack.matches(':popover-open')) stack.hidePopover();
    stack.showPopover();
  }
  setTimeout(() => item.remove(), 4200);
}

export const failed = (text, err) => {
  toast(err?.status === 403 || err?.message === undefined ? text : `${text} ${err.message}`, true);
  console.warn('[launcher]', text, err?.message);
};

export function confirmDialog(title, text, action, danger = false) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'dialog');
    const cancel = button('more', 'Cancel');
    const accept = button(danger ? 'danger' : 'play', action);
    const row = el('div', 'dialog-actions');
    row.append(cancel, accept);
    dialog.append(el('h2', '', title), el('p', '', text), row);
    const finish = value => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    accept.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

const rating = game => {
  const total = (game.totalUpVotes || 0) + (game.totalDownVotes || 0);
  return total ? `${Math.round((game.totalUpVotes / total) * 100)}%` : null;
};

function gameMeta(game) {
  const meta = el('span', 'card-meta');
  const stat = (name, value, label) => {
    const item = el('span', 'stat');
    item.setAttribute('aria-label', label);
    item.append(icon(name, true), value);
    meta.append(item);
  };
  if (rating(game)) stat('thumb-up', rating(game), `${rating(game)} rating`);
  if (game.playerCount !== undefined) stat('two-people', compact(game.playerCount), `${compact(game.playerCount)} playing`);
  return meta;
}

const HIDDEN_KEY = 'webblox.launcher.hidden';

export const hiddenGames = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []);
  } catch {
    return new Set();
  }
};

export function setGameHidden(id, hide) {
  const hidden = hiddenGames();
  if (hide) hidden.add(String(id));
  else hidden.delete(String(id));
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {}
}

const SQUARE_THEMES = new Set(['xbox']);
export const wantsRoom = () => /^(Classic|xbox)/.test(document.documentElement.dataset.theme || '');
const ICON_BATCH_MS = 30;
const ICONS_KEY = 'webblox.launcher.icons';
const SAVED_ICONS = 400;
const wantedIcons = new Set();
const failedIcons = new Set();
let iconTimer = null;

try {
  Object.assign(state.icons, JSON.parse(localStorage.getItem(ICONS_KEY)));
} catch {}

function saveIcons() {
  try {
    localStorage.setItem(ICONS_KEY, JSON.stringify(Object.fromEntries(Object.entries(state.icons).slice(-SAVED_ICONS))));
  } catch {}
}

function paintArt(frame) {
  const id = frame.dataset.universe;
  const square = frame.dataset.square === 'true' || SQUARE_THEMES.has(document.documentElement.dataset.theme);
  if (square && !state.icons[id] && !failedIcons.has(id)) {
    wantedIcons.add(id);
    iconTimer = iconTimer || setTimeout(loadIcons, ICON_BATCH_MS);
    frame.replaceChildren();
    return;
  }
  const src = square ? state.icons[id] || state.art[id] : state.art[id];
  const current = frame.firstElementChild;
  if (!src) frame.replaceChildren();
  else if (current) current.src = src;
  else frame.append(image(src, '', true));
}

export function refreshArt() {
  document.querySelectorAll('.art[data-universe]').forEach(paintArt);
}

async function loadIcons() {
  iconTimer = null;
  const ids = [...wantedIcons];
  wantedIcons.clear();
  const found = await thumbnails(ids.map(id => ({ key: id, request: { targetId: Number(id), type: 'GameIcon', size: '512x512' } }))).catch(() => ({}));
  for (const id of ids) {
    if (found[id]) state.icons[id] = found[id];
    else failedIcons.add(id);
  }
  saveIcons();
  refreshArt();
}

export async function gameIcons(ids) {
  const needed = [...new Set(ids.map(String))].filter(id => !state.icons[id]);
  if (!needed.length) return;
  Object.assign(state.icons, await thumbnails(needed.map(id => ({ key: id, request: { targetId: Number(id), type: 'GameIcon', size: '150x150' } }))).catch(() => ({})));
  saveIcons();
}

function gameCard(game, square) {
  rememberGame(game);
  const node = el('article', 'card');
  const open = link('card-open', `#/game/${game.universeId}`);
  const frame = el('span', 'art');
  frame.dataset.universe = game.universeId;
  if (square) frame.dataset.square = 'true';
  paintArt(frame);
  open.append(frame, el('span', 'card-name', game.name), gameMeta(game));
  node.append(open);
  if (game.rootPlaceId) {
    const start = button('card-play');
    start.setAttribute('aria-label', `Play ${game.name}`);
    start.append(icon('play-large', true));
    start.addEventListener('click', () => play(game.rootPlaceId));
    node.append(start);
  }
  return node;
}

export const card = game => gameCard(game, false);

export const squareCard = game => gameCard(game, true);

export function section(title, note, body, controls, href) {
  const node = el('section', 'section');
  const head = el('div', 'section-head');
  const text = el('div');
  const heading = el('h2');
  if (href) {
    const anchor = link('section-link', href, title);
    anchor.append(icon('chevron-large-right'));
    heading.append(anchor);
  } else heading.textContent = title;
  text.append(heading);
  if (note) text.append(el('p', 'section-note', note));
  head.append(text);
  if (controls) head.append(controls);
  node.append(head, body);
  return node;
}

function nearestCardEdge(row, target) {
  const cards = [...row.children];
  if (!cards.length) return target;
  const origin = cards[0].offsetLeft;
  return cards.reduce((best, card) => {
    const edge = card.offsetLeft - origin;
    return Math.abs(edge - target) < Math.abs(best - target) ? edge : best;
  }, 0);
}

export function rowControls(row) {
  const controls = el('div', 'row-controls');
  const arrow = (name, label, direction) => {
    const node = button('arrow');
    node.setAttribute('aria-label', `${label} in this row`);
    node.append(icon(name));
    node.addEventListener('click', () => row.scrollTo({ left: nearestCardEdge(row, row.scrollLeft + direction * row.clientWidth * 0.9), behavior: 'smooth' }));
    return node;
  };
  const back = arrow('chevron-large-left', 'Back', -1);
  const next = arrow('chevron-large-right', 'Next', 1);
  const update = () => {
    back.disabled = row.scrollLeft <= 1;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
    controls.hidden = back.disabled && next.disabled;
  };
  row.addEventListener('scroll', update, { passive: true });
  row.addEventListener('wheel', event => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    row.scrollLeft += event.deltaX;
  }, { passive: false });
  new ResizeObserver(update).observe(row);
  controls.append(back, next);
  return controls;
}

export function rowSection(title, note, items, href, className = 'row') {
  const row = el('div', className);
  row.append(...items);
  return section(title, note, row, rowControls(row), href);
}

export function personTile(id, sub) {
  const person = state.names[id] || {};
  const node = link('person', `#/user/${id}`);
  node.append(image(state.faces[id], '', true), el('span', 'person-name', person.displayName || 'Roblox user'));
  if (sub) node.append(el('span', 'person-sub', sub));
  return node;
}

export function skeleton(root, placeholder = false) {
  document.body.classList.add('page-loading');
  root.setAttribute('aria-busy', 'true');
  if (!placeholder || root.childElementCount) return;
  const grid = el('div', 'grid');
  for (let i = 0; i < 12; i++) {
    const item = el('div', 'skeleton');
    item.append(el('span', 'art'), el('span', 'line'), el('span', 'line short'));
    grid.append(item);
  }
  const wrap = el('div', 'section');
  wrap.setAttribute('aria-label', 'Loading');
  wrap.append(grid);
  root.replaceChildren(wrap);
}

export function message(root, title, text, action) {
  const box = el('div', 'message');
  box.append(el('strong', '', title), text);
  if (action) {
    const row = el('div', 'actions');
    row.append(action);
    box.append(row);
  }
  root.replaceChildren(box);
}

export function loadFailure(root, err, retry) {
  if (err?.status === 401) {
    if (wispMode) {
      const signIn = button('play', 'Sign in');
      signIn.addEventListener('click', forgetWispSession);
      message(root, 'Your session ended', 'Roblox no longer accepts the saved session. Sign in again with a new one.', signIn);
      return;
    }
    message(root, 'Sign in to continue', 'WebBlox needs a Roblox session to load this page.', link('play', ROBLOX_LAUNCHER, 'Sign in'));
    return;
  }
  const again = button('more', 'Try again');
  again.addEventListener('click', retry);
  message(root, "Couldn't load this page", wispMode ? 'Check your connection and the Wisp relay, then try again.' : 'Check that the WebBlox server is running, then try again.', again);
  console.warn('[launcher] page failed:', err?.message);
}

export function tabs(entries, initial = 0) {
  const wrap = el('section', 'tabs');
  const bar = el('div', 'tab-bar');
  bar.setAttribute('role', 'tablist');
  const panel = el('div', 'tab-panel');
  panel.setAttribute('role', 'tabpanel');
  const select = index => {
    buttons.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    panel.replaceChildren(entries[index][1]());
  };
  const buttons = entries.map(([name], index) => {
    const tab = button('tab', name);
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (index + step + entries.length) % entries.length;
      select(next);
      buttons[next].focus();
    });
    return tab;
  });
  bar.append(...buttons);
  wrap.append(bar, panel);
  select(initial);
  return wrap;
}

export function pageHead(title, note) {
  const head = el('header', 'page-head');
  head.append(el('h1', '', title));
  if (note) head.append(el('p', 'section-note', note));
  return head;
}

export function dropdown({ label, options, value, onPick, search, extra, describe, className }) {
  const wrap = el('div', className ? `dropdown ${className}` : 'dropdown');
  const trigger = button('dropdown-button');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const text = el('span', 'dropdown-value');
  const chevron = icon('chevron-large-right');
  chevron.classList.add('dropdown-chevron');
  trigger.append(text, chevron);
  const menu = el('div', 'dropdown-menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', label);
  trigger.popoverTargetElement = menu;
  let current = value;
  const choices = options.map(([key, name]) => {
    const option = button('dropdown-option');
    option.setAttribute('role', 'option');
    option.dataset.value = key;
    const mark = icon('check', true);
    mark.classList.add('dropdown-check');
    option.append(el('span', '', name), mark);
    option.addEventListener('click', () => pick(key));
    return option;
  });
  const paint = () => {
    const known = options.find(([key]) => key === current);
    text.textContent = known ? known[1] : describe ? describe(current) : current;
    trigger.setAttribute('aria-label', `${label}: ${text.textContent}`);
    for (const option of choices) option.setAttribute('aria-selected', String(option.dataset.value === current));
  };
  function pick(next) {
    current = next;
    paint();
    menu.hidePopover();
    onPick(next);
  }
  if (search) {
    const form = el('form', 'dropdown-search');
    const field = el('input');
    field.type = 'search';
    field.placeholder = search;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', search);
    form.append(field);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const typed = field.value.trim();
      if (typed) pick(typed);
    });
    menu.append(form);
  }
  if (extra) menu.append(extra(pick));
  menu.append(...choices);
  const close = event => {
    if (!menu.contains(event.target)) menu.hidePopover();
  };
  menu.addEventListener('toggle', event => {
    const open = event.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) {
      removeEventListener('scroll', close, true);
      return;
    }
    const box = trigger.getBoundingClientRect();
    menu.style.minWidth = `${box.width}px`;
    menu.style.top = `${box.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8))}px`;
    addEventListener('scroll', close, { capture: true, passive: true });
    (menu.querySelector('input') || menu.querySelector('[aria-selected="true"]') || choices[0])?.focus();
  });
  menu.addEventListener('keydown', event => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = choices.indexOf(document.activeElement);
    choices[(at + step + choices.length) % choices.length].focus();
  });
  wrap.append(trigger, menu);
  wrap.setValue = next => {
    current = next;
    paint();
  };
  paint();
  return wrap;
}

export function loadMore(label, load) {
  const row = el('div', 'center');
  const more = button('more', label);
  more.addEventListener('click', async () => {
    more.disabled = true;
    try {
      const again = await load();
      more.disabled = false;
      if (!again) row.remove();
    } catch (err) {
      more.disabled = false;
      failed("That didn't load.", err);
    }
  });
  row.append(more);
  return row;
}
