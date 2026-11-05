import { api, button, card, compact, confirmDialog, dropdown, el, faces, failed, gameArt, icon, image, link, loadFailure, personTile, robloxUrl, send, skeleton, state, tabs, thumbnails, timeAgo, toast } from './core.js';
import { robuxAmount } from './market.js';

const GROUPS = 'https://groups.roblox.com/v1/groups';
const MEMBERS_PAGE = 50;
const AUDIT_PAGE = 25;
const PREVIEW = 10;
const SORTS = [['rank', 'Your rank'], ['members', 'Most members'], ['name', 'Name']];

const gameFromV2 = game => ({ universeId: game.id, rootPlaceId: game.rootPlace?.id, name: game.name });
const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null));

function emptyState(glyphName, title, text) {
  const box = el('div', 'group-empty');
  const glyph = el('span', 'group-empty-icon');
  glyph.append(icon(glyphName));
  box.append(glyph, el('strong', '', title));
  if (text) box.append(el('span', '', text));
  return box;
}

function communityCard(entry, art, owned, primary) {
  const node = link('community-card', `#/group/${entry.group.id}`);
  const logo = el('span', 'community-logo');
  logo.append(image(art, '', true));
  const text = el('span', 'community-text');
  const name = el('strong');
  name.append(el('span', '', entry.group.name));
  if (entry.group.hasVerifiedBadge) {
    const badge = icon('verified-mono', true);
    badge.setAttribute('aria-label', 'Verified');
    name.append(badge);
  }
  const role = owned ? 'Owner' : entry.role.name;
  text.append(name, el('span', '', `${compact(entry.group.memberCount)} ${entry.group.memberCount === 1 ? 'member' : 'members'}`), el('span', '', primary ? `${role}, primary` : role));
  node.append(logo, text);
  return node;
}

export async function showCommunities(root, params, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [{ data = [] }, primary] = await Promise.all([
      api(`https://groups.roblox.com/v2/users/${state.me.id}/groups/roles`),
      api(`https://groups.roblox.com/v1/users/${state.me.id}/groups/primary/role`).catch(() => null),
    ]);
    const icons = await thumbnails(data.map(entry => ({ key: String(entry.group.id), request: { targetId: entry.group.id, type: 'GroupIcon', size: '150x150' } }))).catch(() => ({}));
    if (!alive()) return;
    const page = el('div', 'communities-page');
    const head = el('header', 'communities-head');
    const title = el('div', 'communities-title');
    title.append(el('h1', '', 'Communities'), el('p', 'section-note', data.length ? `You're in ${data.length} ${data.length === 1 ? 'community' : 'communities'}.` : "You aren't in any communities yet."));
    const tools = el('div', 'communities-tools');
    const find = el('label', 'connections-find');
    const field = el('input');
    field.type = 'search';
    field.placeholder = 'Filter by name';
    field.autocomplete = 'off';
    field.setAttribute('aria-label', 'Filter communities by name');
    find.append(icon('magnifying-glass'), field);
    let sort = 'rank';
    tools.append(find, dropdown({ label: 'Sort', options: SORTS, value: sort, className: 'dropdown-chip', onPick: value => {
      sort = value;
      paint();
    } }));
    head.append(title, tools);
    const body = el('div', 'communities-body');
    page.append(head, body);
    const ownedId = entry => entry.role.rank === 255;
    const primaryId = primary?.group?.id;
    const order = {
      rank: (a, b) => b.role.rank - a.role.rank || b.group.memberCount - a.group.memberCount,
      members: (a, b) => b.group.memberCount - a.group.memberCount,
      name: (a, b) => a.group.name.localeCompare(b.group.name),
    };
    function paint() {
      const needle = field.value.trim().toLowerCase();
      const list = data.filter(entry => !needle || entry.group.name.toLowerCase().includes(needle)).sort(order[sort]);
      const owned = list.filter(ownedId);
      const joined = list.filter(entry => !ownedId(entry));
      const parts = [];
      const block = (heading, entries) => {
        const section = el('section', 'communities-section');
        const grid = el('div', 'community-grid');
        grid.append(...entries.map(entry => communityCard(entry, icons[entry.group.id], ownedId(entry), entry.group.id === primaryId)));
        section.append(el('h2', '', heading), grid);
        return section;
      };
      if (owned.length) parts.push(block('Owned by you', owned));
      if (joined.length) parts.push(block(owned.length ? 'Joined' : 'Your communities', joined));
      if (!parts.length) parts.push(emptyState('three-people', data.length ? 'Nothing matches' : 'No communities yet', data.length ? `None of your communities have "${field.value.trim()}" in the name.` : 'Search at the top to find one to join.'));
      body.replaceChildren(...parts);
    }
    field.addEventListener('input', paint);
    paint();
    root.replaceChildren(page);
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showCommunities(root, params, alive));
  }
}

