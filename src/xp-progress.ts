import { element as h } from './dom.ts';
/** Mirrors ranked-xp-v1: level 1 costs 500 XP, then 100 more per level. */
export function xpLevel(total: number) {
  const xp = Math.max(0, Math.floor(total));
  const level = Math.max(1, Math.floor((-7 + Math.sqrt(81 + 0.08 * xp)) / 2));
  return { level, current: xp - 50 * (level - 1) * (level + 8), needed: 400 + 100 * level };
}
export function resultXP(before: number, after: number) {
  const root = h('div', undefined, 'finish-xp-progress'),
    labels = h('div', undefined, 'finish-xp-labels'),
    level = h('span'),
    gain = h('span', `+${after - before} XP`, 'finish-xp'),
    amount = h('span', undefined, 'finish-xp-amount'),
    track = h('div', undefined, 'finish-xp-track'),
    fill = h('span'),
    initialLevel = xpLevel(before).level;
  root.setAttribute('aria-label', 'Level progress');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Experience to next level');
  track.setAttribute('aria-valuemin', '0');
  labels.append(level, gain, amount);
  track.append(fill);
  root.append(labels, track);
  function update(total: number) {
    const state = xpLevel(total);
    level.textContent = `Level ${state.level}`;
    root.classList.toggle('is-level-up', state.level > initialLevel);
    gain.textContent = `${state.level > initialLevel ? 'Level up · ' : ''}+${after - before} XP`;
    amount.textContent = `${state.current.toLocaleString('en-US')} / ${state.needed.toLocaleString('en-US')} XP`;
    track.setAttribute('aria-valuemax', String(state.needed));
    track.setAttribute('aria-valuenow', String(state.current));
    track.setAttribute(
      'aria-valuetext',
      `Level ${state.level}, ${state.current} of ${state.needed} XP`,
    );
    fill.style.width = `${(100 * state.current) / state.needed}%`;
  }
  update(before);
  return { element: root, update };
}
