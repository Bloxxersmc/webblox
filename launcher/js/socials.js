import { api, el, icon, link } from './core.js';

export const CHANNELS = 'https://accountinformation.roblox.com/v1/promotion-channels';

export const EDITABLE = [
  ['youtube', 'YouTube'],
  ['twitch', 'Twitch'],
  ['twitter', 'X'],
  ['facebook', 'Facebook'],
];

const SHOWN = [
  ['x', 'X', 'twitter'],
  ['twitter', 'X', 'twitter'],
  ['youtube', 'YouTube', 'youtube'],
  ['facebook', 'Facebook', 'facebook'],
  ['discord', 'Discord', 'discord'],
  ['twitch', 'Twitch', 'twitch'],
  ['guilded', 'Guilded', 'guilded'],
];

export async function socialLinks(id) {
  const profile = await api('https://apis.roblox.com/profile-platform-api/v1/profiles/get', { profileId: String(id), profileType: 'User', components: [{ component: 'About' }] }).catch(() => null);
  const links = profile?.components?.About?.socialLinks || {};
  const row = el('div', 'social-links');
  const shown = new Set();
  for (const [key, label, glyph] of SHOWN) {
    const url = links[key]?.url;
    if (!url || !/^https:\/\//i.test(url) || shown.has(label)) continue;
    shown.add(label);
    const node = link('social-icon', url);
    node.target = '_blank';
    node.rel = 'noopener';
    node.setAttribute('aria-label', label);
    node.append(icon(glyph));
    row.append(node);
  }
  return row.children.length ? row : null;
}
