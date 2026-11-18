import { element as h } from './dom.ts';
import type { Ranked } from './ranked.ts';

export function seasonTimeLeft(deadline: number, now: number) {
  if (!Number.isFinite(deadline) || deadline <= now) return '';
  const seconds = Math.ceil((deadline - now) / 1000);
  const days = Math.floor(seconds / 86400);
  if (days) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export class SeasonCountdown {
  #element = h('span', undefined, 'hub-season-countdown');
  #name = h('span', undefined, 'hub-season-name');
  #value = h('span', undefined, 'hub-season-clock');
  #deadline = NaN;
  #timer?: ReturnType<typeof setInterval>;
  #generation = 0;

  get element() { return this.#element; }

  constructor() {
    this.element.hidden = true;
    this.element.setAttribute('role', 'timer');
    this.element.append(this.#name, this.#value);
  }

  #update() {
    const time = seasonTimeLeft(this.#deadline, Date.now());
    this.element.hidden = !time;
    const text = time ? `${time} left` : '';
    if (this.#value.textContent !== text) this.#value.textContent = text;
  }

  start(api?: Pick<Ranked, 'seasons'>) {
    this.stop();
    if (!api) return;
    const generation = this.#generation;
    let nextRefresh = 0;
    const tick = () => {
      this.#update();
      if (Date.now() < nextRefresh) return;
      nextRefresh = Date.now() + 60_000;
      void api.seasons().then(seasons => {
        if (generation !== this.#generation) return;
        const active = seasons.find(season => season.active && !season.ends_at);
        this.#deadline = Date.parse(active?.scheduled_end_at ?? '');
        this.#name.textContent = active ? `${active.name}: ` : '';
        this.#update();
      }).catch(() => {});
    };
    tick();
    this.#timer = setInterval(tick, 1000);
  }

  stop() {
    ++this.#generation;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
