import { api, button, card, compact, el, failed, hiddenGames, icon, image, joinServer, link, longDate, play, robloxUrl, send, setGameHidden, state, thumbnails, toast } from './core.js';
import { previousPageName } from './xbox.js';

const SHELL = (self.__WB||'/')+'launcher/xbox/shell/';
const BADGE_GRID = 4;
const BADGE_SIZE = '150x150';
const ICON_SIZE = '512x512';

function shellImage(name, className = '') {
  const node = el('img', className);
  node.src = `${SHELL}${name}.png`;
  node.alt = '';
  node.decoding = 'async';
  return node;
}

function column(className, title) {
  const node = el('section', `xg-col ${className}`);
  if (title) node.append(el('h2', 'xg-heading', title));
  return node;
}

const divider = () => el('div', 'xg-divider');

function lazily(node, build) {
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    build();
  }, { rootMargin: '400px' });
  observer.observe(node);
}

function voteView(universeId, totals, mine) {
  const view = el('div', 'xg-vote');
  let current = mine?.userVote ?? null;
  let up = totals?.upVotes || 0;
  let down = totals?.downVotes || 0;
  const can = mine?.canVote === true;
  const bar = el('div', 'xg-vote-bar');
  const upButton = button('xg-thumb xg-thumb-up');
  const downButton = button('xg-thumb xg-thumb-down');
  const upImage = shellImage('ThumbsUp');
  const downImage = shellImage('ThumbsDown');
  upButton.append(upImage);
  downButton.append(downImage);
  const rating = el('p', 'xg-vote-rating');
  const upCount = el('p', 'xg-vote-count xg-vote-up');
  const downCount = el('p', 'xg-vote-count xg-vote-down');
  const paint = () => {
    const total = up + down;
    const share = total ? Math.round((up / total) * 100) : 0;
    bar.style.setProperty('--share', `${share}%`);
    bar.classList.toggle('empty', !total);
    upImage.src = `${SHELL}${current === true ? 'ThumbsUpFilled' : 'ThumbsUp'}.png`;
    downImage.src = `${SHELL}${current === false ? 'ThumbsDownFilled' : 'ThumbsDown'}.png`;
    rating.textContent = !total ? 'Be the first to rate this game' : current === true ? 'Liked' : current === false ? 'Disliked' : `${share}%`;
    rating.dataset.vote = current === true ? 'up' : current === false ? 'down' : '';
    upCount.textContent = total ? up.toLocaleString('en') : '';
    downCount.textContent = total ? down.toLocaleString('en') : '';
    upButton.setAttribute('aria-label', current === true ? 'Remove your upvote' : 'Upvote this game');
    downButton.setAttribute('aria-label', current === false ? 'Remove your downvote' : 'Downvote this game');
    upButton.setAttribute('aria-pressed', String(current === true));
    downButton.setAttribute('aria-pressed', String(current === false));
  };
  const vote = async choice => {
    const next = current === choice ? null : choice;
    const before = { current, up, down };
    if (current === true) up--;
    if (current === false) down--;
    if (next === true) up++;
    if (next === false) down++;
    current = next;
    paint();
    try {
      await send(`https://games.roblox.com/v1/games/${universeId}/user-votes`, 'PATCH', { vote: next });
    } catch (err) {
      ({ current, up, down } = before);
      paint();
      failed("Your vote didn't save.", err);
    }
  };
  upButton.addEventListener('click', () => vote(true));
  downButton.addEventListener('click', () => vote(false));
  view.append(upButton, bar, downButton, rating, upCount, downCount);
  if (!can) {
    upButton.disabled = true;
    downButton.disabled = true;
    view.classList.add('locked');
    view.tabIndex = 0;
    view.append(el('p', 'xg-vote-locked', 'You must play this game before rating'));
  }
  paint();
  return view;
}

function shellButton(label, kind = 'grey') {
  const node = button(`xg-button xg-${kind}`);
  node.append(el('span', '', label));
  return node;
}

function favoriteButton(universeId, active) {
  const node = button('xg-button xg-grey xg-favorite');
  const star = shellImage('FavoriteStar');
  const text = el('span');
  node.append(star, text);
  let on = active;
  const paint = () => {
    text.textContent = on ? 'Favorited' : 'Favorite';
    star.hidden = !on;
    node.setAttribute('aria-pressed', String(on));
  };
  node.addEventListener('click', async () => {
    on = !on;
    paint();
    try {
      await api(`https://games.roblox.com/v1/games/${universeId}/favorites`, { isFavorited: on });
    } catch (err) {
      on = !on;
      paint();
      failed("That didn't save.", err);
    }
  });
  paint();
  return node;
}

