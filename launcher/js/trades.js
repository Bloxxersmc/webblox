import { api, button, chunks, confirmDialog, dropdown, el, faces, failed, icon, image, link, loadFailure, loadMore, longDate, message, skeleton, state, thumbnails, toast } from './core.js';
import { holdBadge, itemDetails, robuxAmount, serialBadge } from './market.js';
import { itemFlags, itemValues, loadValues, rovalraOn, worthOf } from './values.js';

const TRADES = 'https://trades.roblox.com';
const LISTS = [['inbound', 'Received', 'Inbound'], ['outbound', 'Sent', 'Outbound'], ['completed', 'Completed', 'Completed'], ['inactive', 'Closed', 'Inactive']];
const LIST_PAGE = 25;
const INVENTORY_PAGE = 25;
const INVENTORY_FETCH = 50;
const INVENTORY_MAX_PAGES = 40;
const CARDS_PER_PAGE = 10;
const DETAILS_CHUNK = 100;
const ASSET_GROUPS = { 8: 'Hat accessories', 41: 'Hair accessories', 42: 'Face accessories', 43: 'Neck accessories', 44: 'Shoulder accessories', 45: 'Front accessories', 46: 'Back accessories', 47: 'Waist accessories', 19: 'Gear', 18: 'Faces', 17: 'Heads' };
const GROUP_ORDER = [...Object.values(ASSET_GROUPS), 'Bundles', 'Other'];
const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_FEE = 0.3;
const DETAIL_WIDTH = 760;
const LIST_VALUE_WORKERS = 2;
const ACCOUNT_SETTINGS = 'https://accountsettings.roblox.com/v1';
const QUALITY = [['None', 'None'], ['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']];
const STATUS = {
  Open: 'Open',
  Pending: 'Pending',
  Completed: 'Completed',
  Expired: 'Expired',
  Declined: 'Declined',
  Countered: 'Countered',
  Processing: 'Processing',
  RejectedDueToError: 'Rejected due to error',
  InterventionRequired: 'Under review',
  TwoStepVerificationRequired: 'Needs 2-step verification',
};
const EMPTY = {
  inbound: ['You have no trades received', 'All offers will be here.'],
  outbound: ['You have no trades sent', 'Trades you send will be here.'],
  completed: ['You have no completed trades', 'Trades that went through will be here.'],
  inactive: ['You have no closed trades', 'Declined, expired and countered trades will be here.'],
};
const HEADINGS = {
  open: ['Items you will give', 'Items you will receive'],
  completed: ['Items you gave', 'Items you received'],
  closed: ['Items you would have given', 'Items you would have received'],
};
const INELIGIBLE = {
  IneligibleTradeSystemDisabled: 'Trading is turned off on Roblox right now.',
  IneligibleCannotTradeWithRoblox: "You can't trade with Roblox.",
  IneligibleUserNotFound: 'Roblox could not find your account.',
  IneligibleMissingPremiumMembership: 'Trading needs Roblox Premium on this account.',
  IneligibleLegalOrRegulatoryRestrictions: "Trading isn't available where you live.",
  IneligibleFreeTradesLimitReached: "You've used all your free trades for now.",
  IneligibleAgeCheckRequired: 'Roblox needs an age check before you can trade.',
  CallingUserIneligible: "Your account can't trade right now.",
  TargetUserIneligible: "This person can't trade right now.",
  CannotTradeWithSelf: "You can't trade with yourself.",
  CallingUserPrivacySettingsRestricted: 'Your privacy settings stop you from trading with this person.',
  CallingUserAgeCheckRequired: 'Roblox needs an age check before you can trade.',
};
const WINDOWS = { day: 'today', week: 'this week', month: 'this month', year: 'this year', lifetime: '' };

const art = {};
const details = new Map();
const assetTypes = new Map();
const waiting = [];
let working = 0;

const instance = (raw, parent = {}) => ({
  id: raw.collectibleItemInstanceId,
  itemType: raw.itemTarget?.itemType || parent.itemTarget?.itemType || 'Asset',
  targetId: raw.itemTarget?.targetId || parent.itemTarget?.targetId,
  name: raw.itemName || parent.itemName || 'Item',
  serial: raw.serialNumber || null,
  stock: raw.assetStock ?? parent.assetStock ?? null,
  rap: raw.recentAveragePrice ?? parent.recentAveragePrice ?? 0,
  onHold: Boolean(raw.isOnHold),
});

