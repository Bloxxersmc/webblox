import { api, button, card, compact, confirmDialog, dropdown, el, faces, failed, gameArt, hiddenGames, icon, image, joinPrivate, joinServer, link, loadFailure, longDate, play, rememberGame, robloxUrl, rowSection, send, setGameHidden, skeleton, state, tabs, thumbnails, toast, userNames } from './core.js';
import { robuxAmount } from './market.js';
import { sendToUser } from './social.js';
import { rovalraOn, serverLocations } from './values.js';
import { renderXboxGame } from './xbox-game.js';

const IMAGE_WAIT_MS = 400;

const ROBUX_CURRENCY = 1;
const PASS_PAGES = 10;
const SERVER_PAGE = 25;
const SERVER_FACES = 6;
const SERVER_SORTS = [['Desc', 'Most players'], ['Asc', 'Fewest players']];
const BEST_PING = ['BestLatency', 'Best ping'];
const headshots = {};

function aboutTab(info, guide, voice) {
  const box = el('div', 'tab-body');
  if (info.description) {
    const description = el('p', 'description clipped', info.description);
    const more = button('link-button', 'Read more');
    more.hidden = true;
    more.addEventListener('click', () => {
      description.classList.remove('clipped');
      more.hidden = true;
    });
    box.append(description, more);
    requestAnimationFrame(() => {
      if (description.scrollHeight > description.clientHeight + 2) more.hidden = false;
    });
  }
  const age = guide?.ageRecommendationDetails?.summary?.ageRecommendation;
  const facts = [
    ['Playing', compact(info.playing)],
    ['Visits', compact(info.visits)],
    ['Favorites', compact(info.favoritedCount)],
    ['Server size', info.maxPlayers],
    ['Genre', [info.genre_l1, info.genre_l2].filter(Boolean).join(', ') || info.genre],
    ['Maturity', age?.displayName],
    ['Voice chat', voice ? (voice.isUniverseEnabledForVoice ? 'Supported' : 'Not supported') : null],
    ['Camera', voice ? (voice.isUniverseEnabledForAvatarVideo ? 'Supported' : 'Not supported') : null],
    ['Created', longDate(info.created)],
    ['Updated', longDate(info.updated)],
  ];
  const list = el('dl', 'facts');
  for (const [name, value] of facts) {
    if (!value) continue;
    const row = el('div');
    row.append(el('dt', '', name), el('dd', '', String(value)));
    list.append(row);
  }
  box.append(list);
  const descriptors = (guide?.ageRecommendationDetails?.descriptorUsages || []).filter(d => d.contains && d.descriptor?.displayName).map(d => d.descriptor.displayName);
  if (descriptors.length) box.append(el('p', 'section-note', `Contains: ${descriptors.join(', ')}`));
  return box;
}

async function buyPass(pass, row) {
  const yes = await confirmDialog(`Buy ${pass.displayName || pass.name}?`, `This spends ${compact(pass.price)} Robux. You have ${compact(state.robux)}.`, `Spend ${compact(pass.price)} Robux`);
  if (!yes) return;
  row.disabled = true;
  try {
    const result = await api(`https://economy.roblox.com/v1/purchases/products/${pass.productId}`, { expectedCurrency: ROBUX_CURRENCY, expectedPrice: pass.price, expectedSellerId: pass.creator?.creatorId });
    if (result.purchased === false) throw new Error(result.errorMsg || result.reason || 'Roblox declined the purchase.');
    row.replaceWith(el('p', 'pass-price', 'Owned'));
    toast('Pass purchased');
  } catch (err) {
    row.disabled = false;
    failed('The purchase failed.', err);
  }
}

function passCard(pass, art, universeId) {
  const item = el('article', 'pass');
  const open = link('pass-main', `#/pass/${pass.id}${universeId ? `/${universeId}` : ''}`);
  const text = el('span', 'pass-text');
  text.append(el('strong', '', pass.displayName || pass.name));
  if (pass.isOwned) text.append(el('span', 'pass-price owned', 'Owned'));
  else if (pass.isForSale && pass.price !== null) text.append(robuxAmount(pass.price, 'robux-amount pass-price'));
  else text.append(el('span', 'pass-price', 'Off sale'));
  open.append(image(art, '', true), text);
  item.append(open);
  if (!pass.isOwned && pass.isForSale && pass.price !== null) {
    const buy = button('more pass-buy', 'Buy');
    buy.setAttribute('aria-label', `Buy ${pass.displayName || pass.name} for ${pass.price.toLocaleString('en')} Robux`);
    buy.addEventListener('click', () => buyPass(pass, buy));
    item.append(buy);
  }
  return item;
}

