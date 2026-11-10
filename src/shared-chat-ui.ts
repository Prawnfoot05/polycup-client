import { playerLooks } from './player-looks.ts';
import { installErrorDismissal, retryDismissedErrors } from './dismissible-errors.ts';
import { element as h } from './dom.ts';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
import type { ChatFeed, SharedChat, SharedMessage } from './shared-chat.ts';
import css from './shared-chat.css';
import { drawTyping, typingCSS } from './typing-ui.ts';
import { ReplyComposer, replyAction, replyQuote, messageReplyCSS } from './message-reply.ts';
export const sharedChatCSS = profilePictureCSS + css + typingCSS + messageReplyCSS;
const editors = new WeakMap<EventTarget, (event: KeyboardEvent) => void>();
/** The game shields its modal inputs at window capture. Route the focused
 * editor there, before shielding, because target listeners cannot run later. */
export function sharedChatKey(event: KeyboardEvent) {
  for (const target of event.composedPath()) {
    const edit = editors.get(target);
    if (edit) {
      edit(event);
      return true;
    }
  }
  return false;
}

/** Stable DOM: settlement/queue refreshes must not replace a draft or steal focus. */
export class SharedChatUI {
  get element() {
    return this.#element;
  }
  #element = h('section', undefined, 'shared-chat');
  #log = h('div', undefined, 'shared-chat-log');
  #input = h('textarea');
  #typing = h('div', undefined, 'chat-typing');
  #typingUnsubscribe?: () => void;
  #send = h('button', 'Send', 'primary');
  #status = h('p', '', 'shared-chat-status');
  #latest = h('button', 'New messages ↓', 'quiet chat-latest');
  #unsubscribe?: () => void;
  #sending = false;
  #nonce = '';
  #reply = new ReplyComposer(() => { this.#nonce = ''; this.#input.focus(); });
  #signature = '';
  #bottom = true;
  #generation = 0;
  #seen = '';
  #onUnread?: (count: number) => void;
  set onUnread(fn: ((count: number) => void) | undefined) {
    this.#onUnread = fn;
  }
  #unread = 0;
  #visible = true;
  #feed: ChatFeed;
  #profile?: (id: string) => void;
  #framesOnly: boolean;
  constructor(
    feed: ChatFeed,
    title: string,
    profile?: (id: string) => void,
    appearance: 'full' | 'frames' = 'full',
  ) {
    this.#framesOnly = appearance === 'frames';
    this.#feed = feed;
    this.#profile = profile;
    this.#element.setAttribute('aria-label', title);
    this.#element.append(h('h2', title));
    this.#log.tabIndex = 0;
    this.#log.setAttribute('role', 'log');
    this.#log.setAttribute('aria-label', title + ' messages');
    this.#log.setAttribute('aria-live', 'off');
    this.#log.addEventListener('scroll', () => {
      this.#bottom = this.#log.scrollHeight - this.#log.scrollTop - this.#log.clientHeight < 32;
    });
    const form = h('form', undefined, 'shared-chat-compose');
    this.#input.rows = 2;
    this.#input.maxLength = 400;
    this.#input.placeholder = 'Write a message…';
    this.#input.setAttribute('aria-label', title + ' message');
    this.#input.addEventListener('input', () => {
      this.#nonce = '';
      this.#updateSend();
      this.#feed.typing?.input(!!this.#input.value.trim());
    });
    this.#input.addEventListener('blur', () => this.#feed.typing?.input(false));
    editors.set(this.#input, (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && this.#reply.value) {
        event.preventDefault(); this.#reply.value = undefined; this.#nonce = ''; return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    this.#input.addEventListener('keydown', sharedChatKey);
    this.#send.type = 'submit';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#post();
    });
    form.append(this.#reply.element, this.#input, this.#send);
    this.#latest.type = 'button';
    this.#latest.hidden = true;
    this.#latest.onclick = () => {
      this.#bottom = true;
      this.#scroll();
    };
    this.#status.setAttribute('role', 'status');
    this.#element.append(this.#log, this.#latest, this.#typing, form, this.#status);
    installErrorDismissal(this.#element);
    this.render();
  }
  get visible() {
    return this.#visible;
  }
  set visible(value: boolean) {
    this.#visible = value;
    if (value && this.#unsubscribe) this.#feed.typing?.start();
    else this.#feed.typing?.stop();
    if (value) {
      this.#unread = 0;
      this.#onUnread?.(0);
      requestAnimationFrame(() => {
        if (this.#bottom) this.#scroll();
      });
    }
  }
  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#feed.subscribe(() => this.render());
    this.#feed.start();
    this.#typingUnsubscribe = this.#feed.typing?.subscribe(() =>
      drawTyping(this.#typing, this.#feed.typing!.players),
    );
    if (this.#visible) this.#feed.typing?.start();
    this.render();
  }
  stop() {
    this.#feed.typing?.stop();
    this.#typingUnsubscribe?.();
    this.#typingUnsubscribe = undefined;
    this.#generation++;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#feed.stop();
    this.#input.value = '';
    this.#input.readOnly = false;
    this.#nonce = '';
    this.#reply.value = undefined;
    this.#sending = false;
  }
  clear() {
    this.stop();
    this.#log.replaceChildren();
    this.#signature = this.#seen = '';
    this.#unread = 0;
  }
  #scroll() {
    this.#log.scrollTop = this.#log.scrollHeight;
    this.#latest.hidden = true;
  }
  #updateSend() {
    this.#send.disabled = this.#sending || !this.#feed.writable || !this.#input.value.trim();
  }
  async #post() {
    if (this.#send.disabled) return;
    this.#feed.typing?.input(false);
    retryDismissedErrors(this.#element);
    const body = this.#input.value.trim(),
      generation = this.#generation;
    this.#nonce ||= crypto.randomUUID();
    this.#sending = true;
    this.#input.readOnly = true;
    this.#updateSend();
    this.#status.textContent = 'Sending…';
    this.#status.setAttribute('role', 'status');
    try {
      await this.#feed.send(body, this.#nonce, this.#reply.value?.id);
      if (generation !== this.#generation) return;
      this.#input.value = '';
      this.#reply.value = undefined;
      this.#nonce = '';
      this.#status.textContent = '';
      this.#bottom = true;
      this.render();
      this.#scroll();
    } catch (e) {
      if (generation === this.#generation) {
        this.#status.textContent =
          (e as Error).message + ' Your draft is kept. Press Send to retry.';
        this.#status.setAttribute('role', 'alert');
      }
    } finally {
      if (generation === this.#generation) {
        this.#sending = false;
        this.#input.readOnly = false;
        this.#updateSend();
      }
    }
  }
  render() {
    this.#element.classList.toggle('replies-enabled', !!this.#feed.supportsReplies && this.#feed.writable);
    const messages = this.#feed.messages,
      signature = JSON.stringify([!!this.#feed.supportsReplies && this.#feed.writable, messages]);
    const last = messages.at(-1)?.id ?? '';
    if (signature !== this.#signature) {
      const firstLoad = !this.#signature;
      this.#signature = signature;
      const scroll = this.#log.scrollTop;
      this.#log.replaceChildren(
        ...messages.map((row, index) => this.#row(row, messages[index - 1])),
      );
      if (!messages.length) this.#log.append(h('p', 'No messages yet.', 'shared-chat-empty'));
      if (firstLoad || this.#bottom)
        requestAnimationFrame(() => {
          if (this.#visible && this.#bottom) this.#scroll();
        });
      else {
        this.#log.scrollTop = scroll;
        this.#latest.hidden = false;
      }
      if (!firstLoad && !this.#visible && last !== this.#seen) {
        this.#unread += messages.filter(
          (m) =>
            /^\d+$/.test(m.id) && /^\d+$/.test(this.#seen) && BigInt(m.id) > BigInt(this.#seen),
        ).length;
        this.#onUnread?.(Math.min(99, this.#unread));
      }
      this.#seen = last;
    }
    this.#input.disabled = !this.#feed.writable;
    if (!this.#feed.writable) {
      this.#reply.value = undefined;
      this.#input.value = '';
      this.#nonce = '';
    }
    this.#input.placeholder = this.#feed.writable
      ? 'Write a message…'
      : (this.#feed.unavailable ?? 'Sign in with Discord to chat');
    if (!this.#sending && !this.#status.textContent?.includes('draft is kept')) {
      this.#status.textContent = this.#feed.error;
      this.#status.setAttribute('role', this.#feed.error ? 'alert' : 'status');
    }
    this.#updateSend();
  }
  #row(row: SharedMessage, previous?: SharedMessage) {
    const item = h('article', undefined, 'shared-chat-message');
    item.dataset.messageId = row.id;
    const elapsed = previous ? Date.parse(row.created_at) - Date.parse(previous.created_at) : -1;
    if (!row.reply && row.sender_id && previous?.sender_id === row.sender_id && elapsed >= 0 && elapsed < 300000)
      item.classList.add('is-continuation');
    item.title = new Date(row.created_at).toLocaleString();
    const portrait = profilePicture(row.display_name, row.avatar_url);
    const content = h('div'),
      header = h('div', undefined, 'shared-chat-byline');
    const name = h(
      this.#profile && row.sender_id ? 'button' : 'span',
      row.display_name,
      'chat-author',
    );
    if (name instanceof HTMLButtonElement) {
      name.type = 'button';
      name.onclick = () => this.#profile?.(row.sender_id);
    }
    const time = h('time');
    const date = new Date(row.created_at);
    if (Number.isFinite(date.getTime())) {
      time.dateTime = row.created_at;
      time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      time.title = date.toLocaleString();
    }
    header.append(name, time);
    if (!this.#framesOnly) playerLooks.decorate(header, row.sender_id);
    if (row.reply) content.append(replyQuote(row.reply, this.#log));
    content.append(header);
    content.append(h('p', row.body));
    item.append(portrait, content);
    if (this.#feed.supportsReplies && this.#feed.writable) item.append(replyAction(() => {
      if (this.#sending || !this.#feed.writable) return;
      this.#reply.value = { id: row.id, display_name: row.display_name, avatar_url: row.avatar_url, body: row.body };
      this.#nonce = ''; this.#input.focus({ preventScroll: true });
    }));
    item.dataset.playerBanner = 'off';
    playerLooks.decorate(item, row.sender_id);
    return item;
  }
}

export class CommunityUI {
  get element() {
    return this.#element;
  }
  #element = h('section', undefined, 'community-view');
  #chat: SharedChatUI;
  get chat() {
    return this.#chat;
  }
  #roster = h('div', undefined, 'community-roster');
  #title = h('h2', 'Online');
  #unsubscribe?: () => void;
  #buttons: HTMLButtonElement[] = [];
  #feed: SharedChat;
  constructor(feed: SharedChat, profile: (id: string) => void) {
    this.#feed = feed;
    this.#chat = new SharedChatUI(feed, 'Community chat', profile, 'frames');
    const toggle = h('div', undefined, 'community-switch');
    for (const [label, online] of [
      ['Chat', false],
      ['Online', true],
    ] as const) {
      const button = h('button', label, 'quiet');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!online));
      button.onclick = () => {
        this.#element.classList.toggle('show-online', online);
        this.#buttons.forEach((b, i) =>
          b.setAttribute('aria-pressed', String(i === (online ? 1 : 0))),
        );
        this.#chat.visible = !online;
      };
      this.#buttons.push(button);
      toggle.append(button);
    }
    const aside = h('aside', undefined, 'community-online');
    aside.setAttribute('aria-label', 'Online players');
    aside.append(this.#title, this.#roster);
    this.#element.append(toggle, this.#chat.element, aside);
    this.#roster.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        'button[data-player]',
      );
      if (button) profile(button.dataset.player!);
    });
  }
  start() {
    this.#unsubscribe ??= this.#feed.subscribe(() => this.render());
    this.#chat.start();
    this.render();
  }
  stop() {
    this.#chat.clear();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
  render() {
    this.#title.textContent = 'Online (' + this.#feed.totalOnline + ')';
    const list = this.#feed.online.map((player) => {
      const button = h('button', undefined, 'community-player');
      button.type = 'button';
      button.dataset.player = player.player_id;
      button.title = player.display_name;
      const text = h('span');
      text.append(h('strong', player.display_name));
      if (player.presence?.label)
        text.append(h('small', player.presence.label, 'community-activity'));
      button.append(profilePicture(player.display_name, player.avatar_url), text);
      button.dataset.playerBanner = 'off';
      playerLooks.decorate(button, player.player_id);
      return button;
    });
    this.#roster.replaceChildren(...list);
    if (!list.length)
      this.#roster.append(
        h('p', this.#feed.rosterError || 'No players online.', 'shared-chat-empty'),
      );
    if (list.length && this.#feed.rosterError)
      this.#roster.append(h('p', this.#feed.rosterError, 'shared-chat-status'));
    if (this.#feed.totalOnline > list.length)
      this.#roster.append(h('p', 'Showing the first 200 players.', 'shared-chat-status'));
  }
}
