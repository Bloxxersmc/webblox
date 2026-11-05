import { ROBLOX_LAUNCHER, api, refreshArt, button, card, clearJoin, compact, el, faces, gameArt, gameIcons, hiddenGames, icon, image, joinServer, link, loadFailure, personTile, play, rememberGame, rowSection, section, sessionId, skeleton, squareCard, state, thumbnails, toast, userNames } from './core.js';
import { showGame, showPass } from './game.js';
import { showUser } from './people.js';
import { showConnections } from './connections.js';
import { showCommunities, showGroup } from './groups.js';
import { showAvatar } from './avatar.js';
import { showItem, showMarket } from './market.js';
import { showTradeComposer, showTrades } from './trades.js';
import { showInventory } from './inventory.js';
import { rovalraOn } from './values.js';
import { showChat, showNotifications } from './social.js';
import { showAccount, showRobux, showWeb, signOut } from './account.js';
import { showSettings } from './settings.js';
import { refreshThemePreviews, watchTheme } from './themes.js';
import { mountXbox, renderXboxProfile } from './xbox.js';
import { mountTileHover } from './tilehover.js';

const ENGINE_FILES = (self.__WB||'/')+'engine/';
const HOME_KEY = 'webblox.launcher.home.v4';
const CHARTS_KEY = 'webblox.launcher.charts.v2';
const SHELL_KEY = 'webblox.launcher.shell';
const TREATMENTS = ['Carousel', 'SortlessGrid', 'FriendCarousel', 'SearchGameGrid'];
const PAGE_SIZE = 30;
const ROW_SIZE = 24;
const IN_GAME = 2;
const PRESENCE_CODES = { Offline: 0, Online: 1, InGame: IN_GAME, InStudio: 3 };
const PRESENCE_MS = 30000;
const COUNTS_MS = 60000;
const FRIEND_TILE = 112;
const FRIEND_GAP = 12;
const EAGER_TILES = 8;
const NAV = [
  ['home', 'Home', 'house', '#/'],
  ['charts', 'Charts', 'chart-three-vertical-bars', '#/charts'],
  ['avatar', 'Avatar', 'person-standing', '#/avatar'],
  ['market', 'Marketplace', 'shopping-basket', '#/marketplace'],
  ['inventory', 'Inventory', 'backpack', '#/inventory'],
  ['trades', 'Trades', 'arrows-swap', '#/trades'],
  ['chat', 'Chat', 'speech-bubble-round', '#/chat'],
  ['friends', 'Friends', 'two-people', '#/friends'],
  ['communities', 'Communities', 'three-people', '#/communities'],
];

const content = document.getElementById('content');
const layout = document.getElementById('layout');
const input = document.getElementById('query');
const suggestions = document.getElementById('suggestions');
let routeToken = 0;
let suggestTimer = null;
let suggestToken = 0;
let suggestIndex = -1;
let startIconsAsked = false;
let shown = PAGE_SIZE;
const scrollByRoute = {};
let lastRoute = location.hash;
let shownRoute = null;
let shownFriends = '';
let pendingPage = null;
let knownFriends = null;

function saveShell() {
  const ids = state.friends.map(friend => friend.id);
  const pick = source => Object.fromEntries(ids.filter(id => source[id]).map(id => [id, source[id]]));
  try {
    localStorage.setItem(SHELL_KEY, JSON.stringify({ counts: state.counts, friends: state.friends, friendCount: state.friendCount, framedFaces: pick(state.faces), names: pick(state.names) }));
  } catch {}
}

async function loadFriends() {
  const id = state.me.id;
  const [{ data }, list, count] = await Promise.all([
    api(`https://friends.roblox.com/v1/users/${id}/friends/online`),
    knownFriends ? null : api(`https://friends.roblox.com/v1/users/${id}/friends/find?limit=50&userSort=1`).catch(() => null),
    knownFriends ? null : api(`https://friends.roblox.com/v1/users/${id}/friends/count`).catch(() => null),
  ]);
  if (list) knownFriends = (list.PageItems || []).map(friend => friend.id);
  if (count) state.friendCount = count.count;
  const online = (data || []).map(row => ({
    id: row.id,
    presence: PRESENCE_CODES[row.userPresence?.UserPresenceType] ?? row.userPresence?.UserPresenceType,
    game: row.userPresence?.lastLocation,
    universeId: row.userPresence?.universeId,
    rootPlaceId: row.userPresence?.rootPlaceId,
    placeId: row.userPresence?.placeId,
    serverId: row.userPresence?.gameInstanceId,
    sortScore: row.sortScore || 0,
  })).sort((a, b) => (b.presence === IN_GAME) - (a.presence === IN_GAME) || b.sortScore - a.sortScore).slice(0, 40);
  const onlineIds = new Set(online.map(friend => friend.id));
  const friends = [...online, ...(knownFriends || []).filter(friend => !onlineIds.has(friend)).map(friend => ({ id: friend }))];
  const ids = friends.map(f => f.id);
  await Promise.all([faces(ids), userNames(ids), gameIcons(online.filter(f => f.presence === IN_GAME && f.universeId).map(f => f.universeId))]);
  state.friends = friends;
  renderFriends();
  saveShell();
}