function storeTab(universeId) {
  const box = el('div', 'tab-body');
  box.append(el('p', 'section-note', 'Loading passes…'));
  (async () => {
    try {
      const gamePasses = [];
      let pageToken = '';
      for (let page = 0; page < PASS_PAGES; page++) {
        const result = await api(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        gamePasses.push(...(result.gamePasses || []));
        pageToken = result.nextPageToken || '';
        if (!pageToken) break;
      }
      if (!gamePasses.length) {
        box.replaceChildren(el('p', 'section-note', "This game doesn't sell any passes."));
        return;
      }
      const icons = await thumbnails(gamePasses.map(p => ({ key: String(p.id), request: { targetId: p.id, type: 'GamePass', size: '150x150' } }))).catch(() => ({}));
      const available = pass => pass.isOwned || (pass.isForSale && pass.price !== null);
      const shown = gamePasses.filter(available);
      const hidden = gamePasses.filter(pass => !available(pass));
      const grid = el('div', 'passes');
      grid.append(...shown.map(pass => passCard(pass, icons[pass.id], universeId)));
      const parts = [shown.length ? grid : el('p', 'section-note', "None of this game's passes are for sale right now.")];
      if (hidden.length) {
        const more = el('div', 'passes passes-offsale');
        more.hidden = true;
        more.append(...hidden.map(pass => passCard(pass, icons[pass.id], universeId)));
        const toggle = button('chip passes-toggle', `Show ${hidden.length} off-sale ${hidden.length === 1 ? 'pass' : 'passes'}`);
        toggle.setAttribute('aria-pressed', 'false');
        toggle.addEventListener('click', () => {
          more.hidden = !more.hidden;
          toggle.setAttribute('aria-pressed', String(!more.hidden));
          toggle.textContent = more.hidden ? `Show ${hidden.length} off-sale ${hidden.length === 1 ? 'pass' : 'passes'}` : 'Hide off-sale passes';
        });
        parts.push(toggle, more);
      }
      box.replaceChildren(...parts);
    } catch (err) {
      box.replaceChildren(el('p', 'section-note', "Passes didn't load. Try again in a moment."));
      console.warn('[launcher] store failed:', err.message);
    }
  })();
  return box;
}

export async function showPass(root, { id, universeId }, alive) {
  skeleton(root);
  try {
    const [info, owned, place, art] = await Promise.all([
      api(`https://apis.roblox.com/game-passes/v1/game-passes/${id}/product-info`),
      state.me ? api(`https://inventory.roblox.com/v1/users/${state.me.id}/items/GamePass/${id}/is-owned`).catch(() => null) : null,
      universeId ? api(`https://games.roblox.com/v1/games?universeIds=${universeId}`).then(result => result.data?.[0] || null, () => null) : null,
      thumbnails([{ key: 'pass', request: { targetId: Number(id), type: 'GamePass', size: '150x150' } }]).catch(() => ({})),
    ]);
    const big = info.IconImageAssetId ? await thumbnails([{ key: 'icon', request: { targetId: info.IconImageAssetId, type: 'Asset', size: '420x420' } }]).catch(() => ({})) : {};
    const placeIcon = place ? (await thumbnails([{ key: 'game', request: { targetId: place.id, type: 'GameIcon', size: '150x150' } }]).catch(() => ({}))).game : null;
    if (!alive()) return;
    const name = info.Name || 'Pass';
    const reload = () => showPass(root, { id, universeId }, alive);
    const back = button('back');
    back.append(icon('chevron-large-left'), 'Back');
    back.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.hash = universeId ? `#/game/${universeId}` : '#/';
    });
    const media = el('div', 'item-media');
    const frame = el('div', 'pass-art');
    frame.append(image(big.icon || art.pass, name));
    media.append(frame);
    if (place) {
      const use = link('pass-place', `#/game/${place.id}`);
      const words = el('span', 'pass-place-text');
      words.append(el('span', '', 'Use this pass in'), el('strong', '', place.name));
      use.append(image(placeIcon, '', true), words);
      media.append(use);
    }
    const social = el('div', 'item-social');
    const share = button('text-action');
    share.append(icon('chain-link'), 'Copy link');
    share.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(robloxUrl(`/game-pass/${id}`));
        toast('Link copied');
      } catch {
        toast("Couldn't copy the link.", true);
      }
    });
    const outside = link('text-action', robloxUrl(`/game-pass/${id}`));
    outside.target = '_blank';
    outside.rel = 'noopener';
    outside.append(icon('arrow-up-right-from-square'), 'Open on Roblox');
    social.append(share, outside);
    media.append(social);
    const infoBox = el('div', 'item-info');
    const title = el('div', 'item-title');
    title.append(el('h1', '', name));
    const by = el('p', 'by');
    const creator = info.Creator || {};
    by.append(link('', creator.CreatorType === 'Group' ? `#/group/${creator.CreatorTargetId}` : `#/user/${creator.CreatorTargetId}`, `By ${creator.Name || 'Roblox'}`));
    infoBox.append(title, by);
    if (owned === true) {
      const tags = el('div', 'item-tags');
      tags.append(el('span', 'item-tag owned', 'You own this'));
      infoBox.append(tags);
    }
    const priceRow = el('div', 'item-price');
    const forSale = info.IsForSale && info.PriceInRobux !== null;
    if (forSale) {
      priceRow.append(robuxAmount(info.PriceInRobux));
      if (info.UserBasePriceInRobux > info.PriceInRobux) priceRow.append(el('s', 'pass-was', info.UserBasePriceInRobux.toLocaleString('en')));
    } else priceRow.append('Off sale');
    infoBox.append(priceRow);
    const discount = (info.PriceDiscountDetails || [])[0];
    if (forSale && discount?.Percent) infoBox.append(el('p', 'section-note pass-discount', `${discount.Percent}% off with Roblox Plus`));
    const actions = el('div', 'item-actions');
    if (owned === true) {
      if (place) actions.append(link('play', `#/game/${place.id}`, 'Play to use it'));
      actions.append(link('more', '#/inventory/passes', 'Inventory'));
    } else if (forSale) {
      const buy = button('play', 'Buy');
      buy.addEventListener('click', async () => {
        await buyPass({ displayName: name, price: info.PriceInRobux, productId: info.ProductId, creator: { creatorId: creator.CreatorTargetId ?? creator.Id } }, buy);
        if (!buy.isConnected) reload();
      });
      actions.append(buy);
    }
    if (actions.children.length) infoBox.append(actions);
    const details = el('dl', 'item-details');
    for (const [label, value] of [['Type', 'Pass'], ['Created', info.Created ? longDate(info.Created) : null], ['Updated', info.Updated ? longDate(info.Updated) : null]]) {
      if (!value) continue;
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', value));
      details.append(row);
    }
    if (info.Description) {
      const row = el('div', 'item-description');
      const text = el('dd', 'description clipped', info.Description);
      row.append(el('dt', '', 'Description'), text);
      details.append(row);
      requestAnimationFrame(() => {
        if (text.scrollHeight <= text.clientHeight + 2) return;
        const more = button('text-action pass-more', 'Read more');
        more.addEventListener('click', () => {
          const open = text.classList.toggle('clipped');
          more.textContent = open ? 'Read more' : 'Show less';
        });
        text.after(more);
      });
    }
    infoBox.append(details);
    const top = el('div', 'item-top');
    top.append(media, infoBox);
    const page = el('div', 'item-page pass-page');
    page.append(back, top);
    root.replaceChildren(page);
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showPass(root, { id, universeId }, alive));
  }
}

