import { api, button, card, compact, confirmDialog, el, faces, failed, gameArt, icon, image, joinServer, link, loadFailure, longDate, personTile, robloxUrl, rowSection, section, skeleton, state, thumbnails, toast, userNames } from './core.js';
import { socialLinks } from './socials.js';
import { itemDetails } from './market.js';
import { previewStage } from './stage.js';
import { openChatWith } from './social.js';
import { itemValues, loadValues, rolimonsPlayer, rovalraOn } from './values.js';

const COLLECTIBLE_PAGES = 10;

async function limitedTotals(userId) {
  await loadValues();
  let cursor = '';
  let pages = 0;
  const totals = { value: 0, rap: 0, count: 0 };
  do {
    const page = await api(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).catch(() => null);
    if (!page) return pages ? totals : null;
    for (const item of page.data || []) {
      const rap = item.recentAveragePrice || 0;
      totals.rap += rap;
      totals.value += itemValues('Asset', item.assetId)?.worth ?? rap;
      totals.count++;
    }
    cursor = page.nextPageCursor || '';
  } while (cursor && ++pages < COLLECTIBLE_PAGES);
  return totals.count ? totals : null;
}

const person = id => state.names[id] || {};

async function presenceFor(ids) {
  if (!ids.length) return {};
  const { userPresences = [] } = await api('https://presence.roblox.com/v1/presence/users', { userIds: ids.map(Number) }).catch(() => ({}));
  return Object.fromEntries(userPresences.map(p => [p.userId, p]));
}

function friendButton(id, initial) {
  const node = button('play');
  let status = initial;
  const paint = () => {
    const labels = { Friends: 'Friends', RequestSent: 'Request sent', RequestReceived: 'Accept request', NotFriends: 'Add friend' };
    node.textContent = labels[status] || 'Add friend';
    node.className = status === 'Friends' || status === 'RequestSent' ? 'more' : 'play';
    node.disabled = status === 'RequestSent';
  };
  node.addEventListener('click', async () => {
    try {
      if (status === 'Friends') {
        if (!await confirmDialog('Remove friend?', `${person(id).displayName || 'This person'} will no longer be your friend.`, 'Remove friend', true)) return;
        await api(`https://friends.roblox.com/v1/users/${id}/unfriend`, {});
        status = 'NotFriends';
      } else if (status === 'RequestReceived') {
        await api(`https://friends.roblox.com/v1/users/${id}/accept-friend-request`, {});
        status = 'Friends';
      } else {
        await api(`https://friends.roblox.com/v1/users/${id}/request-friendship`, { friendshipOriginSourceType: 'UserProfile' });
        status = 'RequestSent';
      }
      paint();
    } catch (err) {
      failed("That didn't work.", err);
    }
  });
  paint();
  return node;
}

function gameFromV2(game) {
  return { universeId: game.id, rootPlaceId: game.rootPlace?.id, name: game.name };
}

function presenceLine(presence) {
  if (!presence) return null;
  const type = presence.userPresenceType;
  if (type === 2) return { text: presence.lastLocation ? `Playing ${presence.lastLocation}` : 'In a game', tone: 'playing' };
  if (type === 3) return { text: 'In Roblox Studio', tone: 'online' };
  if (type === 1) return { text: 'Online', tone: 'online' };
  return null;
}

function miniTile(href, art, label) {
  const tile = href ? link('mini labelled', href) : el('div', 'mini labelled');
  tile.append(image(art, '', true), el('span', '', label));
  return tile;
}

