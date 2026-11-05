import { compact, el, icon, state, thumbnails } from './core.js';

const NAV = [
  ['Home', 'house'],
  ['Charts', 'chart-three-vertical-bars'],
  ['Avatar', 'person-standing'],
  ['Marketplace', 'shopping-basket'],
  ['Chat', 'speech-bubble-round'],
  ['Friends', 'two-people'],
  ['Communities', 'three-people'],
];
const SEARCH_HINT = 'Search games, people and communities';
const GAME_COUNT = 9;
const FRIEND_COUNT = 5;

function previewGames() {
  const ids = [...new Set((state.home?.sorts || []).flatMap(sort => sort.ids))];
  return ids.filter(id => state.games[id] && (state.art[id] || state.icons[id])).slice(0, GAME_COUNT).map(id => state.games[id]);
}

function picture(src) {
  const node = el('img');
  node.alt = '';
  node.decoding = 'async';
  if (src) node.src = src;
  return node;
}

function art(game, square) {
  const frame = el('span', 'tp-art');
  if (!game) return frame;
  const id = game.universeId;
  const node = picture(square ? state.icons[id] || state.art[id] : state.art[id]);
  if (square) node.dataset.previewIcon = id;
  frame.append(node);
  return frame;
}

function tile(game, square, details = true) {
  const node = el('span', 'tp-card');
  node.append(art(game, square));
  if (details) {
    const stats = el('span', 'tp-stats');
    stats.append(icon('two-people', true), compact(game?.playerCount));
    node.append(el('span', 'tp-name', game?.name || ''), stats);
  }
  return node;
}

function tiles(games, square, count, details) {
  const row = el('span', 'tp-row');
  for (let i = 0; i < count; i++) row.append(tile(games.length ? games[i % games.length] : null, square, details));
  return row;
}

function section(title, content, kind = '') {
  const node = el('span', `tp-section ${kind}`);
  node.append(el('span', 'tp-title', title), content);
  return node;
}

function face(src) {
  const frame = el('span', 'tp-face');
  if (src) frame.append(picture(src));
  return frame;
}

const friendIds = () => {
  const ids = (state.friends || []).map(friend => friend.id).slice(0, FRIEND_COUNT);
  return ids.length ? ids : Array(FRIEND_COUNT).fill(null);
};

function friendRow(id) {
  const row = el('span', 'tp-friend');
  const text = el('span', 'tp-friend-text');
  text.append(el('span', 'tp-friend-name', state.names[id]?.displayName || 'Friend'));
  row.append(face(state.faces[id]), text);
  return row;
}

function search() {
  const node = el('span', 'tp-search');
  node.append(icon('magnifying-glass'), el('span', '', SEARCH_HINT));
  return node;
}

function me() {
  const node = el('span', 'tp-me');
  const robux = el('span', 'tp-robux');
  robux.append(icon('robux'), state.robux === undefined ? '' : compact(state.robux));
  node.append(robux, icon('bell'), face(state.me?.face));
  return node;
}

function bar() {
  const node = el('span', 'tp-bar');
  node.append(el('span', 'tp-logo'), search(), me());
  return node;
}

function nav() {
  return NAV.map(([name, iconName], index) => {
    const item = el('span', `tp-nav${index === 0 ? ' on' : ''}`);
    item.append(icon(iconName), el('span', '', name));
    return item;
  });
}

function standard(root, games) {
  const rail = el('span', 'tp-rail');
  rail.append(...nav());
  const main = el('span', 'tp-main');
  const people = el('span', 'tp-people');
  people.append(...friendIds().map(id => {
    const person = el('span', 'tp-person');
    person.append(face(state.faces[id]), el('span', 'tp-friend-name', state.names[id]?.displayName || 'Friend'));
    return person;
  }));
  const first = tiles(games, true, 6);
  main.append(section(`Friends (${state.friendCount ?? state.friends?.length ?? 0})`, people), section('Continue', first, 'tp-recent'), section('Recommended For You', tiles(games.slice(3), false, 3)));
  root.append(bar(), rail, main);
}

function xbox(root, games) {
  const tabs = el('span', 'tp-tabs');
  tabs.append(...NAV.map(([name], index) => el('span', index === 0 ? 'on' : '', name)));
  const side = el('span', 'tp-side');
  const avatar = el('span', 'tp-profile');
  if (state.me?.face) avatar.append(picture(state.me.face));
  side.append(el('span', 'tp-title', state.me?.name || 'Player'), avatar, el('span', 'tp-title', 'Friends online'), ...friendIds().slice(0, 2).map(friendRow));
  const blocks = el('span', 'tp-blocks');
  const block = section('Continue', tiles(games, true, 4, false));
  block.querySelector('.tp-card')?.classList.add('selected');
  blocks.append(block, section('Recommended For You', tiles(games.slice(4), true, 6, false)));
  root.append(bar(), tabs, side, blocks);
}

const LAYOUTS = { xbox };

export function previewKey() {
  const friends = friendIds();
  return JSON.stringify([
    previewGames().map(game => game.universeId),
    friends.map(id => [id, state.faces[id], state.names[id]?.displayName]),
    state.me?.name,
    state.me?.face,
    state.friendCount,
    state.robux,
  ]);
}