async function tokenFaces(tokens) {
  const wanted = [...new Set(tokens)].filter(token => !headshots[token]);
  if (!wanted.length) return;
  Object.assign(headshots, await thumbnails(wanted.map(token => ({ key: token, request: { token, targetId: 0, type: 'AvatarHeadShot', size: '150x150' } }))).catch(() => ({})));
}

function serverCard(server, { friends = [], onJoin }) {
  const node = el('article', 'server-card');
  if (server.id) node.dataset.server = server.id;
  const people = el('div', 'server-faces');
  const known = new Set(friends.map(friend => friend.playerToken).filter(Boolean));
  const pictures = [
    ...friends.map(friend => state.faces[friend.id]),
    ...(server.playerTokens || []).filter(token => !known.has(token)).map(token => headshots[token]),
  ];
  const playing = server.playing ?? pictures.length;
  const shown = pictures.slice(0, playing > SERVER_FACES ? SERVER_FACES - 1 : SERVER_FACES);
  people.append(...shown.map(src => image(src, '', true)));
  if (playing > shown.length) people.append(el('span', 'server-more', `+${playing - shown.length}`));
  node.append(people);
  if (friends.length) node.append(el('span', 'server-friends', `With ${friends.map(friend => state.names[friend.id]?.displayName || friend.displayName || 'a friend').join(', ')}`));
  if (server.maxPlayers) {
    const count = el('div', 'server-count');
    count.append(el('span', '', `${playing} of ${server.maxPlayers} people`));
    if (server.ping) count.append(el('span', 'server-ping', `${server.ping} ms`));
    const meter = el('span', 'server-meter');
    const fill = el('span');
    fill.style.width = `${Math.min(100, (playing / server.maxPlayers) * 100)}%`;
    meter.append(fill);
    node.append(count, meter);
  }
  const join = button('more server-join', 'Join');
  join.setAttribute('aria-label', `Join server with ${playing} people`);
  join.addEventListener('click', onJoin);
  node.append(join);
  return node;
}

async function showLocations(placeId, grid) {
  const cards = [...grid.querySelectorAll('.server-card[data-server]:not([data-located])')];
  if (!cards.length || !rovalraOn('serverLocations')) return;
  cards.forEach(node => {
    node.dataset.located = '';
  });
  const found = await serverLocations(placeId, cards.map(node => node.dataset.server)).catch(err => {
    console.warn('[launcher] server locations failed:', err.message);
    return {};
  });
  for (const node of cards) {
    const place = found[node.dataset.server];
    if (place) node.querySelector('.server-faces').after(el('span', 'server-where', place));
  }
}

function serverSection(title, tools) {
  const box = el('section', 'server-section');
  const head = el('header', 'server-head');
  head.append(el('h3', '', title));
  if (tools) head.append(tools);
  const grid = el('div', 'server-grid');
  const status = el('p', 'section-note server-status');
  box.append(head, grid, status);
  return { box, grid, status };
}

async function friendServers(placeId) {
  const found = await api(`https://games.roblox.com/v1/games/${placeId}/servers/Friend?limit=100`).then(page => page.data || [], () => []);
  const servers = new Map(found.map(server => [server.id, { server, friends: server.players || [] }]));
  for (const friend of state.friends) {
    if (!friend.serverId || String(friend.rootPlaceId) !== String(placeId)) continue;
    const entry = servers.get(friend.serverId) || { server: { id: friend.serverId, placeId: friend.placeId }, friends: [] };
    if (!entry.friends.some(known => String(known.id) === String(friend.id))) entry.friends.push({ id: friend.id });
    servers.set(friend.serverId, entry);
  }
  return [...servers.values()];
}

const VIP = 'https://games.roblox.com/v1/vip-servers';

function closeDialog(dialog) {
  dialog.close();
  dialog.remove();
}