function friendTile(friend, xbox) {
  const inGame = friend.presence === IN_GAME && friend.universeId;
  const name = state.names[friend.id]?.displayName || 'Friend';
  const open = link('friend', inGame && xbox ? `#/game/${friend.universeId}/friend/${friend.id}` : `#/user/${friend.id}`);
  const face = el('span', 'friend-face');
  face.append(image(state.faces[friend.id]));
  if (friend.presence) {
    const dot = el('span', `friend-dot ${friend.presence === IN_GAME ? 'playing' : 'online'}`);
    if (inGame && !xbox) dot.append(icon('controller'));
    face.append(dot);
  }
  const text = el('span', 'friend-text');
  text.append(el('span', 'friend-name', name));
  if (inGame) {
    const game = el('span', 'friend-game playing');
    if (state.icons[friend.universeId]) game.append(image(state.icons[friend.universeId]));
    game.append(el('span', '', friend.game || 'Playing'));
    text.append(game);
  }
  open.append(face, text);
  const row = el('div', 'friend-row');
  row.append(open);
  const placeId = friend.placeId || friend.rootPlaceId;
  const canJoin = inGame && placeId && friend.serverId;
  if (xbox) {
    if (!canJoin) return row;
    const join = button('friend-join', 'Join');
    join.setAttribute('aria-label', `Join ${name}`);
    join.addEventListener('click', () => joinServer(placeId, friend.serverId));
    row.append(join);
    return row;
  }
  const pop = el('div', 'friend-pop');
  if (inGame) {
    const game = link('friend-pop-game', `#/game/${friend.universeId}`);
    const art = el('span', 'friend-pop-art');
    if (state.icons[friend.universeId]) art.append(image(state.icons[friend.universeId]));
    const words = el('span', 'friend-pop-words');
    words.append(el('span', 'friend-pop-who', `${name} is playing`), el('strong', 'friend-pop-name', friend.game || 'a Roblox game'));
    game.append(art, words);
    pop.append(game);
  }
  if (canJoin) {
    const join = button('play friend-pop-button', 'Join');
    join.setAttribute('aria-label', `Join ${name}`);
    join.addEventListener('click', () => joinServer(placeId, friend.serverId));
    pop.append(join);
  }
  pop.append(link('more friend-pop-button', `#/chat/friend/${friend.id}`, 'Chat'), link('friend-pop-button friend-pop-profile', `#/user/${friend.id}`, 'View Profile'));
  row.append(pop);
  return row;
}

function fitFriends() {
  const list = document.querySelector('#friends .friend-list');
  if (!list || document.documentElement.dataset.theme === 'xbox') return;
  const rows = [...list.children];
  const phone = matchMedia('(max-width: 640px)').matches;
  const fit = phone ? rows.length : Math.max(1, Math.floor((list.clientWidth + FRIEND_GAP) / (FRIEND_TILE + FRIEND_GAP)));
  list.classList.toggle('fills', !phone && rows.length >= fit);
  rows.forEach((row, index) => {
    row.hidden = index >= fit;
    row.classList.toggle('pop-end', index >= fit - 2);
  });
}

function renderFriends() {
  const column = document.getElementById('friends');
  const xbox = document.documentElement.dataset.theme === 'xbox';
  const friends = xbox ? state.friends.filter(friend => friend.presence) : state.friends;
  const visible = document.body.dataset.page === 'home' && friends.length > 0;
  column.hidden = !visible;
  layout.classList.toggle('no-friends', !visible);
  const key = JSON.stringify([xbox, state.friendCount, friends.map(friend => [friend, state.names[friend.id]?.displayName, state.faces[friend.id], state.icons[friend.universeId]])]);
  if (key === shownFriends) return;
  shownFriends = key;
  if (!friends.length) {
    column.replaceChildren();
    return;
  }
  const list = el('div', 'friend-list');
  if (!xbox) {
    const add = link('friend friend-add', '#/friends');
    const plus = el('span', 'friend-face');
    plus.append(icon('plus-large'));
    const label = el('span', 'friend-text');
    label.append(el('span', 'friend-name', 'Add Friends'));
    add.append(plus, label);
    const row = el('div', 'friend-row');
    row.append(add);
    list.append(row);
  }
  list.append(...friends.map(friend => friendTile(friend, xbox)));
  if (xbox) {
    const heading = el('h2', '', 'Friends online');
    heading.append(el('small', '', String(friends.length)));
    column.replaceChildren(heading, list);
  } else {
    const head = el('div', 'friends-head');
    const all = link('friends-all', '#/friends', 'See All');
    all.append(icon('arrow-large-right'));
    const title = el('div', 'friends-title');
    const refresh = button('icon-button friends-refresh');
    refresh.setAttribute('aria-label', 'Refresh friends');
    refresh.title = 'Refresh';
    refresh.append(icon('arrow-spin-clockwise'));
    refresh.addEventListener('click', async () => {
      if (refresh.classList.contains('busy')) return;
      refresh.classList.add('busy');
      try {
        await loadFriends();
      } catch {
        toast("Friends didn't refresh. Try again in a moment.", true);
      }
      refresh.classList.remove('busy');
    });
    title.append(el('h2', '', `Friends (${state.friendCount ?? friends.length})`), refresh);
    head.append(title, all);
    column.replaceChildren(head, list);
    fitFriends();
  }
  refreshThemePreviews();
}

