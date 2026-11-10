import type { Controller } from './controller.ts';
import type { ChatFeed, SharedMessage } from './shared-chat.ts';
/** Keep the local, host-relayed race transcript alongside the account-backed
 * postgame feed. Sending still uses the authenticated feed; no client can
 * upload or impersonate another racer's historical messages. */
export class RankedResultsChat implements ChatFeed {
  #race: SharedMessage[] = [];
  #listeners = new Set<() => void>();
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setInterval>;
  constructor(private feed: ChatFeed, private controller: Controller, private match: string) {
    this.#capture();
  }
  #capture() {
    const chat = this.controller.chat;
    if (chat.cupId !== this.match) return;
    this.#race = chat.lines.slice(-100).map(line => ({
      id: `race:${this.match}:${line.seq}`,
      sender_id: `speaker:${line.speaker}`,
      display_name: line.system ? 'Lobby' : line.name,
      body: line.text,
      created_at: new Date(line.at).toISOString(),
    }));
  }
  get messages() {
    this.#capture();
    return [...this.#race, ...this.feed.messages]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(-200);
  }
  get error() { return this.feed.error; }
  get writable() { return this.feed.writable; }
  get unavailable() { return this.feed.unavailable; }
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => { this.#listeners.delete(fn); };
  }
  #changed = () => { for (const fn of this.#listeners) fn(); };
  start() {
    if (this.#timer) return;
    this.#unsubscribe = this.feed.subscribe(this.#changed);
    this.#timer = setInterval(this.#changed, 500);
    this.feed.start();
  }
  stop() {
    this.#capture();
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.feed.stop();
  }
  send(body: string, nonce: string) { return this.feed.send(body, nonce); }
}

/** Casual results remain in the player-hosted lobby and share its existing chat,
 * including guests. No duplicate transport or additional server room is created. */
export class CasualResultsChat implements ChatFeed {
  #timer?: ReturnType<typeof setInterval>;
  #listeners = new Set<() => void>();
  #cup: string;
  #controller: Controller;
  constructor(controller: Controller) {
    this.#controller = controller;
    this.#cup = controller.chat.cupId;
  }
  get messages(): SharedMessage[] {
    return this.#controller.chat.cupId === this.#cup
      ? this.#controller.chat.lines.slice(-100).map((line) => ({
          id: String(line.seq),
          sender_id: 'speaker:' + line.speaker,
          display_name: line.system ? 'Lobby' : line.name,
          body: line.text,
          created_at: new Date(line.at).toISOString(),
        }))
      : [];
  }
  get error() {
    return this.writable ? '' : 'Lobby chat is no longer connected.';
  }
  get unavailable() {
    return 'Lobby chat is no longer connected.';
  }
  get writable() {
    return (
      this.#controller.chat.cupId === this.#cup &&
      !!this.#cup &&
      !this.#controller.chat.muted &&
      !!this.#controller.connection
    );
  }
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
  start() {
    this.stop();
    this.#timer = setInterval(() => {
      for (const fn of this.#listeners) fn();
    }, 500);
  }
  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
  async send(body: string) {
    if (!this.writable) throw Error('Lobby chat is no longer connected.');
    await this.#controller.chat.post(body);
    for (const fn of this.#listeners) fn();
  }
}
