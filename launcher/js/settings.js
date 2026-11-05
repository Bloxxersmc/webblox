import { ROBLOX_LAUNCHER, api, button, confirmDialog, dropdown, el, failed, hiddenGames, link, pageHead, setGameHidden, state, toast, wispMode } from './core.js';
import { fixedMode, loaderPicker, modePicker, themePicker, uiEraPicker } from './themes.js';
import { ROVALRA_FEATURES, rovalraOption, setRovalra } from './values.js';

const ROBLOX_SETTINGS = 'https://apis.roblox.com/user-settings-api/v1/user-settings';
const LABELS = {
  whoCanJoinMeInExperiences: 'Who can join me',
  privateServerPrivacy: 'Who can invite me to private servers',
  whoCanSeeMyInventory: 'Who can see my inventory',
  friendSuggestions: 'Suggest me as a friend',
  phoneNumberDiscoverability: 'Find me by phone number',
  contentAgeRestriction: 'Content maturity',
  whoCanChatWithMeInApp: 'Who can chat with me',
  whoCanGroupChatWithMeInApp: 'Who can group chat with me',
  whoCanChatWithMeInExperiences: 'Who can chat with me in games',
  whoCanWhisperChatWithMeInExperiences: 'Who can whisper to me in games',
  whoCanTradeWithMe: 'Who can trade with me',
  tradeQualityFilter: 'Trade quality filter',
  themeType: 'Roblox.com theme',
};
const OPTION_NAMES = {
  All: 'Everyone',
  AllUsers: 'Everyone',
  FriendsFollowingAndFollowers: 'Friends, following and followers',
  FriendsAndFollowing: 'Friends and following',
  TrustedFriends: 'Trusted friends',
  NoOne: 'No one',
  SeventeenPlus: '17+',
  ThirteenPlus: '13+',
  NinePlus: '9+',
  AllAges: 'All ages',
};
const SWITCHES = [['Enabled', 'Disabled'], ['Discoverable', 'NotDiscoverable']];

