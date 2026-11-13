import { filterChat } from './chat-filter.ts';
import { element as h } from './dom.ts';
import css from './message-reply.css';
import { profilePicture } from './profile-picture.ts';
export const messageReplyCSS = css;

/** Quotes are resolved by the server, never supplied by the sending client. */
export interface MessageReply {
  id: string;
  sender_id?: string;
  display_name?: string;
  avatar_url?: string;
  body?: string;
  unavailable?: boolean;
}
/** Replies notify their original author, just like an explicit mention. */
export function messageNotifies(
  body: string,
  reply: MessageReply | null | undefined,
  user: string | null | undefined,
  sender: string,
) {
  return (
    !!user &&
    sender !== user &&
    (reply?.sender_id === user ||
      [...body.matchAll(/<@([a-f0-9-]{36})(?:\|[^>]*)?>/gi)].some((match) => match[1] === user))
  );
}
const excerpt = (body: string) =>
  body
    .replace(/<@[a-f0-9-]{36}(?:\|([^>]*))?>/gi, (_match, name) => {
      try {
        return '@' + (name ? decodeURIComponent(name) : 'Player');
      } catch {
        return '@Player';
      }
    })
    .replace(/\s+/g, ' ')
    .slice(0, 140);

export function replyAction(select: () => void, author = '') {
  const button = h('button', undefined, 'message-reply-action');
  button.type = 'button';
  button.title = 'Reply';
  button.setAttribute('aria-label', author ? 'Reply to ' + author : 'Reply');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M10 5 3 12l7 7M4 12h10a6 6 0 0 1 6 6');
  svg.append(path);
  button.append(svg);
  button.onclick = select;
  return button;
}

export function replyQuote(reply: MessageReply, log: HTMLElement) {
  const quote = h('button', undefined, 'message-reply-quote');
  quote.type = 'button';
  if (!reply.unavailable) {
    const portrait = profilePicture(reply.display_name ?? '', reply.avatar_url);
    // The original author is independent of the enclosing message sender.
    portrait.dataset.playerAvatar = 'independent';
    quote.append(portrait);
  }
  quote.append(
    h('strong', reply.display_name ?? ''),
    h('span', reply.unavailable ? 'Original message unavailable' : filterChat(excerpt(reply.body ?? ''))),
  );
  quote.setAttribute(
    'aria-label',
    'Show original message' + (reply.display_name ? ' from ' + reply.display_name : ''),
  );
  quote.onclick = () => {
    const original = [...log.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (node) => node.dataset.messageId === reply.id,
    );
    if (!original) {
      quote.title = 'Original message is not loaded';
      return;
    }
    original.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    original.classList.remove('message-reply-target');
    void original.offsetWidth;
    original.classList.add('message-reply-target');
    setTimeout(() => original.classList.remove('message-reply-target'), 1800);
  };
  return quote;
}

export class ReplyComposer {
  #element = h('div', undefined, 'message-reply-compose');
  get element() {
    return this.#element;
  }
  #reply?: MessageReply;
  constructor(private changed: () => void) {
    this.element.hidden = true;
  }
  get value() {
    return this.#reply;
  }
  set value(value: MessageReply | undefined) {
    this.#reply = value;
    this.element.hidden = !value;
    this.element.replaceChildren();
    if (!value) return;
    const text = h('div');
    text.append(
      h('strong', 'Replying to ' + value.display_name),
      h('span', excerpt(value.body ?? '')),
    );
    const cancel = h('button', '×');
    cancel.type = 'button';
    cancel.title = 'Cancel reply';
    cancel.setAttribute('aria-label', 'Cancel reply');
    cancel.onclick = () => {
      this.value = undefined;
      this.changed();
    };
    this.element.append(text, cancel);
  }
}
