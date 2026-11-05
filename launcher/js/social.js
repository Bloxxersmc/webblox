import { api, button, el, failed, faces, icon, image, link, loadFailure, pageHead, state, tabs, thumbnails, timeAgo, toast, userNames } from './core.js';

const CHAT = 'https://apis.roblox.com/platform-chat-api/v1';
const POLL_MS = 4000;
const ONE_TO_ONE = 'one_to_one';
const threads = new Map();

async function findConversation(userId) {
  const { conversations = [] } = await api(`${CHAT}/create-conversations`, { conversations: [{ type: ONE_TO_ONE, participant_user_ids: [Number(userId)] }] });
  const id = conversations[0]?.id;
  if (!id) throw new Error('Roblox did not open a chat with this person.');
  return id;
}

export async function sendToUser(userId, content) {
  const conversationId = await findConversation(userId);
  await api(`${CHAT}/send-messages`, { conversation_id: conversationId, messages: [{ content }] });
}

export async function openChatWith(userId) {
  location.hash = `#/chat/${encodeURIComponent(await findConversation(userId))}`;
}

const otherUser = conversation => (conversation.participant_user_ids || []).find(id => String(id) !== String(state.me?.id));

const conversationKey = conversation => conversation.id || `friend:${otherUser(conversation)}`;

const conversationTitle = conversation => {
  if (conversation.type !== ONE_TO_ONE) return conversation.name || 'Group chat';
  const other = otherUser(conversation);
  return conversation.user_data?.[other]?.combined_name || conversation.user_data?.[other]?.display_name || conversation.name || state.names[other]?.displayName || 'Chat';
};

function conversationRow(conversation, active) {
  const other = otherUser(conversation);
  const row = link('conversation', conversation.id ? `#/chat/${encodeURIComponent(conversation.id)}` : `#/chat/friend/${other}`);
  row.dataset.id = conversationKey(conversation);
  if (active) row.setAttribute('aria-current', 'page');
  const face = el('span', 'conversation-face');
  if (conversation.type === ONE_TO_ONE && state.faces[other]) face.append(image(state.faces[other]));
  else face.append(icon(conversation.type === ONE_TO_ONE ? 'person' : 'two-people'));
  const text = el('span', 'list-text');
  text.append(el('strong', '', conversationTitle(conversation)), el('span', '', conversation.preview_message?.content || 'No messages yet'));
  row.append(face, text);
  if (conversation.unread_message_count) row.append(el('span', 'badge inline', String(conversation.unread_message_count)));
  return row;
}

function bubble(message, group) {
  const mine = String(message.sender_user_id) === String(state.me?.id);
  const node = el('div', `bubble${mine ? ' mine' : ''}`);
  if (!mine && group) node.append(el('span', 'bubble-name', state.names[message.sender_user_id]?.displayName || 'Member'));
  node.append(el('p', '', message.is_deleted ? 'Message removed' : message.content));
  node.append(el('time', '', timeAgo(message.created_at)));
  return node;
}

