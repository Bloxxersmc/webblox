import { api, button, chunks, dropdown, el, icon, image, link, loadFailure, longDate, skeleton, state, thumbnails } from './core.js';
import { itemDetails, robuxAmount, serialBadge } from './market.js';

const PAGE = 100;
const DETAILS_CHUNK = 100;
const SKELETONS = 12;
const PRELOAD_PX = 600;
const COLLECTIBLE = new Set(['Limited', 'LimitedUnique', 'Collectible']);
const SORTS = [['Desc', 'Newest first'], ['Asc', 'Oldest first']];

const asset = (key, label, typeId, catalog = true) => ({ key, label, kind: 'asset', typeId, catalog, sorts: true });
const bundle = (key, label, typeId) => ({ key, label, kind: 'bundle', typeId, catalog: true, sorts: true });
const place = (key, label, tab) => ({ key, label, kind: 'place', tab });
const server = (key, label, tab) => ({ key, label, kind: 'server', tab });

const GROUPS = [
  ['Avatar', [
    ['accessories', 'Accessories', [asset('head', 'Head', 8), asset('face', 'Face', 42), asset('neck', 'Neck', 43), asset('shoulder', 'Shoulder', 44), asset('front', 'Front', 45), asset('back', 'Back', 46), asset('waist', 'Waist', 47), asset('gear', 'Gear', 19)]],
    ['hair', 'Hair', [asset('all', 'Hair', 41)]],
    ['heads', 'Heads', [bundle('all', 'Heads', 4)]],
    ['tops', 'Tops', [asset('tshirts', 'T-shirts', 64), asset('shirts', 'Shirts', 65), asset('sweaters', 'Sweaters', 68), asset('jackets', 'Jackets', 67)]],
    ['bottoms', 'Bottoms', [asset('pants', 'Pants', 66), asset('shorts', 'Shorts', 69), asset('skirts', 'Skirts', 72)]],
    ['shoes', 'Shoes', [asset('left', 'Left shoe', 70), asset('right', 'Right shoe', 71)]],
    ['classic', 'Classic Clothing', [asset('tshirts', 'T-shirts', 2), asset('shirts', 'Shirts', 11), asset('pants', 'Pants', 12)]],
    ['makeup', 'Makeup', [asset('faces', 'Faces', 88), asset('lips', 'Lips', 89), asset('eyes', 'Eyes', 90), asset('eyelashes', 'Eyelashes', 77), asset('eyebrows', 'Eyebrows', 76)]],
    ['bundles', 'Bundles', [bundle('body', 'Body parts', 1), bundle('animations', 'Animation packs', 2), bundle('shoes', 'Shoes', 3)]],
    ['emotes', 'Emotes', [asset('all', 'Emotes', 61)]],
    ['avatar-animations', 'Avatar Animations', [asset('run', 'Run', 53), asset('walk', 'Walk', 55), asset('fall', 'Fall', 50), asset('jump', 'Jump', 52), asset('idle', 'Idle', 51), asset('swim', 'Swim', 54), asset('climb', 'Climb', 48)]],
    ['backgrounds', 'Backgrounds', [asset('all', 'Backgrounds', 92)]],
  ]],
  ['Experiences', [
    ['places', 'Places', [place('created', 'Created by me', 'Created'), place('purchased', 'Purchased', 'Purchased'), place('mine', 'My experiences', 'MyGames'), place('other', 'Other experiences', 'OtherGames')]],
    ['servers', 'Private Servers', [server('mine', 'My servers', 'MyPrivateServers'), server('other', 'Other servers', 'OtherPrivateServers')]],
    ['passes', 'Passes', [{ key: 'all', label: 'Passes', kind: 'pass' }]],
    ['badges', 'Badges', [{ key: 'all', label: 'Badges', kind: 'badge', sorts: true }]],
  ]],
  ['Creations', [
    ['animations', 'Animations', [asset('all', 'Animations', 24, false)]],
    ['audio', 'Audio', [asset('all', 'Audio', 3, false)]],
    ['decals', 'Decals', [asset('all', 'Decals', 13, false)]],
    ['meshes', 'Meshes', [asset('all', 'Meshes', 40, false)]],
    ['models', 'Models & Packages', [asset('all', 'Models & Packages', 10, false)]],
    ['plugins', 'Plugins', [asset('all', 'Plugins', 38, false)]],
    ['video', 'Video', [asset('all', 'Video', 62, false)]],
  ]],
];
const CATEGORIES = GROUPS.flatMap(([, list]) => list);

