import { api, button, el, failed, icon, image, link, loadFailure, loadMore, skeleton, state, tabs, thumbnails, toast } from './core.js';
import { previewStage } from './stage.js';

const AVATAR_URL = 'https://avatar.roblox.com/v2/avatar/avatar';
const SAVE_URL = 'https://avatar.roblox.com/v2/avatar/set-wearing-assets';
const REDRAW_URL = 'https://avatar.roblox.com/v1/avatar/redraw-thumbnail';
const SAVE_DELAY_MS = 250;
const CATEGORIES = {
  accessories: [['Hats', 8], ['Hair', 41], ['Face', 42], ['Neck', 43], ['Shoulders', 44], ['Front', 45], ['Back', 46], ['Waist', 47], ['Gear', 19]],
  clothing: [['Shirts', 11], ['Pants', 12], ['T-Shirts', 2], ['Jackets', 67], ['Sweaters', 68], ['Layered shirts', 65], ['Layered T-shirts', 64], ['Layered pants', 66], ['Shorts', 69], ['Skirts', 72], ['Left shoes', 70], ['Right shoes', 71]],
  head: [['Heads', 79], ['Moods', 78], ['Eyebrows', 76], ['Eyelashes', 77], ['Face makeup', 88], ['Lip makeup', 89], ['Eye makeup', 90], ['Torsos', 27], ['Right arms', 28], ['Left arms', 29], ['Right legs', 31], ['Left legs', 30]],
  animations: [['Idle', 51], ['Walk', 55], ['Run', 53], ['Jump', 52], ['Fall', 50], ['Climb', 48], ['Swim', 54]],
};
const NOT_IN_TRAY = new Set([27, 28, 29, 30, 31, 48, 50, 51, 52, 53, 54, 55, 61, 78, 79]);
const SCALE_LABELS = { height: 'Height', width: 'Width', head: 'Head', depth: 'Depth', proportion: 'Proportion', bodyType: 'Body type' };

function createWardrobe(avatar, rules, view) {
  const types = new Map((rules.wearableAssetTypes || []).map(type => [type.id, type]));
  const listeners = new Set();
  let timer = null;
  let saving = false;
  let dirty = false;
  const notify = () => listeners.forEach(listener => listener());
  const resync = async () => {
    const fresh = await api(AVATAR_URL).catch(() => null);
    if (fresh) avatar.assets = fresh.assets;
    notify();
  };
  const entry = asset => {
    const out = { id: asset.id };
    if (asset.meta) out.meta = asset.meta;
    if (asset.name) out.name = asset.name;
    if (asset.assetType) out.assetType = asset.assetType;
    if (asset.currentVersionId) out.currentVersionId = asset.currentVersionId;
    return out;
  };
  const persist = async () => {
    if (saving) {
      dirty = true;
      return;
    }
    saving = true;
    let changed = false;
    do {
      dirty = false;
      try {
        const result = await api(SAVE_URL, { assets: avatar.assets.map(entry) });
        const rejected = result.invalidAssetIds?.length || result.invalidAssets?.length || result.success === false;
        if (rejected) {
          toast("Roblox couldn't put that on with what you're wearing.", true);
          await resync();
        } else {
          changed = true;
        }
      } catch (err) {
        failed("That change didn't save.", err);
        await resync();
      }
    } while (dirty);
    saving = false;
    if (changed) view.refresh();
  };
  const isWorn = id => avatar.assets.some(asset => asset.id === id);
  return {
    types,
    isWorn,
    subscribe: listener => listeners.add(listener),
    assets: () => avatar.assets,
    toggle(id, name, typeId) {
      if (isWorn(id)) {
        avatar.assets = avatar.assets.filter(asset => asset.id !== id);
      } else {
        const type = types.get(typeId);
        const same = avatar.assets.filter(asset => asset.assetType?.id === typeId);
        const limit = type?.maxNumber || 1;
        const removed = new Set(same.slice(0, Math.max(0, same.length - limit + 1)).map(asset => asset.id));
        avatar.assets = avatar.assets.filter(asset => !removed.has(asset.id)).concat({ id, name, assetType: { id: typeId, name: type?.name || '' } });
      }
      notify();
      clearTimeout(timer);
      timer = setTimeout(persist, SAVE_DELAY_MS);
    },
    reload: resync,
  };
}