function railProfile() {
  const href = `#/user/${state.me.id}`;
  const item = link('rail-item rail-me', href);
  item.title = state.me.name;
  item.setAttribute('aria-label', `${state.me.name}${state.me.premium ? ', Roblox Plus' : ''}, profile`);
  if (location.hash === href) item.setAttribute('aria-current', 'page');
  const face = image(state.me.face);
  face.className = 'rail-face';
  item.append(face, el('span', 'rail-label', state.me.name));
  if (state.me.premium) {
    const badge = icon('roblox-plus');
    badge.classList.add('rail-plus');
    item.append(badge);
  }
  return item;
}

function renderRail() {
  const rail = document.getElementById('rail');
  const current = currentRoute().nav;
  rail.replaceChildren(...(state.me ? [railProfile()] : []), ...NAV.map(([id, label, name, href]) => {
    const item = link('rail-item', href);
    item.dataset.nav = id;
    item.title = label;
    if (id === current) item.setAttribute('aria-current', 'page');
    const glyph = el('span', 'rail-icon');
    glyph.append(icon(name, id === current));
    const count = state.counts[id];
    item.append(glyph, el('span', 'rail-label', label));
    if (count) item.append(el('span', 'rail-count', count > 99 ? '99+' : String(count)));
    return item;
  }));
}

function renderMe() {
  const area = document.getElementById('me');
  if (!state.me) return;
  renderXboxProfile();
  refreshThemePreviews();
  const robux = link('robux', '#/robux');
  robux.setAttribute('aria-label', state.robux === undefined ? 'Robux' : `${compact(state.robux)} Robux`);
  robux.append(icon('robux'));
  if (state.robux !== undefined) robux.append(compact(state.robux));
  const bell = link('icon-button', '#/notifications');
  bell.setAttribute('aria-label', state.counts.notifications ? `Notifications, ${state.counts.notifications} unread` : 'Notifications');
  bell.append(icon('bell'));
  if (state.counts.notifications) bell.append(el('span', 'bell-dot'));
  const menu = el('details', 'profile-menu');
  const summary = el('summary');
  summary.setAttribute('aria-label', 'Account menu');
  const face = image(state.me.face);
  face.className = 'face';
  summary.append(face);
  const panel = el('div', 'menu-panel');
  const heading = link('menu-head', `#/user/${state.me.id}`);
  const headingText = el('span', 'menu-head-text');
  headingText.append(el('strong', '', state.me.name), el('span', '', 'View profile'));
  heading.append(image(state.me.face), headingText);
  panel.append(heading);
  for (const [label, name, href, phoneOnly] of [
    ['Messages', 'envelope', '#/notifications/messages'],
    ['Marketplace', 'shopping-basket', '#/marketplace', true],
    ['Inventory', 'backpack', '#/inventory', true],
    ['Trades', 'arrows-swap', '#/trades', true],
    ['Communities', 'three-people', '#/communities', true],
    ['Robux', 'robux', '#/robux'],
    ['Settings', 'gear', '#/settings'],
    ['Account', 'person', '#/account'],
  ]) {
    const item = link(`menu-item${phoneOnly ? ' phone-only' : ''}`, href);
    item.append(icon(name), label);
    panel.append(item);
  }
  const classic = link('menu-item', ROBLOX_LAUNCHER);
  classic.append(icon('tilt', true), 'Roblox launcher');
  panel.append(classic);
  const out = button('menu-item menu-sign-out', '');
  out.append(icon('door-open-arrow-to-bottom-right'), 'Sign out');
  out.addEventListener('click', signOut);
  panel.append(out);
  panel.addEventListener('click', () => {
    menu.open = false;
  });
  menu.append(summary, panel);
  area.replaceChildren(robux, bell, menu);
}

async function refreshCounts() {
  if (!state.me || document.visibilityState === 'hidden') return;
  const [notifications, requests, chat, messages, trades] = await Promise.all([
    api('https://notifications.roblox.com/v2/stream-notifications/unread-count').catch(() => ({})),
    api('https://friends.roblox.com/v1/user/friend-requests/count').catch(() => ({})),
    api('https://apis.roblox.com/platform-chat-api/v1/get-conversation-metadata').catch(() => ({})),
    api('https://privatemessages.roblox.com/v1/messages/unread/count').catch(() => ({})),
    api('https://trades.roblox.com/v1/trades/Inbound/count').catch(() => ({})),
  ]);
  const newTrades = (trades.count || 0) - (state.counts.trades ?? trades.count ?? 0);
  if (newTrades > 0 && rovalraOn('notifications')) toast(newTrades === 1 ? 'You got a new trade. Open Trades to see it.' : `You got ${newTrades} new trades. Open Trades to see them.`);
  state.counts = { notifications: (notifications.unreadNotifications || 0) + (messages.count || 0), friends: requests.count || 0, chat: chat.global_unread_message_count || 0, trades: trades.count || 0 };
  renderRail();
  renderMe();
  saveShell();
}