const artKey = item => `${item.itemType}:${item.targetId}`;
const rapTotal = side => side.items.reduce((sum, item) => sum + item.rap, 0) + side.robux;
const worthTotal = side => side.items.reduce((sum, item) => sum + worthOf(item), 0) + side.robux;
const plural = (count, word) => `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
const shortDate = value => new Date(value).toLocaleDateString('en', { month: 'numeric', day: 'numeric', year: 'numeric' });
const signed = number => `${number > 0 ? '+' : number < 0 ? '−' : ''}${Math.abs(number).toLocaleString('en')}`;
const tone = number => (number > 0 ? 'up' : number < 0 ? 'down' : '');

async function itemArt(items) {
  const needed = [...new Map(items.filter(item => item.targetId && !art[artKey(item)]).map(item => [artKey(item), item])).values()];
  if (!needed.length) return;
  Object.assign(art, await thumbnails(needed.map(item => ({ key: artKey(item), request: { targetId: Number(item.targetId), type: item.itemType === 'Bundle' ? 'BundleThumbnail' : 'Asset', size: '150x150' } }))).catch(() => ({})));
}

function tradeDetails(id) {
  if (!details.has(id)) {
    const request = api(`${TRADES}/v2/trades/${id}`);
    details.set(id, request);
    request.catch(() => details.delete(id));
  }
  return details.get(id);
}

function queued(run) {
  return new Promise((resolve, reject) => {
    waiting.push([run, resolve, reject]);
    pump();
  });
}

function pump() {
  while (working < LIST_VALUE_WORKERS && waiting.length) {
    const [run, resolve, reject] = waiting.shift();
    working++;
    run().then(resolve, reject).finally(() => {
      working--;
      pump();
    });
  }
}

function sides(trade) {
  const offer = raw => ({ user: raw?.user || {}, robux: raw?.robux || 0, items: (raw?.items || []).map(item => instance(item)) });
  const a = offer(trade.participantAOffer);
  const b = offer(trade.participantBOffer);
  return String(b.user.id) === String(state.me?.id) ? [b, a] : [a, b];
}

function describe(side) {
  const parts = [];
  if (side.items.length) parts.push(plural(side.items.length, 'item'));
  if (side.robux) parts.push(`${side.robux.toLocaleString('en')} Robux`);
  return parts.join(' and ') || 'nothing';
}

function blockedReason(mine, withThem) {
  if (mine && mine.canTrade === false) return INELIGIBLE[mine.tradeEligibility] || "Your account can't trade right now.";
  if (withThem && withThem.canTrade === false) return INELIGIBLE[withThem.mutualTradeEligibility] || "You can't trade with this person.";
  return null;
}

function allowanceNote(mine) {
  const allowance = mine?.freeTradesAllowance;
  if (!(allowance?.limit > 0) || !(allowance.remaining >= 0)) return null;
  return `${allowance.remaining}/${allowance.limit} free trades left ${WINDOWS[allowance.window] ?? ''}`.trim();
}

function tradeCard(item, onSelect) {
  const node = onSelect ? button('trade-card') : link('trade-card', `#/item/${item.itemType}/${item.targetId}`);
  node.title = item.name;
  const frame = el('span', 'trade-card-art');
  frame.append(image(art[artKey(item)], '', true));
  const badges = el('span', 'item-badges');
  badges.append(serialBadge(item.serial, item.stock));
  if (item.onHold) badges.append(holdBadge());
  frame.append(badges);
  const flags = itemFlags(item.itemType, item.targetId);
  if (flags) frame.append(flags);
  if (onSelect) {
    const mark = el('span', 'worn-mark');
    mark.append(icon('check', true));
    frame.append(mark);
    node.addEventListener('click', onSelect);
  }
  const prices = el('span', 'trade-card-prices');
  prices.append(robuxAmount(item.rap));
  const value = rovalraOn('tradeValues') && itemValues(item.itemType, item.targetId)?.value;
  if (value) prices.append(el('span', 'trade-card-value', `${value.toLocaleString('en')} value`));
  node.append(frame, el('span', 'trade-card-name', item.name), prices);
  return node;
}

function winLoss(give, get) {
  if (!rovalraOn('winLoss')) return null;
  const box = el('div', 'trade-winloss');
  const stat = (label, mine, theirs) => {
    const difference = theirs - mine;
    const percent = mine > 0 && difference ? ` (${signed(Math.round((difference / mine) * 100))}%)` : '';
    const node = el('span', `trade-stat ${tone(difference)}`);
    node.append(el('span', '', label), el('strong', '', `${signed(difference)}${percent}`));
    return node;
  };
  box.append(stat('Value', worthTotal(give), worthTotal(get)), stat('RAP', rapTotal(give), rapTotal(get)));
  return box;
}

function postTaxNote(get, fee) {
  if (!rovalraOn('postTax') || get.robux <= 1) return null;
  const after = worthTotal({ ...get, robux: 0 }) + Math.floor(get.robux * (1 - fee));
  const note = el('p', 'trade-tax');
  note.append(`Value received after the ${Math.round(fee * 100)}% Robux fee: `, el('strong', '', after.toLocaleString('en')));
  return note;
}