function wearingTray(wardrobe) {
  const tray = el('section', 'wearing');
  tray.setAttribute('aria-label', 'Currently wearing');
  const row = el('div', 'wearing-row');
  tray.append(el('h2', '', 'Wearing'), row);
  const art = {};
  let token = 0;
  const paint = async () => {
    const mine = ++token;
    const items = wardrobe.assets().filter(asset => !NOT_IN_TRAY.has(asset.assetType?.id));
    tray.hidden = !items.length;
    const missing = items.filter(asset => !art[asset.id]);
    if (missing.length) Object.assign(art, await thumbnails(missing.map(asset => ({ key: String(asset.id), request: { targetId: asset.id, type: 'Asset', size: '150x150' } }))).catch(() => ({})));
    if (mine !== token) return;
    row.replaceChildren(...items.map(asset => {
      const tile = button('worn-tile');
      tile.title = asset.name || 'Item';
      tile.setAttribute('aria-label', `Take off ${asset.name || 'this item'}`);
      tile.append(image(art[asset.id], '', true));
      tile.addEventListener('click', () => wardrobe.toggle(asset.id, asset.name, asset.assetType?.id));
      return tile;
    }));
  };
  wardrobe.subscribe(paint);
  paint();
  return tray;
}

function itemTile(wardrobe, id, name, typeId, art) {
  const node = button('item-tile');
  node.dataset.asset = id;
  const frame = el('span', 'item-image');
  frame.append(image(art, '', true));
  const mark = el('span', 'worn-mark');
  mark.append(icon('check', true));
  frame.append(mark);
  node.append(frame, el('span', 'item-name', name));
  const paint = () => {
    const worn = wardrobe.isWorn(id);
    node.setAttribute('aria-pressed', String(worn));
    node.setAttribute('aria-label', `${worn ? 'Take off' : 'Wear'} ${name}`);
  };
  node.addEventListener('click', () => wardrobe.toggle(id, name, typeId));
  node.repaint = paint;
  paint();
  return node;
}