function memberRow(user, role, tools) {
  const row = el('div', 'member-row');
  const open = link('member-main', `#/user/${user.userId}`);
  const face = el('span', 'member-face');
  face.append(image(state.faces[user.userId], '', true));
  const text = el('span', 'member-text');
  text.append(el('strong', '', user.displayName || user.username), el('span', '', `@${user.username}`));
  open.append(face, text);
  row.append(open);
  if (tools) row.append(tools);
  else if (role) row.append(el('span', 'member-role', role.name));
  return row;
}

function membersTab(id, roles, membership, refresh) {
  const box = el('div', 'group-tab');
  const myRank = membership.userRole?.role?.rank ?? 0;
  const perms = membership.permissions?.groupMembershipPermissions || {};
  const assignable = roles.filter(role => role.rank > 0 && role.rank < myRank);
  const tools = el('div', 'group-tools');
  let roleFilter = 'all';
  tools.append(dropdown({
    label: 'Role',
    options: [['all', 'All roles'], ...roles.filter(role => role.rank > 0).map(role => [String(role.id), `${role.name} (${compact(role.memberCount)})`])],
    value: roleFilter,
    className: 'dropdown-chip',
    onPick: value => {
      roleFilter = value;
      load();
    },
  }));
  const list = el('div', 'member-list');
  const status = el('div');
  const more = button('more', 'Show more members');
  more.hidden = true;
  box.append(tools, list, status, more);
  let cursor = '';
  let token = 0;
  const controls = (user, role, row) => {
    if (String(user.userId) === String(state.me.id) || role.rank >= myRank) return null;
    if (!perms.changeRank && !perms.removeMembers) return null;
    const wrap = el('div', 'member-tools');
    if (perms.changeRank && assignable.length) {
      wrap.append(dropdown({
        label: `Role for ${user.displayName}`,
        options: assignable.map(option => [String(option.id), option.name]),
        value: String(role.id),
        describe: () => role.name,
        className: 'dropdown-chip',
        onPick: async value => {
          const next = assignable.find(option => String(option.id) === value);
          try {
            await send(`${GROUPS}/${id}/users/${user.userId}`, 'PATCH', { roleId: Number(value) });
            toast(`${user.displayName} is now ${next.name}`);
            refresh();
          } catch (err) {
            failed("The role didn't change.", err);
          }
        },
      }));
    } else wrap.append(el('span', 'member-role', role.name));
    if (perms.removeMembers) {
      const remove = button('icon-button member-remove');
      remove.setAttribute('aria-label', `Remove ${user.displayName}`);
      remove.title = 'Remove from community';
      remove.append(icon('x'));
      remove.addEventListener('click', async () => {
        if (!await confirmDialog(`Remove ${user.displayName}?`, 'They will leave the community and can rejoin later if it is open.', 'Remove', true)) return;
        try {
          await send(`${GROUPS}/${id}/users/${user.userId}`, 'DELETE');
          toast(`${user.displayName} was removed`);
          row.remove();
        } catch (err) {
          failed("They weren't removed.", err);
        }
      });
      wrap.append(remove);
    }
    return wrap;
  };
  const page = async () => {
    const mine = token;
    more.disabled = true;
    try {
      const url = roleFilter === 'all'
        ? `${GROUPS}/${id}/users?${query({ limit: MEMBERS_PAGE, sortOrder: 'Desc', cursor })}`
        : `${GROUPS}/${id}/roles/${roleFilter}/users?${query({ limit: MEMBERS_PAGE, sortOrder: 'Desc', cursor })}`;
      const result = await api(url);
      const rows = (result.data || []).map(entry => (entry.user ? entry : { user: entry, role: roles.find(role => String(role.id) === roleFilter) }));
      await faces(rows.map(entry => entry.user.userId));
      if (mine !== token) return;
      for (const entry of rows) {
        const row = memberRow(entry.user, entry.role);
        const extra = controls(entry.user, entry.role, row);
        if (extra) row.querySelector('.member-role')?.replaceWith(extra);
        list.append(row);
      }
      cursor = rows.length < MEMBERS_PAGE ? '' : result.nextPageCursor || '';
      more.hidden = !cursor;
      status.replaceChildren(list.children.length ? '' : emptyState('three-people', 'Nobody has this role'));
    } catch (err) {
      if (mine !== token) return;
      status.replaceChildren(emptyState('three-people', err.status === 403 ? 'The member list is private' : "Members didn't load", err.status === 403 ? null : 'Try again in a moment.'));
    }
    more.disabled = false;
  };
  const load = () => {
    token++;
    cursor = '';
    list.replaceChildren();
    status.replaceChildren(el('p', 'section-note', 'Loading members…'));
    page();
  };
  more.addEventListener('click', page);
  load();
  return box;
}

