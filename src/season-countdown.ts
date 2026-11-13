import { element as h } from './dom.ts';

// 14 November 2026, 00:00 Europe/Bucharest (UTC+02:00).
export const SEASON_ZERO_END = Date.parse('2026-11-14T00:00:00+02:00');

export function seasonCountdown(now: number) {
  const seconds = Math.max(0, Math.ceil((SEASON_ZERO_END - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  return {
    ended: seconds === 0,
    text: [hours, Math.floor(seconds / 60) % 60, seconds % 60]
      .map((value) => String(value).padStart(2, '0')).join(':'),
  };
}

export class SeasonCountdown {
  readonly element = h('aside', undefined, 'hub-season-countdown');
  #value = h('span', undefined, 'hub-season-clock');
  #label = h('span', 'Season 0 ends in', 'hub-season-label');
  #timer?: ReturnType<typeof setInterval>;
  constructor() {
    const heading = h('div', undefined, 'hub-season-heading');
    heading.append(h('strong', 'Season 1'), this.#label);
    this.#value.setAttribute('role', 'timer');
    this.element.setAttribute('aria-label', 'Season 1 countdown');
    this.element.append(heading, this.#value);
    this.update();
  }
  update(now = Date.now()) {
    const state = seasonCountdown(now);
    this.#label.textContent = state.ended ? 'Season 0 has ended' : 'Season 0 ends in';
    this.#value.textContent = state.text;
    this.#value.hidden = state.ended;
  }
  start() {
    this.stop();
    this.update();
    this.#timer = setInterval(() => this.update(), 1000);
  }
  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
