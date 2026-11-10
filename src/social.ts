import { playerLooks } from './player-looks.ts';
import type { CosmeticCollection, EquippedCosmetics } from './cosmetics.ts';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { RankedProfile, RankedStats, ProfileHighlights } from './ranked.ts';
import type { PlayerProgression } from './banner.ts';
import { TypingSignal } from './typing.ts';
import type { ActivityPresence } from './activity.ts';
export const profileAccents = {
  gold: '#ffd76b',
  sky: '#8ecbff',
  mint: '#85e0bc',
  coral: '#ffa69e',
  violet: '#c6adff',
  silver: '#c8d4e5',
} as const;
export type ProfileAccent = keyof typeof profileAccents | `#${string}`;
export interface PlayerProfile {
  player_id: string;
  display_name: string;
  avatar_url: string;
  avatar_key?: string | null;
  discord_avatar_url?: string;
  created_at: string;
  bio: string;
  accent?: ProfileAccent;
  banner_id?: string | null;
  cosmetics?: CosmeticCollection;
  progression?: PlayerProgression;
  highlights?: ProfileHighlights;
  rank: RankedProfile | null;
  stats: RankedStats;
  relationship: 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';
  friendship_id: string | null;
  can_message: boolean;
  blocked_by_me: boolean;
  online: boolean | null;
  presence?: ActivityPresence | null;
}
export interface DirectMessage {
  reply?: import('./message-reply.ts').MessageReply | null;
  invitation?: {id: string;title: string;friendly: boolean;active: boolean;code: string | null;expires_at: string | null};
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  client_nonce: string;
}
export interface Conversation {
  thread_id: string;
  player_id: string;
  display_name: string;
  avatar_url: string;
  preview: string;
  created_at: string;
  sent_by_me: boolean;
  unread: number;
  blocked_by_me: boolean;
}
export interface MessagePage {
  messages: DirectMessage[];
  has_more: boolean;
  profile: PlayerProfile | null;
}
export class Social {
  typing(peer: string) {
    return new TypingSignal(
      this.client,
      'dm:' + [this.#user!, peer].sort().join(':'),
      () => this.#user,
    );
  }
  #user: string | null = null;
  #generation = 0;
  #channel?: RealtimeChannel;
  #timer?: ReturnType<typeof setInterval>;
  #debounce?: ReturnType<typeof setTimeout>;
  #flight?: Promise<void>;
  #refreshQueued = false;
  #listeners = new Set<() => void>();
  #inbox: Conversation[] = [];
  #error = '';
  #connected = false;
  #lastRead = 0;
  #active = false;
  get user() {
    return this.#user;
  }
  get inbox() {
    return this.#inbox;
  }
  get unread() {
    return this.#inbox.reduce((n, row) => n + Number(row.unread), 0);
  }
  get error() {
    return this.#error;
  }
  get connected() {
    return this.#connected;
  }
  set active(value: boolean) {
    this.#active = value;
  }
  constructor(
    private client: SupabaseClient,
    private changed: () => void,
    private blocksChanged: () => void = () => {},
  ) {}
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #notify() {
    this.changed();
    for (const fn of this.#listeners) fn();
  }
  start(user: string | null) {
    if (this.#user === user && this.#timer) return;
    this.stop();
    playerLooks.clear();
    if (!user) return;
    this.#user = user;
    const generation = this.#generation;
    const wake = () => {
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => {
        if (generation === this.#generation) void this.refresh(true);
      }, 120);
    };
    this.#channel = this.client
      .channel('polycup-social-' + user + '-' + crypto.randomUUID())
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'polycup_direct_messages',
          filter: 'recipient_id=eq.' + user,
        },
        wake,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'polycup_direct_messages',
          filter: 'sender_id=eq.' + user,
        },
        wake,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'polycup_dm_members',
          filter: 'player_id=eq.' + user,
        },
        wake,
      )
      .subscribe((state) => {
        if (generation !== this.#generation) return;
        this.#connected = state === 'SUBSCRIBED';
        if (this.#connected) wake();
      });
    this.#timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const interval = this.#active && !this.#connected ? 8000 : 30000;
      if (Date.now() - this.#lastRead >= interval) void this.refresh();
    }, 4000);
    void this.refresh();
  }
  stop() {
    ++this.#generation;
    this.#user = null;
    this.#connected = false;
    this.#active = false;
    clearInterval(this.#timer);
    clearTimeout(this.#debounce);
    this.#timer = undefined;
    if (this.#channel) void this.client.removeChannel(this.#channel);
    this.#channel = undefined;
    this.#flight = undefined;
    this.#refreshQueued = false;
    this.#inbox = [];
    this.#error = '';
    this.#lastRead = 0;
    this.#notify();
  }
  async #rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const generation = this.#generation;
    const { data, error } = await this.client
      .rpc(name, args)
      .abortSignal(AbortSignal.timeout(12000));
    if (generation !== this.#generation) throw Error('Account changed.');
    if (error)
      throw Error(error.code === 'P0001' ? error.message : 'Could not connect. Please try again.');
    return data as T;
  }
  refresh(force = false): Promise<void> {
    if (!this.#user) return Promise.resolve();
    if (this.#flight) {
      if (force) this.#refreshQueued = true;
      return this.#flight;
    }
    const generation = this.#generation;
    const job = (async () => {
      try {
        const rows = await this.#rpc<Conversation[]>('polycup_dm_inbox');
        if (generation !== this.#generation) return;
        this.#inbox = rows;
        this.#error = '';
        this.#lastRead = Date.now();
      } catch {
        if (generation !== this.#generation) return;
        this.#error = 'Messages are unavailable. Try again.';
        this.#lastRead = Date.now();
      }
      this.#notify();
    })();
    this.#flight = job;
    void job.finally(() => {
      if (this.#flight === job) {
        this.#flight = undefined;
        if (this.#refreshQueued && this.#user) {
          this.#refreshQueued = false;
          void this.refresh();
        }
      }
    });
    return job;
  }
  async profile(player: string) {
    const profile = await this.#rpc<PlayerProfile | null>('polycup_player_profile_v3', {
      player_key: player,
    });
    if (profile)
      playerLooks.set({
        player_id: player,
        avatar_url: profile.avatar_url,
        banner_id: profile.banner_id,
        ...profile.cosmetics,
      });
    if (profile?.progression) playerLooks.setProgression(player, profile.progression);
    return profile;
  }
  async updateCosmetics(selection: EquippedCosmetics) {
    await this.#rpc('polycup_update_cosmetics', {
      title_key: selection.title_id ?? null,
      frame_key: selection.frame_id ?? null,
      badge_keys: selection.achievement_ids ?? [],
    });
  }
  async updateAvatar(blob: Blob | null, _currentKey?: string | null, source?: Blob) {
    const user = this.#user,
      generation = this.#generation;
    if (!user) throw Error('Sign in to change your picture.');
    if (blob && (blob.type !== 'image/webp' || !blob.size || blob.size > 262144))
      throw Error('Choose a smaller picture.');
    const form = new FormData();
    if (blob) {
      if (
        !source ||
        !['image/png', 'image/jpeg'].includes(source.type) ||
        !source.size ||
        source.size > 8 * 1024 * 1024
      )
        throw Error('Choose the original PNG or JPG again.');
      form.append('source', source, source.type === 'image/jpeg' ? 'source.jpg' : 'source.png');
      form.append('crop', blob, 'crop.webp');
    }
    const { data, error } = await this.client.functions.invoke<{
      avatar_url: string;
      avatar_key: string | null;
    }>('polycup-avatar', {
      method: blob ? 'POST' : 'DELETE',
      ...(blob ? { body: form } : {}),
      timeout: 75000,
    });
    if (this.#user !== user || generation !== this.#generation)
      throw Error('Your account changed. Try again.');
    if (error || typeof data?.avatar_url !== 'string') {
      let message = 'Could not confirm your picture. Try again.';
      if (error?.context instanceof Response) {
        const result = await error.context.json().catch(() => null);
        const messages: Record<string, string> = {
          rejected: 'This picture was flagged for inappropriate content. Choose another picture.',
          busy: 'A picture check is already running. Try again in a moment.',
          limited: 'Too many picture changes. Try again in an hour.',
          sign_in: 'Sign in again to change your picture.',
          unavailable: 'Picture checks are unavailable. Try again.',
          invalid_picture: 'Could not read this picture. Choose another.',
        };
        message = messages[result?.code] || message;
      }
      throw Error(message);
    }
    playerLooks.setAvatar(user, data.avatar_url);
    this.changed();
    return data;
  }
  async reportPlayer(target: string, reason: string, details: string, nonce: string) {
    const generation = this.#generation;
    if (!this.#user) throw Error('Sign in to report a player.');
    const { data, error } = await this.client.functions.invoke('polycup-report', {
      body: { target, reason, details, nonce },
      timeout: 45000,
    });
    if (generation !== this.#generation) throw Error('Your account changed. Try again.');
    if (error || data?.submitted !== true) {
      const response =
        error?.context instanceof Response ? await error.context.json().catch(() => null) : null;
      const allowed = [
        'Sign in to report a player.',
        'Report limit reached. Try again tomorrow.',
        'Player not found.',
        'Reporting is temporarily unavailable.',
      ];
      throw Error(
        allowed.includes(response?.error)
          ? response.error
          : 'Could not send report. Please try again.',
      );
    }
  }
  updateProfile(bio: string, accent: ProfileAccent, banner?: string | null) {
    return this.#rpc<void>('polycup_update_profile', {
      bio_value: bio,
      accent_value: accent,
      ...(banner !== undefined ? { banner_value: banner } : {}),
    });
  }
  thread(peer: string, before: string | null = null, after: string | null = null) {
    return this.#rpc<MessagePage>('polycup_dm_thread', {
      peer_key: peer,
      before_id: before,
      after_id: after,
    });
  }
  async send(peer: string, body: string, nonce: string, reply?: string) {
    if (!this.#user) throw Error('Sign in to send messages.');
    const text = body.trim();
    if (!text || Array.from(text).length > 1000)
      throw Error('Write a message of 1 to 1000 characters.');
    const message = await this.#rpc<DirectMessage>('polycup_send_dm', {
      peer_key: peer,
      message_text: text,
      nonce_key: nonce,
      ...(reply ? { reply_key: reply } : {}),
    });
    void this.refresh(true);
    return message;
  }
  async read(peer: string, through: string) {
    await this.#rpc('polycup_read_dm', { peer_key: peer, through_id: through });
    void this.refresh(true);
  }
  async block(peer: string, blocked: boolean) {
    await this.#rpc('polycup_block_player', { player_key: peer, blocked });
    this.blocksChanged();
    await this.refresh();
  }
  blocked() {
    return this.#rpc<Pick<PlayerProfile, 'player_id' | 'display_name' | 'avatar_url'>[]>(
      'polycup_blocked_players',
    );
  }
  updateBio(value: string) {
    return this.#rpc('polycup_update_bio', { value });
  }
}
