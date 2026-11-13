import { clientAsset } from './client-assets.ts';
import { rewardRarity, type RewardRarity } from './reward-rarity.ts';
import source from './cosmetic-catalog.json';
import { element as h } from './dom.ts';
import emptyAchievement from '../assets/cosmetics/achievements/empty.png';
export type CosmeticKind = 'title' | 'frame' | 'achievement';
export interface CosmeticItem {
  id: string;
  kind: CosmeticKind;
  name: string;
  family: string;
  metric: string;
  target: number;
  color: string;
  rarity: RewardRarity;
  art: string | null;
  enabled: boolean;
  variants?: { key: string; name: string; art: string; rarity: RewardRarity; color: string }[];
}
export interface EquippedCosmetics {
  title_id?: string | null;
  frame_id?: string | null;
  achievement_ids?: string[];
  achievement_variants?: Record<string, string>;
  achievement_positions?: Record<string, number>;
}
export interface PlayerLooks extends EquippedCosmetics {
  player_id: string;
  banner_id?: string | null;
  avatar_url?: string;
  /** Public level from the batched appearance lookup; absent on older backends. */
  level?: number | null;
  global_position?: number | null;
}
export interface CosmeticCollection extends EquippedCosmetics {
  global_position?: number | null;
  items: {
    id: string;
    unlocked: boolean;
    progress: number;
    target: number;
    variant?: string | null;
  }[];
}
export const cosmeticCatalog = source as CosmeticItem[];
/** One title treatment across equipped labels, collection previews and unlocks. */
export function titleName(item: CosmeticItem, position?: number | null) {
  return item.id === 'global-rank'
    ? `RANK #${validGlobalPosition(position) ? position : '—'}`
    : item.name;
}
export function validGlobalPosition(position?: number | null): position is number {
  return typeof position === 'number' && Number.isSafeInteger(position) && position > 0;
}
export function stylePlayerTitle(node: HTMLElement, item?: CosmeticItem, position?: number | null) {
  node.style.textTransform = 'uppercase';
  const podium = item?.id === 'global-rank' && validGlobalPosition(position) && position <= 3;
  const epic = item?.id !== 'global-rank' && item?.rarity === 'epic';
  const legendary = item?.id !== 'global-rank' && item?.rarity === 'legendary';
  // Fitted text stays inside its slot; glows can extend past the glyph box.
  node.style.overflow = podium || epic || legendary ? 'visible' : '';
  node.style.color = legendary ? '#ffb369' : epic ? '#c6adff' : '#ffffff';
  node.style.textShadow = podium
    ? '0 0 5px #ffffffcc, 0 0 12px #dcecff99, 0 0 22px #c4dcff55'
    : legendary
      ? '0 0 7px #ff8b35b3, 0 0 16px #ff7a3873'
      : epic
        ? '0 0 7px #a779e666'
        : 'none';
}
export function cosmetic(
  id: string | null | undefined,
  kind?: CosmeticKind,
  variant?: string | null,
) {
  const item = cosmeticCatalog.find(
    (item) => item.id === id && item.enabled && (!kind || item.kind === kind),
  );
  const appearance = item?.variants?.find((v) => v.key === variant);
  return item && appearance
    ? { ...item, ...appearance, name: `${item.name} ${appearance.name}` }
    : item;
}
export function cosmeticURL(item?: CosmeticItem) {
  return item?.art
    ? clientAsset('cosmetics/' + item.art, import.meta.url || document.baseURI)
    : '';
}
export function cosmeticBadge(id: string, variant?: string | null, seasonPosition?: number) {
  const item = cosmetic(id, 'achievement', variant);
  if (!item) return null;
  const badge = h('span', undefined, 'player-achievement');
  const image = h('img');
  image.src = cosmeticURL(item);
  image.alt = item.name;
  badge.title = `${item.name} · ${rewardRarity(item.rarity).name} · ${requirement(item)}`;
  badge.tabIndex = 0;
  badge.setAttribute('aria-label', badge.title);
  badge.append(image);
  if (/^season\d+_rank$/.test(item.metric) && validGlobalPosition(seasonPosition)) {
    const detail = h('span', undefined, 'season-badge-detail');
    detail.setAttribute('popover', 'manual');
    detail.setAttribute('role', 'tooltip');
    const art = h('img');
    art.src = image.src;
    art.alt = '';
    const labels = h('span', undefined, 'season-badge-labels');
    labels.append(h('strong', item.name), h('span', rewardRarity(item.rarity).name, 'season-badge-rarity'));
    detail.append(art, labels, h('strong', `#${seasonPosition}`, 'season-badge-position'));
    badge.append(detail);
    badge.removeAttribute('title');
    badge.setAttribute('aria-label', `${item.name} · ${rewardRarity(item.rarity).name} · #${seasonPosition}`);
    const hide = () => { if (detail.matches(':popover-open')) detail.hidePopover(); };
    const show = () => {
      if (!badge.isConnected || detail.matches(':popover-open')) return;
      detail.showPopover();
      const a = badge.getBoundingClientRect(), b = detail.getBoundingClientRect();
      detail.style.left = Math.max(8, Math.min(a.left, innerWidth - b.width - 8)) + 'px';
      detail.style.top = Math.max(8, a.top >= b.height + 12 ? a.top - b.height - 8 : Math.min(a.bottom + 8, innerHeight - b.height - 8)) + 'px';
    };
    badge.onpointerenter = show;
    badge.onpointerleave = hide;
    badge.onfocus = show;
    badge.onblur = hide;
  }
  return badge;
}
/** Three stable slots, including the supplied artwork for unequipped medals. */
export function playerAchievements() {
  const slots = h('span', undefined, 'player-achievements');
  slots.dataset.playerAchievements = '';
  slots.setAttribute('aria-label', 'Equipped achievements');
  paintPlayerAchievements(slots);
  return slots;
}
export function paintPlayerAchievements(slots: HTMLElement, looks: EquippedCosmetics = {}) {
  const ids = looks.achievement_ids ?? [];
  const signature = JSON.stringify(
    ids.slice(0, 3).map((id) => [id, looks.achievement_variants?.[id], looks.achievement_positions?.[id]]),
  );
  if (slots.dataset.achievementSelection === signature) return;
  slots.dataset.achievementSelection = signature;
  slots.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const badge = ids[i] ? cosmeticBadge(ids[i], looks.achievement_variants?.[ids[i]], looks.achievement_positions?.[ids[i]]) : null;
    if (badge) {
      // Player labels also occur inside profile buttons; avoid nested tab stops.
      if (slots.closest('button,a')) badge.removeAttribute('tabindex');
      slots.append(badge);
    } else {
      const empty = h('span', undefined, 'achievement-empty');
      const image = h('img');
      image.src = emptyAchievement;
      image.alt = '';
      empty.setAttribute('aria-hidden', 'true');
      empty.append(image);
      slots.append(empty);
    }
  }
}
export function requirement(item: CosmeticItem) {
  const rankReward = /^season(\d+)_rank$/.exec(item.metric);
  if (rankReward) return `Awarded at the end of Season ${rankReward[1]}`;
  const season = /^season(\d+)_(bronze|silver|gold|platinum|diamond|master|grandmaster)$/.exec(
    item.metric,
  );
  if (season)
    return `End Season ${season[1]} as ${season[2][0].toUpperCase() + season[2].slice(1)}`;
  const nouns: Record<string, string> = {
    wins: 'ranked wins',
    finishes: 'ranked finishes',
    fullspeed_wins: 'Fullspeed wins',
    tech_wins: 'Tech wins',
    best_streak: 'consecutive ranked wins',
    streak_breaks: 'ranked wins ending an opponent’s streak of 2+ consecutive wins (no departures)',
    pb_improvements: 'ranked personal-best improvements (first times excluded)',
    distinct_tracks: 'different ranked tracks completed',
  };
  if (item.metric === 'ranked_placement') return 'Current global rank · Complete placements';
  return item.metric === 'open'
    ? 'Available to everyone'
    : item.metric === 'level'
      ? `Level ${item.target}`
      : `${item.target} ${nouns[item.metric] ?? item.metric}`;
}