function followButton(universeId, active) {
  const node = shellButton('Follow');
  let on = active;
  const paint = () => {
    node.firstChild.textContent = on ? 'Following' : 'Follow';
    node.setAttribute('aria-pressed', String(on));
  };
  node.addEventListener('click', async () => {
    on = !on;
    paint();
    try {
      await send(`https://followings.roblox.com/v1/users/${state.me.id}/universes/${universeId}`, on ? 'POST' : 'DELETE');
    } catch (err) {
      on = !on;
      paint();
      failed("That didn't save.", err);
    }
  });
  paint();
  return node;
}

function openDialog(className, build) {
  const dialog = el('dialog', className);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  build(dialog, close);
  document.body.append(dialog);
  dialog.showModal();
}

function imageOverlay(media, start, name) {
  openDialog('xg-images-overlay', dialog => {
    let index = start;
    const picture = image(media[index], name);
    const previous = button('xg-arrow');
    previous.setAttribute('aria-label', 'Previous image');
    previous.append(shellImage('ArrowLeft'));
    const next = button('xg-arrow');
    next.setAttribute('aria-label', 'Next image');
    next.append(shellImage('ArrowRight'));
    const caption = el('p', 'xg-images-caption');
    const show = step => {
      index = (index + step + media.length) % media.length;
      picture.src = media[index];
      caption.textContent = `${index + 1} / ${media.length}`;
    };
    previous.addEventListener('click', () => show(-1));
    next.addEventListener('click', () => show(1));
    dialog.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      show(step);
    });
    const band = el('div', 'xg-images-band');
    const frame = el('div', 'xg-images-frame');
    frame.append(picture);
    band.append(previous, frame, next, caption);
    previous.hidden = next.hidden = media.length < 2;
    dialog.append(band);
    show(0);
  });
}

function imagesColumn(media, art, name) {
  const pictures = media.length ? media : [art].filter(Boolean);
  if (!pictures.length) return null;
  const col = column('xg-col-images', 'Game Images');
  const tile = (index, className) => {
    const node = button(`xg-tile ${className}`);
    node.setAttribute('aria-label', `Open image ${index + 1} of ${pictures.length}`);
    node.append(image(pictures[index], '', true));
    node.addEventListener('click', () => imageOverlay(pictures, index, name));
    return node;
  };
  col.append(tile(0, 'xg-image-main'));
  if (pictures.length > 1) {
    const small = el('div', 'xg-image-small');
    small.append(...pictures.slice(1, 3).map((_, index) => tile(index + 1, '')));
    col.append(small);
  }
  if (pictures.length > 3) {
    const more = moreButton('More images');
    more.addEventListener('click', () => imageOverlay(pictures, 0, name));
    col.append(more);
  }
  return col;
}

function moreButton(label) {
  const node = button('xg-more');
  node.setAttribute('aria-label', label);
  return node;
}

function badgeTile(badge, art, owned) {
  const node = button(`xg-tile xg-badge${owned ? ' owned' : ''}`);
  node.setAttribute('aria-label', badge.displayName || badge.name);
  node.append(image(art, '', true));
  if (owned) node.append(shellImage('Checkmark', 'xg-badge-check'));
  node.append(el('span', 'xg-popup', badge.displayName || badge.name));
  node.addEventListener('click', () => openDialog('dialog', (dialog, close) => {
    const done = button('more', 'Close');
    done.addEventListener('click', close);
    const actions = el('div', 'dialog-actions');
    actions.append(done);
    const facts = [badge.statistics?.awardedCount != null ? `Won by ${compact(badge.statistics.awardedCount)} players` : '', owned ? 'You own this badge' : ''].filter(Boolean).join('. ');
    dialog.append(el('h2', '', badge.displayName || badge.name), el('p', '', badge.displayDescription || badge.description || ''), el('p', 'section-note', facts), actions);
  }));
  return node;
}