function requestsTab(id, onCount) {
  const box = el('div', 'group-tab');
  const list = el('div', 'member-list');
  const status = el('div');
  const more = button('more', 'Show more requests');
  more.hidden = true;
  box.append(list, status, more);
  let cursor = '';
  const settle = () => {
    onCount(-1);
    if (!list.children.length && !cursor) status.replaceChildren(emptyState('person-plus', 'No one is waiting to join'));
  };
  const page = async () => {
    more.disabled = true;
    try {
      const result = await api(`${GROUPS}/${id}/join-requests?${query({ limit: MEMBERS_PAGE, sortOrder: 'Desc', cursor })}`);
      const rows = result.data || [];
      await faces(rows.map(entry => entry.requester.userId));
      for (const entry of rows) {
        const user = entry.requester;
        const actions = el('div', 'member-tools');
        const accept = button('play', 'Accept');
        const decline = button('more', 'Decline');
        const row = memberRow(user, null, actions);
        row.querySelector('.member-text').append(el('span', '', `Asked ${timeAgo(entry.created)}`));
        const run = async (method, done) => {
          accept.disabled = true;
          decline.disabled = true;
          try {
            await send(`${GROUPS}/${id}/join-requests/users/${user.userId}`, method, method === 'POST' ? {} : undefined);
            toast(done);
            row.remove();
            settle();
          } catch (err) {
            accept.disabled = false;
            decline.disabled = false;
            failed("That didn't work.", err);
          }
        };
        accept.addEventListener('click', () => run('POST', `${user.displayName} joined`));
        decline.addEventListener('click', () => run('DELETE', 'Request declined'));
        actions.append(accept, decline);
        list.append(row);
      }
      cursor = rows.length < MEMBERS_PAGE ? '' : result.nextPageCursor || '';
      more.hidden = !cursor;
      status.replaceChildren(list.children.length ? '' : emptyState('person-plus', 'No one is waiting to join'));
    } catch (err) {
      status.replaceChildren(emptyState('person-plus', "Requests didn't load", 'Try again in a moment.'));
    }
    more.disabled = false;
  };
  more.addEventListener('click', page);
  page();
  return box;
}

function panel(title, note, ...body) {
  const box = el('section', 'manage-panel');
  const head = el('header', 'manage-head');
  head.append(el('h3', '', title));
  if (note) head.append(el('p', 'section-note', note));
  box.append(head, ...body);
  return box;
}

function textForm({ label, value, placeholder, limit, action, save }) {
  const form = el('form', 'edit-form manage-form');
  const field = el('textarea');
  field.value = value || '';
  field.placeholder = placeholder;
  field.maxLength = limit;
  field.rows = 4;
  field.setAttribute('aria-label', label);
  const foot = el('div', 'manage-foot');
  const counter = el('span', 'manage-count');
  const submit = button('play', action);
  submit.type = 'submit';
  foot.append(counter, submit);
  const paint = () => {
    counter.textContent = `${field.value.length.toLocaleString('en')} / ${limit.toLocaleString('en')}`;
  };
  field.addEventListener('input', paint);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await save(field.value.trim());
    } catch (err) {
      failed("That didn't save.", err);
    }
    submit.disabled = false;
  });
  paint();
  form.append(field, foot);
  return form;
}