function dialogRow(label, ...controls) {
  const row = el('div', 'dialog-setting');
  const side = el('span', 'dialog-setting-side');
  side.append(...controls);
  row.append(el('span', '', label), side);
  return row;
}

function nameField(value) {
  const input = el('input', 'dialog-input');
  input.value = value;
  input.maxLength = 50;
  input.setAttribute('aria-label', 'Name');
  return input;
}

function dialogSwitch(label, checked, onChange, disabled = false) {
  const input = el('input', 'switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', label);
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await onChange(input.checked);
    } catch (err) {
      input.checked = !input.checked;
      failed("That didn't save.", err);
    }
    input.disabled = false;
  });
  return dialogRow(label, input);
}

async function serverSettings(id, onChange) {
  const dialog = el('dialog', 'dialog');
  dialog.append(el('h2', '', 'Loading…'));
  document.body.append(dialog);
  dialog.showModal();
  let detail;
  try {
    detail = await api(`${VIP}/${id}`);
  } catch (err) {
    closeDialog(dialog);
    failed("Couldn't load this server.", err);
    return;
  }
  let changed = false;
  const form = el('form');
  const name = nameField(detail.name || '');

  const copy = button('more', 'Copy');
  const reset = button('more');
  const off = el('span', 'dialog-muted', detail.subscription?.expired ? 'Renew it on Roblox first' : 'Turn the server on first');
  const paintLink = () => {
    off.hidden = Boolean(detail.active);
    copy.hidden = !detail.active || !detail.link;
    reset.hidden = !detail.active;
    reset.textContent = detail.link ? 'Reset' : 'Create';
  };
  paintLink();
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(detail.link);
      toast('Link copied');
    } catch {
      toast("Couldn't copy the link.", true);
    }
  });
  reset.addEventListener('click', async () => {
    reset.disabled = true;
    try {
      await send(`${VIP}/${id}`, 'PATCH', { newJoinCode: true });
      detail = await api(`${VIP}/${id}`);
      paintLink();
      toast('New link made');
    } catch (err) {
      failed("Couldn't make a new link.", err);
    }
    reset.disabled = false;
  });

  const done = button('play', 'Done');
  done.type = 'submit';
  const actions = el('div', 'dialog-actions');
  actions.append(done);
  form.append(
    dialogRow('Name', name),
    dialogSwitch('On', Boolean(detail.active), async on => {
      await send(`${VIP}/${id}`, 'PATCH', { active: on });
      detail.active = on;
      paintLink();
      changed = true;
    }, Boolean(detail.subscription?.expired)),
    dialogSwitch('Friends can join', Boolean(detail.permissions?.friendsAllowed), on => send(`${VIP}/${id}/permissions`, 'PATCH', { friendsAllowed: on })),
    dialogRow('Invite link', off, copy, reset),
    actions,
  );
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const next = name.value.trim();
    if (next && next !== detail.name) {
      done.disabled = true;
      try {
        await send(`${VIP}/${id}`, 'PATCH', { name: next });
        changed = true;
      } catch (err) {
        done.disabled = false;
        failed("The name didn't save.", err);
        return;
      }
    }
    closeDialog(dialog);
    if (changed) onChange();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog(dialog);
    if (changed) onChange();
  });
  const expired = detail.subscription?.expired ? [el('p', '', `Expired ${longDate(detail.subscription.expirationDate)}`)] : [];
  dialog.replaceChildren(el('h2', '', detail.name || 'Private server'), ...expired, form);
}

async function privateServerPrice(placeId) {
  const page = await fetch(`/__proxy__/${robloxUrl(`/games/${placeId}/`)}`).then(res => (res.ok ? res.text() : ''));
  const price = page.match(/data-private-server-price="(\d+)"/);
  return price ? Number(price[1]) : null;
}

async function createServer(placeId, universeId, onCreate) {
  const dialog = el('dialog', 'dialog');
  dialog.append(el('h2', '', 'New private server'));
  document.body.append(dialog);
  dialog.showModal();
  const price = await privateServerPrice(placeId).catch(() => null);
  const cancel = button('more', 'Cancel');
  cancel.addEventListener('click', () => closeDialog(dialog));
  const actions = el('div', 'dialog-actions');
  if (price === null) {
    actions.append(cancel);
    dialog.append(el('p', '', "Couldn't get the price. Try again in a moment."), actions);
    return;
  }
  const form = el('form');
  const name = nameField(`${state.me?.name || 'My'}'s server`);
  const create = button('play', 'Create');
  create.type = 'submit';
  actions.append(cancel, create);
  form.append(dialogRow('Name', name), dialogRow('Price', price > 0 ? robuxAmount(price) : el('span', '', 'Free')), actions);
  if (price > 0) form.insertBefore(el('p', 'dialog-hint', 'Renews every month.'), actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const next = name.value.trim();
    if (!next) return;
    create.disabled = true;
    try {
      await send(`https://games.roblox.com/v1/games/vip-servers/${universeId}`, 'POST', { name: next, expectedPrice: price });
      closeDialog(dialog);
      toast('Private server created');
      onCreate();
    } catch (err) {
      create.disabled = false;
      failed("The server wasn't created.", err);
    }
  });
  dialog.append(form);
  name.select();
}

