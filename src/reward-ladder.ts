import { element as h } from './dom.ts';
import { cosmeticCatalog } from './cosmetics.ts';
import { rewardRarity } from './reward-rarity.ts';

/** Reward tiers for one progression metric, read from the catalogue so new tiers need no UI change. */
export function ladderTiers(metric: string) {
  const tiers = new Map<number, string>();
  for (const item of cosmeticCatalog)
    if (item.enabled && item.kind === 'title' && item.metric === metric)
      tiers.set(item.target, item.rarity);
  return [...tiers].sort((a, b) => a[0] - b[0]);
}

/**
 * A stat shown as the ladder it climbs: reached tiers take their rarity colour,
 * the next tier is outlined, later ones stay muted.
 */
export function rewardLadder(label: string, value: number, metric: string, showValue = true) {
  const row = h('div', undefined, 'profile-ladder');
  row.append(h('dt', label), h('dd', showValue ? value.toLocaleString() : ''));
  const tiers = ladderTiers(metric);
  if (!tiers.length) return row;
  const steps = h('ol', undefined, 'profile-ladder-steps');
  const next = tiers.find(([target]) => value < target)?.[0];
  steps.setAttribute(
    'aria-label',
    next === undefined ? `${label}: every tier reached` : `${label}: next tier at ${next}`,
  );
  for (const [target, rarity] of tiers) {
    const step = h('li');
    step.append(h('span', target.toLocaleString()));
    step.dataset.state = value >= target ? 'reached' : target === next ? 'next' : 'ahead';
    step.style.setProperty('--reward-rarity', rewardRarity(rarity).color);
    steps.append(step);
  }
  const ladder = h('dd', undefined, 'profile-ladder-track');
  ladder.append(steps);
  row.append(ladder);
  return row;
}