async function fetchInventory(typeId, cursor = '') {
  const result = await api(`https://inventory.roblox.com/v2/users/${state.me.id}/inventory/${typeId}?limit=50&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  const items = result.data || [];
  const art = await thumbnails(items.map(item => ({ key: String(item.assetId), request: { targetId: item.assetId, type: 'Asset', size: '150x150' } }))).catch(() => ({}));
  return { typeId, items, art, next: result.nextPageCursor || '' };
}

async function fetchOutfits() {
  const { data = [] } = await api(`https://avatar.roblox.com/v1/users/${state.me.id}/outfits?page=1&itemsPerPage=50&isEditable=true`);
  const art = await thumbnails(data.map(outfit => ({ key: String(outfit.id), request: { targetId: outfit.id, type: 'Outfit', size: '150x150' } }))).catch(() => ({}));
  return { data, art };
}

function inventoryPanel(wardrobe, entries, seed = null) {
  const box = el('div', 'tab-body inventory');
  const picker = el('div', 'chips');
  const grid = el('div', 'item-grid');
  const status = el('p', 'section-note', '');
  const moreSlot = el('div');
  box.append(picker, grid, status, moreSlot);
  const available = entries.filter(([, typeId]) => wardrobe.types.has(typeId));
  wardrobe.subscribe(() => [...grid.children].forEach(tile => tile.repaint()));
  let active = null;
  const load = async (name, typeId) => {
    active = typeId;
    [...picker.children].forEach(chip => chip.setAttribute('aria-pressed', String(chip.textContent === name)));
    grid.replaceChildren();
    moreSlot.replaceChildren();
    status.textContent = 'Loading';
    let cursor = '';
    const page = async () => {
      const ready = seed?.typeId === typeId && !cursor ? seed : null;
      seed = null;
      const { items, art, next } = ready || await fetchInventory(typeId, cursor);
      if (active !== typeId) return false;
      grid.append(...items.map(item => itemTile(wardrobe, item.assetId, item.assetName, typeId, art[item.assetId])));
      cursor = next;
      status.textContent = grid.children.length ? '' : `You don't own any ${name.toLowerCase()} yet.`;
      return Boolean(cursor);
    };
    try {
      if (await page()) moreSlot.replaceChildren(loadMore('Show more', page));
    } catch (err) {
      if (active === typeId) status.textContent = "Your inventory didn't load. Try again in a moment.";
      console.warn('[launcher] inventory failed:', err.message);
    }
  };
  for (const [name, typeId] of available) {
    const chip = button('chip', name);
    chip.addEventListener('click', () => load(name, typeId));
    picker.append(chip);
  }
  if (available.length) load(available[0][0], available[0][1]);
  return box;
}

function equipHint() {
  const hint = el('div', 'xa-hint');
  hint.hidden = true;
  const glyph = el('img');
  glyph.src = (self.__WB||'/')+'launcher/xbox/shell/XButton.png';
  glyph.alt = '';
  const text = el('span');
  hint.append(glyph, text);
  let current = null;
  const paint = target => {
    current = target?.closest?.('.item-tile') || null;
    hint.hidden = !current;
    if (!current) return;
    text.textContent = current.dataset.asset ? (current.getAttribute('aria-pressed') === 'true' ? 'Remove' : 'Equip') : 'Swap Avatar';
  };
  hint.watch = panel => {
    panel.addEventListener('pointerover', event => paint(event.target));
    panel.addEventListener('pointerleave', () => paint(document.activeElement));
    panel.addEventListener('focusin', event => paint(event.target));
    panel.addEventListener('click', () => paint(current));
    const onKey = event => {
      if (!panel.isConnected) {
        window.removeEventListener('keydown', onKey);
        return;
      }
      if (event.key.toLowerCase() !== 'x' || event.target.matches?.('input, textarea, select') || !current) return;
      current.click();
      paint(current);
    };
    window.addEventListener('keydown', onKey);
  };
  return hint;
}

function outfitsPanel(wardrobe, view, seed = null) {
  const box = el('div', 'tab-body inventory');
  const grid = el('div', 'item-grid');
  const status = el('p', 'section-note', 'Loading');
  box.append(grid, status);
  const fill = ({ data, art }) => {
    for (const outfit of data) {
      const node = button('item-tile');
      node.setAttribute('aria-label', `Wear outfit ${outfit.name}`);
      const frame = el('span', 'item-image');
      frame.append(image(art[outfit.id], '', true));
      node.append(frame, el('span', 'item-name', outfit.name));
      node.addEventListener('click', async () => {
        node.disabled = true;
        try {
          await api(`https://avatar.roblox.com/v1/outfits/${outfit.id}/wear`, {});
          toast(`Wearing ${outfit.name}`);
          await wardrobe.reload();
          view.refresh();
        } catch (err) {
          failed("That outfit didn't apply.", err);
        }
        node.disabled = false;
      });
      grid.append(node);
    }
    status.textContent = data.length ? '' : 'You have no saved outfits yet.';
  };
  if (seed) {
    fill(seed);
    return box;
  }
  fetchOutfits().then(fill).catch(err => {
    status.textContent = "Outfits didn't load. Try again in a moment.";
    console.warn('[launcher] outfits failed:', err.message);
  });
  return box;
}

function bodyPanel(avatar, rules, view) {
  const box = el('div', 'tab-body body-panel');
  const types = el('div', 'chips');
  for (const type of rules.playerAvatarTypes || []) {
    const chip = button('chip', type);
    chip.setAttribute('aria-pressed', String(avatar.playerAvatarType === type));
    chip.addEventListener('click', async () => {
      try {
        await api('https://avatar.roblox.com/v1/avatar/set-player-avatar-type', { playerAvatarType: type });
        avatar.playerAvatarType = type;
        [...types.children].forEach(item => item.setAttribute('aria-pressed', String(item.textContent === type)));
        view.refresh();
      } catch (err) {
        failed("That didn't save.", err);
      }
    });
    types.append(chip);
  }
  box.append(el('h3', '', 'Avatar type'), types, el('h3', '', 'Scale'));
  const sliders = el('div', 'sliders');
  let saveTimer = null;
  const saveScales = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api('https://avatar.roblox.com/v1/avatar/set-scales', avatar.scales);
        view.refresh();
      } catch (err) {
        failed("Scale didn't save.", err);
      }
    }, 500);
  };
  for (const [key, limits] of Object.entries(rules.scales || {})) {
    const label = el('label', 'slider');
    const value = el('span', 'slider-value', `${Math.round((avatar.scales[key] ?? 1) * 100)}%`);
    const head = el('span', 'slider-head');
    head.append(el('span', '', SCALE_LABELS[key] || key), value);
    const input = el('input');
    input.type = 'range';
    input.min = limits.min;
    input.max = limits.max;
    input.step = limits.increment || 0.01;
    input.value = avatar.scales[key] ?? 1;
    input.addEventListener('input', () => {
      avatar.scales[key] = Number(input.value);
      value.textContent = `${Math.round(avatar.scales[key] * 100)}%`;
      saveScales();
    });
    label.append(head, input);
    sliders.append(label);
  }
  box.append(sliders, el('h3', '', 'Skin color'));
  const swatches = el('div', 'swatches');
  for (const color of rules.bodyColorsPalette || []) {
    const swatch = button('swatch');
    swatch.style.background = color.hexColor;
    swatch.setAttribute('aria-label', color.name);
    swatch.title = color.name;
    swatch.addEventListener('click', async () => {
      const id = color.brickColorId;
      try {
        await api('https://avatar.roblox.com/v1/avatar/set-body-colors', { headColorId: id, torsoColorId: id, rightArmColorId: id, leftArmColorId: id, rightLegColorId: id, leftLegColorId: id });
        view.refresh();
      } catch (err) {
        failed("Color didn't save.", err);
      }
    });
    swatches.append(swatch);
  }
  box.append(swatches);
  return box;
}

