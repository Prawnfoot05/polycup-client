import type { Controller } from './controller.ts';
import type { ChatFeed, SharedMessage } from './shared-chat.ts';
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
