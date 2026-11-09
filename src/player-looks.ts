import type { SupabaseClient } from '@supabase/supabase-js';
import { bannerURL } from './banner.ts';
import {
  cosmetic,
  paintPlayerAchievements,
  stylePlayerTitle,
  titleName,
  validGlobalPosition,
  type PlayerLooks,
} from './cosmetics.ts';
import css from './player-looks.css';
import { fitPlayerTitle, prunePlayerTitles } from './fit-player-title.ts';
import { avatarURL } from './avatar-url.ts';
import type { PlayerProgression } from './banner.ts';
import { isAccountId } from './account-id.ts';
export const playerLooksCSS = css;
/** An opt-in plate slot; painted with a level chip once the public level is known. */
export function levelSlot() {
  const slot = document.createElement('span');
  slot.className = 'player-level';
  slot.dataset.playerLevel = '';
  slot.hidden = true;
  return slot;
}
/** One level mark for every identity plate: the number inside the shared angular cut. */
export function levelChip(level: number) {
  const chip = document.createElement('span');
  chip.className = 'level-chip';
  const hidden = document.createElement('span');
  hidden.className = 'pc-sr-only';
  hidden.textContent = 'Level ';
  chip.append(hidden, String(level));
  return chip;
}
// Public appearance only. One batched lookup per group, never one request per row.
// The bounded cache is scoped to the configured client and cleared on account change.
class PlayerLooksStore {
  #client?: SupabaseClient;
  #generation = 0;
  #rankRefresh?: ReturnType<typeof setInterval>;
  #cache = new Map<string, { value: PlayerLooks; at: number }>();
  #nodes = new Map<string, Set<WeakRef<HTMLElement>>>();
  #owners = new WeakMap<HTMLElement, string>();
  #pending = new Set<string>();
  #inflight = new Set<string>();
  #retryAfter = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #progression = new Map<string, { value: PlayerProgression; at: number }>();
  #progressionJobs = new Set<string>();
  #progressionRetry = new Map<string, number>();
  configure(client: SupabaseClient) {
    if (this.#client !== client || !this.#rankRefresh) {
      this.clear();
      this.#client = client;
    }
    this.#watchRanks();
  }
  #watchRanks() {
    if (this.#rankRefresh || !this.#client) return;
    // Reuse the batched appearance endpoint. Only visible equipped rank titles
    // need refreshing when another player changes the standings.
    this.#rankRefresh = setInterval(() => {
      prunePlayerTitles();
      if (document.hidden) return;
      for (const [id, nodes] of this.#nodes) {
        for (const ref of nodes) if (!ref.deref()?.isConnected) nodes.delete(ref);
        if (!nodes.size) {
          this.#nodes.delete(id);
          continue;
        }
        if (![...nodes].some((ref) => ref.deref()?.getClientRects().length)) continue;
        if (this.#cache.get(id)?.value.title_id === 'global-rank' && !this.#inflight.has(id))
          this.#pending.add(id);
      }
      if (this.#pending.size && Date.now() >= this.#retryAfter)
        this.#timer ??= setTimeout(() => void this.#flush(), 80);
    }, 60000);
  }