export function themePreview(theme) {
  const box = el('span', 'theme-preview');
  box.dataset.theme = theme;
  box.setAttribute('aria-hidden', 'true');
  const root = el('span', 'tp');
  (LAYOUTS[theme] || standard)(root, previewGames());
  box.append(root);
  return box;
}

function loaderText(game) {
  const parts = [el('span', 'lp-title', game?.name || 'Experience')];
  if (game?.creator?.name) parts.push(el('span', 'lp-creator', game.creator.name));
  return parts;
}

function tiltLoader(root, game, variant) {
  const keyart = el('span', 'lp-keyart');
  const icon = el('span', 'lp-icon');
  if (game) {
    const node = picture(state.icons[game.universeId] || state.art[game.universeId]);
    node.dataset.previewIcon = game.universeId;
    icon.append(node);
  }
  keyart.append(el('span', 'lp-frame'), icon);
  const close = el('span', 'lp-close');
  close.append(el('span'));
  const track = el('span', 'lp-track');
  track.append(el('span'));
  if (variant === 'pioneer') {
    const footer = el('span', 'lp-footer');
    footer.append(el('span', '', 'Powered by'), el('span', 'lp-wordmark'));
    root.append(keyart, ...loaderText(game), footer, track);
    return;
  }
  root.append(close, keyart, ...loaderText(game), track);
}

function classicLoader(root, game, variant) {
  root.classList.toggle('lp-launch', variant === 'client-2022');
  const backdrop = el('span', 'lp-backdrop');
  if (game) backdrop.append(picture(state.art[game.universeId] || state.icons[game.universeId]));
  const panel = el('span', 'lp-panel');
  const icon = el('span', 'lp-icon');
  if (game) {
    const node = picture(state.icons[game.universeId] || state.art[game.universeId]);
    node.dataset.previewIcon = game.universeId;
    icon.append(node);
  }
  panel.append(icon, ...loaderText(game));
  root.append(backdrop, panel);
}

function loader2016(root, game, variant) {
  const graphics = el('span', 'lp-graphics');
  if (variant === 'console') {
    root.classList.add('lp-console');
    const cancel = el('span', 'lp-cancel');
    cancel.append(el('span', '', 'Cancel'), el('span', 'lp-button-b'));
    root.append(...loaderText(game), graphics, cancel);
    return;
  }
  graphics.append(el('span', 'lp-loading', 'Loading...'));
  root.append(...loaderText(game), graphics);
}

function loader2014(root, game) {
  const frame = el('span', 'lp-thumbnail');
  if (game) frame.append(picture(state.art[game.universeId] || state.icons[game.universeId]));
  const stats = el('span', 'lp-stats');
  stats.append(...['Instances', 'Bricks', 'Connectors', 'Voxels'].map(name => {
    const stat = el('span');
    stat.append(el('span', '', name), el('span', '', '0'));
    return stat;
  }));
  const top = el('span', 'lp-top-bar');
  top.append(el('span', 'lp-logo-2014'));
  const bottom = el('span', 'lp-bottom-bar');
  bottom.append(el('span', 'lp-way', "You're on your way to"), ...loaderText(game));
  root.append(el('span', 'lp-texture'), top, bottom, frame, stats);
}

function loader2020(root, game, variant) {
  const square = variant === 'icon';
  const frame = el('span', `lp-thumbnail${square ? ' lp-square' : ''}`);
  if (game) {
    const node = picture(square ? state.icons[game.universeId] || state.art[game.universeId] : state.art[game.universeId] || state.icons[game.universeId]);
    if (square) node.dataset.previewIcon = game.universeId;
    frame.append(node);
  }
  root.classList.toggle('lp-white', variant === 'white');
  root.append(frame, ...loaderText(game), el('span', 'lp-spinner'));
}

const LOADER_PREVIEWS = { tilt: tiltLoader, classic: classicLoader, 2014: loader2014, 2016: loader2016, 2020: loader2020 };

export function loaderPreview(loader, variant) {
  const box = el('span', 'theme-preview loader-preview');
  box.setAttribute('aria-hidden', 'true');
  const root = el('span', `lp lp-${loader}`);
  LOADER_PREVIEWS[loader](root, previewGames()[0], variant);
  box.append(root);
  return box;
}

export async function loadPreviewIcons(group) {
  const nodes = [...group.querySelectorAll('img[data-preview-icon]')];
  const missing = [...new Set(nodes.map(node => node.dataset.previewIcon))].filter(id => !state.icons[id]);
  if (missing.length) {
    try {
      Object.assign(state.icons, await thumbnails(missing.map(id => ({ key: id, request: { targetId: Number(id), type: 'GameIcon', size: '512x512' } }))));
    } catch (err) {
      console.warn('[launcher] preview icons failed:', err.message);
    }
  }
  for (const node of nodes) {
    const src = state.icons[node.dataset.previewIcon];
    if (src && node.src !== src) node.src = src;
  }
}
