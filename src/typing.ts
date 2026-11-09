import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
export interface TypingPlayer {
  player_id: string;
  display_name: string;
  avatar_url?: string;
  touched_at: string;
  expires_in_ms?: number;
}
/** Bounded ephemeral presence. Actual drafts never leave the composer. */
export class TypingSignal {
  #channel?: RealtimeChannel;
  #timer?: ReturnType<typeof setInterval>;
  #idle?: ReturnType<typeof setTimeout>;
  #refresh?: ReturnType<typeof setTimeout>;
  #invalidated = false;
  #generation = 0;
  #owner: string | null = null;
  #last = 0;
  #sending = false;
  #reading = false;
  #writes = Promise.resolve();
  #rows: TypingPlayer[] = [];
  #expires=new Map<string,number>();
  #lastRead = 0;
  #listeners = new Set<() => void>();
  constructor(
    private client: SupabaseClient,
    readonly scope: string,
    private identity: () => string | null,
  ) {}
  get players() {
    return this.#rows;
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
    if (this.#timer || !this.identity()) return;
    this.#owner = this.identity();
    this.#lastRead = 0;
    const generation = ++this.#generation;
    this.#channel = this.client
      .channel('typing-' + crypto.randomUUID())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'polycup_typing', filter: 'scope=eq.' + this.scope },
        () => {
          if (generation === this.#generation) this.#invalidate();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && generation === this.#generation) this.#invalidate();
      });
    this.#timer = setInterval(() => {
      if (document.hidden) {
        this.input(false);
        return;
      }
      const next = this.#rows.filter((p) => (this.#expires.get(p.player_id)??0)>Date.now());
      if (next.length !== this.#rows.length) {
        this.#rows = next;
        this.#changed();
      }
      if (Date.now() - this.#lastRead >= 5000) void this.#read();
    }, 500);
    void this.#read();
  }
  input(active: boolean) {
    clearTimeout(this.#idle);
    if (!this.#timer || this.identity() !== this.#owner) return;
    if (active && !document.hidden) {
      if (!this.#sending || Date.now() - this.#last >= 2500) {
        this.#sending = true;
        this.#last = Date.now();
        this.#write(true);
      }
      this.#idle = setTimeout(() => this.input(false), 3500);
    } else if (this.#sending) {
      this.#sending = false;
      this.#write(false);
    }
  }
  #write(active: boolean) {
    const owner = this.#owner;
    this.#writes = this.#writes
      .catch(() => {})
      .then(async () => {
        if (this.identity() !== owner) return;
        await this.client
          .rpc('polycup_typing_touch', { channel_key: this.scope, active })
          .abortSignal(AbortSignal.timeout(5000));
      });
  }
  #invalidate() {
    this.#invalidated = true;
    this.#refresh ??= setTimeout(() => {
      this.#refresh = undefined;
      void this.#read();
    }, Math.max(0, 200 - (Date.now() - this.#lastRead)));
  }
  async #read() {
    if (
      this.#reading ||
      !this.#timer ||
      document.hidden ||
      this.identity() !== this.#owner
    )
      return;
    if (Date.now() - this.#lastRead < 200) {
      if (this.#invalidated) this.#invalidate();
      return;
    }
    this.#reading = true;
    this.#invalidated = false;
    this.#lastRead = Date.now();
    const generation = this.#generation;
    try {
      const { data, error } = await this.client
        .rpc('polycup_typing_list', { channel_key: this.scope })
        .abortSignal(AbortSignal.timeout(5000));
      if (!error && generation === this.#generation) {
        this.#rows = Array.isArray(data) ? data : [];
        this.#expires=new Map(this.#rows.map(row=>[row.player_id,Date.now()+Math.max(0,Math.min(8000,row.expires_in_ms??8000))]));
        this.#changed();
      }
    } catch {
      /* Optional signal never interferes with sending a message. */
    } finally {
      this.#reading = false;
      if (this.#invalidated && this.#timer) this.#invalidate();
    }
  }
  stop() {
    this.input(false);
    ++this.#generation;
    clearInterval(this.#timer);
    clearTimeout(this.#idle);
    clearTimeout(this.#refresh);
    this.#refresh = undefined;
    this.#invalidated = false;
    this.#timer = undefined;
    if (this.#channel) void this.client.removeChannel(this.#channel);
    this.#channel = undefined;
    this.#rows = [];
    this.#expires.clear();
    this.#changed();
  }
}