function privateRow(placeId, server, refresh) {
  const row = el('div', 'private-row');
  const face = el('span', 'private-face');
  face.append(image(state.faces[server.owner?.id], '', true));
  const text = el('span', 'private-text');
  text.append(el('strong', '', server.name || 'Private server'), el('span', '', server.accessCode ? `${server.playing || 0} of ${server.maxPlayers} people, by ${server.owner?.displayName || 'someone'}` : 'Inactive'));
  row.append(face, text);
  if (server.vipServerId && String(server.owner?.id) === String(state.me?.id)) {
    const manage = button('more server-manage', 'Settings');
    manage.setAttribute('aria-label', `Settings for ${server.name || 'private server'}`);
    manage.addEventListener('click', () => serverSettings(server.vipServerId, refresh));
    row.append(manage);
  }
  const join = button('more server-join', 'Join');
  join.disabled = !server.accessCode;
  join.setAttribute('aria-label', `Join ${server.name || 'private server'}`);
  join.addEventListener('click', () => joinPrivate(placeId, server.accessCode));
  row.append(join);
  return row;
}

function privateServers(placeId) {
  const box = el('section', 'server-section private-servers');
  const head = el('header', 'server-head');
  head.append(el('h3', '', 'Private servers'));
  const list = el('div', 'private-list');
  const empty = el('p', 'section-note', "You don't have a private server here yet.");
  empty.hidden = true;
  const more = button('more', 'Show more');
  more.hidden = true;
  box.append(head, list, empty, more);
  box.hidden = true;
  let cursor = '';
  let creatable = false;
  let loaded = false;
  const paint = () => {
    empty.hidden = !loaded || Boolean(list.children.length);
    box.hidden = !list.children.length && !creatable;
  };
  const load = async () => {
    more.disabled = true;
    try {
      const page = await api(`https://games.roblox.com/v1/games/${placeId}/private-servers?limit=${SERVER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const servers = page.data || [];
      await faces(servers.map(server => server.owner?.id).filter(Boolean));
      list.append(...servers.map(server => privateRow(placeId, server, refresh)));
      cursor = page.nextPageCursor || '';
      more.hidden = !cursor;
      loaded = true;
      paint();
    } catch (err) {
      console.warn('[launcher] private servers failed:', err.message);
    }
    more.disabled = false;
  };
  const refresh = () => {
    cursor = '';
    list.replaceChildren();
    load();
  };
  more.addEventListener('click', load);
  (async () => {
    try {
      const { universeId } = await api(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
      const { privateServersEnabled } = await api(`https://games.roblox.com/v1/private-servers/enabled-in-universe/${universeId}`);
      if (!privateServersEnabled || !state.me) return;
      creatable = true;
      const create = button('chip', 'Create');
      create.addEventListener('click', () => createServer(placeId, universeId, refresh));
      head.append(create);
      paint();
    } catch (err) {
      console.warn('[launcher] private server check failed:', err.message);
    }
  })();
  load();
  return box;
}

export async function joinRandom(placeId) {
  try {
    const page = await api(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Desc&excludeFullGames=true`);
    const open = (page.data || []).filter(server => server.id && server.playing < server.maxPlayers);
    if (!open.length) {
      play(placeId);
      return;
    }
    joinServer(placeId, open[Math.floor(Math.random() * open.length)].id);
  } catch (err) {
    failed("Couldn't find a server to join.", err);
  }
}

function serversTab(placeId) {
  const box = el('div', 'tab-body servers-tab');
  const friendsPart = serverSection('Servers your friends are in');
  const sorts = rovalraOn('bestPing') ? [BEST_PING, ...SERVER_SORTS] : SERVER_SORTS;
  let sort = sorts[0][0];
  let hideFull = true;
  let cursor = '';
  let token = 0;
  const tools = el('div', 'server-tools');
  const full = button('chip', 'Hide full servers');
  full.setAttribute('aria-pressed', 'true');
  full.addEventListener('click', () => {
    hideFull = !hideFull;
    full.setAttribute('aria-pressed', String(hideFull));
    reload();
  });
  const refresh = button('icon-button server-refresh');
  refresh.setAttribute('aria-label', 'Refresh servers');
  refresh.title = 'Refresh';
  refresh.append(icon('arrow-spin-clockwise'));
  refresh.addEventListener('click', () => {
    loadFriends();
    reload();
  });
  tools.append(dropdown({ label: 'Sort servers', options: sorts, value: sort, className: 'dropdown-chip', onPick: value => {
    sort = value;
    reload();
  } }), full, refresh);
  const others = serverSection('Other servers', tools);
  const more = button('more', 'Show more servers');
  more.hidden = true;
  box.append(privateServers(placeId), friendsPart.box, others.box, more);
  const loadFriends = async () => {
    friendsPart.status.textContent = 'Looking for friends…';
    const entries = await friendServers(placeId);
    await Promise.all([tokenFaces(entries.flatMap(entry => entry.server.playerTokens || [])), faces(entries.flatMap(entry => entry.friends.map(friend => friend.id)))]);
    friendsPart.grid.replaceChildren(...entries.map(({ server, friends }) => serverCard(server, { friends, onJoin: () => joinServer(server.placeId || placeId, server.id) })));
    friendsPart.status.textContent = entries.length ? '' : "None of your friends are playing this right now.";
    showLocations(placeId, friendsPart.grid);
  };
  const page = async () => {
    const mine = token;
    more.disabled = true;
    try {
      const query = `limit=${SERVER_PAGE}${hideFull ? '&excludeFullGames=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const result = await api(sort === BEST_PING[0]
        ? `https://games.roblox.com/v2/games/${placeId}/servers/Public?sortOrder=Desc&orderBy=BestLatency&${query}`
        : `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=${sort}&${query}`);
      const servers = result.data || [];
      await tokenFaces(servers.flatMap(server => server.playerTokens || []));
      if (mine !== token) return;
      others.grid.append(...servers.map(server => serverCard(server, { onJoin: () => joinServer(placeId, server.id) })));
      showLocations(placeId, others.grid);
      others.status.textContent = others.grid.children.length ? '' : 'No public servers are running right now. Press Play to start one.';
      cursor = result.nextPageCursor || '';
      more.hidden = !cursor;
    } catch (err) {
      if (mine !== token) return;
      others.status.textContent = "Servers didn't load. Try again in a moment.";
      console.warn('[launcher] servers failed:', err.message);
    }
    more.disabled = false;
  };
  const reload = () => {
    token++;
    cursor = '';
    others.grid.replaceChildren();
    others.status.textContent = 'Loading servers…';
    more.hidden = true;
    page();
  };
  more.addEventListener('click', page);
  loadFriends();
  reload();
  return box;
}