const catalog = new Map();
const art = {};

const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null));

const SOURCES = {
  async asset(sub, me, cursor, sort) {
    const result = await api(`https://inventory.roblox.com/v2/users/${me}/inventory/${sub.typeId}?${query({ limit: PAGE, sortOrder: sort, cursor })}`);
    return [(result.data || []).map(row => ({ id: row.assetId, itemType: 'Asset', name: row.assetName, serial: row.serialNumber, added: row.created, href: `#/item/Asset/${row.assetId}`, thumb: 'Asset' })), result.nextPageCursor];
  },
  async bundle(sub, me, cursor, sort) {
    const result = await api(`https://catalog.roblox.com/v1/users/${me}/bundles/${sub.typeId}?${query({ limit: PAGE, sortOrder: sort, cursor })}`);
    return [(result.data || []).map(row => ({ id: row.id, itemType: 'Bundle', name: row.name, creator: row.creator?.name, href: `#/item/Bundle/${row.id}`, thumb: 'BundleThumbnail' })), result.nextPageCursor];
  },
  async place(sub, me, cursor) {
    const result = await api(`https://inventory.roblox.com/v1/users/${me}/places/inventory?${query({ itemsPerPage: PAGE, placesTab: sub.tab, cursor })}`);
    return [(result.data || []).map(row => ({ id: row.placeId, name: row.name, creator: row.creator?.name, price: row.priceInRobux, href: row.universeId ? `#/game/${row.universeId}` : null, thumb: 'PlaceIcon' })), result.nextPageCursor];
  },
  async server(sub, me, cursor) {
    const result = await api(`https://games.roblox.com/v1/private-servers/my-private-servers?${query({ privateServersTab: sub.tab, itemsPerPage: PAGE, cursor })}`);
    return [(result.data || []).map(row => ({ id: row.universeId, name: row.name, note: row.universeName, creator: sub.tab === 'OtherPrivateServers' ? row.ownerName : null, status: row.active ? 'Active' : 'Inactive', href: row.universeId ? `#/game/${row.universeId}` : null, thumb: 'GameIcon' })), result.nextPageCursor];
  },
  async pass(sub, me, cursor) {
    const result = await api(`https://apis.roblox.com/game-passes/v1/users/${me}/game-passes?${query({ count: PAGE, exclusiveStartId: cursor })}`);
    const rows = result.gamePasses || [];
    return [rows.map(row => ({ id: row.gamePassId, name: row.name, creator: row.creator?.name, href: `#/pass/${row.gamePassId}`, thumb: 'GamePass' })), rows.length === PAGE ? rows.at(-1).gamePassId : ''];
  },
  async badge(sub, me, cursor, sort) {
    const result = await api(`https://badges.roblox.com/v1/users/${me}/badges?${query({ limit: PAGE, sortOrder: sort, cursor })}`);
    return [(result.data || []).map(row => ({ id: row.id, name: row.displayName || row.name, creator: row.creator?.name, thumb: 'BadgeIcon', round: true })), result.nextPageCursor];
  },
};

async function describe(items, withCatalog) {
  const fresh = items.filter(item => !art[`${item.thumb}:${item.id}`]);
  const wanted = withCatalog ? items.filter(item => !catalog.has(`${item.itemType}:${item.id}`)) : [];
  await Promise.all([
    thumbnails(fresh.map(item => ({ key: `${item.thumb}:${item.id}`, request: { targetId: item.id, type: item.thumb, size: '150x150' } }))).then(found => Object.assign(art, found), () => {}),
    ...chunks(wanted, DETAILS_CHUNK).map(group => itemDetails(group.map(item => ({ itemType: item.itemType, id: item.id }))).then(found => {
      for (const item of group) catalog.set(`${item.itemType}:${item.id}`, null);
      for (const detail of found) catalog.set(`${detail.itemType}:${detail.id}`, detail);
    }, () => {})),
  ]);
}

