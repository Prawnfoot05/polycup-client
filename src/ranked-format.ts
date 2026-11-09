/** Missing placements are intentional for unaffected racers in interrupted Cups. */
export function positionNumber(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : '—';
}

export function placing(value: unknown): string {
  if (positionNumber(value) === '—') return '—';
  const place = value as number;
  const lastTwo = place % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th';
  return `${place}${suffix}`;
}

export function ratingNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

export function ratingChange(before: unknown, after: unknown): string {
  if (typeof after !== 'number' || !Number.isFinite(after)) return '—';
  if (before === null) return 'First rating';
  if (typeof before !== 'number' || !Number.isFinite(before)) return '—';
  const delta = after - before;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${ratingNumber(Math.abs(delta))}`;
}