function eventsTab(events) {
  const box = el('div', 'tab-body');
  const list = el('div', 'event-list');
  const now = Date.now();
  const cards = events.map(event => {
    const node = link('event-card', robloxUrl(`/events/${event.id}`));
    node.target = '_blank';
    node.rel = 'noopener';
    const art = el('span', 'event-art');
    const text = el('span', 'event-text');
    const start = Date.parse(event.eventTime.startUtc);
    const end = Date.parse(event.eventTime.endUtc);
    const status = now < start ? 'Upcoming' : now > end ? 'Ended' : 'Live now';
    text.append(el('span', `event-status${status === 'Live now' ? ' live' : ''}`, status), el('strong', '', event.displayTitle || event.title), el('span', 'event-when', `${longDate(event.eventTime.startUtc)} to ${longDate(event.eventTime.endUtc)}`));
    if (event.displaySubtitle) text.append(el('span', 'event-sub', event.displaySubtitle));
    node.append(art, text);
    return { node, art, media: event.thumbnails?.[0]?.mediaId };
  });
  list.append(...cards.map(entry => entry.node));
  box.append(list);
  const wanted = cards.filter(entry => entry.media);
  if (wanted.length) {
    thumbnails(wanted.map(entry => ({ key: String(entry.media), request: { targetId: entry.media, type: 'Asset', size: '768x432' } }))).then(found => {
      for (const entry of wanted) {
        if (!found[entry.media]) continue;
        entry.art.append(image(found[entry.media]));
        entry.node.classList.add('has-art');
      }
    }, () => {});
  }
  return box;
}

function gallery(art, media, name) {
  const wrap = el('div', 'gallery');
  const main = el('div', 'gallery-main');
  const picture = image(art, name);
  main.append(picture);
  wrap.append(main);
  if (media.length > 1) {
    let current = 0;
    const strip = el('div', 'gallery-strip');
    const show = index => {
      current = (index + media.length) % media.length;
      picture.src = media[current];
      items.forEach((item, i) => item.setAttribute('aria-pressed', String(i === current)));
      strip.scrollLeft = items[current].offsetLeft - strip.offsetLeft - (strip.clientWidth - items[current].offsetWidth) / 2;
    };
    const items = media.map((url, index) => {
      const thumb = button('gallery-thumb');
      thumb.setAttribute('aria-label', `Show image ${index + 1} of ${media.length}`);
      thumb.setAttribute('aria-pressed', String(index === 0));
      thumb.append(image(url));
      thumb.addEventListener('click', () => show(index));
      return thumb;
    });
    for (const [step, glyph, label] of [[-1, 'chevron-large-left', 'Previous image'], [1, 'chevron-large-right', 'Next image']]) {
      const arrow = button(`gallery-arrow ${step < 0 ? 'prev' : 'next'}`);
      arrow.setAttribute('aria-label', label);
      arrow.append(icon(glyph));
      arrow.addEventListener('click', () => show(current + step));
      main.append(arrow);
    }
    main.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') show(current - 1);
      if (event.key === 'ArrowRight') show(current + 1);
    });
    strip.append(...items);
    wrap.append(strip);
  }
  return wrap;
}

function votes(universeId, totals, mine) {
  const row = el('div', 'votes');
  let current = mine?.userVote ?? null;
  let up = totals?.upVotes || 0;
  let down = totals?.downVotes || 0;
  const can = mine?.canVote === true;
  const upButton = button('action');
  const downButton = button('action');
  const paint = () => {
    const total = up + down;
    upButton.replaceChildren(icon('thumb-up', current === true), total ? `${Math.round((up / total) * 100)}%` : 'Upvote');
    downButton.replaceChildren(icon('thumb-down', current === false));
    upButton.setAttribute('aria-label', current === true ? 'Remove your upvote' : 'Upvote this game');
    downButton.setAttribute('aria-label', current === false ? 'Remove your downvote' : 'Downvote this game');
    upButton.setAttribute('aria-pressed', String(current === true));
    downButton.setAttribute('aria-pressed', String(current === false));
  };
  const vote = async choice => {
    const next = current === choice ? null : choice;
    const before = { current, up, down };
    if (current === true) up--;
    if (current === false) down--;
    if (next === true) up++;
    if (next === false) down++;
    current = next;
    paint();
    try {
      await send(`https://games.roblox.com/v1/games/${universeId}/user-votes`, 'PATCH', { vote: next });
    } catch (err) {
      ({ current, up, down } = before);
      paint();
      failed("Your vote didn't save.", err);
    }
  };
  upButton.disabled = !can;
  downButton.disabled = !can;
  if (!can) {
    upButton.title = 'Play this game before voting';
    downButton.title = 'Play this game before voting';
  }
  upButton.addEventListener('click', () => vote(true));
  downButton.addEventListener('click', () => vote(false));
  paint();
  row.append(upButton, downButton);
  return row;
}