function auditSummary(entry) {
  const detail = entry.description || {};
  const pick = ['TargetName', 'Text', 'NewName', 'RoleSetName', 'NewRoleSetName', 'AssetName', 'UniverseName', 'Amount'].map(key => detail[key]).find(value => value !== undefined && value !== null && value !== '');
  return pick === undefined ? '' : String(pick);
}

function auditList(id) {
  const list = el('div', 'audit-list');
  const more = button('more', 'Show older');
  more.hidden = true;
  const status = el('div');
  let cursor = '';
  const page = async () => {
    more.disabled = true;
    try {
      const result = await api(`${GROUPS}/${id}/audit-log?${query({ limit: AUDIT_PAGE, sortOrder: 'Desc', cursor })}`);
      const rows = result.data || [];
      await faces(rows.map(entry => entry.actor?.user?.userId).filter(Boolean));
      for (const entry of rows) {
        const row = el('div', 'audit-row');
        const face = el('span', 'member-face small');
        face.append(image(state.faces[entry.actor?.user?.userId], '', true));
        const text = el('span', 'audit-text');
        const line = el('span', 'audit-line');
        line.append(el('strong', '', entry.actor?.user?.displayName || 'Someone'), ` ${entry.actionType.toLowerCase()}`);
        const summary = auditSummary(entry);
        if (summary) line.append(el('span', 'audit-detail', summary));
        text.append(line, el('span', 'audit-time', timeAgo(entry.created)));
        row.append(face, text);
        list.append(row);
      }
      cursor = rows.length < AUDIT_PAGE ? '' : result.nextPageCursor || '';
      more.hidden = !cursor;
      status.replaceChildren(list.children.length ? '' : el('p', 'section-note', 'Nothing has happened yet.'));
    } catch (err) {
      status.replaceChildren(el('p', 'section-note', "The audit log didn't load."));
    }
    more.disabled = false;
  };
  more.addEventListener('click', page);
  page();
  const box = el('div', 'audit');
  box.append(list, status, more);
  return box;
}

function manageTab(id, group, membership, settings, funds, refresh) {
  const box = el('div', 'group-tab manage');
  const perms = membership.permissions || {};
  const owner = membership.isOwner;
  if (perms.groupPostsPermissions?.postToStatus) {
    box.append(panel('Shout', 'Shown at the top of the community for every member.', textForm({
      label: 'Shout',
      value: group.shout?.body,
      placeholder: 'Say something to your members',
      limit: 255,
      action: 'Post shout',
      save: async message => {
        await send(`${GROUPS}/${id}/status`, 'PATCH', { message });
        toast(message ? 'Shout posted' : 'Shout cleared');
        refresh();
      },
    })));
  }
  if (owner || membership.canConfigure) {
    box.append(panel('Description', null, textForm({
      label: 'Description',
      value: group.description,
      placeholder: 'What is this community about?',
      limit: 1000,
      action: 'Save description',
      save: async description => {
        await send(`${GROUPS}/${id}/description`, 'PATCH', { description });
        toast('Description saved');
        refresh();
      },
    })));
  }
  if ((owner || membership.canConfigure) && settings) {
    const row = el('label', 'setting switch-setting');
    const words = el('span', 'setting-text');
    words.append(el('strong', '', 'Ask before people join'), el('span', '', 'New members wait in Requests until someone with permission lets them in.'));
    const toggle = el('input', 'switch');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = Boolean(settings.isApprovalRequired);
    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      try {
        await send(`${GROUPS}/${id}/settings`, 'PATCH', { isApprovalRequired: toggle.checked });
        toast(toggle.checked ? 'New members now need approval' : 'Anyone can join now');
      } catch (err) {
        toggle.checked = !toggle.checked;
        failed("The setting didn't save.", err);
      }
      toggle.disabled = false;
    });
    row.append(words, toggle);
    box.append(panel('Joining', null, row));
  }
  if (funds && (perms.groupEconomyPermissions?.spendGroupFunds || perms.groupEconomyPermissions?.viewGroupPayouts)) {
    const amount = el('p', 'manage-funds');
    amount.append(robuxAmount(funds.robux || 0));
    const payouts = link('more', robloxUrl(`/communities/configure?id=${id}#!/revenue`), 'Payouts on Roblox');
    payouts.target = '_blank';
    payouts.rel = 'noopener';
    const row = el('div', 'manage-row');
    row.append(amount, payouts);
    box.append(panel('Funds', 'Robux the community holds right now.', row));
  }
  if (perms.groupManagementPermissions?.viewAuditLogs) box.append(panel('Audit log', 'Recent changes made by members with permissions.', auditList(id)));
  const roblox = link('text-action', robloxUrl(`/communities/configure?id=${id}`));
  roblox.target = '_blank';
  roblox.rel = 'noopener';
  roblox.append(icon('arrow-up-right-from-square'), 'Roles, places and everything else on Roblox');
  box.append(roblox);
  return box;
}