async function loadHome() {
  const me = await api('https://users.roblox.com/v1/users/authenticated');
  const previousFace = state.me?.face || null;
  state.me = { id: me.id, name: me.displayName || me.name, face: previousFace, premium: Boolean(state.me?.premium) };
  const [feed, robux, own, launch] = await Promise.all([
    api('https://apis.roblox.com/discovery-api/omni-recommendation', { pageType: 'Home', sessionId, supportedTreatmentTypes: TREATMENTS, requestIntent: 'logIn' }),
    api(`https://economy.roblox.com/v1/users/${me.id}/currency`).catch(() => ({})),
    thumbnails([{ key: 'me', request: { targetId: me.id, type: 'AvatarHeadShot', size: '150x150' } }]).catch(() => ({})),
    api('https://users.roblox.com/v1/users/authenticated/app-launch-info').catch(() => null),
  ]);
  state.me.face = own.me || previousFace;
  if (launch) state.me.premium = Boolean(launch.isPremium || launch.hasRobloxSubscription);
  state.robux = robux.robux;
  const metadata = feed.contentMetadata?.Game || {};
  const sorts = [];
  const seen = new Set();
  for (const sort of feed.sorts || []) {
    const items = (sort.recommendationList || []).filter(r => r.contentType === 'Game' && metadata[r.contentId]);
    if (!items.length || seen.has(sort.topicId)) continue;
    seen.add(sort.topicId);
    const grid = sort.treatmentType === 'SortlessGrid';
    const ids = items.map(r => r.contentId);
    for (const id of ids) {
      const game = metadata[id];
      rememberGame({ universeId: game.universeId, rootPlaceId: game.rootPlaceId, name: game.name, playerCount: game.playerCount, totalUpVotes: game.totalUpVotes, totalDownVotes: game.totalDownVotes, layoutDataBySort: game.layoutDataBySort, primaryMediaAsset: game.primaryMediaAsset });
    }
    sorts.push({ id: sort.topicId, title: sort.topic, subtitle: sort.subtitle || '', grid, ids });
  }
  sorts.sort((a, b) => /continue/i.test(b.title) - /continue/i.test(a.title));
  await gameArt(sorts.flatMap(s => s.ids.slice(0, s.grid ? PAGE_SIZE : ROW_SIZE)).map(id => state.games[id]));
  const recs = await api(`https://friends.roblox.com/v1/users/${me.id}/friends/recommendations`).catch(() => ({}));
  const suggested = (recs.data || []).map(r => r.id).filter(Boolean).slice(0, 20);
  await Promise.all([faces(suggested), userNames(suggested)]);
  return { sorts, suggested };
}

function settleImages(parts) {
  const shown = {};
  content.querySelectorAll('.art[data-universe] img').forEach(node => {
    (shown[node.src] ||= []).push(node);
  });
  for (const part of parts) {
    part.querySelectorAll('.art[data-universe] img').forEach((node, index) => {
      if (index < EAGER_TILES) {
        node.loading = 'eager';
        node.decoding = 'sync';
      }
      const kept = shown[node.src]?.pop();
      if (kept) node.replaceWith(kept);
    });
  }
}

function renderHome() {
  const home = state.home;
  if (!home) return;
  const hidden = hiddenGames();
  const parts = [];
  const grids = [];
  for (const sort of home.sorts) {
    const games = sort.ids.map(id => state.games[id]).filter(g => g && !hidden.has(String(g.universeId)));
    if (!sort.grid) {
      const recent = /continue/i.test(sort.title);
      parts.push(rowSection(sort.title, sort.subtitle, games.slice(0, ROW_SIZE).map(recent ? squareCard : card), undefined, recent ? 'row continue-row' : 'row'));
      continue;
    }
    const grid = el('div', 'grid');
    grid.append(...games.slice(0, shown).map(card));
    const sentinel = el('div', 'sentinel');
    grids.push(section(sort.title, sort.subtitle, grid), sentinel);
    if (games.length > shown) {
      const token = routeToken;
      const watcher = new IntersectionObserver(async ([entry]) => {
        if (!entry.isIntersecting || token !== routeToken) return;
        watcher.disconnect();
        const next = games.slice(shown, shown + PAGE_SIZE);
        shown += PAGE_SIZE;
        await gameArt(next);
        if (token !== routeToken) return;
        grid.append(...next.map(card));
        if (games.length > shown) watcher.observe(sentinel);
      }, { rootMargin: '600px' });
      watcher.observe(sentinel);
    }
  }
  if (home.suggested?.length) parts.splice(1, 0, rowSection('People you may know', '', home.suggested.map(id => personTile(id)), null, 'row people-row'));
  parts.push(...grids);
  settleImages(parts);
  content.replaceChildren(...parts);
}

