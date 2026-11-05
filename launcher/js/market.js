import { api, button, chunks, compact, confirmDialog, dropdown, el, faces, failed, icon, image, link, loadFailure, longDate, pageHead, robloxUrl, rowSection, section, send, skeleton, state, thumbnails, toast } from './core.js';
import { previewStage } from './stage.js';
import { flagNames, itemValues, loadValues, rolimonsItem, rovalraOn } from './values.js';

const ROBUX_CURRENCY = 1;
const MARKET_PAGE = 60;
const MARKET_CURATED = 120;
const MARKET_PRELOAD_PX = 800;
const MARKET_RETRY_MS = 1500;

const CART_KEY = 'webblox.launcher.cart';
const SALES = 'https://apis.roblox.com/marketplace-sales/v1/item';
const COLLECTIBLE_RESTRICTIONS = new Set(['Limited', 'LimitedUnique', 'Collectible']);
const DAY_MS = 86400000;
const CHART_RANGES = [['30', '30D'], ['90', '90D'], ['180', '180D'], ['all', 'All']];
const MENU_URL = 'https://catalog.roblox.com/v1/search/navigation-menu-items';
const FILTERS_KEY = 'webblox.launcher.market';
const SORTS = [['0', 'Relevance'], ['1', 'Most favorited'], ['2', 'Bestselling'], ['3', 'Recently published'], ['5', 'Price: high to low'], ['4', 'Price: low to high']];
const PRICES = [['', 'Any price'], ['free', 'Free'], ['1-100', '1 to 100'], ['100-1000', '100 to 1,000'], ['1000-10000', '1,000 to 10,000'], ['10000-', '10,000 and up']];
const SALES_TYPES = [['1', 'All items'], ['2', 'Limiteds']];
const CREATORS = [['', 'All creators'], ['Roblox', 'Roblox']];
const STOCK = [['false', 'For sale'], ['true', 'Include off sale']];
const DEFAULT_FILTERS = { category: 'All', subcategory: '', keyword: '', sort: '0', price: '', sales: '1', creator: '', offsale: 'false' };
let catalogMenu = null;
const BUNDLE_TYPES = { BodyParts: 'Character', AvatarAnimations: 'Animations', Shoes: 'Shoes', DynamicHead: 'Head' };
const cartListeners = new Set();

const loadCart = () => {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
};

function saveCart(items) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {}
  cartListeners.forEach(listener => listener());
}

const inCart = item => loadCart().some(entry => entry.id === item.id && entry.itemType === item.itemType);

export const robuxAmount = (value, className = 'robux-amount') => {
  const node = el('span', className);
  node.setAttribute('aria-label', `${value.toLocaleString('en')} Robux`);
  node.append(icon('robux'), value.toLocaleString('en'));
  return node;
};

export function serialBadge(serial, stock) {
  const node = el('span', 'serial-badge');
  node.setAttribute('role', 'img');
  const words = `Serial ${serial ? `#${serial.toLocaleString('en')}` : 'N/A'}${stock ? ` / ${stock.toLocaleString('en')}` : ''}`;
  node.setAttribute('aria-label', words);
  node.append(icon('sparkle', true));
  if (serial) node.append(el('span', 'serial-number', `#${serial.toLocaleString('en')}`));
  node.append(el('span', 'item-tip', words));
  return node;
}

export function holdBadge() {
  const node = el('span', 'hold-badge');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', "On hold, can't be traded yet");
  node.append(icon('clock'), el('span', 'item-tip', "On hold, can't be traded yet"));
  return node;
}

const itemPrice = item => item.lowestPrice ?? item.price ?? 0;

async function firstSalePurchase(item) {
  const me = String(state.me.id);
  if (item.collectibleItemId) {
    const [market] = await api('https://apis.roblox.com/marketplace-items/v1/items/details', { itemIds: [item.collectibleItemId] });
    if (!market?.collectibleProductId) throw new Error('Roblox did not return this item for sale.');
    const result = await api(`${SALES}/${item.collectibleItemId}/purchase-item`, {
      collectibleItemId: item.collectibleItemId,
      collectibleProductId: market.collectibleProductId,
      expectedCurrency: ROBUX_CURRENCY,
      expectedPrice: market.price ?? item.price ?? 0,
      expectedPurchaserId: me,
      expectedPurchaserType: 'User',
      expectedSellerId: item.expectedSellerId ?? item.creatorTargetId,
      expectedSellerType: item.creatorType,
      idempotencyKey: crypto.randomUUID(),
    });
    if (result.purchased === false) throw new Error(result.errorMessage || result.purchaseResult || 'Roblox declined the purchase.');
    return;
  }
  const details = await api(`https://economy.roblox.com/v2/assets/${item.id}/details`);
  const result = await api(`https://economy.roblox.com/v1/purchases/products/${details.ProductId}`, { expectedCurrency: ROBUX_CURRENCY, expectedPrice: item.price ?? 0, expectedSellerId: item.creatorTargetId });
  if (result.purchased === false) throw new Error(result.errorMsg || result.reason || 'Roblox declined the purchase.');
}

async function resalePurchase(item, listing) {
  const result = await api(`${SALES}/${item.collectibleItemId}/purchase-resale`, {
    collectibleItemId: item.collectibleItemId,
    collectibleItemInstanceId: listing.collectibleItemInstanceId,
    collectibleProductId: listing.collectibleProductId,
    expectedCurrency: ROBUX_CURRENCY,
    expectedPrice: listing.price,
    expectedPurchaserId: String(state.me.id),
    expectedPurchaserType: 'User',
    expectedSellerId: listing.seller.sellerId,
    expectedSellerType: listing.seller.sellerType,
    idempotencyKey: crypto.randomUUID(),
  });
  if (result.purchased === false) throw new Error(result.errorMessage || result.purchaseResult || 'Roblox declined the purchase.');
}

