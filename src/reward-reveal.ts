import { element as h } from './dom.ts';
import { cosmetic, cosmeticURL, stylePlayerTitle } from './cosmetics.ts';
import { rewardRarity } from './reward-rarity.ts';
import { bannerURL, bannerMetadata } from './banner.ts';
export interface RewardUnlock {
  id: string;
  kind: 'banner' | 'title' | 'frame' | 'achievement';
  name: string;
  variant?: string;
}
const seen = new Set<string>();
export class RewardReveal {
  #element = h('section', undefined, 'reward-reveal');
  get element() {
    return this.#element;
  }
  #key = '';
  #done?: () => void;
  constructor() {
    this.element.hidden = true;
  }
  show(key: string, rewards: RewardUnlock[], done: () => void) {
    rewards = rewards.filter((reward) => reward.kind !== 'frame' || !!cosmetic(reward.id, 'frame'));
    if (!rewards.length || seen.has(key)) return false;
    try {
      if (localStorage.getItem('polycup.reward-seen.' + key)) return false;
    } catch {
      /* private mode */
    }
    this.#key = key;
    this.#done = done;
    const title = h('h2', rewards.length === 1 ? 'Item unlocked' : 'Items unlocked'),
      grid = h('div', undefined, 'reward-reveal-grid'),
      close = h('button', '×', 'reward-reveal-close'),
      proceed = h('button', 'Continue', 'primary');
    title.id = 'reward-reveal-heading';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', title.id);
    close.setAttribute('aria-label', 'Skip unlock reveal');
    for (const reward of rewards) {
      const item = cosmetic(
        reward.id,
        reward.kind === 'banner' ? undefined : reward.kind,
        reward.variant,
      );
      const url = reward.kind === 'banner' ? bannerURL(reward.id) : cosmeticURL(item);
      const name =
        reward.kind === 'title' ? (item?.name ?? reward.name).toUpperCase() : reward.name;
      if (!url && reward.kind !== 'title') continue;
      const card = h('article', undefined, 'reward-reveal-card'),
        art = h('div', undefined, 'reward-reveal-art');
      const rarityKey = reward.kind === 'banner' ? bannerMetadata(reward.id)?.rarity : item?.rarity;
      const rarity = rewardRarity(rarityKey);
      card.dataset.rarity = rarityKey ?? 'common';
      card.style.setProperty('--reward-color', rarity.color);
      card.classList.toggle('is-banner', reward.kind === 'banner');
      if (url) {
        const image = h('img');
        image.src = url;
        image.alt = '';
        art.append(image);
      } else {
        const title = h('span', name, 'reward-reveal-title');
        stylePlayerTitle(title, item);
        art.append(title);
      }
      const kind =
        reward.kind === 'achievement'
          ? 'Achievement badge'
          : reward.kind === 'frame'
            ? 'Avatar frame'
            : reward.kind === 'banner'
              ? 'Profile banner'
              : 'Player title';
      const rarityLabel = h('p', rarity.name, 'reward-reveal-rarity');
      const details = h('p', kind, 'reward-reveal-kind');
      card.append(rarityLabel, art, details, h('h3', name));
      grid.append(card);
    }
    if (!grid.childElementCount) return false;
    close.onclick = proceed.onclick = () => this.acknowledge();
    this.element.replaceChildren(close, title, grid, proceed);
    this.element.hidden = false;
    proceed.focus();
    return true;
  }
  acknowledge() {
    seen.add(this.#key);
    try {
      localStorage.setItem('polycup.reward-seen.' + this.#key, '1');
    } catch {
      /* memory fallback */
    }
    this.hide();
  }
  hide() {
    this.element.hidden = true;
    this.#done?.();
    this.#done = undefined;
  }
}