async function refreshHome() {
  try {
    const home = await loadHome();
    state.home = home;
    renderMe();
    renderRail();
    loadFriends().catch(() => {});
    refreshCounts();
    try {
      const games = {};
      for (const sort of home.sorts) for (const id of sort.ids) games[id] = state.games[id];
      localStorage.setItem(HOME_KEY, JSON.stringify({ home, games, art: state.art, icons: state.icons, me: state.me, robux: state.robux, framedFaces: state.faces, names: state.names }));
    } catch {}
    if (currentRoute().page === 'home') renderHome();
  } catch (err) {
    if (currentRoute().page === 'home' && !state.home) loadFailure(content, err, refreshHome);
    else console.warn('[launcher] refresh failed:', err.message);
  }
}

function chartsFrom(response) {
  const sorts = [];
  let filters = null;
  for (const sort of response.sorts || []) {
    if (sort.filters) filters = sort.filters;
    if (sort.games?.length) sorts.push({ id: sort.sortId, title: sort.sortDisplayName, games: sort.games });
  }
  return { sorts, filters, next: response.nextSortsPageToken || null };
}

const chartQuery = () => {
  const query = state.chartFilters || {};
  return Object.entries(query).filter(([, v]) => v && v !== 'all').map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
};

function chartFilters(filters, alive) {
  const bar = el('div', 'filters');
  for (const filter of filters || []) {
    const label = el('label', 'filter');
    label.append(el('span', '', filter.filterDisplayName));
    const select = el('select');
    for (const option of filter.filterOptions || []) {
      const item = el('option', '', option.optionDisplayName);
      item.value = option.optionId;
      select.append(item);
    }
    select.value = state.chartFilters?.[filter.filterType] || filter.selectedOptionId || filter.defaultOptionId || 'all';
    select.addEventListener('change', () => {
      state.chartFilters = { ...state.chartFilters, [filter.filterType]: select.value };
      state.charts = null;
      showCharts(content, {}, alive);
    });
    label.append(select);
    bar.append(label);
  }
  return bar;
}

function renderCharts(alive) {
  const charts = state.charts;
  const parts = [chartFilters(charts.filters, alive)];
  for (const sort of charts.sorts) parts.push(rowSection(sort.title, '', sort.games.slice(0, ROW_SIZE).map(card), `#/charts/${sort.id}`));
  if (charts.next) {
    const row = el('div', 'center');
    const more = button('more', 'Show more charts');
    more.addEventListener('click', async () => {
      more.disabled = true;
      more.textContent = 'Loading…';
      try {
        const page = chartsFrom(await api(`https://apis.roblox.com/charts-api/v1/get-sorts?sessionId=${sessionId}${chartQuery()}&sortsPageToken=${encodeURIComponent(charts.next)}`));
        await gameArt(page.sorts.flatMap(s => s.games.slice(0, ROW_SIZE)));
        charts.sorts.push(...page.sorts);
        charts.next = page.next;
        const scroll = window.scrollY;
        if (alive()) renderCharts(alive);
        window.scrollTo(0, scroll);
      } catch (err) {
        more.disabled = false;
        more.textContent = 'Show more charts';
        console.warn('[launcher] charts failed:', err.message);
      }
    });
    row.append(more);
    parts.push(row);
  }
  content.replaceChildren(...parts);
}

async function showCharts(root, params, alive) {
  if (state.charts) renderCharts(alive);
  else skeleton(root);
  try {
    const charts = chartsFrom(await api(`https://apis.roblox.com/charts-api/v1/get-sorts?sessionId=${sessionId}${chartQuery()}`));
    await gameArt(charts.sorts.flatMap(s => s.games.slice(0, ROW_SIZE)));
    if (!alive()) return;
    if (!state.charts || state.charts.sorts.length <= charts.sorts.length) {
      state.charts = charts;
      renderCharts(alive);
    }
    try {
      if (!chartQuery()) localStorage.setItem(CHARTS_KEY, JSON.stringify({ ...charts, filters: charts.filters }));
    } catch {}
  } catch (err) {
    if (alive() && !state.charts) loadFailure(root, err, () => showCharts(root, params, alive));
  }
}

async function showChart(root, { sortId }, alive) {
  skeleton(root);
  try {
    const sort = await api(`https://apis.roblox.com/charts-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}&pageSize=100${chartQuery()}`);
    const games = sort.games || [];
    await gameArt(games);
    if (!alive()) return;
    const grid = el('div', 'grid');
    grid.append(...games.map(card));
    root.replaceChildren(section(sort.sortDisplayName || 'Chart', sort.topicLayoutData?.infoText || '', grid));
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showChart(root, { sortId }, alive));
  }
}

function searchTabs(kind, query) {
  const nav = el('div', 'tab-bar search-kinds');
  for (const [id, label] of [['games', 'Games'], ['people', 'People'], ['communities', 'Communities']]) {
    const tab = link('tab', `#/search/${id}/${encodeURIComponent(query)}`, label);
    if (id === kind) tab.setAttribute('aria-current', 'page');
    nav.append(tab);
  }
  return nav;
}

