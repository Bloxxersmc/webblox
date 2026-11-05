import { ROBLOX_LAUNCHER, leaveFor, forgetWispSession, wispMode, api, button, compact, confirmDialog, el, failed, faces, icon, image, link, loadFailure, longDate, pageHead, robloxUrl, section, send, skeleton, state, tabs, toast, userNames } from './core.js';
import { CHANNELS, EDITABLE } from './socials.js';
import { rovalraOn } from './values.js';

const WEB_PAGES = {
  robux: ['Buy Robux', '/upgrades/robux'],
  subscription: ['Roblox Plus and Premium', '/premium/membership'],
  settings: ['All Roblox settings', '/my/account'],
  security: ['Account security', '/my/account#!/security'],
  privacy: ['Privacy', '/my/account#!/privacy'],
  parental: ['Parental controls', '/my/account#!/parental-controls'],
  billing: ['Billing', '/my/account#!/billing'],
};

const BLOCKING = 'https://apis.roblox.com/user-blocking-api/v1/users';
const TOTAL_TYPES = ['Purchase', 'Sale', 'TradeRobux', 'GroupPayout', 'EngagementPayout'];
const PAGE_GAP_MS = 1000;
const RETRY_WAITS_MS = [5000, 10000, 20000, 30000, 60000, 60000, 60000];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function patiently(url, onWait, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api(url, body);
    } catch (err) {
      if (err.status !== 429 || attempt >= RETRY_WAITS_MS.length) throw err;
      onWait(RETRY_WAITS_MS[attempt]);
      await wait(RETRY_WAITS_MS[attempt]);
    }
  }
}