const GRAPHICS_KEY = 'webblox.settings';
const GRAPHICS_DEFAULTS = { v: 2, fps: 60, resolution: 100, mesh: -1, msaa: '1', grass: true, ui: 'sharp', distance: 0, quality: -1, renderer: 'webgpu', fullbright: false };
const PRESETS = [
  ['performance', 'Performance', { fps: 60, resolution: 75, mesh: 0, msaa: '1', grass: false, ui: 'standard', distance: 0, quality: 1 }],
  ['balanced', 'Balanced', { fps: 60, resolution: 100, mesh: -1, msaa: '1', grass: true, ui: 'sharp', distance: 0, quality: 1 }],
  ['quality', 'Quality', { fps: 60, resolution: 200, mesh: 3, msaa: '4', grass: true, ui: 'sharp', distance: 2, quality: 10 }],
];
const GRAPHICS_ROWS = [
  ['renderer', 'Renderer', [['webgpu', 'WebGPU'], ['webgl', 'WebGL']]],
  ['quality', 'Graphics quality', Array.from({ length: 10 }, (_, i) => [i + 1, `Level ${i + 1}`])],
  ['resolution', '3D resolution', [[50, '50%'], [60, '60%'], [75, '75%'], [85, '85%'], [100, '100%'], [200, 'Full']]],
  ['ui', 'Interface resolution', [['sharp', 'Sharp'], ['standard', 'Standard']]],
  ['fps', 'Frame rate cap', [[30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS'], [144, '144 FPS'], [240, '240 FPS'], [0, 'Unlimited']]],
  ['mesh', 'Mesh detail', [[-1, 'Default'], [0, 'Lowest'], [1, 'Low'], [2, 'Medium'], [3, 'High']]],
  ['msaa', 'Anti-aliasing', [['', 'Default'], ['1', 'Off'], ['2', '2x'], ['4', '4x']]],
  ['distance', 'View distance', [[0, 'Default'], [1, 'Far'], [2, 'Very Far']]],
  ['grass', 'Grass'],
  ['fullbright', 'Fullbright'],
];

const CACHE_KEYS = /^webblox\.launcher\.(icons|values|home|charts|shell)/;
const PREFERENCE_KEYS = /^webblox\.launcher\.(theme|loader|uiEra|rovalra|avatar3d|xbox\.sound|market)/;

const optionName = value => OPTION_NAMES[value] || String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/ (\w)/g, (_, c) => ` ${c.toLowerCase()}`);

function row(title, ...side) {
  const switchRow = side.length === 1 && side[0].classList?.contains('switch');
  const node = el(switchRow ? 'label' : 'div', 'pref-row');
  node.append(el('span', '', title));
  if (side.length) {
    const right = el('span', 'pref-side');
    right.append(...side);
    node.append(right);
  }
  return node;
}

function toggle(checked, onChange) {
  const input = el('input', 'switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function choice(label, options, value, onPick, fallback = 'Not set') {
  return dropdown({
    label,
    className: 'pref-dropdown',
    options: options.map(([id, text]) => [String(id), text]),
    value: String(value),
    describe: () => fallback,
    onPick: picked => onPick(options.find(([id]) => String(id) === picked)[0]),
  });
}

function robloxRow(key, setting) {
  const values = (setting.options || []).map(o => o.option?.optionValue).filter(Boolean);
  if (!values.length) return null;
  let current = setting.currentValue;
  let control;
  const save = async (next, revert) => {
    try {
      await api(ROBLOX_SETTINGS, { [key]: next });
      current = next;
      toast('Saved');
    } catch (err) {
      revert(current);
      failed("That setting didn't save. Roblox may need you to verify first.", err);
    }
  };
  const pair = SWITCHES.find(([on, off]) => values.length === 2 && values.includes(on) && values.includes(off));
  if (pair) {
    control = toggle(current === pair[0], on => save(on ? pair[0] : pair[1], value => {
      control.checked = value === pair[0];
    }));
  } else {
    control = dropdown({
      label: LABELS[key],
      className: 'pref-dropdown',
      options: values.map(value => [value, optionName(value)]),
      value: current,
      onPick: next => save(next, value => control.setValue(value)),
    });
  }
  return row(LABELS[key], control);
}

let robloxSettings = null;

function robloxRows(keys) {
  const box = el('div');
  const load = () => {
    box.replaceChildren(...keys.map(() => {
      const line = el('div', 'pref-row');
      line.append(el('span', 'pref-loading'));
      return line;
    }));
    (robloxSettings ||= api(`${ROBLOX_SETTINGS}/settings-and-options`)).then(options => {
      box.replaceChildren(...keys.map(key => options[key] && robloxRow(key, options[key])).filter(Boolean));
    }, err => {
      robloxSettings = null;
      if (err?.status === 401) {
        box.replaceChildren(row('Sign in to change these.', link('more', ROBLOX_LAUNCHER, 'Sign in')));
        return;
      }
      const again = button('more', 'Try again');
      again.addEventListener('click', load);
      box.replaceChildren(row("Couldn't load these from Roblox.", again));
      console.warn('[launcher] Roblox settings failed:', err?.message);
    });
  };
  load();
  return box;
}

function readGraphics() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(GRAPHICS_KEY)) || {};
  } catch {}
  const settings = { ...GRAPHICS_DEFAULTS };
  for (const key of Object.keys(settings)) {
    if (typeof stored[key] === typeof settings[key]) settings[key] = stored[key];
  }
  return { stored, settings };
}

function saveGraphics(update) {
  const { stored, settings } = readGraphics();
  try {
    localStorage.setItem(GRAPHICS_KEY, JSON.stringify({ ...stored, ...settings, ...update, v: GRAPHICS_DEFAULTS.v }));
  } catch {}
}