export async function showGroup(root, { id, tab }, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [group, gamesPage, membership, iconMap, rolesResult] = await Promise.all([
      api(`${GROUPS}/${id}`),
      api(`https://games.roblox.com/v2/groups/${id}/gamesV2?accessFilter=Public&limit=25`).catch(() => ({})),
      api(`${GROUPS}/${id}/membership`).catch(() => ({})),
      thumbnails([{ key: 'icon', request: { targetId: Number(id), type: 'GroupIcon', size: '420x420' } }]).catch(() => ({})),
      api(`${GROUPS}/${id}/roles`).catch(() => ({})),
    ]);
    const perms = membership.permissions || {};
    const manager = membership.isOwner || membership.canConfigure || perms.groupPostsPermissions?.postToStatus || perms.groupManagementPermissions?.viewAuditLogs;
    const [settings, funds, requestCount] = await Promise.all([
      membership.isOwner || membership.canConfigure ? api(`${GROUPS}/${id}/settings`).catch(() => null) : null,
      perms.groupEconomyPermissions?.spendGroupFunds || perms.groupEconomyPermissions?.viewGroupPayouts ? api(`https://economy.roblox.com/v1/groups/${id}/currency`).catch(() => null) : null,
      perms.groupMembershipPermissions?.inviteMembers ? api(`${GROUPS}/${id}/join-requests?limit=100`).then(result => ({ count: (result.data || []).length, more: Boolean(result.nextPageCursor) }), () => null) : null,
    ]);
    const games = (gamesPage.data || []).map(gameFromV2);
    await Promise.all([gameArt(games), group.shout?.poster ? faces([group.shout.poster.userId]) : null]);
    if (!alive()) return;
    const roles = rolesResult.roles || [];
    const role = membership.userRole?.role;
    const inGroup = role && role.rank > 0;
    const owner = Boolean(membership.isOwner);
    const refresh = () => showGroup(root, { id, tab: location.hash.split('/')[3] }, alive);
    const page = el('div', 'group-page');
    const hero = el('header', 'group-hero');
    const logo = el('div', 'group-logo');
    logo.append(image(iconMap.icon, `${group.name} icon`));
    const info = el('div', 'group-info');
    const name = el('h1', '', group.name);
    if (group.hasVerifiedBadge) {
      const badge = icon('verified-mono', true);
      badge.setAttribute('aria-label', 'Verified');
      name.append(badge);
    }
    const meta = el('div', 'group-meta');
    if (group.owner) {
      const by = el('span', '', 'By ');
      by.append(link('group-owner', `#/user/${group.owner.userId}`, group.owner.displayName));
      meta.append(by);
    } else meta.append(el('span', '', 'No owner'));
    meta.append(el('span', '', `${compact(group.memberCount)} ${group.memberCount === 1 ? 'member' : 'members'}`));
    if (inGroup) meta.append(el('span', '', owner ? 'You own this' : `Your role: ${role.name}`));
    if (membership.isPrimary) meta.append(el('span', '', 'Your primary community'));
    info.append(name, meta);
    const actions = el('div', 'group-actions');
    if (inGroup) {
      const primary = button('more', membership.isPrimary ? 'Remove as primary' : 'Make primary');
      primary.addEventListener('click', async () => {
        primary.disabled = true;
        try {
          if (membership.isPrimary) await send('https://groups.roblox.com/v1/user/groups/primary', 'DELETE');
          else await api('https://groups.roblox.com/v1/user/groups/primary', { groupId: Number(id) });
          toast(membership.isPrimary ? 'No longer your primary community' : 'Now your primary community');
          refresh();
        } catch (err) {
          primary.disabled = false;
          failed("That didn't work.", err);
        }
      });
      actions.append(primary);
      if (!owner) {
        const leave = button('more', 'Leave');
        leave.addEventListener('click', async () => {
          if (!await confirmDialog(`Leave ${group.name}?`, 'You can rejoin later if the community is open.', 'Leave', true)) return;
          try {
            await send(`${GROUPS}/${id}/users/${state.me.id}`, 'DELETE');
            toast('You left the community');
            refresh();
          } catch (err) {
            failed("That didn't work.", err);
          }
        });
        actions.append(leave);
      }
    } else if (membership.isPendingJoin) {
      const pending = button('more', 'Request sent');
      pending.disabled = true;
      actions.append(pending);
    } else {
      const join = button('play', group.publicEntryAllowed ? 'Join community' : 'Request to join');
      join.addEventListener('click', async () => {
        join.disabled = true;
        try {
          await api(`${GROUPS}/${id}/users`, {});
          toast(group.publicEntryAllowed ? 'You joined the community' : 'Request sent');
          refresh();
        } catch (err) {
          join.disabled = false;
          failed("That didn't work. Roblox may want a check you can only do on its site.", err);
        }
      });
      actions.append(join);
    }
    const share = button('more');
    share.setAttribute('aria-label', 'Copy link');
    share.title = 'Copy link';
    share.append(icon('chain-link'));
    share.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(robloxUrl(`/communities/${id}`));
        toast('Link copied');
      } catch {
        toast("Couldn't copy the link.", true);
      }
    });
    actions.append(share);
    info.append(actions);
    hero.append(logo, info);
    const about = () => {
      const box = el('div', 'group-tab');
      if (group.shout?.body) {
        const shout = el('article', 'group-shout');
        const who = el('div', 'group-shout-who');
        const face = el('span', 'member-face small');
        face.append(image(state.faces[group.shout.poster?.userId], '', true));
        const words = el('span', 'member-text');
        words.append(el('strong', '', group.shout.poster?.displayName || 'Community'), el('span', '', timeAgo(group.shout.updated)));
        who.append(face, words);
        shout.append(who, el('p', 'description', group.shout.body));
        box.append(shout);
      }
      box.append(group.description ? el('p', 'description group-description', group.description) : el('p', 'section-note', 'No description yet.'));
      if (membership.canViewMemberList !== false) {
        const shelf = el('section', 'group-games');
        const grid = el('div', 'people-grid');
        shelf.append(el('h2', '', 'Members'), grid);
        box.append(shelf);
        api(`${GROUPS}/${id}/users?limit=${PREVIEW}&sortOrder=Desc`).then(async result => {
          const users = (result.data || []).map(entry => entry.user);
          for (const user of users) state.names[user.userId] = { displayName: user.displayName, name: user.username, verified: user.hasVerifiedBadge };
          await faces(users.map(user => user.userId));
          grid.append(...users.map(user => personTile(user.userId)));
          if (!users.length) shelf.remove();
        }, () => shelf.remove());
      }
      if (games.length) {
        const shelf = el('section', 'group-games');
        const grid = el('div', 'grid');
        grid.append(...games.map(card));
        shelf.append(el('h2', '', 'Experiences'), grid);
        box.append(shelf);
      }
      return box;
    };
    const entries = [['About', about]];
    if (membership.canViewMemberList !== false) entries.push(['Members', () => membersTab(id, roles, membership, refresh)]);
    let requestsTabButton = null;
    if (requestCount) {
      entries.push([requestCount.count ? `Requests (${requestCount.count}${requestCount.more ? '+' : ''})` : 'Requests', () => requestsTab(id, delta => {
        requestCount.count = Math.max(0, requestCount.count + delta);
        if (requestsTabButton) requestsTabButton.textContent = requestCount.count ? `Requests (${requestCount.count}${requestCount.more ? '+' : ''})` : 'Requests';
      })]);
    }
    if (manager) entries.push(['Manage', () => manageTab(id, group, membership, settings, funds, refresh)]);
    const keys = entries.map(([label]) => label.split(' ')[0].toLowerCase());
    const start = Math.max(0, keys.indexOf(tab));
    const tabbed = tabs(entries, start);
    const tabButtons = [...tabbed.querySelectorAll('.tab')];
    requestsTabButton = tabButtons[keys.indexOf('requests')] || null;
    tabButtons.forEach((node, index) => node.addEventListener('click', () => history.replaceState(null, '', `#/group/${id}${index ? `/${keys[index]}` : ''}`)));
    page.append(hero, tabbed);
    root.replaceChildren(page);
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showGroup(root, { id, tab }, alive));
  }
}