function offerSection(title, side, fee) {
  const box = el('section', 'trade-offer');
  const grid = el('div', 'trade-cards');
  grid.append(...side.items.map(item => tradeCard(item)));
  if (!grid.children.length) grid.append(el('p', 'section-note', 'No items'));
  const lines = el('div', 'trade-offer-lines');
  const line = (label, amount, className) => {
    const row = el('div', `trade-offer-line ${className}`);
    row.append(el('span', '', label), robuxAmount(amount));
    lines.append(row);
    return row;
  };
  if (side.robux) line(`Robux offered (after ${Math.round(fee * 100)}% fee):`, Math.floor(side.robux * (1 - fee)), 'robux');
  const total = line('Total value:', rapTotal(side), 'total');
  if (rovalraOn('tradeValues')) total.append(el('span', 'trade-total-value', `${worthTotal(side).toLocaleString('en')} value`));
  box.append(el('h3', '', title), grid, lines);
  return box;
}

function settingsDialog(title, body) {
  const dialog = el('dialog', 'dialog trades-dialog');
  const head = el('header', 'trades-dialog-head');
  const close = button('icon-button trades-dialog-close');
  close.setAttribute('aria-label', 'Close');
  close.append(icon('x'));
  head.append(el('h2', '', title), close);
  dialog.append(head, ...body);
  const finish = () => {
    dialog.close();
    dialog.remove();
  };
  close.addEventListener('click', finish);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) finish();
  });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

function qualityFilter() {
  const list = el('div', 'trades-quality');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Minimum trade quality');
  let saved = null;
  for (const [value, label] of QUALITY) {
    const row = el('label', 'trades-quality-row');
    const input = el('input');
    input.type = 'radio';
    input.name = 'trade-quality';
    input.value = value;
    input.disabled = true;
    input.addEventListener('change', async () => {
      try {
        await api(`${ACCOUNT_SETTINGS}/trade-value`, { tradeValue: value });
        saved = value;
        toast(value === 'None' ? 'Trade filter turned off' : `Only ${label.toLowerCase()} quality trades and up will reach you`);
      } catch (err) {
        list.querySelector(`input[value='${saved}']`).checked = true;
        failed("Your trade filter didn't save.", err);
      }
    });
    row.append(el('span', '', label), input);
    list.append(row);
  }
  const problem = el('p', 'reason');
  problem.hidden = true;
  settingsDialog('Trade Quality Filter', [el('p', '', 'Only let new trades through if they meet your minimum quality. Anything below gets filtered out automatically.'), list, problem]);
  api(`${ACCOUNT_SETTINGS}/trade-value`).then(result => {
    saved = result.tradeValue || 'None';
    list.querySelectorAll('input').forEach(input => {
      input.disabled = false;
      input.checked = input.value === saved;
    });
  }, () => {
    problem.textContent = "Your trade filter didn't load. Try again in a moment.";
    problem.hidden = false;
  });
}

function tradeInfo(metadata) {
  const max = metadata.maxItemsPerSide || DEFAULT_MAX_ITEMS;
  const fee = Math.round((metadata.tradeSystemRobuxFee ?? DEFAULT_FEE) * 100);
  const list = el('ul', 'trades-info');
  for (const text of [
    `Each side of a trade can hold up to ${max} items, plus Robux.`,
    `Roblox keeps ${fee}% of any Robux added to a trade.`,
    'Trades expire if nobody answers them in time.',
    "Items with a clock are on hold and can't be traded again until the hold ends.",
    'Hover the star on an item to see its serial number and how many exist.',
  ]) list.append(el('li', '', text));
  settingsDialog('About trades', [list]);
}

