import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { TypingSignal } from './typing.ts';
import type { ActivityPresence } from './activity.ts';

import type { MessageReply } from './message-reply.ts';
export interface SharedMessage {
  reply?: MessageReply | null;
  id: string;
  sender_id: string;
  display_name: string;
  avatar_url?: string;
  body: string;
  created_at: string;
}
export interface OnlinePlayer {
  player_id: string;
  display_name: string;
  avatar_url?: string;
  activity: string;
  presence?: ActivityPresence;
}
export interface ChatFeed {
  readonly supportsReplies?: boolean;
  readonly messages: readonly SharedMessage[];
  readonly error: string;
  readonly writable: boolean;
  readonly unavailable?: string;
  readonly typing?: TypingSignal;
  subscribe(fn: () => void): () => void;
  start(): void;
  stop(): void;
  send(body: string, nonce: string, reply?: string): Promise<void>;
}
/** One visible surface owns a feed. Notifications only invalidate; rows come from
 * the permission-checked RPC, so blocked senders never enter the rendered log. */
export class SharedChat implements ChatFeed {
  #typing?: TypingSignal;
  get typing() {
    return this.#typing;
  }
  get rosterError() {
    return this.#rosterError;
  }
  get error() {
    return this.#error;
  }
  get totalOnline() {
    return this.#totalOnline;
  }
  get online() {
    return this.#online;
  }
  get messages() {
    return this.#messages;
  }
  get active() {
    return this.#active;
  }
  #messages: SharedMessage[] = [];
  #online: OnlinePlayer[] = [];
  #totalOnline = 0;
  #error = '';
  #rosterError = '';
  #listeners = new Set<() => void>();
  #generation = 0;
  #channel?: RealtimeChannel;
  #timer?: ReturnType<typeof setInterval>;
  #debounce?: ReturnType<typeof setTimeout>;
  #flight?: Promise<void>;
  #again = false;
  #active = false;
  #lastRead = 0;
  #lastRoster = 0;
  #connected = false;
  #user: string | null = null;
  #snapshot = true;
  #closed = false;
  #client: SupabaseClient;
  #scope: string;
  #identity: () => string | null;
  get scope() {
    return this.#scope;
  }
  constructor(client: SupabaseClient, scope: string, identity: () => string | null) {
    this.#client = client;
    this.#scope = scope;
    this.#identity = identity;
    if (scope === 'community') this.#typing = new TypingSignal(client, scope, identity);
  }
  get writable() {
    return !this.#closed && !!this.#identity() && this.#identity() === this.#user;
  }
  get unavailable() {
    return this.#closed ? 'Match chat has closed.' : 'Sign in with Discord to chat';
  }
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
  #changed() {
    for (const fn of this.#listeners) fn();
  }
  start() {
    const user = this.#identity();
    if (this.#active && this.#user === user) return;
    this.stop();
    if (user !== this.#user) {
      this.#messages = [];
      this.#online = [];
      this.#totalOnline = 0;
    }
    this.#user = user;
    this.#error = this.#rosterError = '';
    this.#closed = false;
    this.#active = true;
    this.#lastRoster = this.#lastRead = 0;
    this.#snapshot = true;
    const generation = this.#generation;
    this.#channel = this.#client
      .channel('chat-' + crypto.randomUUID())
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'polycup_chat_messages',
          filter: 'scope=eq.' + this.#scope,
        },
        () => {
          if (generation !== this.#generation) return;
          clearTimeout(this.#debounce);
          this.#debounce = setTimeout(() => void this.refresh(), 150);
        },
      )
      .subscribe((status) => {
        if (generation !== this.#generation) return;
        this.#connected = status === 'SUBSCRIBED';
        if (this.#connected) void this.refresh(true);
      });
    this.#timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() - this.#lastRead >= (this.#connected ? 30000 : 8000)) void this.refresh();
    }, 2000);
    void this.refresh();
    this.#changed();
  }
  stop() {
    this.typing?.stop();
    this.#generation++;
    this.#active = false;
    clearInterval(this.#timer);
    clearTimeout(this.#debounce);
    if (this.#channel) void this.#client.removeChannel(this.#channel);
    this.#channel = undefined;
    this.#flight = undefined;
    this.#again = false;
    this.#connected = false;
  }
  reset() {
    this.stop();
    this.#messages = [];
    this.#online = [];
    this.#totalOnline = 0;
    this.#user = null;
    this.#closed = false;
    this.#error = this.#rosterError = '';
    this.#changed();
  }
  async #rpc(name: string, args: Record<string, unknown>, generation: number) {
    const response = await this.#client.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
    if (generation !== this.#generation || this.#identity() !== this.#user)
      throw Error('Chat account changed.');
    if (response.error) throw Error(response.error.message);
    return response.data;
  }
  refreshRoster() {
    this.#lastRoster = 0;
    if (this.#active) void this.refresh();
  }
  refresh(snapshot = false): Promise<void> {
    this.#snapshot ||= snapshot;
    if (!this.#active) return Promise.resolve();
    if (this.#identity() !== this.#user) {
      this.start();
      return this.#flight ?? Promise.resolve();
    }
    if (this.#flight) {
      this.#again = true;
      return this.#flight;
    }
    const generation = this.#generation;
    this.#lastRead = Date.now();
    const flight = (async () => {
      try {
        const snapshot = this.#snapshot;
        this.#snapshot = false;
        const rows: SharedMessage[] = await this.#rpc(
          'polycup_chat_page',
          {
            channel_key: this.#scope,
            after_key: snapshot ? '0' : (this.#messages.at(-1)?.id ?? '0'),
          },
          generation,
        );
        const merged = new Map((snapshot ? [] : this.#messages).map((row) => [row.id, row]));
        for (const row of rows) merged.set(row.id, row);
        this.#messages = [...merged.values()]
          .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
          .slice(-100);
        this.#error = '';
      } catch (e) {
        if (generation === this.#generation) {
          this.#error = (e as Error).message;
          this.#closed = /Match chat has closed/.test(this.#error);
          if (this.#closed) {
            clearInterval(this.#timer);
            if (this.#channel) void this.#client.removeChannel(this.#channel);
            this.#channel = undefined;
          }
        }
      }
      if (
        this.#scope === 'community' &&
        generation === this.#generation &&
        Date.now() - this.#lastRoster >= 30000
      ) {
        this.#lastRoster = Date.now();
        try {
          const roster = await this.#rpc('polycup_community_online', {}, generation);
          this.#online = roster.players;
          this.#totalOnline = roster.total;
          this.#rosterError = '';
        } catch (e) {
          if (generation === this.#generation)
            this.#rosterError = 'Online list unavailable. Retrying…';
        }
      }
      if (generation === this.#generation) this.#changed();
    })().finally(() => {
      if (generation !== this.#generation) return;
      this.#flight = undefined;
      if (this.#again) {
        this.#again = false;
        void this.refresh();
      }
    });
    this.#flight = flight;
    return flight;
  }
  get supportsReplies() { return this.#scope === 'community'; }
  async send(body: string, nonce: string, reply?: string) {
    body = body.trim();
    if (!this.writable) throw Error('Sign in with Discord to chat.');
    if (!body || body.length > 400) throw Error('Write a message of 1 to 400 characters.');
    const generation = this.#generation;
    await this.#rpc(
      'polycup_chat_send',
      { channel_key: this.#scope, message_text: body, nonce_key: nonce, ...(reply ? { reply_key: reply } : {}) },
      generation,
    );
    await this.refresh();
  }
}