function toggle(label, activeLabel, name, active, run) {
  const node = button('action');
  let on = active;
  const paint = () => {
    node.replaceChildren(icon(name, on), on ? activeLabel : label);
    node.setAttribute('aria-pressed', String(on));
  };
  node.addEventListener('click', async () => {
    on = !on;
    paint();
    try {
      await run(on);
    } catch (err) {
      on = !on;
      paint();
      failed("That didn't save.", err);
    }
  });
  paint();
  return node;
}

function inviteDialog(info) {
  const dialog = el('dialog', 'dialog');
  dialog.append(el('h2', '', 'Invite a friend'), el('p', '', `Sends a link to ${info.name} in chat.`));
  const list = el('div', 'dialog-list');
  const people = state.friends.slice(0, 40);
  if (!people.length) list.append(el('p', 'section-note', 'None of your friends are online right now.'));
  for (const friend of people) {
    const row = button('dialog-row');
    row.append(image(state.faces[friend.id]), el('span', '', state.names[friend.id]?.displayName || 'Friend'));
    row.addEventListener('click', async () => {
      row.disabled = true;
      try {
        await sendToUser(friend.id, robloxUrl(`/games/${info.rootPlaceId}`));
        toast('Invite sent');
        dialog.close();
        dialog.remove();
      } catch (err) {
        row.disabled = false;
        failed("The invite didn't send.", err);
      }
    });
    list.append(row);
  }
  const cancel = button('more', 'Cancel');
  cancel.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });
  const actions = el('div', 'dialog-actions');
  actions.append(cancel);
  dialog.append(list, actions);
  document.body.append(dialog);
  dialog.showModal();
}

function moreActions(info) {
  const wrap = el('div', 'game-links');
  const share = button('text-action');
  share.append(icon('chain-link'), 'Copy link');
  share.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(robloxUrl(`/games/${info.rootPlaceId}`));
      toast('Link copied');
    } catch {
      toast("Couldn't copy the link.", true);
    }
  });
  const invite = button('text-action');
  invite.append(icon('person-plus'), 'Invite');
  invite.addEventListener('click', () => inviteDialog(info));
  const report = link('text-action', robloxUrl(`/abusereport/asset?id=${info.rootPlaceId}`));
  report.target = '_blank';
  report.rel = 'noopener';
  report.append(icon('flag'), 'Report');
  const hide = button('text-action');
  const isHidden = () => hiddenGames().has(String(info.id));
  const paint = () => hide.replaceChildren(icon('eye-slash'), isHidden() ? 'Show on Home again' : 'Not interested');
  hide.addEventListener('click', () => {
    setGameHidden(info.id, !isHidden());
    paint();
    toast(isHidden() ? 'Hidden from your Home page' : 'Back on your Home page');
  });
  paint();
  wrap.append(share, invite, report, hide);
  return wrap;
}

