import { api, el } from './core.js';

const OPTIONS_KEY = 'webblox.launcher.rovalra';
const OLD_OPTIONS_KEY = 'webblox.launcher.rovalk';
const DATA_KEY = 'webblox.launcher.values';
const OLD_DATA_KEY = 'webblox.launcher.rolimons';
const DATA_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const ITEMS_URL = 'https://apis.rovalra.com/v1/rolimons/limiteds';
export const ROVALRA_API = 'https://apis.rovalra.com';

export const ROVALRA_FEATURES = [
  ['Values', [
    ['tradeValues', 'Values in trades'],
    ['listValues', 'Values on trade lists'],
    ['itemPages', 'Values on item pages'],
    ['profiles', 'Values on profiles'],
  ]],
  ['Trading', [
    ['winLoss', 'Win/loss stats'],
    ['postTax', 'Post-tax trade value'],
    ['notifications', 'Inbound trade notifications', false],
  ]],
  ['Items', [
    ['flags', 'Flag rare, projected and hyped items'],
    ['links', 'Rolimons links'],
  ]],
  ['Servers', [
    ['serverLocations', 'Server locations'],
    ['bestPing', 'Sort servers by best ping'],
  ]],
  ['Account', [
    ['robuxTotals', 'All-time Robux totals'],
    ['bulkUnblock', 'Unblock everyone button'],
  ]],
];
const DEFAULTS = Object.fromEntries([['enabled', false], ...ROVALRA_FEATURES.flatMap(([, list]) => list.map(([key, , on = true]) => [key, on]))]);

function readOptions() {
  try {
    const saved = localStorage.getItem(OPTIONS_KEY) ?? localStorage.getItem(OLD_OPTIONS_KEY);
    return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULTS };
  }
}

let options = readOptions();
let data = null;
let pending = null;
let failedAt = 0;

try {
  localStorage.removeItem(OLD_DATA_KEY);
  const saved = JSON.parse(localStorage.getItem(DATA_KEY));
  if (saved?.items) data = saved;
} catch {}

export const rovalraOption = key => Boolean(options[key]);

export const rovalraOn = key => Boolean(options.enabled && (key === undefined || options[key]));

export function setRovalra(key, on) {
  options = { ...options, [key]: on };
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    localStorage.removeItem(OLD_OPTIONS_KEY);
  } catch {}
  if (options.enabled) loadValues();
}

export async function loadValues() {
  if (!options.enabled) return null;
  if (data && Date.now() - data.at < DATA_MS) return data;
  if (Date.now() - failedAt < RETRY_MS) return data;
  pending ||= api(ITEMS_URL)
    .then(result => {
      if (!result?.items) throw new Error('RoValra sent no item list');
      data = { at: Date.now(), items: result.items };
      try {
        localStorage.setItem(DATA_KEY, JSON.stringify(data));
      } catch {}
      return data;
    })
    .catch(err => {
      failedAt = Date.now();
      console.warn('[launcher] RoValra values failed:', err.message);
      return data;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

const known = word => (word && word !== 'None' ? word : null);

export function itemValues(itemType, id) {
  const entry = itemType === 'Bundle' ? null : data?.items?.[id];
  if (!entry) return null;
  const value = entry.value > 0 ? entry.value : null;
  return {
    name: entry.name,
    acronym: entry.acronym,
    rap: entry.rap,
    value,
    worth: value ?? (entry.default_price || entry.rap),
    demand: known(entry.demand),
    trend: known(entry.trend),
    projected: Boolean(entry.is_projected),
    rare: Boolean(entry.is_rare),
    hyped: Boolean(entry.is_hyped),
  };
}

export const worthOf = item => itemValues(item.itemType, item.targetId)?.worth ?? item.rap;

const FLAGS = [
  ['rare', 'Rare', 'Rolimons lists this item as rare.'],
  ['projected', 'Projected', 'Projected: its RAP has been pushed above what it normally sells for.'],
  ['hyped', 'Hyped', 'Rolimons lists this item as hyped.'],
];

export const flagNames = info => FLAGS.filter(([key]) => info?.[key]).map(([, name]) => name);

export function itemFlags(itemType, id) {
  if (!rovalraOn('flags')) return null;
  const info = itemValues(itemType, id);
  const shown = FLAGS.filter(([key]) => info?.[key]);
  if (!shown.length) return null;
  const box = el('span', 'item-flags');
  for (const [key, name, text] of shown) {
    const flag = el('span', `item-flag ${key}`, name);
    flag.title = text;
    box.append(flag);
  }
  return box;
}

export async function serverLocations(placeId, ids) {
  if (!rovalraOn('serverLocations') || !ids.length) return {};
  const result = await api(`${ROVALRA_API}/v1/servers/details?place_id=${placeId}&server_ids=${ids.map(encodeURIComponent).join(',')}`);
  const found = {};
  for (const server of result?.servers || []) {
    const place = [server.city, server.country].filter(Boolean).join(', ');
    if (server.server_id && place) found[server.server_id] = place;
  }
  return found;
}

export const rolimonsItem = id => `https://www.rolimons.com/item/${id}`;
export const rolimonsPlayer = id => `https://www.rolimons.com/player/${id}`;