export async function showAvatar(root, params, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [avatar, rules, body] = await Promise.all([
      api(AVATAR_URL),
      api('https://avatar.roblox.com/v1/avatar-rules'),
      thumbnails([{ key: 'me', request: { targetId: state.me.id, type: 'Avatar', size: '720x720' } }]).catch(() => ({})),
    ]);
    if (!alive()) return;
    const types = new Set((rules.wearableAssetTypes || []).map(type => type.id));
    const firstType = CATEGORIES.accessories.find(([, typeId]) => types.has(typeId))?.[1];
    const xbox = document.documentElement.dataset.theme === 'xbox';
    const [firstItems, outfits] = await Promise.all([
      firstType ? fetchInventory(firstType).catch(() => null) : null,
      xbox ? fetchOutfits().catch(() => null) : null,
    ]);
    if (!alive()) return;
    const avatarUrl = `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${state.me.id}`;
    const view = previewStage({
      src: body.me,
      alt: 'Your avatar',
      room: true,
      extras: xbox ? [el('div', 'xa-glow xa-glow-base'), el('div', 'xa-glow xa-glow-top')] : [],
      source3d: (previous, viewer) => viewer.thumbnail3d(avatarUrl, previous),
      source2d: async () => (await thumbnails([{ key: 'me', request: { targetId: state.me.id, type: 'Avatar', size: '720x720' } }]).catch(() => ({}))).me,
      redraw: () => api(REDRAW_URL, {}),
    });
    const wardrobe = createWardrobe(avatar, rules, view);
    const stage = el('div', 'avatar-stage');
    if (xbox) stage.append(el('h2', 'xa-name', state.me.name || ''));
    stage.append(view.node, wearingTray(wardrobe));
    const head = el('header', 'avatar-head');
    const shop = link('text-action', '#/marketplace');
    shop.append(icon('shopping-basket'), 'Marketplace');
    head.append(el('h1', '', 'Avatar'), shop);
    const panel = el('div', 'avatar-panel');
    const entries = [
      ['Accessories', () => inventoryPanel(wardrobe, CATEGORIES.accessories, firstItems)],
      ['Clothing', () => inventoryPanel(wardrobe, CATEGORIES.clothing)],
      ['Head and body', () => inventoryPanel(wardrobe, CATEGORIES.head)],
      ['Animations', () => inventoryPanel(wardrobe, CATEGORIES.animations)],
      ['Outfits', () => outfitsPanel(wardrobe, view)],
      ['Body', () => bodyPanel(avatar, rules, view)],
    ];
    if (xbox) {
      const collection = el('section', 'xa-collection');
      const titles = el('header', 'xa-collection-head');
      titles.append(el('h2', '', 'My Collection'), shop);
      collection.append(titles, outfitsPanel(wardrobe, view, outfits));
      const hasOutfits = outfits?.data.length > 0;
      collection.hidden = !hasOutfits;
      panel.classList.toggle('has-collection', hasOutfits);
      const hint = equipHint();
      panel.append(collection, tabs(entries.filter(([name]) => name !== 'Outfits')), hint);
      hint.watch(panel);
    } else {
      panel.append(head, tabs(entries));
    }
    const layout = el('div', 'avatar-layout');
    layout.append(stage, panel);
    root.replaceChildren(layout);
    view.start();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showAvatar(root, params, alive));
  }
}