function render(root, game, loaded, related) {
  if (loaded && document.documentElement.dataset.theme === 'xbox') {
    renderXboxGame(root, game, loaded, related, { storeTab, serversTab, eventsTab, inviteDialog, joinRandom });
    return;
  }
  const page = el('div', 'game-page');
  const back = button('back');
  back.append(icon('chevron-large-left'), 'Back');
  back.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  });
  const top = el('div', 'game-top');
  const side = el('div', 'game-side');
  side.append(el('h1', '', loaded?.info.name || game?.name || 'Loading…'));
  const creator = loaded?.info.creator;
  if (creator?.name) {
    const by = el('p', 'by');
    const anchor = link('', creator.type === 'Group' ? `#/group/${creator.id}` : `#/user/${creator.id}`, `By ${creator.name}`);
    by.append(anchor);
    if (creator.hasVerifiedBadge) {
      const badge = icon('verified-mono', true);
      badge.setAttribute('aria-label', 'Verified creator');
      by.append(badge);
    }
    side.append(by);
  }
  const controls = el('div', 'game-controls');
  const placeId = loaded?.info.rootPlaceId || game?.rootPlaceId;
  const start = button('play big');
  start.append(icon('play-large', true), 'Play');
  start.disabled = !placeId;
  start.addEventListener('click', () => play(placeId));
  const random = button('play big play-random');
  random.setAttribute('aria-label', 'Join a random server');
  random.title = 'Join a random server';
  random.append(icon('shuffle'));
  random.disabled = !placeId;
  random.addEventListener('click', async () => {
    if (random.getAttribute('aria-busy') === 'true') return;
    random.setAttribute('aria-busy', 'true');
    await joinRandom(placeId);
    random.removeAttribute('aria-busy');
  });
  const playRow = el('div', 'play-split');
  playRow.append(start, random);
  controls.append(playRow);
  const friend = loaded?.friend;
  if (friend?.serverId) {
    const name = state.names[friend.id]?.displayName || 'friend';
    const join = button('more big', `Join ${name}`);
    join.addEventListener('click', () => joinServer(friend.placeId || friend.rootPlaceId, friend.serverId));
    controls.append(join);
  }
  if (loaded?.status?.isPlayable === false) {
    console.warn('[launcher] not playable:', loaded.status.playabilityStatus);
    start.disabled = true;
    random.disabled = true;
    start.replaceChildren("Can't play");
    controls.append(el('p', 'reason', loaded.status.unplayableDisplayText || "This game isn't available to your account right now."));
  }
  side.append(controls);
  if (loaded) {
    const actions = el('div', 'game-actions');
    const universe = loaded.info.id;
    actions.append(
      toggle('Favorite', 'Favorited', 'star', Boolean(loaded.info.isFavoritedByUser), on => api(`https://games.roblox.com/v1/games/${universe}/favorites`, { isFavorited: on })),
      votes(universe, loaded.votes, loaded.userVote),
    );
    if (loaded.follow && (loaded.follow.CanFollow || loaded.follow.IsFollowing)) {
      actions.append(toggle('Follow', 'Following', 'bell', Boolean(loaded.follow.IsFollowing), on => send(`https://followings.roblox.com/v1/users/${state.me.id}/universes/${universe}`, on ? 'POST' : 'DELETE')));
    }
    controls.append(actions, moreActions(loaded.info));
  }
  top.append(gallery(state.art[game?.universeId] || loaded?.media[0], loaded?.media || [], game?.name || ''), side);
  page.append(back, top);
  if (loaded) {
    const entries = [
      ['About', () => aboutTab(loaded.info, loaded.guide, loaded.voice)],
      ['Store', () => storeTab(loaded.info.id)],
      ['Servers', () => serversTab(loaded.info.rootPlaceId)],
    ];
    if (loaded.events?.length) entries.push(['Events', () => eventsTab(loaded.events)]);
    page.append(tabs(entries));
  }
  if (related?.length) page.append(rowSection('You might also like', '', related.map(card)));
  root.replaceChildren(page);
}

function imageReady(src) {
  if (!src) return Promise.resolve();
  const preload = new Image();
  preload.src = src;
  return Promise.race([preload.decode().catch(() => {}), new Promise(done => setTimeout(done, IMAGE_WAIT_MS))]);
}

export async function showGame(root, { id, friend }, alive) {
  skeleton(root);
  try {
    const [details, playability, voteTotals, userVote, media, recommended, guide, voice, follow, events] = await Promise.all([
      api(`https://games.roblox.com/v1/games?universeIds=${id}`),
      api(`https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${id}`).catch(() => []),
      api(`https://games.roblox.com/v1/games/votes?universeIds=${id}`).catch(() => ({})),
      api(`https://games.roblox.com/v1/games/${id}/votes/user`).catch(() => null),
      api(`https://games.roblox.com/v2/games/${id}/media`).catch(() => ({})),
      api(`https://games.roblox.com/v1/games/recommendations/game/${id}?maxRows=12`).catch(() => ({})),
      api('https://apis.roblox.com/experience-guidelines-api/experience-guidelines/get-age-recommendation', { universeId: String(id) }).catch(() => null),
      api(`https://voice.roblox.com/v1/settings/universe/${id}`).catch(() => null),
      state.me ? api(`https://followings.roblox.com/v1/users/${state.me.id}/universes/${id}/status`).catch(() => null) : null,
      api(`https://apis.roblox.com/virtual-events/v1/universes/${id}/virtual-events?limit=5`).catch(() => ({})),
    ]);
    if (!alive()) return;
    const info = details.data?.[0];
    if (!info) {
      root.replaceChildren(el('p', 'section-note', 'Roblox has no game with that ID.'));
      return;
    }
    rememberGame({ universeId: info.id, rootPlaceId: info.rootPlaceId, name: info.name, playerCount: info.playing });
    const imageIds = (media.data || []).filter(m => m.imageId && m.approved).slice(0, 8);
    const images = await thumbnails(imageIds.map(m => ({ key: String(m.imageId), request: { targetId: m.imageId, type: 'Asset', size: '768x432' } }))).catch(() => ({}));
    const related = (recommended.games || []).map(g => ({ universeId: g.universeId, rootPlaceId: g.placeId, name: g.name, playerCount: g.playerCount, totalUpVotes: g.totalUpVotes, totalDownVotes: g.totalDownVotes }));
    await gameArt(related.concat(state.games[info.id] || []));
    const friendRow = friend ? state.friends.find(f => String(f.id) === friend) : null;
    if (friendRow) await Promise.all([faces([friendRow.id]), userNames([friendRow.id])]);
    await imageReady(state.art[info.id] || images[imageIds[0]?.imageId]);
    if (!alive()) return;
    render(root, state.games[info.id], {
      info,
      media: imageIds.map(m => images[m.imageId]).filter(Boolean),
      votes: voteTotals.data?.[0],
      userVote,
      status: Array.isArray(playability) ? playability[0] : null,
      friend: friendRow,
      guide,
      voice,
      follow,
      events: (events.data || []).filter(e => e.eventStatus !== 'unpublished'),
    }, related);
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showGame(root, { id, friend }, alive));
  }
}
