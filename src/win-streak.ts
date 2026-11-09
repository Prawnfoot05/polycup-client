import streakIcon from '../assets/streak.png';
import { element as h } from './dom.ts';
export const STREAK_START = 2;
/** Counts consecutive wins, with no offset; one win is progress, not a streak. */
export function streakLength(count: number | null | undefined) {
  const value = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 0;
  return value >= STREAK_START ? value : 0;
}
/** A small fixed-size flame, independent of emoji fonts/platform rendering. */
export function winStreak(count: number | null | undefined) {
  const badge = h('span', undefined, 'win-streak');
  const value = streakLength(count);
  badge.hidden = value === 0;
  badge.setAttribute('aria-label', `${value}-win streak`);
  badge.title = `${value} consecutive ranked wins`;
  const image = h('img');
  image.src = streakIcon;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  badge.append(image, h('span', String(value)));
  return badge;
}
export const winStreakCSS = `.win-streak{display:inline-flex;align-items:center;gap:6px;flex:none;color:#ff9b89;font:400 18px/1.2 ForcedSquare,Arial,sans-serif;white-space:nowrap}.win-streak[hidden]{display:none}.win-streak img{display:block;width:18px;height:22px;object-fit:contain;flex:none}.win-streak.is-earned{animation:streak-earned .55s ease-out}@keyframes streak-earned{0%{transform:scale(.85);opacity:.5}60%{transform:scale(1.13)}100%{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){.win-streak.is-earned{animation:none}}`;