function priceOf(detail) {
  if (!detail) return null;
  const limited = (detail.itemRestrictions || []).some(tag => COLLECTIBLE.has(tag));
  if (limited) return detail.lowestResalePrice || detail.lowestPrice || null;
  if (detail.isOffSale || detail.priceStatus === 'Off Sale') return null;
  return detail.price || null;
}

function tile(item) {
  const detail = item.itemType ? catalog.get(`${item.itemType}:${item.id}`) : null;
  const node = item.href ? link('inventory-tile', item.href) : el('div', 'inventory-tile');
  const frame = el('span', `inventory-art${item.round ? ' round' : ''}`);
  frame.append(image(art[`${item.thumb}:${item.id}`], '', true));
  const limited = item.serial || (detail?.itemRestrictions || []).some(tag => COLLECTIBLE.has(tag));
  if (limited) {
    const badges = el('span', 'item-badges');
    badges.append(serialBadge(item.serial, detail?.totalQuantity));
    frame.append(badges);
  }
  if (item.status) frame.append(el('span', `inventory-status${item.status === 'Active' ? ' on' : ''}`, item.status));
  const text = el('span', 'inventory-text');
  text.append(el('span', 'inventory-name', item.name || detail?.name || 'Untitled'));
  if (item.note) text.append(el('span', 'inventory-note', item.note));
  const creator = item.creator || detail?.creatorName;
  if (creator) {
    const by = el('span', 'inventory-by', 'By ');
    by.append(el('strong', '', creator));
    text.append(by);
  }
  const price = item.price || priceOf(detail);
  if (price) text.append(robuxAmount(price, 'robux-amount inventory-price'));
  else if (detail) text.append(el('span', 'inventory-price muted', 'Off sale'));
  else if (item.added) text.append(el('span', 'inventory-price muted', `Added ${longDate(item.added)}`));
  node.append(frame, text);
  return node;
}

function placeholders() {
  return Array.from({ length: SKELETONS }, () => {
    const item = el('div', 'skeleton inventory-skeleton');
    item.append(el('span', 'art'), el('span', 'line'), el('span', 'line short'));
    return item;
  });
}

function notice(title, text, action) {
  const glyph = el('span', 'inventory-empty-icon');
  glyph.append(icon('backpack'));
  const parts = [glyph, el('strong', '', title), el('span', '', text)];
  if (action) parts.push(action);
  return parts;
}

