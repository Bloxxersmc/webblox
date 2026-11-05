import { el } from './core.js';
import { loaderPreview, loadPreviewIcons, previewKey, themePreview } from './previews.js';

const LOADER_KEY = 'webblox.launcher.loader';
const DEFAULT_LOADER = 'tilt';
const LOADERS = [
  ['tilt', 'Tilt'],
  ['classic', 'Classic'],
  ['2014', '2014'],
  ['2016', '2016'],
  ['2020', '2017–2022'],
];
const VARIANTS = {
  tilt: [
    ['standard', 'Standard'],
    ['pioneer', 'Pioneer'],
  ],
  classic: [
    ['web', 'Web'],
    ['client-2023', 'Client (2023 onward)'],
    ['client-2022', 'Client launch (2022)'],
  ],
  2016: [
    ['standard', 'Standard'],
    ['console', 'Console'],
  ],
  2020: [
    ['thumbnail', 'Thumbnail (2017–2021)'],
    ['icon', 'Square icon (2021–2022)'],
    ['white', 'White (2017)'],
  ],
};
const THEME_KEY = 'webblox.launcher.theme';
const MODE_KEY = 'webblox.launcher.themeMode';
const DEFAULT_THEME = 'Default';
const DEFAULT_MODE = 'dark';
const MODES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];
const THEME_GROUPS = [
  ['', [
    ['Default', 'Default'],
    ['xbox', 'Xbox'],
  ]],
  ['Dynamic', [
    ['CosmicDust', 'Cosmic Dust'],
    ['PolarFreeze', 'Polar Freeze'],
    ['SuperCharge', 'Super Charge'],
    ['ElectricLime', 'Electric Lime'],
    ['LavaGlow', 'Lava Glow'],
    ['StarBurst', 'Star Burst'],
    ['PixelPop', 'Pixel Pop'],
  ]],
  ['Calm', [
    ['NebulaDrift', 'Nebula Drift'],
    ['NitroFrost', 'Nitro Frost'],
    ['CircuitRush', 'Circuit Rush'],
    ['KineticEnergy', 'Kinetic Energy'],
    ['InfernoBlast', 'Inferno Blast'],
    ['HyperPlum', 'Hyper Plum'],
    ['QuantumPulse', 'Quantum Pulse'],
  ]],
  ['Special', [
    ['Classic', 'Classic'],
    ['Halloween2026', 'The Hollow'],
  ]],
];
const THEME_IDS = THEME_GROUPS.flatMap(([, themes]) => themes.map(([id]) => id));
const FIXED_MODE = new Set(['xbox', 'Halloween2026']);
const systemLight = matchMedia('(prefers-color-scheme: light)');

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEME_IDS.includes(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function savedMode() {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return MODES.some(([id]) => id === value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function resolve(theme) {
  if (theme === 'xbox') return theme;
  if (theme === 'Halloween2026') return `${theme}-dark`;
  const mode = savedMode();
  if (mode === 'system') return `${theme}-${systemLight.matches ? 'light' : 'dark'}`;
  return `${theme}-${mode}`;
}

function applyTheme() {
  document.documentElement.dataset.theme = resolve(savedTheme());
}

function paintThemePreviews() {
  document.querySelectorAll('.theme-grid').forEach(group => {
    group.querySelectorAll('.theme-card').forEach(card => {
      card.querySelector('.theme-preview').replaceWith(themePreview(resolve(card.querySelector('input').value)));
    });
    loadPreviewIcons(group);
  });
}

function themeChanged() {
  applyTheme();
  paintThemePreviews();
}

export function watchTheme() {
  applyTheme();
  systemLight.addEventListener('change', themeChanged);
  window.addEventListener('storage', event => {
    if (event.key === THEME_KEY || event.key === MODE_KEY) themeChanged();
  });
}

let shownPreviews = '';

export function refreshThemePreviews() {
  if (!document.querySelector('.theme-grid') || previewKey() === shownPreviews) return;
  shownPreviews = previewKey();
  paintThemePreviews();
  paintLoaderPreviews();
}

function paintLoaderPreviews() {
  const loaders = document.querySelector('.loader-grid');
  if (!loaders) return;
  loaders.querySelectorAll('.theme-card').forEach(card => {
    const loader = card.querySelector('input').value;
    card.querySelector('.theme-preview').replaceWith(loaderPreview(loader, savedVariant(loader)));
  });
  loadPreviewIcons(loaders);
  document.querySelectorAll('.loader-variants').forEach(panel => {
    panel.querySelectorAll('.theme-card').forEach(card => {
      card.querySelector('.theme-preview').replaceWith(loaderPreview(panel.dataset.loader, card.querySelector('input').value));
    });
    loadPreviewIcons(panel);
  });
}

function savedVariant(loader) {
  const options = VARIANTS[loader];
  if (!options) return '';
  try {
    const value = localStorage.getItem(LOADER_KEY + loader);
    return options.some(([id]) => id === value) ? value : options[0][0];
  } catch {
    return options[0][0];
  }
}

function savedLoader() {
  try {
    const value = localStorage.getItem(LOADER_KEY);
    return LOADERS.some(([id]) => id === value) ? value : DEFAULT_LOADER;
  } catch {
    return DEFAULT_LOADER;
  }
}

function variantPicker(loader, loaderName) {
  const panel = el('div', 'loader-variants');
  panel.dataset.loader = loader;
  const title = `${loaderName} variant`;
  const heading = el('h3', 'loader-variants-title', title);
  const group = el('div', 'loader-variant-grid');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', title);
  const current = savedVariant(loader);
  for (const [id, name] of VARIANTS[loader]) {
    const card = el('label', 'theme-card');
    const input = el('input');
    input.type = 'radio';
    input.name = `launcher-loader-variant-${loader}`;
    input.value = id;
    input.checked = id === current;
    input.addEventListener('change', () => {
      try {
        localStorage.setItem(LOADER_KEY + loader, id);
      } catch {}
      paintLoaderPreviews();
    });
    card.append(input, loaderPreview(loader, id), el('span', 'theme-name', name));
    group.append(card);
  }
  panel.append(heading, group);
  loadPreviewIcons(group);
  return panel;
}

export function loaderPicker() {
  const wrapper = el('div');
  const group = el('div', 'loader-grid');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Loading screen');
  const current = savedLoader();
  const panels = LOADERS.filter(([id]) => VARIANTS[id]).map(([id, name]) => {
    const panel = variantPicker(id, name);
    panel.hidden = id !== current;
    return panel;
  });
  for (const [id, name] of LOADERS) {
    const card = el('label', 'theme-card');
    const input = el('input');
    input.type = 'radio';
    input.name = 'launcher-loader';
    input.value = id;
    input.checked = id === current;
    input.addEventListener('change', () => {
      try {
        localStorage.setItem(LOADER_KEY, id);
      } catch {}
      panels.forEach(panel => {
        panel.hidden = panel.dataset.loader !== id;
      });
    });
    card.append(input, loaderPreview(id, savedVariant(id)), el('span', 'theme-name', name));
    group.append(card);
  }
  loadPreviewIcons(group);
  wrapper.append(group, ...panels);
  return wrapper;
}

const UI_ERA_KEY = 'webblox.launcher.uiEra';
const CURRENT_UI = { id: '', label: 'Current' };

function savedUiEra() {
  try {
    return localStorage.getItem(UI_ERA_KEY) || '';
  } catch {
    return '';
  }
}

async function requestUiEras() {
  const response = await fetch('/__uieras');
  if (!response.ok) throw new Error(`in-game UI list returned ${response.status}`);
  return response.json();
}

export function uiEraPicker() {
  const wrapper = el('div');
  const group = el('div', 'loader-grid');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'In-game UI');
  wrapper.append(group);
  requestUiEras().then(list => {
    const saved = savedUiEra();
    const current = list.some(era => era.id === saved) ? saved : CURRENT_UI.id;
    for (const era of [CURRENT_UI, ...list]) {
      const card = el('label', 'theme-card');
      const input = el('input');
      input.type = 'radio';
      input.name = 'launcher-ui-era';
      input.value = era.id;
      input.checked = era.id === current;
      input.addEventListener('change', () => {
        try {
          if (era.id) localStorage.setItem(UI_ERA_KEY, era.id);
          else localStorage.removeItem(UI_ERA_KEY);
        } catch {}
      });
      const preview = el('span', 'theme-preview ui-era-preview');
      const image = el('img');
      image.src = `${self.__WB||'/'}launcher/ui-eras/${era.id || 'current'}.jpg`;
      image.alt = '';
      image.loading = 'lazy';
      preview.append(image);
      card.append(input, preview, el('span', 'theme-name', era.label));
      group.append(card);
    }
  }, () => {
    wrapper.closest('section')?.remove();
    wrapper.remove();
  });
  return wrapper;
}

export const fixedMode = () => FIXED_MODE.has(savedTheme());

export function modePicker() {
  const field = el('fieldset', 'theme-mode');
  field.append(el('legend', '', 'Mode'));
  const options = el('div', 'theme-mode-options');
  const current = savedMode();
  for (const [id, name] of MODES) {
    const option = el('label', 'theme-mode-option');
    const input = el('input');
    input.type = 'radio';
    input.name = 'launcher-theme-mode';
    input.value = id;
    input.checked = id === current;
    input.addEventListener('change', () => {
      try {
        localStorage.setItem(MODE_KEY, id);
      } catch {}
      themeChanged();
    });
    option.append(input, name);
    options.append(option);
  }
  field.append(options);
  field.disabled = fixedMode();
  return field;
}

export function themePicker(onPick) {
  const wrapper = el('div');
  const current = savedTheme();
  for (const [title, themes] of THEME_GROUPS) {
    if (title) wrapper.append(el('h3', 'theme-group-title', title));
    const group = el('div', 'theme-grid');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', title || 'Theme');
    for (const [id, name] of themes) {
      const card = el('label', 'theme-card');
      const input = el('input');
      input.type = 'radio';
      input.name = 'launcher-theme';
      input.value = id;
      input.checked = id === current;
      input.addEventListener('change', () => {
        try {
          localStorage.setItem(THEME_KEY, id);
        } catch {}
        applyTheme();
        onPick?.(id);
      });
      card.append(input, themePreview(resolve(id)), el('span', 'theme-name', name));
      group.append(card);
    }
    loadPreviewIcons(group);
    wrapper.append(group);
  }
  shownPreviews = previewKey();
  return wrapper;
}