function cartButton() {
  const node = button('icon-button cart-button');
  const paint = () => {
    const count = loadCart().length;
    node.setAttribute('aria-label', count ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart');
    node.replaceChildren(icon('shopping-cart'));
    if (count) node.append(el('span', 'badge', String(count)));
  };
  cartListeners.add(() => {
    if (node.isConnected) paint();
  });
  node.addEventListener('click', openCart);
  paint();
  return node;
}

async function openCart() {
  const dialog = el('dialog', 'dialog cart-dialog');
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const list = el('div', 'dialog-list cart-list');
  const footer = el('div', 'dialog-actions');
  const paint = async () => {
    const entries = loadCart();
    if (!entries.length) {
      list.replaceChildren(el('p', 'section-note', 'Your cart is empty.'));
      const done = button('more', 'Close');
      done.addEventListener('click', close);
      footer.replaceChildren(done);
      return;
    }
    const art = await itemThumbs(entries).catch(() => ({}));
    list.replaceChildren(...entries.map(entry => {
      const row = el('div', 'cart-row');
      const open = link('cart-open', `#/item/${entry.itemType}/${entry.id}`);
      open.addEventListener('click', close);
      const text = el('span', 'list-text');
      text.append(el('strong', '', entry.name), robuxAmount(entry.price));
      open.append(image(art[`${entry.itemType}:${entry.id}`], '', true), text);
      const remove = button('icon-button');
      remove.setAttribute('aria-label', `Remove ${entry.name} from cart`);
      remove.append(icon('x'));
      remove.addEventListener('click', () => {
        saveCart(loadCart().filter(other => !(other.id === entry.id && other.itemType === entry.itemType)));
        paint();
      });
      row.append(open, remove);
      return row;
    }));
    const total = entries.reduce((sum, entry) => sum + entry.price, 0);
    const keep = button('more', 'Keep shopping');
    keep.addEventListener('click', close);
    const buy = button('play', `Buy all for ${total.toLocaleString('en')} Robux`);
    buy.addEventListener('click', async () => {
      const yes = await confirmDialog(`Buy ${entries.length} ${entries.length === 1 ? 'item' : 'items'}?`, `This spends ${total.toLocaleString('en')} Robux. You have ${(state.robux ?? 0).toLocaleString('en')}.`, `Spend ${total.toLocaleString('en')} Robux`);
      if (!yes) return;
      buy.disabled = true;
      let bought = 0;
      for (const entry of entries) {
        try {
          const details = await api(`https://catalog.roblox.com/v1/catalog/items/${entry.id}/details?itemType=${entry.itemType}`);
          if (itemPrice(details) !== entry.price) throw new Error('The price changed.');
          await firstSalePurchase(details);
          saveCart(loadCart().filter(other => !(other.id === entry.id && other.itemType === entry.itemType)));
          bought++;
        } catch (err) {
          failed(`${entry.name} wasn't bought.`, err);
        }
      }
      if (bought) toast(`Bought ${bought} ${bought === 1 ? 'item' : 'items'}`);
      buy.disabled = false;
      paint();
    });
    footer.replaceChildren(keep, buy);
  };
  dialog.append(el('h2', '', 'Cart'), list, footer);
  document.body.append(dialog);
  dialog.showModal();
  paint();
}

const svgNode = (tag, attributes) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

function chartPoints(list) {
  return (list || []).map(point => ({ value: point.value, time: new Date(point.date).getTime() })).filter(point => Number.isFinite(point.time) && point.value > 0).sort((a, b) => a.time - b.time);
}

function priceChart(history) {
  const prices = chartPoints(history.priceDataPoints);
  const volumes = chartPoints(history.volumeDataPoints);
  const wrap = el('div', 'price-chart');
  const head = el('div', 'price-chart-head');
  const legend = el('div', 'price-legend');
  legend.append(el('span', 'price-key line', 'Average price'), el('span', 'price-key bars', 'Sales'));
  const ranges = el('div', 'price-ranges');
  ranges.setAttribute('role', 'group');
  ranges.setAttribute('aria-label', 'Time range');
  const plot = el('div', 'price-plot');
  const axis = el('div', 'price-axis');
  head.append(legend, ranges);
  wrap.append(head, plot, axis);
  let range = '180';

  const draw = () => {
    const end = Date.now();
    const start = range === 'all' ? Math.min(prices[0]?.time ?? end, end - 30 * DAY_MS) - DAY_MS : end - Number(range) * DAY_MS;
    const span = end - start;
    const shown = prices.filter(point => point.time >= start);
    const sold = volumes.filter(point => point.time >= start);
    const x = time => ((time - start) / span) * 100;
    let low = Math.min(...shown.map(point => point.value));
    let high = Math.max(...shown.map(point => point.value));
    if (low === high) {
      low *= 0.8;
      high *= 1.2;
    }
    const y = value => 6 + (1 - (value - low) / (high - low)) * 64;
    const most = Math.max(1, ...sold.map(point => point.value));
    const svg = svgNode('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const labels = el('div', 'price-labels');
    plot.replaceChildren(svg, labels);
    axis.replaceChildren();
    for (const step of [0, 0.5, 1]) {
      const value = high - (high - low) * step;
      svg.append(svgNode('line', { x1: 0, x2: 100, y1: y(value), y2: y(value), class: 'price-grid', 'vector-effect': 'non-scaling-stroke' }));
      const label = el('span', '', shown.length ? compact(value) : '');
      label.style.top = `${y(value)}%`;
      labels.append(label);
    }
    const width = Math.max(0.4, Math.min(2, 100 / (span / DAY_MS) * 0.6));
    for (const point of sold) {
      const height = (point.value / most) * 20;
      svg.append(svgNode('rect', { x: x(point.time) - width / 2, y: 100 - height, width, height, class: 'price-bar' }));
    }
    if (shown.length > 1) svg.append(svgNode('polyline', { points: shown.map(point => `${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`).join(' '), class: 'price-line', 'vector-effect': 'non-scaling-stroke' }));
    for (const point of shown.length === 1 ? shown : []) {
      const dot = el('span', 'price-dot');
      dot.style.left = `${x(point.time)}%`;
      dot.style.top = `${y(point.value)}%`;
      plot.append(dot);
    }
    if (!shown.length) plot.append(el('p', 'price-empty', 'No sales in this period'));
    const format = span > 300 * DAY_MS ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' };
    for (let tick = 0; tick <= 4; tick++) axis.append(el('span', '', new Date(start + (span * tick) / 4).toLocaleDateString('en', format)));
    const cross = el('span', 'price-cross');
    const marker = el('span', 'price-dot');
    const tip = el('span', 'price-tip');
    for (const node of [cross, marker, tip]) node.hidden = true;
    plot.append(cross, marker, tip);
    plot.onpointermove = event => {
      if (!shown.length) return;
      const box = plot.getBoundingClientRect();
      const at = ((event.clientX - box.left) / box.width) * 100;
      const point = shown.reduce((best, item) => (Math.abs(x(item.time) - at) < Math.abs(x(best.time) - at) ? item : best));
      const count = sold.find(item => Math.abs(item.time - point.time) < DAY_MS / 2)?.value;
      const left = x(point.time);
      for (const node of [cross, marker, tip]) node.hidden = false;
      cross.style.left = `${left}%`;
      marker.style.left = `${left}%`;
      marker.style.top = `${y(point.value)}%`;
      tip.replaceChildren(el('strong', '', `${point.value.toLocaleString('en')} Robux`), el('span', '', `${longDate(point.time)}${count ? `, ${count.toLocaleString('en')} sold` : ''}`));
      tip.style.left = `${left}%`;
      tip.classList.toggle('flip', left > 60);
    };
    plot.onpointerleave = () => {
      for (const node of [cross, marker, tip]) node.hidden = true;
    };
    for (const node of ranges.children) node.setAttribute('aria-pressed', String(node.dataset.range === range));
  };

  for (const [value, label] of CHART_RANGES) {
    const node = button('price-range', label);
    node.dataset.range = value;
    node.addEventListener('click', () => {
      range = value;
      draw();
    });
    ranges.append(node);
  }
  draw();
  return wrap;
}

function resaleSections(item, resale, history, listings, onBought) {
  const sections = [];
  const facts = el('dl', 'facts');
  for (const [label, value] of [['Lowest price', item.lowestResalePrice || null], ['Average price', resale?.recentAveragePrice ?? history?.recentAveragePrice], ['Original price', resale?.originalPrice], ['Sold', resale?.sales]]) {
    if (value === undefined || value === null) continue;
    const row = el('div');
    row.append(el('dt', '', label), el('dd', '', Math.round(value).toLocaleString('en')));
    facts.append(row);
  }
  const body = el('div', 'resale');
  if (history && (history.priceDataPoints?.length || history.volumeDataPoints?.length)) body.append(priceChart(history));
  if (facts.children.length) body.append(facts);
  if (body.children.length) sections.push(section('Price history', '', body));
  if (listings.length) {
    const rows = el('div', 'resellers');
    for (const listing of listings) {
      const row = el('div', 'reseller');
      const seller = listing.seller || {};
      const profile = seller.sellerType === 'Group' ? `#/group/${seller.sellerId}` : `#/user/${seller.sellerId}`;
      const face = link('reseller-face', profile);
      face.setAttribute('aria-hidden', 'true');
      face.tabIndex = -1;
      face.append(image(state.faces[seller.sellerId], '', true));
      const text = el('span', 'reseller-text');
      const serial = listing.serialNumber ? `Serial #${listing.serialNumber.toLocaleString('en')}${item.totalQuantity ? ` of ${item.totalQuantity.toLocaleString('en')}` : ''}` : 'No serial';
      text.append(link('reseller-name', profile, seller.name || 'Seller'), el('span', '', serial));
      const buy = button('reseller-buy', 'Buy');
      buy.setAttribute('aria-label', `Buy from ${seller.name || 'this seller'} for ${listing.price.toLocaleString('en')} Robux`);
      buy.addEventListener('click', async () => {
        const yes = await confirmDialog(`Buy ${item.name}?`, `This spends ${listing.price.toLocaleString('en')} Robux, paid to ${listing.seller?.name || 'the seller'}. You have ${(state.robux ?? 0).toLocaleString('en')}.`, `Spend ${listing.price.toLocaleString('en')} Robux`);
        if (!yes) return;
        buy.disabled = true;
        try {
          await resalePurchase(item, listing);
          toast(`${item.name} is yours`);
          onBought();
        } catch (err) {
          buy.disabled = false;
          failed('The purchase failed.', err);
        }
      });
      row.append(face, text, robuxAmount(listing.price, 'robux-amount reseller-price'), buy);
      rows.append(row);
    }
    sections.push(section('Resellers', '', rows));
  }
  return sections;
}

async function relatedItems(rows) {
  if (!rows.length) return [];
  const details = await itemDetails(rows);
  const art = await itemThumbs(details).catch(() => ({}));
  return details.map(item => marketTile(item, art));
}

function tryOnRender(item, avatar, details, kind) {
  const worn = avatar.assets.map(asset => ({ id: asset.id, assetTypeId: asset.assetType?.id, meta: asset.meta }));
  const adding = item.itemType === 'Bundle'
    ? (item.bundledItems || []).filter(part => part.type === 'Asset').map(part => ({ id: part.id, assetTypeId: part.assetType }))
    : [{ id: item.id, assetTypeId: item.assetType }];
  const replacing = new Set(adding.map(part => part.assetTypeId));
  const limits = new Map((details.wearableAssetTypes || []).map(type => [type.id, type.maxNumber]));
  const kept = worn.filter(asset => !replacing.has(asset.assetTypeId) || (limits.get(asset.assetTypeId) || 1) > 1);
  const assets = kept.concat(adding).map(asset => (asset.meta ? { id: asset.id, meta: asset.meta } : { id: asset.id }));
  const colors = avatar.bodyColor3s;
  return api('https://avatar.roblox.com/v1/avatar/render', {
    thumbnailConfig: { thumbnailId: item.id, thumbnailType: kind, size: '420x420' },
    avatarDefinition: {
      assets,
      bodyColors: { headColor: colors.headColor3, leftArmColor: colors.leftArmColor3, leftLegColor: colors.leftLegColor3, rightArmColor: colors.rightArmColor3, rightLegColor: colors.rightLegColor3, torsoColor: colors.torsoColor3 },
      scales: avatar.scales,
      playerAvatarType: { playerAvatarType: avatar.playerAvatarType },
    },
  });
}

export async function showItem(root, { type, id }, alive) {
  skeleton(root);
  const itemType = type === 'Bundle' ? 'Bundle' : 'Asset';
  const favoritePath = itemType === 'Bundle' ? 'bundles' : 'assets';
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [item, owned, favorite, economy, rules, wearing, large] = await Promise.all([
      api(`https://catalog.roblox.com/v1/catalog/items/${id}/details?itemType=${itemType}`),
      api(`https://inventory.roblox.com/v1/users/${state.me.id}/items/${itemType}/${id}/is-owned`).catch(() => false),
      api(`https://catalog.roblox.com/v1/favorites/users/${state.me.id}/${favoritePath}/${id}/favorite`).catch(() => null),
      itemType === 'Asset' ? api(`https://economy.roblox.com/v2/assets/${id}/details`).catch(() => null) : null,
      api('https://avatar.roblox.com/v1/avatar-rules').catch(() => ({})),
      api(`https://avatar.roblox.com/v1/users/${state.me.id}/currently-wearing`).catch(() => ({})),
      thumbnails([{ key: 'large', request: { targetId: Number(id), type: itemType === 'Bundle' ? 'BundleThumbnail' : 'Asset', size: '420x420' } }]).catch(() => ({})),
      rovalraOn('itemPages') ? loadValues() : null,
    ]);
    if (!alive()) return;
    const roli = rovalraOn('itemPages') ? itemValues(itemType, id) : null;

    const restricted = (item.itemRestrictions || []).some(tag => COLLECTIBLE_RESTRICTIONS.has(tag));
    const outfit = (item.bundledItems || []).find(part => part.type === 'UserOutfit');
    const url3d = itemType === 'Bundle'
      ? outfit && `https://thumbnails.roblox.com/v1/users/outfit-3d?outfitId=${outfit.id}`
      : `https://thumbnails.roblox.com/v1/assets-thumbnail-3d?assetId=${id}`;
    const base3d = url3d ? (previous, viewer) => viewer.thumbnail3d(url3d, previous) : null;
    const base2d = async () => large.large;
    const tryOn = button('avatar-try', 'Try on');
    tryOn.setAttribute('aria-pressed', 'false');
    const stage = previewStage({ src: large.large, alt: item.name, source3d: base3d, source2d: base2d, quiet: true, extras: [tryOn] });
    let avatarData = null;
    tryOn.addEventListener('click', async () => {
      const on = tryOn.getAttribute('aria-pressed') !== 'true';
      tryOn.setAttribute('aria-pressed', String(on));
      tryOn.textContent = on ? 'Stop trying on' : 'Try on';
      if (!on) {
        await stage.swap(base3d, base2d);
        return;
      }
      try {
        avatarData = avatarData || await api('https://avatar.roblox.com/v2/avatar/avatar');
        const render3d = async (previous, viewer) => {
          const result = await tryOnRender(item, avatarData, rules, '3d');
          if (result.state !== 'Completed' || !result.imageUrl || result.imageUrl === previous) return null;
          return { url: result.imageUrl, data: await api(result.imageUrl) };
        };
        const render2d = async () => {
          const result = await tryOnRender(item, avatarData, rules, '2dWebp');
          return result.state === 'Completed' ? result.imageUrl : null;
        };
        const done = await stage.swap(render3d, render2d);
        if (!done && tryOn.getAttribute('aria-pressed') === 'true') {
          toast("Roblox couldn't render this on your avatar.", true);
          tryOn.setAttribute('aria-pressed', 'false');
          tryOn.textContent = 'Try on';
          await stage.swap(base3d, base2d);
        }
      } catch (err) {
        failed("Try on didn't work.", err);
        tryOn.setAttribute('aria-pressed', 'false');
        tryOn.textContent = 'Try on';
        await stage.swap(base3d, base2d);
      }
    });

    const social = el('div', 'item-social');
    let favorited = Boolean(favorite);
    let favoriteCount = item.favoriteCount ?? 0;
    const fav = button('text-action');
    const paintFav = () => {
      fav.replaceChildren(icon('star', favorited), compact(favoriteCount));
      fav.setAttribute('aria-pressed', String(favorited));
      fav.setAttribute('aria-label', `${favorited ? 'Remove from favorites' : 'Add to favorites'}, ${compact(favoriteCount)} favorites`);
    };
    fav.addEventListener('click', async () => {
      const url = `https://catalog.roblox.com/v1/favorites/users/${state.me.id}/${favoritePath}/${id}/favorite`;
      try {
        if (favorited) await send(url, 'DELETE');
        else await api(url, {});
        favoriteCount += favorited ? -1 : 1;
        favorited = !favorited;
        paintFav();
      } catch (err) {
        failed("That didn't save.", err);
      }
    });
    paintFav();
    const share = button('text-action');
    share.append(icon('chain-link'), 'Copy link');
    share.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(robloxUrl(`/${itemType === 'Bundle' ? 'bundles' : 'catalog'}/${id}`));
        toast('Link copied');
      } catch {
        toast("Couldn't copy the link.", true);
      }
    });
    const outside = link('text-action', robloxUrl(`/${itemType === 'Bundle' ? 'bundles' : 'catalog'}/${id}`));
    outside.target = '_blank';
    outside.rel = 'noopener';
    outside.append(icon('arrow-up-right-from-square'), 'Open on Roblox');
    const report = link('text-action', robloxUrl(`/abusereport/asset?id=${id}`));
    report.target = '_blank';
    report.rel = 'noopener';
    report.append(icon('flag'), 'Report');
    social.append(fav, share, outside, report);
    const media = el('div', 'item-media');
    const cornerTag = limitedTag(item);
    if (cornerTag) stage.node.append(cornerTag);
    media.append(stage.node, social);

    const info = el('div', 'item-info');
    const titleRow = el('div', 'item-title');
    titleRow.append(el('h1', '', item.name), cartButton());
    const by = el('p', 'by');
    by.append(link('', item.creatorType === 'Group' ? `#/group/${item.creatorTargetId}` : `#/user/${item.creatorTargetId}`, `By ${item.creatorName}`));
    if (item.creatorHasVerifiedBadge) {
      const badge = icon('verified-mono', true);
      badge.setAttribute('aria-label', 'Verified creator');
      by.append(badge);
    }
    info.append(titleRow, by);
    const tags = el('div', 'item-tags');
    for (const tag of item.itemRestrictions || []) {
      const label = { Rthro: 'Rthro', Live: 'Live' }[tag];
      if (label) tags.append(el('span', 'item-tag', label));
    }
    if (owned === true) tags.append(el('span', 'item-tag owned', 'You own this'));
    if (tags.children.length) info.append(tags);

    const onSale = item.isPurchasable !== false && !item.isOffSale && item.priceStatus !== 'Off Sale' && (item.price !== undefined || item.priceStatus === 'Free');
    const hasResale = Boolean(item.hasResellers && item.lowestResalePrice);
    const listings = hasResale && item.collectibleItemId ? (await api(`${SALES}/${item.collectibleItemId}/resellers?limit=30`).catch(() => ({}))).data || [] : [];
    const priceRow = el('div', 'item-price');
    if (onSale) {
      if (itemPrice(item)) priceRow.append(robuxAmount(itemPrice(item)));
      else priceRow.append('Free');
    } else if (hasResale) {
      priceRow.append(robuxAmount(item.lowestResalePrice), el('small', '', 'Lowest resale'));
    } else {
      priceRow.append('Off sale');
    }
    info.append(priceRow);

    const actions = el('div', 'item-actions');
    const reload = () => showItem(root, { type, id }, alive);
    if (owned === true && itemType === 'Asset') {
      let worn = (wearing.assetIds || []).includes(Number(id));
      const wear = button('play');
      const paintWear = () => {
        wear.textContent = worn ? 'Take off' : 'Wear';
      };
      wear.addEventListener('click', async () => {
        wear.disabled = true;
        try {
          await api(`https://avatar.roblox.com/v1/avatar/assets/${id}/${worn ? 'remove' : 'wear'}`, {});
          worn = !worn;
          paintWear();
        } catch (err) {
          failed("That didn't save.", err);
        }
        wear.disabled = false;
      });
      paintWear();
      actions.append(wear, link('more', '#/avatar', 'Open Avatar'));
      if (!itemPrice(item) && !restricted) {
        const drop = button('text-action', 'Remove from inventory');
        drop.addEventListener('click', async () => {
          if (!await confirmDialog(`Remove ${item.name}?`, 'This takes the free item out of your inventory.', 'Remove', true)) return;
          try {
            await send(`https://inventory.roblox.com/v2/inventory/asset/${id}`, 'DELETE');
            toast('Removed from your inventory');
            reload();
          } catch (err) {
            failed("That didn't work.", err);
          }
        });
        actions.append(drop);
      }
    } else if (owned === true) {
      actions.append(link('play', '#/avatar', 'Open Avatar'));
    } else if (onSale) {
      const price = itemPrice(item);
      const buy = button('play', price ? 'Buy' : 'Get');
      buy.addEventListener('click', async () => {
        const yes = await confirmDialog(`Buy ${item.name}?`, price ? `This spends ${price.toLocaleString('en')} Robux. You have ${(state.robux ?? 0).toLocaleString('en')}.` : 'This item is free.', price ? `Spend ${price.toLocaleString('en')} Robux` : 'Get item');
        if (!yes) return;
        buy.disabled = true;
        try {
          await firstSalePurchase(item);
          toast(`${item.name} is yours`);
          reload();
        } catch (err) {
          buy.disabled = false;
          failed('The purchase failed.', err);
        }
      });
      const toCart = button('more');
      const paintCart = () => {
        toCart.textContent = inCart(item) ? 'Remove from cart' : 'Add to cart';
      };
      toCart.addEventListener('click', () => {
        saveCart(inCart(item) ? loadCart().filter(entry => !(entry.id === item.id && entry.itemType === item.itemType)) : loadCart().concat({ id: item.id, itemType: item.itemType, name: item.name, price }));
        paintCart();
      });
      cartListeners.add(() => {
        if (toCart.isConnected) paintCart();
      });
      paintCart();
      actions.append(buy);
      if (price) actions.append(toCart);
    } else if (listings.length) {
      const buy = button('play', 'Buy from lowest seller');
      buy.addEventListener('click', async () => {
        const listing = listings[0];
        const yes = await confirmDialog(`Buy ${item.name}?`, `This spends ${listing.price.toLocaleString('en')} Robux, paid to ${listing.seller?.name || 'the seller'}. You have ${(state.robux ?? 0).toLocaleString('en')}.`, `Spend ${listing.price.toLocaleString('en')} Robux`);
        if (!yes) return;
        buy.disabled = true;
        try {
          await resalePurchase(item, listing);
          toast(`${item.name} is yours`);
          reload();
        } catch (err) {
          buy.disabled = false;
          failed('The purchase failed.', err);
        }
      });
      actions.append(buy);
    }
    if (actions.children.length) info.append(actions);

    const typeName = itemType === 'Bundle'
      ? BUNDLE_TYPES[item.bundleType] || BUNDLE_TYPES[{ 1: 'BodyParts', 2: 'AvatarAnimations', 3: 'Shoes', 4: 'DynamicHead' }[item.bundleType]] || 'Bundle'
      : (rules.wearableAssetTypes || []).find(entry => entry.id === item.assetType)?.name || economy?.AssetTypeId && `Type ${economy.AssetTypeId}`;
    const placement = (item.taxonomy || []).map(entry => entry.taxonomyName).join(', ');
    const details = el('dl', 'item-details');
    const flags = roli && rovalraOn('flags') ? flagNames(roli).join(', ') : '';
    for (const [label, value] of [
      ['Value', roli ? (roli.value ? roli.value.toLocaleString('en') : 'Not valued') : null],
      ['RAP', roli?.rap > 0 ? roli.rap.toLocaleString('en') : null],
      ['Demand', roli?.demand],
      ['Trend', roli?.trend],
      ['Flags', flags],
      ['Tradable', restricted ? 'Yes' : 'No'],
      ['Type', typeName],
      ['Placement', placement],
      ['Quantity', item.totalQuantity ? item.totalQuantity.toLocaleString('en') : null],
      ['Remaining', restricted && item.unitsAvailableForConsumption !== undefined && !item.isOffSale ? item.unitsAvailableForConsumption.toLocaleString('en') : null],
      ['Limit per person', item.quantityLimitPerUser || null],
      ['Sold in', item.saleLocationType && item.saleLocationType !== 'ShopOnly' && item.saleLocationType !== 'NotApplicable' ? friendlySaleLocation(item.saleLocationType) : null],
      ['Off sale on', item.offSaleDeadline ? longDate(item.offSaleDeadline) : null],
      ['Created', item.itemCreatedUtc ? longDate(item.itemCreatedUtc) : null],
      ['Updated', economy?.Updated ? longDate(economy.Updated) : null],
    ]) {
      if (value === null || value === undefined || value === '') continue;
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', String(value)));
      details.append(row);
    }
    if (item.description) {
      const row = el('div', 'item-description');
      row.append(el('dt', '', 'Description'), el('dd', 'description', item.description));
      details.append(row);
    }
    if (roli && itemType === 'Asset' && rovalraOn('links')) {
      const row = el('div');
      const out = link('text-action', rolimonsItem(id), 'Open on Rolimons');
      out.target = '_blank';
      out.rel = 'noopener';
      row.append(el('dt', '', 'Rolimons'), el('dd', '', ''));
      row.lastChild.append(out);
      details.append(row);
    }
    info.append(details);

    const page = el('div', 'item-page');
    const top = el('div', 'item-top');
    top.append(media, info);
    page.append(top);
    root.replaceChildren(page);
    stage.start();

    const extras = [];
    if (hasResale || restricted) {
      const [resale, recent] = await Promise.all([
        itemType === 'Asset' ? api(`https://economy.roblox.com/v1/assets/${id}/resale-data`).catch(() => null) : null,
        item.collectibleItemId ? api(`${SALES}/${item.collectibleItemId}/resale-data`).catch(() => null) : null,
        faces(listings.filter(listing => listing.seller?.sellerType !== 'Group').map(listing => listing.seller?.sellerId)),
      ]);
      const history = recent?.priceDataPoints?.length ? recent : resale;
      extras.push(...resaleSections(item, resale, history, listings, reload));
    }
    const parts = (item.bundledItems || []).filter(part => part.type === 'Asset');
    if (parts.length) {
      const tiles = await relatedItems(parts.map(part => ({ itemType: 'Asset', id: part.id })));
      if (tiles.length) extras.push(rowSection('Included items', '', tiles, null, 'row item-row'));
    }
    if (itemType === 'Asset') {
      const bundles = await api(`https://catalog.roblox.com/v1/assets/${id}/bundles?limit=10`).catch(() => ({}));
      const tiles = await relatedItems((bundles.data || []).map(bundle => ({ itemType: 'Bundle', id: bundle.id })));
      if (tiles.length) extras.push(rowSection('Part of these bundles', '', tiles, null, 'row item-row'));
    }
    const recommended = await api(itemType === 'Bundle'
      ? `https://catalog.roblox.com/v2/recommendations/bundles?bundleId=${id}&numItems=12`
      : `https://catalog.roblox.com/v2/recommendations/assets?assetId=${id}&assetTypeId=${item.assetType}&numItems=12`).catch(() => ({}));
    const tiles = await relatedItems((recommended.data || []).map(value => ({ itemType, id: value })));
    if (tiles.length) extras.push(rowSection('Recommended', '', tiles, null, 'row item-row'));
    if (alive()) page.append(...extras);
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showItem(root, { type, id }, alive));
  }
}

