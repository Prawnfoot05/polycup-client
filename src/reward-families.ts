import type { CosmeticItem, EquippedCosmetics } from './cosmetics.ts';

/** Catalogue-driven: adding tiers needs no new picker branches or saved IDs. */
export function achievementFamilies(items: CosmeticItem[]) {
  const groups = new Map<string, CosmeticItem[]>();
  for (const item of items) {
    const key = `${item.family}:${item.metric}`;
    const family = groups.get(key) ?? [];
    family.push(item);
    groups.set(key, family);
  }
  return [...groups.values()].map((tiers) => tiers.sort((a, b) => a.target - b.target));
}

export function challengeName(item: CosmeticItem) {
  return item.family === 'Wins' ? 'Ranked wins' : item.family;
}

export function familyRepresentative(
  tiers: CosmeticItem[],
  equipped: EquippedCosmetics,
  isUnlocked: (id: string) => boolean,
) {
  return (
    [...tiers].reverse().find((item) => equipped.achievement_ids?.includes(item.id)) ??
    [...tiers].reverse().find((item) => isUnlocked(item.id)) ??
    tiers[0]
  );
}

/** The family's earned standing: its highest unlocked tier, if any. */
export function familyHighestUnlocked(tiers: CosmeticItem[], isUnlocked: (id: string) => boolean) {
  return [...tiers].reverse().find((item) => isUnlocked(item.id));
}

export function equipFamilyTier(ids: string[], tiers: CosmeticItem[], id: string) {
  const familyIds = new Set(tiers.map((item) => item.id));
  if (ids.includes(id)) return ids.filter((equipped) => !familyIds.has(equipped));
  const first = ids.findIndex((equipped) => familyIds.has(equipped));
  const result = ids.filter((equipped) => !familyIds.has(equipped));
  result.splice(first < 0 ? result.length : first, 0, id);
  return result;
}