export async function showInventory(root, { category, sub }, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    let current = CATEGORIES.find(([id]) => id === category) || CATEGORIES[0];
    let picked = current[2].find(entry => entry.key === sub) || current[2][0];
    let sort = 'Desc';
    let keyword = '';
    let token = 0;
    let cursor = '';
    let busy = false;
    let loaded = [];
    const page = el('div', 'inventory-page');
    const head = el('header', 'inventory-head');
    const shop = link('more inventory-shop', '#/marketplace');
    shop.append(icon('shopping-basket'), 'Get more');
    head.append(el('h1', '', 'Inventory'), shop);
    const nav = el('nav', 'inventory-nav');
    nav.setAttribute('aria-label', 'Inventory categories');
    const navButtons = new Map();
    for (const [group, list] of GROUPS) {
      const section = el('div', 'inventory-nav-group');
      section.append(el('h2', 'inventory-nav-label', group));
      for (const entry of list) {
        const item = button('inventory-nav-item', entry[1]);
        item.addEventListener('click', () => pick(entry, entry[2][0]));
        navButtons.set(entry, item);
        section.append(item);
      }
      nav.append(section);
    }
    const main = el('section', 'inventory-main');
    const bar = el('div', 'inventory-bar');
    const title = el('h2', 'inventory-title');
    const tools = el('div', 'inventory-tools');
    const find = el('label', 'inventory-find');
    const field = el('input');
    field.type = 'search';
    field.placeholder = 'Filter by name';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Filter items by name');
    find.append(icon('magnifying-glass'), field);
    const sortSlot = el('div', 'inventory-sort');
    sortSlot.append(dropdown({
      label: 'Sort',
      options: SORTS,
      value: sort,
      className: 'dropdown-chip',
      onPick: value => {
        sort = value;
        load();
      },
    }));
    tools.append(find, sortSlot);
    bar.append(title, tools);
    const subs = el('div', 'chips inventory-subs');
    const grid = el('div', 'inventory-grid');
    const status = el('div', 'inventory-empty');
    const sentinel = el('div', 'inventory-sentinel');
    main.append(bar, subs, grid, status, sentinel);
    const body = el('div', 'inventory-body');
    body.append(nav, main);
    page.append(head, body);
    const matches = item => !keyword || item.name?.toLowerCase().includes(keyword) || item.note?.toLowerCase().includes(keyword);
    const paintStatus = () => {
      if (busy || cursor) {
        status.replaceChildren();
        return;
      }
      const label = picked.label.toLowerCase();
      if (!loaded.length) {
        const shopping = picked.catalog;
        status.replaceChildren(...notice(`No ${label} yet`, shopping ? 'Things you get from the Marketplace show up here.' : 'Anything you own here shows up in this list.', shopping ? link('more', '#/marketplace', 'Browse the Marketplace') : null));
      } else if (!grid.children.length) status.replaceChildren(...notice('Nothing matches', `None of your ${label} have "${field.value.trim()}" in the name.`));
      else status.replaceChildren();
    };
    const fetchPage = async () => {
      if (busy) return;
      const mine = token;
      busy = true;
      try {
        const [items, next] = await SOURCES[picked.kind](picked, state.me.id, cursor, picked.sorts ? sort : undefined);
        await describe(items, picked.catalog);
        if (mine !== token) return;
        grid.querySelectorAll('.inventory-skeleton').forEach(node => node.remove());
        loaded = loaded.concat(items);
        grid.append(...items.filter(matches).map(tile));
        cursor = next ? String(next) : '';
      } catch (err) {
        if (mine !== token) return;
        grid.replaceChildren();
        cursor = '';
        status.replaceChildren(...notice(err.status === 403 ? 'This list is private' : "Items didn't load", err.status === 403 ? 'Roblox only shows it to its owner.' : 'Try again in a moment.'));
        console.warn('[launcher] inventory failed:', err.message);
        return;
      } finally {
        if (mine === token) busy = false;
      }
      paintStatus();
      if (cursor && alive() && sentinel.getBoundingClientRect().top < innerHeight + PRELOAD_PX) fetchPage();
    };
    const load = () => {
      token++;
      busy = false;
      cursor = '';
      loaded = [];
      grid.replaceChildren(...placeholders());
      status.replaceChildren();
      fetchPage();
    };
    const paint = () => {
      for (const [entry, node] of navButtons) {
        if (entry === current) node.setAttribute('aria-current', 'true');
        else node.removeAttribute('aria-current');
      }
      requestAnimationFrame(() => {
        if (nav.scrollWidth <= nav.clientWidth) return;
        const active = navButtons.get(current);
        nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
      });
      title.textContent = current[1];
      sortSlot.hidden = !picked.sorts;
      subs.hidden = current[2].length < 2;
      subs.replaceChildren(...current[2].map(entry => {
        const chip = button('chip', entry.label);
        chip.setAttribute('aria-pressed', String(entry === picked));
        chip.addEventListener('click', () => pick(current, entry));
        return chip;
      }));
    };
    function pick(entry, child) {
      if (entry === current && child === picked) return;
      current = entry;
      picked = child;
      history.replaceState(null, '', `#/inventory/${current[0]}${current[2].length > 1 ? `/${picked.key}` : ''}`);
      paint();
      load();
    }
    field.addEventListener('input', () => {
      keyword = field.value.trim().toLowerCase();
      grid.replaceChildren(...loaded.filter(matches).map(tile));
      paintStatus();
    });
    const watcher = new IntersectionObserver(([entry]) => {
      if (!alive()) watcher.disconnect();
      else if (entry.isIntersecting && cursor) fetchPage();
    }, { rootMargin: `${PRELOAD_PX}px 0px` });
    if (!alive()) return;
    paint();
    root.replaceChildren(page);
    watcher.observe(sentinel);
    load();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showInventory(root, { category, sub }, alive));
  }
}