async function renderThread(pane, conversation, alive) {
  const group = conversation.type !== ONE_TO_ONE;
  const head = el('header', 'thread-head');
  const back = link('icon-button thread-back', '#/chat');
  back.setAttribute('aria-label', 'Back to chats');
  back.append(icon('chevron-large-left'));
  head.append(back, el('h2', '', conversationTitle(conversation)));
  const other = otherUser(conversation);
  if (!group && other) head.append(link('text-action', `#/user/${other}`, 'View profile'));
  const list = el('div', 'thread');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  const form = el('form', 'composer');
  const input = el('input');
  input.placeholder = 'Message';
  input.setAttribute('aria-label', 'Message');
  input.maxLength = 300;
  input.autocomplete = 'off';
  const sendButton = el('button', 'join', 'Send');
  sendButton.type = 'submit';
  form.append(input, sendButton);

  let shown = new Set();
  const show = () => {
    pane.replaceChildren(head, list, form);
    list.scrollTop = list.scrollHeight;
  };
  const paint = ordered => {
    const fresh = ordered.filter(m => !shown.has(m.id));
    if (!fresh.length) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (!shown.size) list.replaceChildren();
    list.append(...fresh.map(m => bubble(m, group)));
    shown = new Set(ordered.map(m => m.id));
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  const load = async () => {
    if (!conversation.id) return;
    const { messages = [] } = await api(`${CHAT}/get-conversation-messages?conversation_id=${encodeURIComponent(conversation.id)}&pageSize=50`);
    const ordered = [...messages].reverse();
    if (group) await userNames(ordered.map(m => m.sender_user_id));
    threads.set(conversation.id, ordered);
    if (!alive()) return;
    const before = shown.size;
    paint(ordered);
    if (shown.size !== before) api(`${CHAT}/mark-conversations`, { conversation_ids: [conversation.id] }).catch(() => {});
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    sendButton.disabled = true;
    try {
      if (!conversation.id) {
        const draftKey = conversationKey(conversation);
        conversation.id = await findConversation(other);
        const row = chatView?.list.querySelector(`.conversation[data-id="${draftKey}"]`);
        if (row) {
          row.dataset.id = conversation.id;
          row.href = `#/chat/${encodeURIComponent(conversation.id)}`;
          row.querySelector('.list-text span').textContent = content;
        }
        if (chatView) chatView.id = conversation.id;
        if (alive()) history.replaceState(null, '', `#/chat/${encodeURIComponent(conversation.id)}`);
      }
      await api(`${CHAT}/send-messages`, { conversation_id: conversation.id, messages: [{ content }] });
      await load();
    } catch (err) {
      input.value = content;
      failed("Your message didn't send.", err);
    }
    sendButton.disabled = false;
    input.focus();
  });
  const saved = threads.get(conversation.id);
  if (saved) {
    paint(saved);
    show();
  }
  try {
    await load();
    if (!alive()) return;
    if (!shown.size) list.replaceChildren(el('p', 'section-note thread-empty', 'No messages yet. Say hi.'));
  } catch (err) {
    if (!alive()) return;
    if (!shown.size) list.replaceChildren(el('p', 'section-note thread-empty', "Messages didn't load. Try again in a moment."));
    console.warn('[launcher] thread failed:', err.message);
  }
  if (!saved) show();
  const timer = setInterval(() => {
    if (!alive()) return clearInterval(timer);
    if (document.visibilityState === 'visible') load().catch(() => {});
  }, POLL_MS);
}

function markActive(view, id) {
  view.shell.classList.toggle('viewing', Boolean(id));
  view.list.querySelectorAll('.conversation').forEach(row => {
    const active = Boolean(id) && row.dataset.id === String(id);
    if (active) {
      row.setAttribute('aria-current', 'page');
      row.querySelector('.badge')?.remove();
    } else row.removeAttribute('aria-current');
  });
}