async function showDetail(pane, summary, type, hooks) {
  const token = (pane.dataset.token = String(Number(pane.dataset.token || 0) + 1));
  pane.replaceChildren(el('p', 'section-note trades-loading', 'Loading trade…'));
  try {
    const [trade] = await Promise.all([tradeDetails(summary.id), rovalraOn() ? loadValues() : null]);
    const [mine, theirs] = sides(trade);
    await itemArt(mine.items.concat(theirs.items));
    if (pane.dataset.token !== token || !pane.isConnected) return;
    const status = trade.status || summary.status;
    const open = status === 'Open';
    const [giveTitle, getTitle] = HEADINGS[open ? 'open' : type === 'completed' ? 'completed' : 'closed'];
    const who = summary.user?.displayName || summary.user?.name || 'Roblox user';
    const back = button('back trades-back');
    back.append(icon('chevron-large-left'), 'Trades');
    back.addEventListener('click', hooks.onBack);
    const title = el('h2', 'trades-title');
    title.append(`Trade with ${who} `, link('trades-handle', `#/user/${summary.user?.id}`, `@${summary.user?.name || ''}`));
    const sub = el('p', 'trades-sub');
    if (open && summary.expiration) sub.append(`Expires on ${longDate(summary.expiration)}`);
    else sub.append(el('span', 'trades-status', STATUS[status] || status), `Sent ${longDate(summary.created)}`);
    const parts = [back, title, sub];
    const stats = winLoss(mine, theirs);
    if (stats) parts.push(stats);
    parts.push(offerSection(giveTitle, mine, hooks.fee), offerSection(getTitle, theirs, hooks.fee));
    const tax = postTaxNote(theirs, hooks.fee);
    if (tax) parts.push(tax);
    const actions = el('div', 'trades-actions');
    const act = (label, className, run) => {
      const node = button(className, label);
      node.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach(b => {
          b.disabled = true;
        });
        try {
          if (await run() !== false) hooks.onChange();
        } catch (err) {
          failed(`${label} didn't work.`, err);
        }
        actions.querySelectorAll('button').forEach(b => {
          b.disabled = false;
        });
      });
      return node;
    };
    if (open && type === 'inbound') {
      actions.append(
        act('Accept', 'play', async () => {
          if (!await confirmDialog('Accept this trade?', `You give ${describe(mine)} and get ${describe(theirs)}. This can't be undone.`, 'Accept trade')) return false;
          await api(`${TRADES}/v1/trades/${summary.id}/accept`, {});
          toast('Trade accepted');
        }),
        act('Counter', 'more', async () => {
          location.hash = `#/trades/counter/${summary.id}`;
          return false;
        }),
        act('Decline', 'more', async () => {
          if (!await confirmDialog('Decline this trade?', `${who} will see that you declined it.`, 'Decline', true)) return false;
          await api(`${TRADES}/v1/trades/${summary.id}/decline`, {});
          toast('Trade declined');
        }),
      );
    } else if (open && type === 'outbound') {
      actions.append(act('Cancel trade', 'more', async () => {
        if (!await confirmDialog('Cancel this trade?', `${who} won't be able to accept it any more.`, 'Cancel trade', true)) return false;
        await api(`${TRADES}/v1/trades/${summary.id}/decline`, {});
        toast('Trade cancelled');
      }));
    }
    if (actions.children.length) parts.push(actions);
    pane.replaceChildren(...parts);
  } catch (err) {
    if (pane.dataset.token === token) pane.replaceChildren(el('p', 'reason trades-loading', "This trade didn't load. Try again in a moment."));
    console.warn('[launcher] trade failed:', err.message);
  }
}

function rowValues(row, trade) {
  if (!rovalraOn('listValues')) return;
  queued(async () => {
    const [detail] = await Promise.all([tradeDetails(trade.id), loadValues()]);
    return detail;
  }).then(detail => {
    if (!row.isConnected) return;
    const [mine, theirs] = sides(detail);
    const give = worthTotal(mine);
    const get = worthTotal(theirs);
    const box = el('span', `trades-row-values ${tone(get - give)}`);
    box.title = `You give ${give.toLocaleString('en')} and get ${get.toLocaleString('en')} in value`;
    box.append(el('span', '', give.toLocaleString('en')), el('span', '', get.toLocaleString('en')));
    row.append(box);
  }).catch(() => {});
}