const matchingPreset = settings => PRESETS.find(([, , preset]) => Object.entries(preset).every(([key, value]) => settings[key] === value || (key === 'quality' && settings.quality < 0)))?.[0] || '';

function appearancePanel() {
  const modes = modePicker();
  const themes = themePicker(() => {
    modes.disabled = fixedMode();
  });
  themes.classList.add('pref-block');
  return [row('Mode', modes), themes, el('h3', '', 'Roblox'), robloxRows(['themeType'])];
}

function loadingPanel() {
  const parts = [loaderPicker()];
  parts[0].classList.add('pref-block');
  if (!wispMode) {
    const eras = el('section');
    const picker = uiEraPicker();
    picker.classList.add('pref-block');
    eras.append(el('h3', '', 'In-game UI'), el('p', 'prefs-note', 'The Roblox menu from that time. Applies the next time you join.'), picker);
    parts.push(eras);
  }
  return parts;
}

function graphicsPanel() {
  const { settings } = readGraphics();
  const controls = {};
  const preset = choice('Preset', PRESETS.map(([id, name]) => [id, name]), matchingPreset(settings), id => {
    const found = PRESETS.find(([key]) => key === id);
    saveGraphics(found[2]);
    for (const [key, value] of Object.entries(found[2])) controls[key]?.(value);
  }, 'Custom');
  const rows = GRAPHICS_ROWS.map(([key, label, options]) => {
    const pick = value => {
      saveGraphics({ [key]: value });
      preset.setValue(matchingPreset(readGraphics().settings));
    };
    if (!options) {
      const input = toggle(settings[key], pick);
      controls[key] = value => {
        input.checked = value;
      };
      return row(label, input);
    }
    const menu = choice(label, options, settings[key], pick, key === 'quality' ? 'As set in game' : undefined);
    controls[key] = value => menu.setValue(String(value));
    return row(label, menu);
  });
  return [el('p', 'prefs-note', 'Same as Esc > Settings in a game. Changes apply the next time you join.'), row('Preset', preset), ...rows];
}

function privacyPanel() {
  return [
    robloxRows(['whoCanJoinMeInExperiences', 'privateServerPrivacy', 'whoCanSeeMyInventory', 'friendSuggestions', 'phoneNumberDiscoverability', 'contentAgeRestriction']),
    el('h3', '', 'Chat'),
    robloxRows(['whoCanChatWithMeInApp', 'whoCanGroupChatWithMeInApp', 'whoCanChatWithMeInExperiences', 'whoCanWhisperChatWithMeInExperiences']),
  ];
}

function tradingPanel() {
  return [robloxRows(['whoCanTradeWithMe', 'tradeQualityFilter'])];
}

function rovalraPanel() {
  const features = el('div');
  const paint = () => {
    features.hidden = !rovalraOption('enabled');
  };
  for (const [title, list] of ROVALRA_FEATURES) {
    features.append(el('h3', '', title), ...list.map(([key, label]) => row(label, toggle(rovalraOption(key), on => setRovalra(key, on)))));
  }
  const credit = el('p', 'prefs-note', 'Features based on ');
  const project = link('', 'https://github.com/NotValra/RoValra', 'RoValra');
  const site = link('', 'https://www.rovalra.com', 'rovalra.com');
  for (const anchor of [project, site]) {
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  }
  credit.append(project, ', rebuilt for WebBlox. Values and server locations come from ', site, '.');
  paint();
  return [
    credit,
    row('Turn on RoValra features', toggle(rovalraOption('enabled'), on => {
      setRovalra('enabled', on);
      paint();
    })),
    features,
  ];
}