  clear() {
    ++this.#generation;
    clearInterval(this.#rankRefresh);
    this.#rankRefresh = undefined;
    prunePlayerTitles();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#cache.clear();
    this.#pending.clear();
    this.#inflight.clear();
    this.#retryAfter = 0;
    this.#progression.clear();
    this.#progressionJobs.clear();
    this.#progressionRetry.clear();
    for (const [id, nodes] of this.#nodes)
      for (const ref of nodes) {
        const node = ref.deref();
        if (node) this.#paint(node, { player_id: id });
      }
    this.#nodes.clear();
    this.#owners = new WeakMap();
  }
  set(value: PlayerLooks) {
    // Profile and save writes carry no level; keep the last public level rather than blank the chip.
    const previous = this.#cache.get(value.player_id)?.value;
    if (value.level === undefined && previous?.level !== undefined)
      value = { ...value, level: previous.level };
    if (value.global_position === undefined && previous?.global_position !== undefined)
      value = { ...value, global_position: previous.global_position };
    if (value.avatar_url === undefined && previous?.avatar_url !== undefined)
      value = { ...value, avatar_url: previous.avatar_url };
    this.#cache.delete(value.player_id);
    this.#cache.set(value.player_id, { value, at: Date.now() });
    if (this.#cache.size > 500) this.#cache.delete(this.#cache.keys().next().value!);
    const nodes = this.#nodes.get(value.player_id);
    if (nodes)
      for (const ref of nodes) {
        const node = ref.deref();
        if (!node || !node.isConnected) nodes.delete(ref);
        else this.#paint(node, value);
      }
  }
  setAvatar(id: string, url: string) {
    this.set({ ...this.#cache.get(id)?.value, player_id: id, avatar_url: url });
  }
  undecorate(node: HTMLElement) {
    const owner = this.#owners.get(node),
      nodes = owner ? this.#nodes.get(owner) : undefined;
    if (nodes) {
      for (const ref of nodes) if (!ref.deref() || ref.deref() === node) nodes.delete(ref);
      if (!nodes.size) this.#nodes.delete(owner!);
    }
    this.#owners.delete(node);
    this.#paint(node, { player_id: owner ?? '' });
    node.classList.remove('player-look');
  }
  decorate(node: HTMLElement, id?: string | null) {
    if (!isAccountId(id)) {
      if (this.#owners.has(node)) this.undecorate(node);
      return node;
    }
    this.#watchRanks();
    const previous = this.#owners.get(node);
    if (previous && previous !== id) this.undecorate(node);
    this.#owners.set(node, id);
    node.classList.add('player-look');
    const old = this.#cache.get(id);
    if (old) this.#paint(node, old.value);
    let nodes = this.#nodes.get(id);
    if (!nodes) this.#nodes.set(id, (nodes = new Set()));
    let registered = false;
    for (const ref of nodes) {
      const current = ref.deref();
      if (!current) nodes.delete(ref);
      else if (current === node) registered = true;
    }
    if (!registered) nodes.add(new WeakRef(node));
    if (node.querySelector('[data-player-xp]')) {
      this.#paintProgression(node, this.#progression.get(id)?.value);
      void this.refreshProgression(id);
    }
    // Avoid caching invisible chat continuation rows or mass fetching history not on screen.
    if (
      this.#client &&
      !this.#inflight.has(id) &&
      Date.now() >= this.#retryAfter &&
      (!old || Date.now() - old.at > 60000)
    ) {
      this.#pending.add(id);
      this.#timer ??= setTimeout(() => void this.#flush(), 80);
    }
    return node;
  }
  setProgression(id: string, value: PlayerProgression) {
    this.#progression.set(id, { value, at: Date.now() });
    if (this.#progression.size > 50)
      this.#progression.delete(this.#progression.keys().next().value!);
    for (const ref of this.#nodes.get(id) ?? []) {
      const node = ref.deref();
      if (node?.isConnected) this.#paintProgression(node, value);
    }
  }
  async refreshProgression(id: string, force = false) {
    if (!isAccountId(id)) return;
    const client = this.#client,
      generation = this.#generation;
    const old = this.#progression.get(id);
    if (
      !client ||
      this.#progressionJobs.has(id) ||
      Date.now() < (this.#progressionRetry.get(id) ?? 0) ||
      (!force && old && Date.now() - old.at < 60000)
    )
      return;
    this.#progressionJobs.add(id);
    try {
      const { data, error } = await client
        .rpc('polycup_player_progression', { player_key: id })
        .abortSignal(AbortSignal.timeout(8000));
      if (generation !== this.#generation) return;
      if (error || !data) throw Error('Progression unavailable');
      // A profile fetched while this request ran has the newer progression snapshot.
      if (this.#progression.get(id) === old) this.setProgression(id, data as PlayerProgression);
    } catch {
      if (generation === this.#generation) this.#progressionRetry.set(id, Date.now() + 10000);
    } finally {
      if (generation === this.#generation) this.#progressionJobs.delete(id);
    }
  }
  #paintProgression(node: HTMLElement, value?: PlayerProgression) {
    const slot = node.querySelector<HTMLElement>('[data-player-xp]');
    if (!slot) return;
    slot.replaceChildren();
    slot.hidden = !value;
    if (!value) return;
    const label = levelChip(value.level);
    const bar = document.createElement('progress');
    bar.max = Math.max(1, value.next_level_xp);
    bar.value = Math.max(0, value.level_xp);
    const detail = `${value.level_xp.toLocaleString()} / ${value.next_level_xp.toLocaleString()} XP`;
    bar.setAttribute('aria-label', `Level ${value.level}: ${detail}`);
    slot.title = detail;
    slot.tabIndex = 0;
    slot.setAttribute('aria-label', `Level ${value.level}: ${detail}`);
    slot.append(label, bar);
  }
  async #flush() {
    this.#timer = undefined;
    const client = this.#client;
    if (!client) return;
    const ids = [...this.#pending].slice(0, 100);
    ids.forEach((id) => this.#pending.delete(id));
    const generation = this.#generation;
    const snapshots = new Map(ids.map((id) => [id, this.#cache.get(id)]));
    ids.forEach((id) => this.#inflight.add(id));
    try {
      const { data, error } = await client
        .rpc('polycup_player_looks', { player_keys: ids })
        .abortSignal(AbortSignal.timeout(8000));
      if (generation !== this.#generation) return;
      // Cosmetic failure must never delay or block navigation or match admission.
      if (!error)
        for (const id of ids) {
          if (this.#cache.get(id) === snapshots.get(id))
            this.set(
              (data as PlayerLooks[] | null)?.find((row) => row.player_id === id) ?? {
                player_id: id,
              },
            );
        }
      if (error) this.#retryAfter = Date.now() + 10000;
    } catch {
      if (generation === this.#generation) this.#retryAfter = Date.now() + 10000;
    }
    if (generation !== this.#generation) return;
    ids.forEach((id) => this.#inflight.delete(id));
    if (this.#pending.size) this.#timer ??= setTimeout(() => void this.#flush(), 80);
    for (const [id, nodes] of this.#nodes) {
      for (const ref of nodes) if (!ref.deref()?.isConnected) nodes.delete(ref);
      if (!nodes.size) this.#nodes.delete(id);
    }
  }
  preview(node: HTMLElement, value: PlayerLooks) {
    this.#paint(node, { ...this.#cache.get(value.player_id)?.value, ...value });
  }
  #paint(node: HTMLElement, value: PlayerLooks) {
    this.#paintProgression(node, this.#progression.get(value.player_id)?.value);
    const banner = bannerURL(value.banner_id);
    node.classList.toggle('has-player-banner', !!banner && node.dataset.playerBanner !== 'off');
    node.style.setProperty('--player-banner', banner ? `url("${banner}")` : 'none');
    for (const portrait of node.querySelectorAll<HTMLElement>(
      '.player-portrait,.friend-avatar,.account-avatar',
    )) {
      if (value.avatar_url !== undefined) {
        const url = avatarURL(value.avatar_url);
        let image = portrait.querySelector<HTMLImageElement>(':scope > img');
        if (!url) image?.remove();
        else if (image?.src !== url) {
          if (!image) {
            image = document.createElement('img');
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            portrait.append(image);
          }
          image.src = url;
          image.onerror = () => image?.remove();
        }
      }
    }
    const title = cosmetic(value.title_id, 'title');
    const slot = node.querySelector<HTMLElement>('[data-player-title]');
    if (slot) {
      slot.textContent = title ? titleName(title, value.global_position) : '';
      slot.hidden =
        !title || (title.id === 'global-rank' && !validGlobalPosition(value.global_position));
      stylePlayerTitle(slot, title, value.global_position);
      fitPlayerTitle(slot);
    }
    for (const medals of node.querySelectorAll<HTMLElement>('[data-player-achievements]'))
      paintPlayerAchievements(medals, value);
    for (const slot of node.querySelectorAll<HTMLElement>('[data-player-level]')) {
      const level = typeof value.level === 'number' ? value.level : null;
      slot.hidden = level === null;
      slot.replaceChildren(...(level === null ? [] : [levelChip(level)]));
    }
  }
}
export const playerLooks = new PlayerLooksStore();