/** Short, persistent eligibility labels for the collection; never hover-only. */
export function rewardCondition(item: Pick<CosmeticItem, 'metric'>) {
  const labels: Record<string, { label: string; note?: string }> = {
    open: { label: 'Available' },
    ranked_placement: { label: 'Complete placements', note: 'Live global rank · Top 3 glow' },
    level: { label: 'Player level' },
    wins: { label: 'Ranked wins' },
    finishes: { label: 'Ranked finishes' },
    fullspeed_wins: { label: 'Ranked Fullspeed wins' },
    tech_wins: { label: 'Ranked Tech wins' },
    best_streak: { label: 'Consecutive ranked wins' },
    streak_breaks: { label: 'Beat a 2+ win streak', note: 'Ranked · No departures' },
    pb_improvements: { label: 'Ranked PB improvements', note: 'First times excluded' },
    distinct_tracks: { label: 'Ranked tracks finished' },
  };
  return (
    labels[item.metric] ?? {
      label: item.metric.startsWith('season') ? 'Season-end rank' : item.metric,
    }
  );
}

export function playerName(name: string) {
  const label = h('span', undefined, 'player-label player-account-label');
  const title = h('span', undefined, 'player-title');
  title.dataset.playerTitle = '';
  title.hidden = true;
  label.append(h('span', name), title, playerAchievements());
  return label;
}