function createChatView() {
  const list = el('div', 'conversation-list');
  const status = el('p', 'section-note', 'Loading chats…');
  list.append(status);
  const pane = el('section', 'chat-pane');
  const shell = el('div', 'chat-layout');
  shell.append(list, pane);
  const view = { shell, list, pane, collected: [], id: null };
  let cursor = '';
  const more = button('more', 'Show more chats');
  let fills = 0;
  const fill = async reset => {
    const token = ++fills;
    more.disabled = true;
    const page = await api(`${CHAT}/get-user-conversations?include_user_data=true&pageSize=30${!reset && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const items = page.conversations || [];
    await faces(items.flatMap(c => (c.participant_user_ids || []).filter(p => String(p) !== String(state.me.id)).slice(0, 1)));
    if (token !== fills) return;
    if (reset) {
      view.collected = [];
      list.replaceChildren();
    }
    view.collected.push(...items);
    status.remove();
    more.remove();
    list.append(...items.map(c => conversationRow(c, conversationKey(c) === view.id)));
    cursor = page.next_cursor || '';
    if (cursor) list.append(more);
    if (!view.collected.length) list.append(el('p', 'section-note', 'No chats yet. Open a profile and press Message.'));
    more.disabled = false;
  };
  view.fill = fill;
  more.addEventListener('click', () => fill(false).catch(err => failed("Chats didn't load.", err)));
  return view;
}

let chatView = null;

async function openConversation(view, id, alive) {
  view.id = id;
  markActive(view, id);
  if (!id) {
    view.pane.replaceChildren(el('p', 'section-note thread-empty', 'Pick a chat to read it.'));
    return;
  }
  let conversation = view.collected.find(c => conversationKey(c) === id);
  if (!conversation && id.startsWith('friend:')) {
    const friend = id.slice('friend:'.length);
    await userNames([friend]);
    conversation = { id: null, type: ONE_TO_ONE, participant_user_ids: [state.me.id, friend] };
  }
  if (!conversation) {
    const result = await api(`${CHAT}/get-conversations?conversation_ids=${encodeURIComponent(id)}&include_user_data=true`);
    conversation = result.conversations?.[0];
  }
  if (!alive()) return;
  if (conversation) renderThread(view.pane, conversation, alive);
  else view.pane.replaceChildren(el('p', 'section-note thread-empty', "That chat couldn't be opened."));
}

export async function showChat(root, { id }, alive) {
  const target = id || null;
  try {
    if (chatView) {
      if (!chatView.shell.isConnected) {
        root.replaceChildren(chatView.shell);
        chatView.fill(true).then(() => markActive(chatView, chatView.id)).catch(() => {});
      }
      await openConversation(chatView, target, alive);
      return;
    }
    const view = createChatView();
    chatView = view;
    view.id = target;
    view.shell.classList.toggle('viewing', Boolean(target));
    root.replaceChildren(view.shell);
    const me = state.me || await api('https://users.roblox.com/v1/users/authenticated');
    state.me = state.me || { id: me.id, name: me.displayName || me.name };
    const metadata = await api(`${CHAT}/metadata`).catch(() => ({}));
    if (metadata.isChatEnabled === false) {
      chatView = null;
      const note = el('p', 'section-note', 'Chat is turned off for this account. You can change that in ');
      note.append(link('pref-link', '#/settings/chat', 'Chat settings'), '.');
      root.replaceChildren(note);
      return;
    }
    await view.fill(false);
    if (alive()) await openConversation(view, target, alive);
  } catch (err) {
    chatView = null;
    if (alive()) loadFailure(root, err, () => showChat(root, { id }, alive));
  }
}

function notificationText(item) {
  const visual = item.content?.states?.default?.visualItems || {};
  const body = visual.textBody?.[0];
  return { title: body?.title?.text, text: body?.label?.text || item.content?.notificationType || 'Notification', thumb: visual.thumbnail?.[0] };
}

const THUMB_TYPES = { UserId: ['AvatarHeadShot', '150x150'], User: ['AvatarHeadShot', '150x150'], AssetId: ['Asset', '150x150'], Asset: ['Asset', '150x150'], GroupId: ['GroupIcon', '150x150'], Group: ['GroupIcon', '150x150'], UniverseId: ['GameIcon', '150x150'], Universe: ['GameIcon', '150x150'], GameIcon: ['GameIcon', '150x150'], BadgeId: ['BadgeIcon', '150x150'] };

function notificationsTab() {
  const box = el('div', 'tab-body');
  const list = el('div', 'list-rows');
  const status = el('p', 'section-note', 'Loading notifications…');
  box.append(list, status);
  (async () => {
    try {
      const items = await api('https://notifications.roblox.com/v2/stream-notifications/get-recent?limit=30');
      const parsed = items.map(item => ({ item, ...notificationText(item) }));
      const requests = parsed.map((p, index) => {
        const type = THUMB_TYPES[p.thumb?.idType];
        return type && p.thumb.id ? { key: String(index), request: { targetId: Number(p.thumb.id), type: type[0], size: type[1] } } : null;
      }).filter(Boolean);
      const images = await thumbnails(requests).catch(() => ({}));
      parsed.forEach((p, index) => {
        const row = el('div', `list-row${p.item.isInteracted ? '' : ' unread'}`);
        const text = el('span', 'list-text');
        if (p.title) text.append(el('strong', '', p.title));
        text.append(el('span', p.title ? '' : 'strong-line', p.text), el('span', 'list-time', timeAgo(p.item.eventDate || p.item.timestamp)));
        const picture = images[index] ? image(images[index], '', true) : el('span', 'list-icon');
        if (!images[index]) picture.append(icon('bell'));
        row.append(picture, text);
        list.append(row);
      });
      status.hidden = Boolean(parsed.length);
      status.textContent = 'No notifications yet.';
      api('https://notifications.roblox.com/v2/stream-notifications/clear-unread', {}).catch(() => {});
    } catch (err) {
      status.textContent = "Notifications didn't load. Try again in a moment.";
      console.warn('[launcher] notifications failed:', err.message);
    }
  })();
  return box;
}

const MESSAGE_PAGE = 20;
const SAFE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'P', 'DIV', 'UL', 'OL', 'LI']);

function messageHtml(html) {
  const source = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html').body.firstChild;
  const copy = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const children = [...node.childNodes].map(copy).filter(Boolean);
    if (node.tagName === 'BR') return el('br');
    if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href') || '')) {
      const anchor = link('message-link', node.getAttribute('href'));
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.append(...children);
      return anchor;
    }
    if (!SAFE_TAGS.has(node.tagName)) {
      const fragment = document.createDocumentFragment();
      fragment.append(...children);
      return fragment;
    }
    const tag = node.tagName === 'SPAN' && /emphasis/.test(node.className) ? 'strong' : node.tagName.toLowerCase();
    const out = el(tag);
    out.append(...children);
    return out;
  };
  const body = el('div', 'message-text');
  body.append(...[...source.childNodes].map(copy).filter(Boolean));
  return body;
}

function messageRow(message, kind, onArchive) {
  const person = kind === 'sent' ? message.recipient : message.sender;
  const row = el('details', `message-row${message.isRead ? '' : ' unread'}`);
  const summary = el('summary');
  const system = message.isSystemMessage && kind !== 'sent';
  const face = el('span', `message-face${system ? ' system' : ''}`);
  face.append(system ? icon('tilt', true) : image(state.faces[person?.id], '', true));
  const text = el('span', 'message-summary');
  const top = el('span', 'message-top');
  const name = el('span', 'message-from');
  name.append(el('span', '', kind === 'sent' ? `To ${person?.displayName || 'someone'}` : person?.displayName || 'Roblox'));
  if (person?.hasVerifiedBadge) {
    const badge = icon('verified-mono', true);
    badge.setAttribute('aria-label', 'Verified');
    name.append(badge);
  }
  top.append(name, el('span', 'message-time', timeAgo(message.created)));
  const preview = messageHtml(message.body).textContent.replace(/\s+/g, ' ').trim();
  text.append(top, el('strong', 'message-subject', message.subject || '(No subject)'), el('span', 'message-preview', preview));
  summary.append(face, text);
  const body = el('div', 'message-body');
  body.append(messageHtml(message.body));
  if (kind !== 'sent') {
    const actions = el('div', 'message-actions');
    const archive = button('more', kind === 'inbox' ? 'Archive' : 'Move to inbox');
    archive.addEventListener('click', () => onArchive(row, message, archive));
    actions.append(archive);
    body.append(actions);
  }
  row.addEventListener('toggle', () => {
    if (!row.open || message.isRead || kind === 'sent') return;
    message.isRead = true;
    row.classList.remove('unread');
    api('https://privatemessages.roblox.com/v1/messages/mark-read', { messageIds: [message.id] }).catch(() => {});
  });
  row.append(summary, body);
  return row;
}

function messagesTab(kind) {
  const box = el('div', 'tab-body messages');
  const list = el('div', 'message-list');
  const status = el('p', 'section-note', 'Loading messages…');
  const more = button('more', 'Show more');
  more.hidden = true;
  box.append(list, status, more);
  let page = 0;
  const archive = async (row, message, control) => {
    control.disabled = true;
    try {
      await api(`https://privatemessages.roblox.com/v1/messages/${kind === 'inbox' ? 'archive' : 'unarchive'}`, { messageIds: [message.id] });
      row.remove();
      toast(kind === 'inbox' ? 'Archived' : 'Moved to inbox');
    } catch (err) {
      control.disabled = false;
      failed("That didn't work.", err);
    }
  };
  const load = async () => {
    more.disabled = true;
    try {
      const result = await api(`https://privatemessages.roblox.com/v1/messages?messageTab=${kind}&pageNumber=${page}&pageSize=${MESSAGE_PAGE}`);
      const items = result.collection || [];
      await faces(items.map(message => (kind === 'sent' ? message.recipient?.id : message.sender?.id)).filter(Boolean));
      list.append(...items.map(message => messageRow(message, kind, archive)));
      status.hidden = Boolean(list.children.length);
      status.textContent = kind === 'archive' ? 'Nothing archived.' : kind === 'sent' ? "You haven't sent any messages." : 'Your inbox is empty.';
      page += 1;
      more.hidden = page >= (result.totalPages || 0);
    } catch (err) {
      status.textContent = "Messages didn't load. Try again in a moment.";
      status.hidden = false;
      console.warn('[launcher] messages failed:', err.message);
    }
    more.disabled = false;
  };
  more.addEventListener('click', load);
  load();
  return box;
}

export async function showNotifications(root, { tab }) {
  state.counts.notifications = 0;
  root.replaceChildren(pageHead('Notifications'), tabs([
    ['Notifications', () => notificationsTab()],
    ['Inbox', () => messagesTab('inbox')],
    ['Sent', () => messagesTab('sent')],
    ['Archive', () => messagesTab('archive')],
  ], tab === 'messages' ? 1 : 0));
}