async function hiddenRows(box) {
  const ids = [...hiddenGames()];
  if (!ids.length) {
    box.replaceChildren(el('p', 'prefs-note', 'Games you hide from Home show up here.'));
    return;
  }
  const missing = ids.filter(id => !state.games[id]?.name);
  if (missing.length) {
    const found = await api(`https://games.roblox.com/v1/games?universeIds=${missing.slice(0, 50).join(',')}`).catch(() => ({}));
    for (const game of found.data || []) state.games[game.id] = { ...state.games[game.id], universeId: game.id, name: game.name };
  }
  box.replaceChildren(...ids.map(id => {
    const show = button('more', 'Unhide');
    show.addEventListener('click', () => {
      setGameHidden(id, false);
      toast('Back on Home');
      hiddenRows(box);
    });
    const line = row('', show);
    line.firstChild.append(link('pref-link', `#/game/${id}`, state.games[id]?.name || 'Game'));
    return line;
  }));
}

function cacheSize() {
  let chars = 0;
  try {
    for (const key of Object.keys(localStorage)) if (CACHE_KEYS.test(key)) chars += key.length + localStorage.getItem(key).length;
  } catch {}
  const bytes = chars * 2;
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function clearKeys(pattern) {
  try {
    Object.keys(localStorage).filter(key => pattern.test(key)).forEach(key => localStorage.removeItem(key));
  } catch {}
}

function advancedPanel() {
  const relay = window.CobaltIframe?.wispUrl || window.COBALT_WISP_URLS?.[0] || '';
  const connection = wispMode
    ? row(`Connected through ${relay ? new URL(relay).host : 'a Wisp relay'}`, ...(window.WEBLOX_SERVER ? [link('more', '/?mode=node', 'Use this computer')] : []))
    : row('Connected through this computer', link('more', '/?mode=wisp', 'Use Wisp'));

  const hidden = el('div');
  hiddenRows(hidden);

  const size = el('span', '', cacheSize());
  const clear = button('more', 'Clear');
  clear.addEventListener('click', () => {
    clearKeys(CACHE_KEYS);
    size.textContent = 'Cleared';
    clear.disabled = true;
  });
  const reset = button('more', 'Reset');
  reset.addEventListener('click', async () => {
    const yes = await confirmDialog('Reset WebBlox settings?', 'Theme, loading screen, graphics and RoValra features go back to their defaults. Your Roblox account settings stay as they are.', 'Reset', true);
    if (!yes) return;
    clearKeys(PREFERENCE_KEYS);
    try {
      localStorage.removeItem(GRAPHICS_KEY);
    } catch {}
    location.reload();
  });

  return [
    connection,
    row('Saved data', size, clear),
    row('Reset WebBlox settings', reset),
    row("Roblox's launcher", link('more', ROBLOX_LAUNCHER, 'Open')),
    row('Roblox account settings', link('more', '#/web/settings', 'Open')),
    el('h3', '', 'Hidden games'),
    hidden,
  ];
}

const PANELS = [
  ['appearance', 'Appearance', appearancePanel],
  ['loading', 'Loading screen', loadingPanel],
  ['graphics', 'Graphics', graphicsPanel],
  ['privacy', 'Privacy', privacyPanel],
  ['trading', 'Trading', tradingPanel],
  ['rovalra', 'RoValra', rovalraPanel],
  ['advanced', 'Advanced', advancedPanel],
];

export function showSettings(root, { tab }) {
  const current = PANELS.find(([id]) => id === tab) || PANELS[0];
  robloxSettings = null;
  const nav = el('nav', 'prefs-nav');
  nav.setAttribute('aria-label', 'Settings');
  for (const [id, title] of PANELS) {
    const item = link('prefs-tab', `#/settings/${id}`, title);
    if (id === current[0]) item.setAttribute('aria-current', 'page');
    nav.append(item);
  }
  const panel = el('section', 'prefs-panel');
  panel.append(el('h2', '', current[1]), ...current[2]());
  const layout = el('div', 'prefs');
  layout.append(nav, panel);
  root.replaceChildren(pageHead('Settings'), layout);
  const active = nav.querySelector('[aria-current]');
  if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.getBoundingClientRect().left - nav.getBoundingClientRect().left - 16;
}