const friendlySaleLocation = value => ({ ExperiencesDevApiOnly: 'Experiences only', MyExperiencesOnly: "This creator's experiences", ShopAndMyExperiences: "Marketplace and this creator's experiences", ShopAndAllExperiences: 'Marketplace and experiences', DevApiOnly: 'Experiences only' }[value] || value.replace(/([a-z])([A-Z])/g, '$1 $2'));

const priceText = item => {
  if (item.priceStatus === 'Off Sale' || (item.price === undefined && item.lowestPrice === undefined && item.priceStatus !== 'Free')) return 'Off sale';
  const price = item.lowestPrice ?? item.price;
  return price ? `${compact(price)} Robux` : 'Free';
};

export async function itemDetails(list) {
  if (!list.length) return [];
  const { data = [] } = await api('https://catalog.roblox.com/v1/catalog/items/details', { items: list.map(i => ({ itemType: i.itemType, id: i.id })) });
  return data;
}

async function itemThumbs(items) {
  const request = item => ({ key: `${item.itemType}:${item.id}`, request: { targetId: item.id, type: item.itemType === 'Bundle' ? 'BundleThumbnail' : 'Asset', size: '150x150' } });
  return thumbnails(items.map(request)).catch(() => ({}));
}

function limitedTag(item) {
  const restrictions = item.itemRestrictions || [];
  if (!restrictions.some(tag => COLLECTIBLE_RESTRICTIONS.has(tag))) return null;
  const unique = restrictions.includes('LimitedUnique');
  const node = el('span', `item-label ${unique ? 'limited-unique' : 'limited'}`);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', unique ? 'Limited U' : 'Limited');
  return node;
}