export async function showTrades(root, { tab }, alive) {
  skeleton(root);
  let current = LISTS.find(([id]) => id === tab)?.[0] || 'inbound';
  try {
    const [count, mine, metadata] = await Promise.all([
      api(`${TRADES}/v1/trades/Inbound/count`),
      api(`${TRADES}/v2/users/me/can-trade`).catch(() => null),
      api(`${TRADES}/v1/trades/metadata`).catch(() => ({})),
    ]);
    if (!alive()) return;
    if (rovalraOn()) loadValues();
    const fee = metadata.tradeSystemRobuxFee ?? DEFAULT_FEE;
    const shell = el('div', 'trades-shell');
    const side = el('aside', 'trades-side');
    const head = el('header', 'trades-side-head');
    const tools = el('div', 'trades-tools');
    const info = button('icon-button');
    info.setAttribute('aria-label', 'About trades');
    info.append(icon('circle-info'));
    info.addEventListener('click', () => tradeInfo(metadata));
    const filter = button('icon-button');
    filter.setAttribute('aria-label', 'Trade quality filter');
    filter.append(icon('gear'));
    filter.addEventListener('click', qualityFilter);
    tools.append(info, filter);
    head.append(el('h1', '', 'Trades'), tools);
    const pills = el('div', 'trades-pills');
    pills.setAttribute('role', 'tablist');
    const list = el('div', 'trades-list');
    const status = el('div', 'trades-empty');
    const moreSlot = el('div', 'trades-more');
    const scroller = el('div', 'trades-scroll');
    scroller.append(list, status, moreSlot);
    side.append(head, pills);
    const blocked = blockedReason(mine, null);
    const allowance = allowanceNote(mine);
    if (blocked || allowance) {
      const card = el('div', 'trades-allowance');
      card.append(icon('arrows-swap'), el('span', '', blocked || allowance));
      side.append(card);
    }
    side.append(scroller);
    const pane = el('section', 'trades-pane');
    pane.setAttribute('aria-live', 'polite');
    shell.append(side, pane);

    let token = 0;
    let cursor = '';
    let inbound = count.count || 0;
    const blank = () => {
      shell.classList.remove('has-selection');
      const box = el('div', 'trades-blank');
      const glyph = el('span', 'trades-blank-icon');
      glyph.append(icon('arrows-swap'));
      box.append(glyph, el('p', '', list.children.length ? 'Choose a trade to see it here.' : 'Nothing to show yet.'));
      pane.replaceChildren(box);
    };
    const select = (trade, row) => {
      list.querySelectorAll('[aria-current]').forEach(node => node.removeAttribute('aria-current'));
      row.setAttribute('aria-current', 'true');
      shell.classList.add('has-selection');
      showDetail(pane, trade, current, {
        fee,
        onBack: () => {
          row.removeAttribute('aria-current');
          blank();
        },
        onChange: () => {
          recount();
          load();
        },
      });
    };
    const row = trade => {
      const node = button('trades-row');
      const text = el('span', 'trades-row-text');
      text.append(el('strong', '', trade.user?.displayName || trade.user?.name || 'Roblox user'), el('span', `trades-row-status ${trade.status === 'Open' ? 'open' : ''}`, STATUS[trade.status] || trade.status));
      const meta = el('span', 'trades-row-meta');
      meta.append(el('span', 'trades-row-date', shortDate(trade.created)));
      node.append(image(state.faces[trade.user?.id], '', true), text, meta);
      node.addEventListener('click', () => select(trade, node));
      rowValues(meta, trade);
      return node;
    };
    const page = async () => {
      const mine = token;
      const type = LISTS.find(([id]) => id === current)[2];
      const result = await api(`${TRADES}/v1/trades/${type}?limit=${LIST_PAGE}&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const trades = result.data || [];
      await faces(trades.map(trade => trade.user?.id));
      if (mine !== token) return false;
      for (const trade of trades) if (trade.user?.id) state.names[trade.user.id] ||= { displayName: trade.user.displayName, name: trade.user.name };
      list.append(...trades.map(row));
      cursor = result.nextPageCursor || '';
      return Boolean(cursor);
    };
    const load = async () => {
      const mine = ++token;
      cursor = '';
      list.replaceChildren();
      moreSlot.replaceChildren();
      status.replaceChildren(el('p', 'section-note', 'Loading trades…'));
      blank();
      try {
        const again = await page();
        if (mine !== token) return;
        status.replaceChildren();
        if (!list.children.length) {
          const [title, text] = EMPTY[current];
          const glyph = el('span', 'trades-blank-icon');
          glyph.append(icon('arrows-swap'));
          status.append(glyph, el('strong', '', title), el('span', '', text));
        }
        if (again) moreSlot.replaceChildren(loadMore('Show more', page));
        if (list.firstElementChild && shell.clientWidth >= DETAIL_WIDTH) list.firstElementChild.click();
        else blank();
      } catch (err) {
        if (mine === token) status.replaceChildren(el('p', 'reason', "Trades didn't load. Try again in a moment."));
        console.warn('[launcher] trades failed:', err.message);
      }
    };
    const pill = ([id, label]) => {
      const node = button('trades-pill', label);
      node.setAttribute('role', 'tab');
      node.dataset.list = id;
      node.addEventListener('click', () => {
        if (current === id) return;
        current = id;
        history.replaceState(null, '', `#/trades/${id}`);
        paintPills();
        load();
      });
      return node;
    };
    const pillNodes = LISTS.map(pill);
    pills.append(...pillNodes);
    function paintPills() {
      for (const node of pillNodes) {
        const on = node.dataset.list === current;
        node.setAttribute('aria-selected', String(on));
        node.tabIndex = on ? 0 : -1;
        node.querySelector('.trades-pill-count')?.remove();
        if (node.dataset.list === 'inbound' && inbound) node.append(el('span', 'trades-pill-count', String(inbound)));
      }
    }
    async function recount() {
      const fresh = await api(`${TRADES}/v1/trades/Inbound/count`).catch(() => null);
      if (!fresh) return;
      inbound = fresh.count || 0;
      paintPills();
    }
    paintPills();
    root.replaceChildren(shell);
    load();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showTrades(root, { tab }, alive));
  }
}