async function showSearch(root, { kind, query }, alive) {
  input.value = query;
  const head = () => [el('h1', 'search-title', `Results for "${query}"`), searchTabs(kind, query)];
  root.replaceChildren(...head());
  try {
    let body;
    if (kind === 'people') {
      const result = await api(`https://apis.roblox.com/search-api/omni-search?verticalType=user&searchQuery=${encodeURIComponent(query)}&sessionId=${sessionId}&pageType=all`);
      const people = (result.searchResults || []).flatMap(g => g.contents || []);
      for (const p of people) state.names[p.contentId] = { displayName: p.displayName, name: p.username, verified: p.hasVerifiedBadge };
      await faces(people.map(p => p.contentId));
      body = el('div', 'people-grid');
      body.append(...people.map(p => personTile(p.contentId, `@${p.username}`)));
      if (!people.length) body = el('p', 'section-note', 'No people match that search.');
    } else if (kind === 'communities') {
      const { data = [] } = await api(`https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(query)}&limit=25&prioritizeExactMatch=true`);
      const icons = await thumbnails(data.map(g => ({ key: String(g.id), request: { targetId: g.id, type: 'GroupIcon', size: '150x150' } }))).catch(() => ({}));
      body = el('div', 'list-rows');
      for (const group of data) {
        const row = link('list-row', `#/group/${group.id}`);
        const text = el('span', 'list-text');
        text.append(el('strong', '', group.name), el('span', '', `${compact(group.memberCount)} members`));
        row.append(image(icons[group.id], '', true), text);
        body.append(row);
      }
      if (!data.length) body = el('p', 'section-note', 'No communities match that search.');
    } else {
      const result = await api(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(query)}&sessionId=${sessionId}&pageType=all`);
      const games = (result.searchResults || []).filter(g => g.contentGroupType === 'Game').flatMap(g => g.contents || []).filter(g => g.universeId && g.rootPlaceId).slice(0, 60);
      await gameArt(games);
      body = el('div', 'grid');
      body.append(...games.map(card));
      if (!games.length) body = el('p', 'section-note', 'No games match that search. Try a different name.');
    }
    if (alive()) root.replaceChildren(...head(), body);
  } catch (err) {
    if (alive()) root.replaceChildren(...head(), el('p', 'section-note', "Search didn't load. Try again in a moment."));
    console.warn('[launcher] search failed:', err.message);
  }
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [first, second, third, fourth] = parts;
  switch (first) {
    case 'charts': return second ? { page: 'chart', nav: 'charts', run: showChart, params: { sortId: second } } : { page: 'charts', nav: 'charts', run: showCharts, params: {} };
    case 'search': return third ? { page: 'search', run: showSearch, params: { kind: second, query: parts.slice(2).join('/') } } : { page: 'search', run: showSearch, params: { kind: 'games', query: second || '' } };
    case 'game': return { page: 'game', run: showGame, params: { id: second, friend: third === 'friend' ? fourth : null } };
    case 'avatar': return { page: 'avatar', nav: 'avatar', run: showAvatar, params: {} };
    case 'marketplace': return { page: 'market', nav: 'market', run: showMarket, params: { keyword: second } };
    case 'inventory': return { page: 'inventory', nav: 'inventory', run: showInventory, params: { category: second, sub: third } };
    case 'trades':
      if (second === 'new') return { page: 'trade', nav: 'trades', run: showTradeComposer, params: { userId: third } };
      if (second === 'counter') return { page: 'trade', nav: 'trades', run: showTradeComposer, params: { tradeId: third } };
      return { page: 'trades', nav: 'trades', run: showTrades, params: { tab: second } };
    case 'pass': return { page: 'pass', run: showPass, params: { id: second, universeId: third } };
    case 'item': return { page: 'item', nav: 'market', run: showItem, params: { type: second, id: third } };
    case 'chat': return { page: 'chat', nav: 'chat', run: showChat, params: { id: second === 'friend' ? `friend:${third}` : second } };
    case 'friends': return { page: 'friends', nav: 'friends', run: showConnections, params: { tab: second } };
    case 'user': return third ? { page: 'connections', run: showConnections, params: { userId: second, tab: third } } : { page: 'user', run: showUser, params: { id: second } };
    case 'communities': return { page: 'communities', nav: 'communities', run: showCommunities, params: {} };
    case 'group': return { page: 'group', nav: 'communities', run: showGroup, params: { id: second, tab: third } };
    case 'notifications': return { page: 'notifications', run: showNotifications, params: { tab: second } };
    case 'settings': return { page: 'settings', nav: 'settings', run: showSettings, params: { tab: second } };
    case 'robux': return { page: 'robux', nav: 'robux', run: showRobux, params: {} };
    case 'account': return { page: 'account', nav: 'account', run: showAccount, params: {} };
    case 'web': return { page: 'web', run: showWeb, params: { key: second } };
    default: return { page: 'home', nav: 'home' };
  }
}

function showPendingPage() {
  document.body.classList.remove('page-loading');
  content.removeAttribute('aria-busy');
  const show = pendingPage;
  pendingPage = null;
  if (show) show();
}

function route() {
  if (!pendingPage) scrollByRoute[lastRoute] = window.scrollY;
  const from = shownRoute;
  lastRoute = location.hash;
  const token = ++routeToken;
  const alive = () => token === routeToken;
  const current = currentRoute();
  closeSuggestions();
  if (current.page !== 'search') input.value = '';
  const target = location.hash;
  pendingPage = () => {
    shownRoute = target;
    document.body.dataset.page = current.page;
    renderFriends();
    const saved = current.page === 'game' ? 0 : scrollByRoute[target] || 0;
    requestAnimationFrame(() => window.scrollTo(0, saved));
    window.dispatchEvent(new CustomEvent('launcher-page', { detail: { from, to: target } }));
  };
  renderRail();
  const held = content.childElementCount > 0;
  document.body.classList.remove('page-loading');
  if (current.page === 'home') {
    if (state.home) renderHome();
    else skeleton(content, true);
  } else {
    current.run(content, current.params, alive);
  }
  if (!held || !document.body.classList.contains('page-loading')) {
    const loading = document.body.classList.contains('page-loading');
    showPendingPage();
    document.body.classList.toggle('page-loading', loading);
  }
}

function closeSuggestions() {
  suggestToken++;
  suggestIndex = -1;
  suggestions.hidden = true;
  suggestions.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

function runSearch(query) {
  closeSuggestions();
  if (!query) return;
  rememberSearch(query);
  const target = `#/search/games/${encodeURIComponent(query)}`;
  if (location.hash === target) route();
  else location.hash = target;
}

const options = () => [...suggestions.querySelectorAll('.suggestion')];

function highlight(index) {
  const items = options();
  suggestIndex = index;
  items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
  if (items[index]) input.setAttribute('aria-activedescendant', items[index].id);
  else input.removeAttribute('aria-activedescendant');
}

const SUGGESTED_GAMES = 4;
const RECENT_KEY = 'webblox.launcher.searches';
const RECENT_SEARCHES = 5;
const RECENT_GAMES = 4;
const SCOPES = [
  ['People', 'person', query => `#/search/people/${encodeURIComponent(query)}`],
  ['Marketplace', 'shopping-basket', query => `#/marketplace/${encodeURIComponent(query)}`],
  ['Communities', 'three-people', query => `#/search/communities/${encodeURIComponent(query)}`],
];

function suggestion(index, text, scope, glyph, go) {
  const item = el('li', 'suggestion');
  item.id = `suggestion-${index}`;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', 'false');
  const words = el('span', 'suggestion-text');
  words.append(el('strong', '', text));
  if (scope) words.append(el('span', 'suggestion-scope', ` in ${scope}`));
  item.append(icon(glyph), words);
  item.go = go;
  item.addEventListener('mousedown', event => {
    event.preventDefault();
    go();
  });
  return item;
}

function openSuggestion(href) {
  closeSuggestions();
  if (location.hash === href) route();
  else location.hash = href;
}

const recentSearches = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
};

function rememberSearch(query) {
  const list = [query, ...recentSearches().filter(old => old.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_SEARCHES);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function suggestHead(text, action) {
  const item = el('li', 'suggest-head');
  item.setAttribute('role', 'presentation');
  item.append(el('span', '', text));
  if (action) item.append(action);
  return item;
}

function recentGames() {
  const sort = state.home?.sorts.find(s => /continue/i.test(s.title));
  const hidden = hiddenGames();
  return (sort?.ids || []).map(id => state.games[id]).filter(g => g && !hidden.has(String(g.universeId))).slice(0, RECENT_GAMES);
}

function gameSuggestion(index, game) {
  const item = el('li', 'suggestion suggest-game');
  item.id = `suggestion-${index}`;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', 'false');
  item.append(image(state.icons[game.universeId] || state.art[game.universeId]), el('span', 'suggestion-text', game.name));
  item.go = () => openSuggestion(`#/game/${game.universeId}`);
  item.addEventListener('mousedown', event => {
    event.preventDefault();
    item.go();
  });
  if (game.rootPlaceId) {
    const start = button('suggest-play');
    start.tabIndex = -1;
    start.setAttribute('aria-label', `Play ${game.name}`);
    start.append(icon('play-large', true));
    start.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      closeSuggestions();
      play(game.rootPlaceId);
    });
    item.append(start);
  }
  return item;
}

function paintStart() {
  if (input.value.trim()) return;
  const items = [];
  let index = 0;
  const searches = recentSearches();
  if (searches.length) {
    const clear = button('suggest-clear', 'Clear');
    clear.addEventListener('mousedown', event => {
      event.preventDefault();
      try {
        localStorage.removeItem(RECENT_KEY);
      } catch {}
      paintStart();
    });
    items.push(suggestHead('Recent searches', clear), ...searches.map(query => {
      const item = suggestion(index++, query, '', 'clock', () => {
        input.value = query;
        runSearch(query);
      });
      item.classList.add('suggest-recent');
      return item;
    }));
  }
  const games = recentGames();
  if (games.length) items.push(suggestHead('Jump back in'), ...games.map(game => gameSuggestion(index++, game)));
  if (!items.length) return closeSuggestions();
  suggestions.replaceChildren(...items);
  highlight(-1);
  suggestions.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  const missing = games.filter(game => !state.icons[game.universeId]).map(game => game.universeId);
  if (missing.length && !startIconsAsked) {
    startIconsAsked = true;
    gameIcons(missing).then(() => {
      if (!suggestions.hidden && !input.value.trim()) paintStart();
    });
  }
}

function paintSuggestions(prefix, games) {
  const extra = games.filter(query => query.toLowerCase() !== prefix.toLowerCase()).slice(0, SUGGESTED_GAMES);
  const items = [prefix, ...extra].map((query, index) => suggestion(index, query, 'Games', 'circle-play', () => runSearch(query)));
  const scoped = SCOPES.map(([scope, glyph, href], index) => suggestion(items.length + index, prefix, scope, glyph, () => openSuggestion(href(prefix))));
  scoped[0].classList.add('split');
  items.push(...scoped);
  const picked = suggestIndex;
  suggestions.replaceChildren(...items);
  highlight(picked < items.length ? picked : -1);
  suggestions.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

async function loadSuggestions(prefix) {
  const token = ++suggestToken;
  paintSuggestions(prefix, []);
  try {
    const { entries = [] } = await api(`https://apis.rbxcdn.com/games-autocomplete/v1/get-suggestion/${encodeURIComponent(prefix)}`);
    if (token !== suggestToken || input.value.trim() !== prefix) return;
    paintSuggestions(prefix, [...new Set(entries.map(entry => entry.searchQuery).filter(Boolean))]);
  } catch (err) {
    console.warn('[launcher] suggestions failed:', err.message);
  }
}

input.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const prefix = input.value.trim();
  if (!prefix) {
    closeSuggestions();
    return paintStart();
  }
  suggestIndex = -1;
  suggestTimer = setTimeout(() => loadSuggestions(prefix), 110);
});
input.addEventListener('keydown', event => {
  if (suggestions.hidden) return;
  const count = options().length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    highlight(suggestIndex === -1 && step === -1 ? count - 1 : (suggestIndex + step + count) % count);
  } else if (event.key === 'Escape') {
    closeSuggestions();
  }
});
input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));
input.addEventListener('focus', paintStart);
input.addEventListener('click', () => {
  if (suggestions.hidden) paintStart();
});
document.getElementById('find').addEventListener('submit', event => {
  event.preventDefault();
  clearTimeout(suggestTimer);
  const picked = options()[suggestIndex];
  if (picked?.go) picked.go();
  else runSearch(input.value.trim());
});
document.addEventListener('click', event => {
  document.querySelectorAll('details.profile-menu[open]').forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});