function marketTile(item, thumbs) {
  const node = link('item-tile', `#/item/${item.itemType}/${item.id}`);
  const frame = el('span', 'item-image');
  frame.append(image(thumbs[`${item.itemType}:${item.id}`], '', true));
  const limited = limitedTag(item);
  if (limited) frame.append(limited);
  const price = el('small');
  if (/Robux/.test(priceText(item))) price.append(robuxAmount(itemPrice(item)));
  else price.textContent = priceText(item);
  node.append(frame, el('span', 'item-name', item.name), price);
  return node;
}

async function searchPage(url, tries = 3) {
  try {
    return await api(url);
  } catch (err) {
    if (err.status !== 429 || tries <= 1) throw err;
    await new Promise(resolve => setTimeout(resolve, MARKET_RETRY_MS * (4 - tries)));
    return searchPage(url, tries - 1);
  }
}

function savedFilters() {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY)) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function searchQuery(filter, cursor) {
  const curated = filter.category === 'All' && filter.sort === '0' && !filter.keyword && !filter.subcategory;
  const query = new URLSearchParams({ category: filter.category, limit: String(curated ? MARKET_CURATED : MARKET_PAGE), sortType: filter.sort, salesTypeFilter: filter.sales, includeNotForSale: filter.offsale });
  if (filter.subcategory) query.set('subcategory', filter.subcategory);
  if (filter.keyword) query.set('keyword', filter.keyword);
  if (filter.creator) query.set('creatorName', filter.creator);
  if (filter.sort === '1' || filter.sort === '2') query.set('sortAggregation', '5');
  if (filter.price) {
    const [min, max] = filter.price === 'free' ? ['0', '0'] : filter.price.split('-');
    if (min) query.set('minPrice', min);
    if (max) query.set('maxPrice', max);
  }
  if (cursor) query.set('cursor', cursor);
  return query;
}

