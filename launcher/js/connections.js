import { api, button, compact, confirmDialog, el, faces, failed, icon, image, link, loadFailure, skeleton, state, toast, userNames } from './core.js';

const FRIENDS = 'https://friends.roblox.com/v1';
const PAGE = 50;
const SKELETONS = 9;
const PRELOAD_PX = 600;
const PRESENCE = { 1: ['Online', 'online'], 2: ['Playing', 'playing'], 3: ['In Studio', 'online'] };

const TABS = [
  ['friends', 'Friends', id => `${FRIENDS}/users/${id}/friends/count`],
  ['following', 'Following', id => `${FRIENDS}/users/${id}/followings/count`],
  ['followers', 'Followers', id => `${FRIENDS}/users/${id}/followers/count`],
  ['requests', 'Requests', () => `${FRIENDS}/user/friend-requests/count`, true],
];

const SOURCES = {
  async friends(id, cursor) {
    const page = await api(`${FRIENDS}/users/${id}/friends/find?limit=${PAGE}&userSort=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    return [(page.PageItems || []).map(row => row.id), page.NextCursor];
  },
  async following(id, cursor) {
    const page = await api(`${FRIENDS}/users/${id}/followings?limit=${PAGE}&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    return [(page.data || []).map(row => row.id), page.nextPageCursor];
  },
  async followers(id, cursor) {
    const page = await api(`${FRIENDS}/users/${id}/followers?limit=${PAGE}&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    return [(page.data || []).map(row => row.id), page.nextPageCursor];
  },
  async requests(id, cursor) {
    const page = await api(`${FRIENDS}/my/friends/requests?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    return [(page.data || []).map(row => row.id), page.nextPageCursor];
  },
};

async function presenceFor(ids) {
  if (!ids.length) return {};
  const { userPresences = [] } = await api('https://presence.roblox.com/v1/presence/users', { userIds: ids.map(Number) }).catch(() => ({}));
  return Object.fromEntries(userPresences.map(entry => [entry.userId, entry]));
}

function placeholders() {
  return Array.from({ length: SKELETONS }, () => {
    const item = el('div', 'connection connection-skeleton skeleton');
    item.append(el('span', 'art'), el('span', 'line'));
    return item;
  });
}

function card(id, presence, actions) {
  const who = state.names[id] || {};
  const node = el('div', 'connection');
  const open = link('connection-main', `#/user/${id}`);
  const face = el('span', 'connection-face');
  face.append(image(state.faces[id], '', true));
  const [label, tone] = PRESENCE[presence?.userPresenceType] || ['Offline', 'offline'];
  if (tone !== 'offline') face.append(el('span', `connection-dot ${tone}`));
  const text = el('span', 'connection-text');
  const name = el('strong');
  name.append(el('span', '', who.displayName || 'Roblox user'));
  if (who.verified) {
    const badge = icon('verified-mono', true);
    badge.setAttribute('aria-label', 'Verified');
    name.append(badge);
  }
  const status = presence?.userPresenceType === 2 && presence.lastLocation ? presence.lastLocation : label;
  text.append(name, el('span', 'connection-handle', `@${who.name || ''}`));
  if (tone !== 'offline') text.append(el('span', `connection-status ${tone}`, status));
  open.append(face, text);
  node.append(open);
  if (actions) node.append(actions);
  return node;
}

export async function showConnections(root, { userId, tab }, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const id = String(userId || state.me.id);
    const isMe = id === String(state.me.id);
    const tabs = TABS.filter(([, , , mineOnly]) => isMe || !mineOnly);
    const [user, ...counts] = await Promise.all([
      isMe ? null : api(`https://users.roblox.com/v1/users/${id}`),
      ...tabs.map(([, , url]) => api(url(id)).then(result => result.count ?? 0, () => null)),
    ]);
    if (!alive()) return;
    if (user) state.names[id] = { displayName: user.displayName, name: user.name, verified: user.hasVerifiedBadge };
    let current = tabs.find(([key]) => key === tab) || tabs[0];
    const total = Object.fromEntries(tabs.map(([key], index) => [key, counts[index]]));
    let token = 0;
    let cursor = '';
    let busy = false;
    let loaded = [];
    let presence = {};
    let keyword = '';
    const page = el('div', 'connections-page');
    const head = el('header', 'connections-head');
    if (isMe) head.append(el('h1', '', 'Friends'));
    else {
      const back = link('back', `#/user/${id}`);
      back.append(icon('chevron-large-left'), 'Profile');
      const title = el('h1', '', user.displayName);
      head.append(back, title, el('p', 'section-note', `@${user.name}`));
    }
    const bar = el('div', 'tab-bar connections-tabs');
    bar.setAttribute('role', 'tablist');
    const tabButtons = tabs.map(entry => {
      const [key, label] = entry;
      const node = button('tab', label);
      node.setAttribute('role', 'tab');
      node.dataset.key = key;
      node.addEventListener('click', () => pick(entry));
      return node;
    });
    bar.append(...tabButtons);
    const tools = el('div', 'connections-tools');
    const find = el('label', 'connections-find');
    const field = el('input');
    field.type = 'search';
    field.placeholder = 'Filter by name';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Filter by name');
    find.append(icon('magnifying-glass'), field);
    const ignore = button('more connections-ignore', 'Ignore all');
    ignore.addEventListener('click', async () => {
      if (!await confirmDialog('Ignore all friend requests?', 'Everyone who sent you a request will stay unanswered and drop off this list.', 'Ignore all', true)) return;
      try {
        await api(`${FRIENDS}/user/friend-requests/decline-all`, {});
        toast('Requests ignored');
        total.requests = 0;
        paintTabs();
        load();
      } catch (err) {
        failed("That didn't work.", err);
      }
    });
    tools.append(find, ignore);
    const grid = el('div', 'connection-grid');
    const status = el('div', 'connections-empty');
    const sentinel = el('div', 'connections-sentinel');
    page.append(head, bar, tools, grid, status, sentinel);
    const named = target => {
      const who = state.names[target] || {};
      return !keyword || who.displayName?.toLowerCase().includes(keyword) || who.name?.toLowerCase().includes(keyword);
    };
    const answer = (target, path, done) => {
      const actions = el('div', 'connection-actions');
      const accept = button('play', 'Accept');
      const decline = button('more', 'Decline');
      const run = async (route, message, delta) => {
        accept.disabled = true;
        decline.disabled = true;
        try {
          await api(`${FRIENDS}/users/${target}/${route}`, {});
          toast(message);
          loaded = loaded.filter(entry => entry !== target);
          actions.closest('.connection')?.remove();
          total.requests = Math.max(0, (total.requests || 1) - 1);
          if (delta) total.friends = (total.friends || 0) + 1;
          paintTabs();
          paintStatus();
        } catch (err) {
          accept.disabled = false;
          decline.disabled = false;
          failed("That didn't work.", err);
        }
      };
      accept.addEventListener('click', () => run(path[0], done[0], true));
      decline.addEventListener('click', () => run(path[1], done[1], false));
      actions.append(accept, decline);
      return actions;
    };
    const render = target => card(target, presence[target], current[0] === 'requests' ? answer(target, ['accept-friend-request', 'decline-friend-request'], ['Friend added', 'Request declined']) : null);
    const paintStatus = () => {
      if (busy || cursor) {
        status.replaceChildren();
        return;
      }
      const glyph = el('span', 'connections-empty-icon');
      glyph.append(icon('two-people'));
      const whose = isMe ? 'You have' : `${user.displayName} has`;
      const empty = {
        friends: `${whose} no friends yet`,
        following: isMe ? "You aren't following anyone" : `${user.displayName} isn't following anyone`,
        followers: `${whose} no followers yet`,
        requests: 'No friend requests right now',
      };
      if (!loaded.length) status.replaceChildren(glyph, el('strong', '', empty[current[0]]));
      else if (!grid.children.length) status.replaceChildren(glyph, el('strong', '', 'Nobody matches'), el('span', '', `No one here has "${field.value.trim()}" in their name.`));
      else status.replaceChildren();
    };
    const fetchPage = async () => {
      if (busy) return;
      const mine = token;
      busy = true;
      try {
        const [ids, next] = await SOURCES[current[0]](id, cursor);
        const [found] = await Promise.all([presenceFor(ids), faces(ids), userNames(ids)]);
        if (mine !== token) return;
        Object.assign(presence, found);
        grid.querySelectorAll('.connection-skeleton').forEach(node => node.remove());
        const fresh = ids.filter(entry => !loaded.includes(entry));
        loaded = loaded.concat(fresh);
        grid.append(...fresh.filter(named).map(render));
        cursor = next || '';
      } catch (err) {
        if (mine !== token) return;
        grid.replaceChildren();
        cursor = '';
        const glyph = el('span', 'connections-empty-icon');
        glyph.append(icon('two-people'));
        status.replaceChildren(glyph, el('strong', '', err.status === 403 ? 'This list is private' : "This list didn't load"), el('span', '', err.status === 403 ? 'Only its owner can see it.' : 'Try again in a moment.'));
        console.warn('[launcher] connections failed:', err.message);
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
    function paintTabs() {
      for (const node of tabButtons) {
        const on = node.dataset.key === current[0];
        node.setAttribute('aria-selected', String(on));
        node.tabIndex = on ? 0 : -1;
        node.querySelector('.tab-count')?.remove();
        const count = total[node.dataset.key];
        if (count !== null && count !== undefined) node.append(el('span', 'tab-count', compact(count)));
      }
      ignore.hidden = current[0] !== 'requests' || !total.requests;
      requestAnimationFrame(() => {
        const active = tabButtons.find(node => node.dataset.key === current[0]);
        if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = active.offsetLeft - bar.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
      });
    }
    function pick(entry) {
      if (entry === current) return;
      current = entry;
      history.replaceState(null, '', isMe ? `#/friends/${current[0]}` : `#/user/${id}/${current[0]}`);
      paintTabs();
      load();
    }
    field.addEventListener('input', () => {
      keyword = field.value.trim().toLowerCase();
      grid.replaceChildren(...loaded.filter(named).map(render));
      paintStatus();
    });
    const watcher = new IntersectionObserver(([entry]) => {
      if (!alive()) watcher.disconnect();
      else if (entry.isIntersecting && cursor) fetchPage();
    }, { rootMargin: `${PRELOAD_PX}px 0px` });
    paintTabs();
    root.replaceChildren(page);
    watcher.observe(sentinel);
    load();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showConnections(root, { userId, tab }, alive));
  }
}