function warmEngine() {
  if (window.webbloxEmbed) return window.webbloxEmbed.warm();  // the game frame prepares the engine
  const load = () => {
    for (const file of ['WebClient.wasm', 'WebClient.js', 'WasmPlayer.js', 'WasmLoader.js']) {
      const prefetch = el('link');
      prefetch.rel = 'prefetch';
      prefetch.as = 'fetch';
      prefetch.crossOrigin = 'anonymous';
      prefetch.href = `${ENGINE_FILES}${file}`;
      document.head.append(prefetch);
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1500);
}

watchTheme();
mountXbox();
mountTileHover();
clearJoin();
document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));

try {
  const shell = JSON.parse(localStorage.getItem(SHELL_KEY));
  if (shell) {
    state.counts = shell.counts || {};
    state.friends = shell.friends || [];
    state.friendCount = shell.friendCount;
    Object.assign(state.faces, shell.framedFaces);
    Object.assign(state.names, shell.names);
  }
  const saved = JSON.parse(localStorage.getItem(HOME_KEY));
  if (saved) {
    state.home = saved.home;
    state.me = saved.me;
    state.robux = saved.robux;
    Object.assign(state.art, saved.art);
    Object.assign(state.icons, saved.icons);
    Object.assign(state.faces, saved.framedFaces);
    Object.assign(state.names, saved.names);
    Object.values(saved.games || {}).forEach(rememberGame);
    renderMe();
  }
  const charts = JSON.parse(localStorage.getItem(CHARTS_KEY));
  if (charts) state.charts = charts;
} catch {}

new ResizeObserver(fitFriends).observe(document.getElementById('friends'));
new MutationObserver(showPendingPage).observe(content, { childList: true });
new MutationObserver(() => {
  refreshArt();
  renderFriends();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
window.addEventListener('hashchange', route);
if (!state.me) {
  try {
    const me = await api('https://users.roblox.com/v1/users/authenticated');
    state.me = { id: me.id, name: me.displayName || me.name };
  } catch {}
}
route();
performance.mark('launcher-first-content');

warmEngine();
refreshHome().then(() => performance.mark('launcher-fresh-content'));
setInterval(() => {
  if (state.me && document.visibilityState === 'visible') loadFriends().catch(() => {});
}, PRESENCE_MS);
setInterval(refreshCounts, COUNTS_MS);