function chip(label, pressed, onPick) {
  const node = button('chip', label);
  node.setAttribute('aria-pressed', String(pressed));
  node.addEventListener('click', onPick);
  return node;
}

export async function showMarket(root, params, alive) {
  skeleton(root);
  const filter = params.keyword === undefined ? savedFilters() : { ...DEFAULT_FILTERS, keyword: params.keyword };
  const grid = el('div', 'item-grid market');
  const status = el('p', 'section-note', '');
  const moreSlot = el('span', 'market-sentinel');
  const categoryRow = el('div', 'chips market-categories');
  const subRow = el('div', 'chips market-subcategories');
  const bar = el('div', 'filters market-filters');
  let token = 0;
  let categories = [];
  const save = () => {
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filter));
    } catch {}
  };
  let cursor = '';
  let busy = false;
  const page = async () => {
    if (busy) return;
    const mine = token;
    busy = true;
    try {
      const result = await searchPage(`https://catalog.roblox.com/v1/search/items?${searchQuery(filter, cursor)}`);
      const items = (await Promise.all(chunks(result.data || [], MARKET_PAGE).map(itemDetails))).flat();
      const thumbs = await itemThumbs(items);
      if (mine !== token || !alive()) return;
      grid.append(...items.map(item => marketTile(item, thumbs)));
      cursor = result.nextPageCursor || '';
      status.textContent = grid.children.length ? '' : 'Nothing matches these filters.';
    } catch (err) {
      if (mine !== token) return;
      cursor = '';
      status.textContent = grid.children.length ? "More items didn't load. Try again in a moment." : "The Marketplace didn't load. Try again in a moment.";
      console.warn('[launcher] marketplace failed:', err.message);
    } finally {
      if (mine === token) busy = false;
    }
    if (mine === token && cursor && moreSlot.getBoundingClientRect().top < innerHeight + MARKET_PRELOAD_PX) page();
  };
  const load = () => {
    token++;
    busy = false;
    cursor = '';
    save();
    grid.replaceChildren();
    status.textContent = 'Loading…';
    page();
  };
  const watcher = new IntersectionObserver(([entry]) => {
    if (!alive()) watcher.disconnect();
    else if (entry.isIntersecting && cursor) page();
  }, { rootMargin: `${MARKET_PRELOAD_PX}px 0px` });
  const paintCategories = () => {
    categoryRow.replaceChildren(...categories.map(entry => chip(entry.name, entry.category === filter.category, () => {
      filter.category = entry.category;
      filter.subcategory = '';
      paintCategories();
      load();
    })));
    const current = categories.find(entry => entry.category === filter.category);
    const subs = (current?.subcategories || []).filter(sub => sub.subcategory);
    subRow.hidden = !subs.length;
    subRow.replaceChildren(
      chip(`All ${current?.name.toLowerCase() || 'items'}`, !filter.subcategory, () => {
        filter.subcategory = '';
        paintCategories();
        load();
      }),
      ...subs.map(sub => chip(sub.name, sub.subcategory === filter.subcategory, () => {
        filter.subcategory = sub.subcategory;
        paintCategories();
        load();
      })),
    );
  };
  const select = (label, options, key, more = {}) => dropdown({
    label,
    options,
    value: filter[key],
    ...more,
    onPick: value => {
      filter[key] = value;
      load();
    },
  });
  const priceRange = pick => {
    const form = el('form', 'dropdown-range');
    const field = placeholder => {
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'numeric';
      input.placeholder = placeholder;
      input.setAttribute('aria-label', `${placeholder} price`);
      return input;
    };
    const low = field('Min');
    const high = field('Max');
    const [savedLow, savedHigh] = /^\d*-\d*$/.test(filter.price) ? filter.price.split('-') : ['', ''];
    low.value = savedLow;
    high.value = savedHigh;
    const apply = button('dropdown-apply', 'Apply');
    apply.type = 'submit';
    form.append(low, el('span', 'dropdown-range-dash', 'to'), high, apply);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const from = low.value === '' ? '' : String(Math.max(0, Math.floor(Number(low.value))));
      const to = high.value === '' ? '' : String(Math.max(0, Math.floor(Number(high.value))));
      if (from || to) pick(`${from}-${to}`);
    });
    return form;
  };
  const describePrice = value => {
    const [from, to] = value.split('-').map(part => (part === '' ? '' : Number(part).toLocaleString('en')));
    if (from && to) return `${from} to ${to}`;
    return from ? `${from} and up` : `Up to ${to}`;
  };
  try {
    catalogMenu ||= api(MENU_URL).catch(() => null);
    const menu = await catalogMenu;
    if (!alive()) return;
    categories = (menu?.categories || []).filter(entry => entry.category && entry.isSearchable);
    if (!categories.length) categories = [{ category: 'All', name: 'All', subcategories: [] }];
    if (!categories.some(entry => entry.category === filter.category)) Object.assign(filter, { category: 'All', subcategory: '' });
    const form = el('form', 'market-search');
    const search = el('input', 'filter-search');
    search.type = 'search';
    search.placeholder = 'Search the Marketplace';
    search.value = filter.keyword;
    search.setAttribute('aria-label', 'Search the Marketplace');
    form.append(search);
    form.addEventListener('submit', event => {
      event.preventDefault();
      filter.keyword = search.value.trim();
      load();
    });
    search.addEventListener('search', () => {
      if (!search.value && filter.keyword) {
        filter.keyword = '';
        load();
      }
    });
    bar.append(select('Sort', SORTS, 'sort'), select('Price', PRICES, 'price', { extra: priceRange, describe: describePrice }), select('Sales type', SALES_TYPES, 'sales'), select('Creator', CREATORS, 'creator', { search: 'Search a creator' }), select('Availability', STOCK, 'offsale'));
    const head = pageHead('Marketplace');
    head.classList.add('with-action');
    head.append(cartButton());
    paintCategories();
    const controls = el('div', 'market-controls');
    controls.append(form, categoryRow, subRow, bar);
    root.replaceChildren(head, controls, grid, status, moreSlot);
    watcher.observe(moreSlot);
    load();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showMarket(root, params, alive));
  }
}