function badgesColumn(universeId) {
  const col = column('xg-col-badges', 'Game Badges');
  const grid = el('div', 'xg-badges');
  col.append(grid);
  lazily(col, async () => {
    try {
      const { data = [] } = await api(`https://badges.roblox.com/v1/universes/${universeId}/badges?limit=100&sortOrder=Asc`);
      if (!data.length) {
        col.remove();
        return;
      }
      const ids = data.map(badge => badge.id);
      const [art, awarded] = await Promise.all([
        thumbnails(ids.map(id => ({ key: String(id), request: { targetId: id, type: 'BadgeIcon', size: BADGE_SIZE } }))).catch(() => ({})),
        state.me ? api(`https://badges.roblox.com/v1/users/${state.me.id}/badges/awarded-dates?badgeIds=${ids.join(',')}`).catch(() => ({})) : {},
      ]);
      const owned = new Set((awarded.data || []).map(entry => entry.badgeId));
      const tiles = data.map(badge => badgeTile(badge, art[badge.id], owned.has(badge.id)));
      grid.append(...tiles.slice(0, BADGE_GRID));
      if (tiles.length > BADGE_GRID) {
        const more = moreButton('All badges');
        more.addEventListener('click', () => openDialog('xg-badge-screen', (dialog, close) => {
          const done = button('more', 'Close');
          done.addEventListener('click', close);
          const all = el('div', 'xg-badge-list');
          all.append(...data.map(badge => badgeTile(badge, art[badge.id], owned.has(badge.id))));
          dialog.append(el('h2', 'xg-heading', 'Game Badges'), all, done);
        }));
        col.append(more);
      }
    } catch (err) {
      col.remove();
      console.warn('[launcher] badges failed:', err.message);
    }
  });
  return col;
}

function lazyColumn(className, title, build) {
  const col = column(`xg-col-list ${className}`, title);
  lazily(col, () => col.append(build()));
  return col;
}

function factRow(label, value) {
  const row = el('div', 'xg-fact');
  row.append(el('p', 'xg-fact-label', label));
  if (value instanceof Node) row.append(value);
  else row.append(el('p', 'xg-fact-value', String(value)));
  return row;
}

function creatorValue(creator) {
  const anchor = link('xg-fact-value xg-creator', creator.type === 'Group' ? `#/group/${creator.id}` : `#/user/${creator.id}`);
  anchor.append(shellImage('RobloxIcon32'), el('span', '', creator.name));
  if (creator.hasVerifiedBadge) {
    const badge = icon('verified-mono', true);
    badge.setAttribute('aria-label', 'Verified creator');
    anchor.append(badge);
  }
  return anchor;
}

function detailsColumn(info, guide, voice) {
  const col = column('xg-col-details', 'More Details');
  const age = guide?.ageRecommendationDetails?.summary?.ageRecommendation;
  const descriptors = (guide?.ageRecommendationDetails?.descriptorUsages || []).filter(d => d.contains && d.descriptor?.displayName).map(d => d.descriptor.displayName);
  const facts = [
    ['Last Updated', longDate(info.updated)],
    ['Creation Date', longDate(info.created)],
    ['Max Players', info.maxPlayers],
    ['Created By', info.creator?.name ? creatorValue(info.creator) : null],
    ['Playing', compact(info.playing)],
    ['Visits', compact(info.visits)],
    ['Favorites', compact(info.favoritedCount)],
    ['Genre', [info.genre_l1, info.genre_l2].filter(Boolean).join(', ') || info.genre],
    ['Maturity', age?.displayName],
    ['Voice Chat', voice ? (voice.isUniverseEnabledForVoice ? 'Supported' : 'Not supported') : null],
    ['Camera', voice ? (voice.isUniverseEnabledForAvatarVideo ? 'Supported' : 'Not supported') : null],
    ['Contains', descriptors.join(', ')],
  ];
  const grid = el('div', 'xg-facts');
  for (const [label, value] of facts) {
    if (value) grid.append(factRow(label, value));
  }
  const report = link('xg-tile xg-report', robloxUrl(`/abusereport/asset?id=${info.rootPlaceId}`));
  report.target = '_blank';
  report.rel = 'noopener';
  report.setAttribute('aria-label', 'Report Game');
  report.append(shellImage('ReportIcon'));
  const footer = el('div', 'xg-report-row');
  footer.append(report, el('span', 'xg-report-text', 'Report Game'));
  col.append(grid, footer, el('div', 'xg-report-line'));
  return col;
}