async function tradableItems(ownerId) {
  const items = [];
  let cursor = '';
  let limit = INVENTORY_FETCH;
  for (let page = 0; page < INVENTORY_MAX_PAGES; page++) {
    const query = new URLSearchParams({ sortBy: 'CreationTime', limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    let result;
    try {
      result = await api(`${TRADES}/v2/users/${ownerId}/tradableItems?${query}`);
    } catch (err) {
      if (err.status !== 400 || limit === INVENTORY_PAGE) throw err;
      limit = INVENTORY_PAGE;
      page--;
      continue;
    }
    items.push(...(result.items || []).flatMap(parent => (parent.instances || []).map(raw => instance(raw, parent))));
    cursor = result.nextPageCursor || '';
    if (!cursor) break;
  }
  return items;
}

async function loadAssetTypes(items) {
  const ids = [...new Set(items.filter(item => item.itemType !== 'Bundle' && !assetTypes.has(String(item.targetId))).map(item => String(item.targetId)))];
  const found = await Promise.all(chunks(ids, DETAILS_CHUNK).map(group => itemDetails(group.map(id => ({ itemType: 'Asset', id: Number(id) }))).catch(() => [])));
  for (const detail of found.flat()) assetTypes.set(String(detail.id), detail.assetType);
}

const groupOf = item => (item.itemType === 'Bundle' ? 'Bundles' : ASSET_GROUPS[assetTypes.get(String(item.targetId))] || 'Other');

function inventoryPanel(title, ownerId, emptyText, side, sync) {
  const panel = el('section', 'trade-inventory-panel');
  const head = el('header', 'inventory-panel-header');
  head.append(el('h2', 'inventory-label', title));
  const filters = el('div', 'inventory-filter-row');
  const typeSlot = el('div', 'inventory-type');
  const search = el('div', 'inventory-search');
  const field = el('input', 'inventory-search-input');
  field.type = 'search';
  field.placeholder = 'Search items';
  field.setAttribute('aria-label', `Search ${title.toLowerCase()}`);
  field.hidden = true;
  const toggle = button('inventory-search-toggle');
  toggle.setAttribute('aria-label', 'Search items');
  toggle.append(icon('magnifying-glass'));
  search.append(field, toggle);
  filters.append(typeSlot, search);
  const grid = el('div', 'trade-inventory-grid');
  const status = el('p', 'trade-inventory-status', 'Loading items…');
  const pager = el('div', 'trade-inventory-pager');
  const previous = button('pager-button');
  previous.setAttribute('aria-label', 'Previous page');
  previous.append(icon('chevron-large-left'));
  const label = el('span', 'pager-label');
  const next = button('pager-button');
  next.setAttribute('aria-label', 'Next page');
  next.append(icon('chevron-large-right'));
  pager.append(previous, label, next);
  pager.hidden = true;
  panel.append(head, filters, grid, status, pager);

  let items = [];
  let group = 'all';
  let keyword = '';
  let page = 0;
  const visible = () => items.filter(item => (group === 'all' || groupOf(item) === group) && (!keyword || item.name.toLowerCase().includes(keyword)));
  const render = () => {
    const list = visible();
    const pages = Math.max(1, Math.ceil(list.length / CARDS_PER_PAGE));
    page = Math.min(page, pages - 1);
    grid.replaceChildren(...list.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE).map(item => {
      const card = tradeCard(item, () => sync(side, item));
      card.dataset.instance = item.id;
      card.setAttribute('aria-pressed', String(side.items.has(item.id)));
      if (item.onHold) {
        card.disabled = true;
        card.title = `${item.name} is on hold and can't be traded yet.`;
      }
      return card;
    }));
    label.textContent = `Page ${page + 1} of ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page >= pages - 1;
    pager.hidden = pages < 2;
    status.hidden = Boolean(list.length);
    status.textContent = items.length ? 'No items match.' : emptyText;
  };
  previous.addEventListener('click', () => {
    page--;
    render();
  });
  next.addEventListener('click', () => {
    page++;
    render();
  });
  toggle.addEventListener('click', () => {
    field.hidden = !field.hidden;
    search.classList.toggle('is-open', !field.hidden);
    if (!field.hidden) field.focus();
    else if (keyword) {
      field.value = '';
      keyword = '';
      render();
    }
  });
  field.addEventListener('input', () => {
    keyword = field.value.trim().toLowerCase();
    page = 0;
    render();
  });
  field.addEventListener('keydown', event => {
    if (event.key === 'Escape') toggle.click();
  });

  (async () => {
    try {
      items = await tradableItems(ownerId);
      await Promise.all([itemArt(items), loadAssetTypes(items)]);
      const groups = [...new Set(items.map(groupOf))].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
      typeSlot.replaceChildren(dropdown({
        label: 'Item type',
        className: 'dropdown-chip',
        options: [['all', 'All'], ...groups.map(name => [name, name])],
        value: 'all',
        onPick: value => {
          group = value;
          page = 0;
          render();
        },
      }));
      render();
    } catch (err) {
      status.textContent = err.status === 403 ? "This person's inventory is private." : "Items didn't load. Try again in a moment.";
      console.warn('[launcher] tradable items failed:', err.message);
    }
  })();
  return panel;
}

export async function showTradeComposer(root, { userId, tradeId }, alive) {
  skeleton(root);
  try {
    let partnerId = userId;
    let counterOf = null;
    if (tradeId) {
      counterOf = sides(await tradeDetails(tradeId));
      partnerId = counterOf[1].user.id;
    }
    const meId = state.me?.id;
    const [user, metadata, mine, withThem] = await Promise.all([
      api(`https://users.roblox.com/v1/users/${partnerId}`),
      api(`${TRADES}/v1/trades/metadata`).catch(() => ({})),
      api(`${TRADES}/v2/users/me/can-trade`).catch(() => null),
      api(`${TRADES}/v2/users/${partnerId}/can-trade-with`).catch(() => null),
      faces([meId, partnerId]),
      rovalraOn() ? loadValues() : null,
    ]);
    if (!alive()) return;
    state.names[partnerId] = { displayName: user.displayName, name: user.name, verified: user.hasVerifiedBadge };
    const blocked = blockedReason(mine, withThem);
    if (blocked) {
      message(root, `You can't trade with ${user.displayName}`, blocked, link('more', `#/user/${partnerId}`, 'Back to profile'));
      return;
    }
    const max = metadata.maxItemsPerSide || DEFAULT_MAX_ITEMS;
    const fee = metadata.tradeSystemRobuxFee ?? DEFAULT_FEE;
    const robuxShare = metadata.tradeSystemMaxRobuxPercent;
    const currency = withThem?.currencyTransferEligibility || mine?.currencyTransferEligibility;
    const give = { key: 'give', title: 'Your offer', items: new Map(), robux: 0, robuxAllowed: currency?.canSend !== false };
    const get = { key: 'get', title: 'Your request', items: new Map(), robux: 0, robuxAllowed: currency?.canRequest !== false };
    if (counterOf) {
      for (const item of counterOf[0].items) give.items.set(item.id, item);
      for (const item of counterOf[1].items) get.items.set(item.id, item);
      give.robux = give.robuxAllowed ? counterOf[0].robux : 0;
      get.robux = get.robuxAllowed ? counterOf[1].robux : 0;
      await itemArt(counterOf[0].items.concat(counterOf[1].items));
      if (!alive()) return;
    }
    const plain = side => ({ items: [...side.items.values()], robux: side.robux });

    const sendButton = button('play trade-send', counterOf ? 'Send counter' : 'Make offer');
    const problem = el('p', 'reason');
    problem.hidden = true;
    const verdict = el('div', 'trade-verdict');
    const panels = new Map();

    const offerPanel = side => {
      const box = el('section', 'trade-offer-panel');
      const head = el('header', 'inventory-panel-header');
      const count = el('span', 'trade-count');
      head.append(el('h2', 'inventory-label', side.title), count);
      const list = el('div', 'trade-request-items');
      box.append(head, list);
      let fee = null;
      if (side.robuxAllowed) {
        const group = el('label', 'robux-input-group');
        const input = el('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.inputMode = 'numeric';
        input.placeholder = 'Plus Robux amount';
        input.value = side.robux ? String(side.robux) : '';
        input.setAttribute('aria-label', side.key === 'give' ? 'Robux to add to your offer' : 'Robux to ask for');
        input.addEventListener('input', () => {
          side.robux = Math.max(0, Math.floor(Number(input.value) || 0));
          paint();
        });
        group.append(icon('robux'), input);
        fee = el('div', 'robux-line fee');
        box.append(group, fee);
      }
      const total = el('div', 'robux-line total');
      box.append(total);
      panels.set(side.key, { list, count, fee, total });
      return box;
    };

    const sync = (side, item) => {
      if (side.items.has(item.id)) side.items.delete(item.id);
      else if (side.items.size >= max) {
        toast(`You can add up to ${max} items on each side.`, true);
        return;
      } else side.items.set(item.id, item);
      paint();
    };

    const sideProblem = side => {
      const itemRap = [...side.items.values()].reduce((sum, item) => sum + item.rap, 0);
      if (side.key === 'give' && state.robux !== undefined && side.robux > state.robux) return `You only have ${state.robux.toLocaleString('en')} Robux.`;
      if (side.robux && robuxShare && side.robux > Math.floor(itemRap * robuxShare)) return `Robux can be at most ${Math.round(robuxShare * 100)}% of the item value on its side.`;
      return null;
    };

    const amountLine = (label, amount) => {
      const value = el('span', 'robux-line-amount');
      value.append(robuxAmount(amount));
      return [el('span', '', label), value];
    };

    function paint() {
      for (const side of [give, get]) {
        const { list, count, fee: feeLine, total } = panels.get(side.key);
        const items = [...side.items.values()];
        count.textContent = `${items.length}/${max}`;
        list.replaceChildren(...items.map(item => {
          const row = el('div', 'trade-request-item');
          const text = el('span', 'trade-request-text');
          text.append(el('span', 'item-name', item.name));
          const meta = el('span', 'item-value');
          meta.append(robuxAmount(item.rap));
          if (item.serial) meta.append(el('span', 'trade-request-serial', `#${item.serial.toLocaleString('en')}`));
          text.append(meta);
          const remove = button('trade-request-item-remove');
          remove.setAttribute('aria-label', `Remove ${item.name}`);
          remove.append(icon('x'));
          remove.addEventListener('click', () => sync(side, item));
          const thumbFrame = el('span', 'trade-request-thumb');
          thumbFrame.append(image(art[artKey(item)], '', true));
          row.append(thumbFrame, text, remove);
          return row;
        }));
        if (!items.length) list.append(el('div', 'trade-request-item blank-item', side.key === 'give' ? 'Add items from your inventory' : `Add items from ${user.displayName}'s inventory`));
        if (feeLine) {
          feeLine.hidden = !side.robux;
          feeLine.replaceChildren(...amountLine(`After ${Math.round(fee * 100)}% fee:`, Math.floor(side.robux * (1 - fee))));
        }
        const sum = plain(side);
        total.replaceChildren(...amountLine('Total Value:', rapTotal(sum)));
        if (rovalraOn('tradeValues')) total.append(el('span', 'trade-total-value', `${worthTotal(sum).toLocaleString('en')} value`));
      }
      const stats = winLoss(plain(give), plain(get));
      verdict.replaceChildren();
      if (stats) verdict.append(stats);
      const tax = postTaxNote(plain(get), fee);
      if (tax) verdict.append(tax);
      verdict.hidden = !verdict.children.length;
      document.querySelectorAll('.trade-inventory-panel [data-instance]').forEach(card => {
        const side = card.closest('.trade-inventory-panel') === mineView ? give : get;
        card.setAttribute('aria-pressed', String(side.items.has(card.dataset.instance)));
      });
      const issue = sideProblem(give) || sideProblem(get);
      problem.textContent = issue || '';
      problem.hidden = !issue;
      sendButton.disabled = Boolean(issue) || (!give.items.size && !get.items.size);
    }

    sendButton.addEventListener('click', async () => {
      const giveSide = plain(give);
      const getSide = plain(get);
      const yes = await confirmDialog(counterOf ? `Counter ${user.displayName}'s trade?` : `Send this trade to ${user.displayName}?`, `You give ${describe(giveSide)} (RAP ${rapTotal(giveSide).toLocaleString('en')}) and ask for ${describe(getSide)} (RAP ${rapTotal(getSide).toLocaleString('en')}).`, counterOf ? 'Send counter' : 'Send trade');
      if (!yes) return;
      sendButton.disabled = true;
      const request = {
        senderOffer: { userId: Number(meId), robux: give.robux, collectibleItemInstanceIds: [...give.items.keys()] },
        recipientOffer: { userId: Number(partnerId), robux: get.robux, collectibleItemInstanceIds: [...get.items.keys()] },
      };
      try {
        await api(counterOf ? `${TRADES}/v2/trades/${tradeId}/counter` : `${TRADES}/v2/trades/send`, request);
        toast(counterOf ? 'Counter sent' : 'Trade sent');
        location.hash = '#/trades/outbound';
      } catch (err) {
        failed(counterOf ? "The counter didn't send." : "The trade didn't send.", err);
        paint();
      }
    });

    const back = link('back', '#/trades');
    back.append(icon('chevron-large-left'), 'Back to trades');
    const title = el('h1', 'trade-request-title');
    title.append(counterOf ? `Counter ${user.displayName}'s trade ` : `Trade with ${user.displayName} `, link('trades-handle', `#/user/${partnerId}`, `@${user.name}`));
    const top = el('header', 'trade-request-head');
    top.append(back, title);
    const note = allowanceNote(mine);
    if (note) top.append(el('p', 'section-note', note));
    const mineView = inventoryPanel('Your inventory', meId, 'You have no tradable items.', give, sync);
    const theirsView = inventoryPanel(`${user.displayName}'s inventory`, partnerId, `${user.displayName} has no tradable items.`, get, sync);
    const request = offerPanel(get);
    const foot = el('div', 'trade-request-foot');
    foot.append(verdict, problem, sendButton);
    request.append(foot);
    const body = el('div', 'trade-request-window');
    body.append(mineView, offerPanel(give), theirsView, request);
    const page = el('div', 'trade-request-page');
    page.append(top, body);
    root.replaceChildren(page);
    paint();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showTradeComposer(root, { userId, tradeId }, alive));
  }
}