function allTimeTotals() {
  const box = el('div', 'tab-body');
  const facts = el('dl', 'facts');
  facts.hidden = true;
  const status = el('p', 'section-note', 'Adds up every Robux transaction on your account. Big accounts take a while.');
  const start = button('more', 'Count');
  box.append(facts, status, start);
  start.addEventListener('click', async () => {
    start.disabled = true;
    let spent = 0;
    let earned = 0;
    let seen = 0;
    try {
      for (const type of TOTAL_TYPES) {
        let cursor = '';
        do {
          const page = await patiently(`https://apis.roblox.com/transaction-records/v1/users/${state.me.id}/transactions?limit=100&transactionType=${type}&itemPricingType=PaidAndLimited${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, ms => {
            status.textContent = `Counted ${seen.toLocaleString('en')} transactions. Roblox asked to slow down, waiting ${ms / 1000} seconds…`;
          });
          for (const tx of page.data || []) {
            const amount = tx.currency?.amount || 0;
            if (amount < 0) spent -= amount;
            else earned += amount;
          }
          seen += page.data?.length || 0;
          status.textContent = `Counted ${seen.toLocaleString('en')} transactions…`;
          cursor = page.nextPageCursor || '';
          if (cursor) await wait(PAGE_GAP_MS);
        } while (cursor);
      }
      facts.replaceChildren();
      for (const [label, value] of [['Spent all time', spent], ['Earned all time', earned]]) {
        const row = el('div');
        row.append(el('dt', '', label), el('dd', '', value.toLocaleString('en')));
        facts.append(row);
      }
      facts.hidden = false;
      status.textContent = `From ${seen.toLocaleString('en')} transactions.`;
      start.textContent = 'Count again';
    } catch (err) {
      status.textContent = "Roblox stopped answering partway through. Try again in a minute.";
      console.warn('[launcher] all-time totals failed:', err.message);
    }
    start.disabled = false;
  });
  return box;
}

async function allBlocked() {
  const ids = [];
  let cursor = '';
  do {
    const page = await api(`${BLOCKING}/get-blocked-users?count=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    ids.push(...(page.data?.blockedUserIds || []));
    cursor = page.data?.cursor || '';
  } while (cursor);
  return ids;
}

function unblockEveryone(list) {
  const all = button('more', 'Unblock everyone');
  all.addEventListener('click', async () => {
    all.disabled = true;
    try {
      const ids = await allBlocked();
      const yes = ids.length && await confirmDialog(`Unblock ${ids.length} ${ids.length === 1 ? 'person' : 'people'}?`, 'They will be able to message you, join you and send you friend requests again.', 'Unblock all', true);
      if (yes) {
        let done = 0;
        for (const id of ids) {
          await patiently(`${BLOCKING}/${id}/unblock-user`, () => {
            all.textContent = 'Waiting for Roblox…';
          }, {});
          list.querySelector(`[data-user="${id}"]`)?.remove();
          done++;
          all.textContent = `Unblocked ${done} of ${ids.length}`;
          await wait(PAGE_GAP_MS);
        }
        toast(`Unblocked ${done} ${done === 1 ? 'person' : 'people'}`);
        all.remove();
      }
    } catch (err) {
      all.textContent = 'Unblock everyone';
      failed("Unblocking stopped partway through.", err);
    }
    all.disabled = false;
  });
  return all;
}

const LINK_PRIVACY = [
  ['AllUsers', 'Everyone'],
  ['FriendsFollowingAndFollowers', 'Friends, following and followers'],
  ['FriendsAndFollowing', 'Friends and following'],
  ['Friends', 'Friends'],
  ['NoOne', 'No one'],
];

function linksForm(channels) {
  const form = el('form', 'edit-form');
  const fields = el('div', 'social-fields');
  const inputs = {};
  for (const [key, label] of EDITABLE) {
    const wrap = el('label');
    const input = el('input');
    input.value = channels[key] || '';
    input.placeholder = 'Username';
    input.spellcheck = false;
    input.autocomplete = 'off';
    wrap.append(el('span', '', label), input);
    inputs[key] = input;
    fields.append(wrap);
  }
  const privacy = el('label');
  const select = el('select');
  for (const [value, label] of LINK_PRIVACY) {
    const option = el('option', '', label);
    option.value = value;
    select.append(option);
  }
  select.value = channels.promotionChannelsVisibilityPrivacy || 'AllUsers';
  privacy.append(el('span', '', 'Who can see them'), select);
  const save = el('button', 'more', 'Save links');
  save.type = 'submit';
  form.append(fields, privacy, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = { promotionChannelsVisibilityPrivacy: select.value };
    for (const [key] of EDITABLE) body[key] = inputs[key].value.trim() || null;
    save.disabled = true;
    try {
      await api(CHANNELS, body);
      toast('Links saved');
    } catch (err) {
      failed("Your links didn't save.", err);
    }
    save.disabled = false;
  });
  return form;
}

function transactionsTab(type) {
  const box = el('div', 'tab-body');
  const list = el('div', 'list-rows');
  const status = el('p', 'section-note', 'Loading transactions…');
  const more = button('more', 'Show more');
  more.hidden = true;
  box.append(list, status, more);
  let cursor = '';
  const load = async () => {
    more.disabled = true;
    try {
      const page = await api(`https://economy.roblox.com/v2/users/${state.me.id}/transactions?transactionType=${type}&limit=25&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const tx of page.data || []) {
        const row = el('div', 'list-row plain');
        const text = el('span', 'list-text');
        text.append(el('strong', '', tx.details?.name || tx.transactionType), el('span', '', `${tx.agent?.name || 'Roblox'}, ${longDate(tx.created)}${tx.isPending ? ', pending' : ''}`));
        const amount = tx.currency?.amount || 0;
        row.append(text, el('span', `amount${amount > 0 ? ' plus' : ''}`, `${amount > 0 ? '+' : ''}${amount.toLocaleString('en')}`));
        list.append(row);
      }
      status.hidden = Boolean(list.children.length);
      status.textContent = 'Nothing here yet.';
      cursor = page.nextPageCursor || '';
      more.hidden = !cursor;
      more.disabled = false;
    } catch (err) {
      status.textContent = "Transactions didn't load. Try again in a moment.";
      status.hidden = false;
      more.disabled = false;
      console.warn('[launcher] transactions failed:', err.message);
    }
  };
  more.addEventListener('click', load);
  load();
  return box;
}

export async function showRobux(root, params, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [balance, totals, launch] = await Promise.all([
      api(`https://economy.roblox.com/v1/users/${state.me.id}/currency`),
      api(`https://economy.roblox.com/v2/users/${state.me.id}/transaction-totals?timeFrame=Month&transactionType=summary`).catch(() => ({})),
      api('https://users.roblox.com/v1/users/authenticated/app-launch-info').catch(() => ({})),
    ]);
    if (!alive()) return;
    state.robux = balance.robux;
    const summary = el('div', 'money-summary');
    const main = el('div', 'money-balance');
    const amount = el('strong');
    amount.setAttribute('aria-label', `${balance.robux.toLocaleString('en')} Robux`);
    amount.append(icon('robux'), balance.robux.toLocaleString('en'));
    main.append(el('span', 'section-note', 'Your balance'), amount);
    const actions = el('div', 'actions');
    actions.append(link('play', '#/web/robux', 'Buy Robux'), link('more', '#/web/subscription', launch.isPremium || launch.hasRobloxSubscription ? 'Manage subscription' : 'Roblox Plus and Premium'));
    main.append(actions);
    const facts = el('dl', 'facts');
    for (const [label, value] of [['Spent this month', totals.purchasesTotal], ['Earned this month', totals.salesTotal], ['Pending', totals.pendingRobuxTotal]]) {
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', compact(Math.abs(value || 0))));
      facts.append(row);
    }
    summary.append(main, facts);
    root.replaceChildren(pageHead('Robux'), summary, ...(rovalraOn('robuxTotals') ? [section('All time', '', allTimeTotals())] : []), tabs([
      ['Purchases', () => transactionsTab('Purchase')],
      ['Sales', () => transactionsTab('Sale')],
      ['Bought Robux', () => transactionsTab('CurrencyPurchase')],
    ]));
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showRobux(root, params, alive));
  }
}

export function showWeb(root, { key }) {
  const page = WEB_PAGES[key];
  if (!page) {
    root.replaceChildren(el('p', 'section-note', 'That page does not exist.'));
    return;
  }
  const head = el('header', 'web-head');
  head.append(el('h1', '', page[0]));
  const outside = link('text-action', robloxUrl(page[1]));
  outside.target = '_blank';
  outside.rel = 'noopener';
  outside.append(icon('arrow-up-right-from-square'), 'Open on Roblox');
  head.append(outside);
  const frame = el('iframe', 'web-frame');
  frame.title = page[0];
  frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox';
  frame.src = window.webbloxEmbed?.frameUrl(robloxUrl(page[1])) || `/${wispMode ? '__frame__' : '__proxy__'}/${robloxUrl(page[1])}`;
  root.replaceChildren(head, frame);
}

export async function signOut() {
  const yes = await confirmDialog('Sign out of Roblox?', 'This ends the session WebBlox is using. You can sign back in on WebBlox.', 'Sign out', true);
  if (!yes) return;
  try {
    await api('https://auth.roblox.com/v2/logout', {});
  } catch (err) {
    if (!wispMode || err.status !== 401) {
      failed("Sign out didn't work.", err);
      return;
    }
  }
  try {
    Object.keys(localStorage).filter(k => k.startsWith('webblox.launcher.')).forEach(k => localStorage.removeItem(k));
  } catch {}
  if (wispMode) forgetWispSession();
  else leaveFor(ROBLOX_LAUNCHER);
}

export async function showAccount(root, params, alive) {
  skeleton(root);
  try {
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const [user, email, description, blocked, channels] = await Promise.all([
      api(`https://users.roblox.com/v1/users/${state.me.id}`),
      api('https://accountsettings.roblox.com/v1/email').catch(() => ({})),
      api('https://users.roblox.com/v1/description').catch(() => ({})),
      api(`${BLOCKING}/get-blocked-users?count=50`).catch(() => ({})),
      api(CHANNELS).catch(() => ({})),
    ]);
    const blockedIds = blocked.data?.blockedUserIds || [];
    await Promise.all([faces(blockedIds), userNames(blockedIds)]);
    if (!alive()) return;

    const details = el('dl', 'facts');
    for (const [label, value] of [['Username', `@${user.name}`], ['User ID', user.id], ['Joined', longDate(user.created)], ['Email', email.emailAddress ? `${email.emailAddress}${email.verified ? ', verified' : ', not verified'}` : 'None']]) {
      const row = el('div');
      row.append(el('dt', '', label), el('dd', 'small', String(value)));
      details.append(row);
    }

    const names = el('form', 'edit-form');
    const nameLabel = el('label');
    nameLabel.append(el('span', '', 'Display name'));
    const nameInput = el('input');
    nameInput.value = user.displayName;
    nameInput.maxLength = 20;
    nameLabel.append(nameInput);
    const saveName = el('button', 'more', 'Save name');
    saveName.type = 'submit';
    names.append(nameLabel, saveName);
    names.addEventListener('submit', async event => {
      event.preventDefault();
      saveName.disabled = true;
      try {
        await send(`https://users.roblox.com/v1/users/${state.me.id}/display-names`, 'PATCH', { newDisplayName: nameInput.value.trim() });
        state.me.name = nameInput.value.trim();
        toast('Display name saved');
      } catch (err) {
        failed("That name didn't save.", err);
      }
      saveName.disabled = false;
    });

    const about = el('form', 'edit-form');
    const aboutLabel = el('label');
    aboutLabel.append(el('span', '', 'About'));
    const aboutInput = el('textarea');
    aboutInput.value = description.description || '';
    aboutInput.maxLength = 1000;
    aboutInput.rows = 4;
    aboutLabel.append(aboutInput);
    const saveAbout = el('button', 'more', 'Save about');
    saveAbout.type = 'submit';
    about.append(aboutLabel, saveAbout);
    about.addEventListener('submit', async event => {
      event.preventDefault();
      saveAbout.disabled = true;
      try {
        await api('https://users.roblox.com/v1/description', { description: aboutInput.value });
        toast('About saved');
      } catch (err) {
        failed("That didn't save.", err);
      }
      saveAbout.disabled = false;
    });

    const blockedList = el('div', 'list-rows');
    for (const id of blockedIds) {
      const row = el('div', 'list-row');
      row.dataset.user = id;
      const open = link('list-main', `#/user/${id}`);
      const text = el('span', 'list-text');
      text.append(el('strong', '', state.names[id]?.displayName || 'Roblox user'));
      open.append(image(state.faces[id], '', true), text);
      const unblock = button('more', 'Unblock');
      unblock.addEventListener('click', async () => {
        try {
          await api(`${BLOCKING}/${id}/unblock-user`, {});
          row.remove();
          toast('Unblocked');
        } catch (err) {
          failed("That didn't work.", err);
        }
      });
      row.append(open, unblock);
      blockedList.append(row);
    }
    const out = button('danger', 'Sign out');
    out.addEventListener('click', signOut);
    const session = el('div', 'tab-body');
    session.append(el('p', 'section-note', 'To sign in as someone else, sign out, then use the sign-in screen on WebBlox.'), out);

    root.replaceChildren(
      pageHead('Account'),
      section('Your details', '', details),
      section('Profile', '', (() => {
        const stack = el('div', 'tab-body');
        stack.append(names, about);
        return stack;
      })()),
      section('Social links', '', linksForm(channels)),
      section('Blocked people', blockedIds.length ? '' : 'You haven’t blocked anyone.', blockedList, blockedIds.length > 1 && rovalraOn('bulkUnblock') ? unblockEveryone(blockedList) : null),
      section('Session', '', session),
    );
  } catch (err) {
    if (alive()) loadFailure(root, err, () => showAccount(root, params, alive));
  }
}