export async function showUser(root, { id }, alive) {
  skeleton(root);
  try {
    const isMe = String(state.me?.id) === String(id);
    const [user, friendsCount, followers, followings, body, status, follow, roles, favorites, created, badges, robloxBadges, wearing, blocked, history, presence, friendRows, collections] = await Promise.all([
      api(`https://users.roblox.com/v1/users/${id}`),
      api(`https://friends.roblox.com/v1/users/${id}/friends/count`).catch(() => ({})),
      api(`https://friends.roblox.com/v1/users/${id}/followers/count`).catch(() => ({})),
      api(`https://friends.roblox.com/v1/users/${id}/followings/count`).catch(() => ({})),
      thumbnails([{ key: 'body', request: { targetId: Number(id), type: 'Avatar', size: '720x720' } }]).catch(() => ({})),
      !isMe && state.me ? api(`https://friends.roblox.com/v1/users/${state.me.id}/friends/statuses?userIds=${id}`).catch(() => ({})) : {},
      !isMe ? api('https://friends.roblox.com/v1/user/following-exists', { targetUserIds: [Number(id)] }).catch(() => ({})) : {},
      api(`https://groups.roblox.com/v2/users/${id}/groups/roles`).catch(() => ({})),
      api(`https://games.roblox.com/v2/users/${id}/favorite/games?limit=10`).catch(() => ({})),
      api(`https://games.roblox.com/v2/users/${id}/games?limit=10`).catch(() => ({})),
      api(`https://badges.roblox.com/v1/users/${id}/badges?limit=25&sortOrder=Desc`).catch(() => ({})),
      api(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`).catch(() => []),
      api(`https://avatar.roblox.com/v1/users/${id}/currently-wearing`).catch(() => ({})),
      !isMe ? api('https://apis.roblox.com/user-blocking-api/v1/users/get-blocked-users?count=50').catch(() => null) : null,
      api(`https://users.roblox.com/v1/users/${id}/username-history?limit=10&sortOrder=Desc`).catch(() => ({})),
      presenceFor([id]).catch(() => ({})),
      api(`https://friends.roblox.com/v1/users/${id}/friends/find?limit=12&userSort=1`).catch(() => ({})),
      api(`https://apis.roblox.com/showcases-api/v1/users/profile/robloxcollections-json?userId=${id}`).catch(() => []),
    ]);
    const favoriteGames = (favorites.data || []).map(gameFromV2);
    const createdGames = (created.data || []).map(gameFromV2);
    await gameArt(favoriteGames.concat(createdGames));
    const assetIds = wearing.assetIds || [];
    const groups = (roles.data || []).slice(0, 12);
    const friendIds = (friendRows.PageItems || []).map(row => row.id);
    const [assetThumbs, groupIcons, badgeIcons, wornDetails] = await Promise.all([
      thumbnails(assetIds.map(asset => ({ key: String(asset), request: { targetId: asset, type: 'Asset', size: '150x150' } }))).catch(() => ({})),
      thumbnails(groups.map(entry => ({ key: String(entry.group.id), request: { targetId: entry.group.id, type: 'GroupIcon', size: '150x150' } }))).catch(() => ({})),
      thumbnails((badges.data || []).map(entry => ({ key: String(entry.id), request: { targetId: entry.id, type: 'BadgeIcon', size: '150x150' } }))).catch(() => ({})),
      itemDetails(assetIds.map(asset => ({ itemType: 'Asset', id: asset }))).catch(() => []),
      faces(friendIds),
      userNames(friendIds),
    ]);
    if (!alive()) return;
    state.names[id] = { displayName: user.displayName, name: user.name, verified: user.hasVerifiedBadge };

    const avatarUrl = `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${id}`;
    const portrait = previewStage({
      src: body.body,
      alt: `${user.displayName}'s avatar`,
      source3d: (previous, viewer) => viewer.thumbnail3d(avatarUrl, previous),
      source2d: async () => body.body,
      quiet: true,
    });
    const stage = el('div', 'avatar-stage');
    stage.append(portrait.node);
    const wornNames = new Map(wornDetails.map(item => [item.id, item.name]));
    const shownWorn = assetIds.filter(asset => wornNames.has(asset));
    if (shownWorn.length) {
      const tray = el('section', 'wearing');
      tray.setAttribute('aria-label', 'Currently wearing');
      const row = el('div', 'wearing-row');
      row.append(...shownWorn.map(asset => {
        const tile = link('worn-tile', `#/item/Asset/${asset}`);
        tile.title = wornNames.get(asset);
        tile.setAttribute('aria-label', `View ${wornNames.get(asset)}`);
        tile.append(image(assetThumbs[asset], '', true));
        return tile;
      }));
      tray.append(el('h2', '', 'Wearing'), row);
      stage.append(tray);
    }

    const main = el('div', 'profile-main');
    const head = el('header', 'profile-title');
    const name = el('h1', '', user.displayName);
    if (user.hasVerifiedBadge) {
      const badge = icon('verified-mono', true);
      badge.setAttribute('aria-label', 'Verified');
      name.append(badge);
    }
    head.append(name, el('p', 'section-note', `@${user.name}`));
    const live = presenceLine(presence[id]);
    if (live) {
      const line = el('p', `profile-presence ${live.tone}`, live.text);
      head.append(line);
    }
    main.append(head);

    const actions = el('div', 'profile-actions');
    if (isMe) {
      actions.append(link('play', '#/avatar', 'Edit avatar'), link('more', '#/account', 'Edit account'));
    } else if (user.isBanned) {
      main.append(el('p', 'reason', 'This account is banned.'));
    } else {
      actions.append(friendButton(id, status.data?.[0]?.status || 'NotFriends'));
      const chat = button('more', 'Message');
      chat.addEventListener('click', async () => {
        try {
          await openChatWith(id);
        } catch (err) {
          failed("Chat didn't open.", err);
        }
      });
      actions.append(chat, link('more', `#/trades/new/${id}`, 'Trade'));
      const here = presence[id];
      if (here?.userPresenceType === 2 && here.gameId && here.rootPlaceId) {
        const join = button('more', 'Join');
        join.setAttribute('aria-label', `Join ${user.displayName}`);
        join.addEventListener('click', () => joinServer(here.placeId || here.rootPlaceId, here.gameId));
        actions.append(join);
      }
      let following = Boolean(follow.followings?.[0]?.isFollowing);
      const followButton = button('more', following ? 'Unfollow' : 'Follow');
      followButton.addEventListener('click', async () => {
        try {
          await api(`https://friends.roblox.com/v1/users/${id}/${following ? 'unfollow' : 'follow'}`, {});
          following = !following;
          followButton.textContent = following ? 'Unfollow' : 'Follow';
        } catch (err) {
          failed("That didn't work.", err);
        }
      });
      actions.append(followButton);
    }
    if (actions.children.length) main.append(actions);

    const counts = el('dl', 'profile-counts');
    const listOf = tab => (isMe ? `#/friends/${tab}` : `#/user/${id}/${tab}`);
    for (const [label, value, href] of [['Friends', friendsCount.count, listOf('friends')], ['Followers', followers.count, listOf('followers')], ['Following', followings.count, listOf('following')]]) {
      const item = el('div');
      item.append(el('dd', '', compact(value)), el('dt', '', label));
      if (href) {
        const anchor = link('', href);
        anchor.append(item);
        counts.append(anchor);
      } else {
        counts.append(item);
      }
    }
    main.append(counts);
    const socials = el('div');
    main.append(socials);
    socialLinks(id).then(row => {
      if (row && alive()) socials.replaceWith(row);
    });
    if (rovalraOn('profiles')) limitedTotals(id).then(totals => {
      if (!totals || !alive()) return;
      for (const [label, value] of [['Value', totals.value], ['RAP', totals.rap]]) {
        const item = el('div');
        item.append(el('dd', '', compact(value)), el('dt', '', label));
        item.title = `${value.toLocaleString('en')} across ${totals.count} limiteds`;
        if (rovalraOn('links')) {
          const anchor = link('', rolimonsPlayer(id));
          anchor.target = '_blank';
          anchor.rel = 'noopener';
          anchor.append(item);
          counts.append(anchor);
        } else counts.append(item);
      }
    });

    const about = el('dl', 'item-details');
    const pastNames = (history.data || []).map(entry => entry.name);
    if (user.description) {
      const row = el('div', 'item-description');
      row.append(el('dt', '', 'About'), el('dd', 'description', user.description));
      about.append(row);
    }
    for (const [label, value] of [['Joined', longDate(user.created)], ['Previous names', pastNames.join(', ')]]) {
      if (!value) continue;
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', value));
      about.append(row);
    }
    main.append(about);

    const links = el('div', 'item-social');
    const share = button('text-action');
    share.append(icon('chain-link'), 'Copy link');
    share.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(robloxUrl(`/users/${id}/profile`));
        toast('Link copied');
      } catch {
        toast("Couldn't copy the link.", true);
      }
    });
    links.append(share);
    if (!isMe) {
      const report = link('text-action', robloxUrl(`/abusereport/userprofile?id=${id}`));
      report.target = '_blank';
      report.rel = 'noopener';
      report.append(icon('flag'), 'Report');
      links.append(report);
      if (!user.isBanned) {
        let isBlocked = (blocked?.data?.blockedUserIds || []).includes(Number(id));
        const blockButton = button('text-action', isBlocked ? 'Unblock' : 'Block');
        blockButton.addEventListener('click', async () => {
          if (!isBlocked && !await confirmDialog(`Block ${user.displayName}?`, "They won't be able to message you or find you in chat.", 'Block', true)) return;
          try {
            await api(`https://apis.roblox.com/user-blocking-api/v1/users/${id}/${isBlocked ? 'unblock-user' : 'block-user'}`, {});
            isBlocked = !isBlocked;
            blockButton.textContent = isBlocked ? 'Unblock' : 'Block';
          } catch (err) {
            failed("That didn't work.", err);
          }
        });
        links.append(blockButton);
      }
    }
    main.append(links);

    if (friendIds.length) main.append(rowSection('Friends', '', friendIds.map(friend => personTile(friend)), null, 'row people-row'));
    if (Array.isArray(collections) && collections.length) {
      main.append(rowSection('Collections', '', collections.map(entry => miniTile(`#/item/Asset/${entry.id}`, entry.thumbnail?.url, entry.name)), null, 'row mini-row'));
    }
    if (favoriteGames.length) main.append(rowSection('Favorites', '', favoriteGames.map(card)));
    if (createdGames.length) main.append(rowSection('Creations', '', createdGames.map(card)));
    if (groups.length) main.append(rowSection('Communities', '', groups.map(entry => miniTile(`#/group/${entry.group.id}`, groupIcons[entry.group.id], entry.group.name)), null, 'row mini-row'));
    if (badges.data?.length) main.append(rowSection('Badges', '', badges.data.map(entry => miniTile(null, badgeIcons[entry.id], entry.displayName || entry.name)), null, 'row mini-row'));
    if (Array.isArray(robloxBadges) && robloxBadges.length) {
      const row = el('div', 'badge-row');
      for (const badge of robloxBadges) {
        const item = el('div', 'badge-item');
        item.append(image(badge.imageUrl, '', true), el('span', '', badge.name));
        row.append(item);
      }
      main.append(section('Roblox badges', '', row));
    }

    const layout = el('div', 'avatar-layout');
    layout.append(stage, main);
    root.replaceChildren(layout);
    portrait.start();
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showUser(root, { id }, alive));
  }
}