export function renderXboxGame(root, game, loaded, related, parts) {
  const { info } = loaded;
  const page = el('div', 'xg');
  const back = button('xg-back');
  back.append(shellImage('BackIcon'), el('span', '', previousPageName()));
  const goBack = () => {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  };
  back.addEventListener('click', goBack);
  const name = info.name || game?.name || '';
  const strip = el('div', 'xg-strip');

  const iconColumn = column('xg-col-icon');
  const iconFrame = el('div', 'xg-icon');
  iconFrame.append(image(state.icons[info.id] || state.art[info.id], name));
  iconColumn.append(iconFrame);
  thumbnails([{ key: 'icon', request: { targetId: info.id, type: 'GameIcon', size: ICON_SIZE } }]).then(found => {
    if (found.icon) iconFrame.firstElementChild.src = found.icon;
  }).catch(() => {});

  const rating = column('xg-col-rating', 'Rating and Description');
  rating.append(voteView(info.id, loaded.votes, loaded.userVote), el('div', 'xg-rating-line'));
  const description = el('p', 'xg-description', info.description || '');
  description.tabIndex = 0;
  rating.append(description);

  const items = [iconColumn, rating, divider()];
  const images = imagesColumn(loaded.media, state.art[info.id], name);
  if (images) items.push(images);
  items.push(badgesColumn(info.id));
  if (related?.length) {
    const col = column('xg-col-related', 'Related Games');
    const grid = el('div', 'xg-related');
    grid.append(...related.map(card));
    col.append(grid);
    items.push(col);
  }
  items.push(
    lazyColumn('xg-col-store', 'Store', () => parts.storeTab(info.id)),
    lazyColumn('xg-col-servers', 'Servers', () => parts.serversTab(info.rootPlaceId)),
  );
  if (loaded.events?.length) items.push(lazyColumn('xg-col-events', 'Events', () => parts.eventsTab(loaded.events)));
  items.push(divider(), detailsColumn(info, loaded.guide, loaded.voice));
  strip.append(...items);
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.target.closest('.xg-description, .xg-col-list')) return;
    if (strip.scrollWidth <= strip.clientWidth) return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
  }, { passive: false });

  const buttons = el('div', 'xg-buttons');
  const placeId = info.rootPlaceId || game?.rootPlaceId;
  const start = shellButton('Play', 'green');
  start.disabled = !placeId || loaded.status?.isPlayable === false;
  start.addEventListener('click', () => play(placeId));
  const random = shellButton('Random Server');
  random.disabled = start.disabled;
  random.addEventListener('click', () => parts.joinRandom(placeId));
  buttons.append(start, random);
  const friend = loaded.friend;
  if (friend?.serverId) {
    const join = shellButton(`Join ${state.names[friend.id]?.displayName || 'friend'}`, 'green');
    join.addEventListener('click', () => joinServer(friend.placeId || friend.rootPlaceId, friend.serverId));
    buttons.append(join);
  }
  buttons.append(favoriteButton(info.id, Boolean(info.isFavoritedByUser)));
  if (loaded.follow && (loaded.follow.CanFollow || loaded.follow.IsFollowing)) buttons.append(followButton(info.id, Boolean(loaded.follow.IsFollowing)));
  const invite = shellButton('Invite');
  invite.addEventListener('click', () => parts.inviteDialog(info));
  const share = shellButton('Copy Link');
  share.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(robloxUrl(`/games/${info.rootPlaceId}`));
      toast('Link copied');
    } catch {
      toast("Couldn't copy the link.", true);
    }
  });
  const hide = shellButton('Not Interested');
  const isHidden = () => hiddenGames().has(String(info.id));
  const paintHide = () => {
    hide.firstChild.textContent = isHidden() ? 'Show on Home' : 'Not Interested';
  };
  hide.addEventListener('click', () => {
    setGameHidden(info.id, !isHidden());
    paintHide();
    toast(isHidden() ? 'Hidden from your Home page' : 'Back on your Home page');
  });
  paintHide();
  buttons.append(invite, share, hide);
  if (loaded.status?.isPlayable === false) buttons.append(el('p', 'xg-reason', loaded.status.unplayableDisplayText || "This game isn't available to your account right now."));

  page.append(back, el('h1', 'xg-title', name), strip, buttons);
  root.replaceChildren(page);
  const onKey = event => {
    if (!page.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (event.key !== 'Escape' || document.querySelector('dialog[open]') || event.target.matches?.('input, textarea, select')) return;
    goBack();
  };
  window.addEventListener('keydown', onKey);
}
