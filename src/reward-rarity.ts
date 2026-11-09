/** Curated presentation tiers. Rarity never changes unlock eligibility. */
export const rewardRarities = {
  common: { name: 'Common', color: '#c8d4e5' },
  uncommon: { name: 'Uncommon', color: '#85e0bc' },
  rare: { name: 'Rare', color: '#8ecbff' },
  epic: { name: 'Epic', color: '#c6adff' },
  legendary: { name: 'Legendary', color: '#ffd76b' },
} as const;
export type RewardRarity = keyof typeof rewardRarities;
export function rarityOrder(key?: string) {
  const index = Object.keys(rewardRarities).indexOf(key ?? 'common');
  return Math.max(0, index);
}
export function rewardRarity(key?: string) {
  return rewardRarities[key as RewardRarity] ?? rewardRarities.common;
}
