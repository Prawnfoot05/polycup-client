import { clickableRow } from './clickable-row.ts';
import { element as h } from './dom.ts';
import { profilePicture } from './profile-picture.ts';
import type { Ranked } from './ranked.ts';

const categories = [
  ['average_finish', 'Avg. season finish'],
  ['titles', 'Season champions'],
  ['grandmaster_seasons', 'Grandmaster seasons'],
  ['average_race_finish', 'Avg. race finish'],
  ['wins', 'Ranked wins'],
  ['win_rate', 'Win rate'],
  ['best_streak', 'Longest win streak'],
  ['peak_rating', 'Peak rating'],
  ['track_firsts', 'Season track #1s'],
] as const;
type Metric = typeof categories[number][0];
interface Entry {
  player_id?: string;
  display_name: string;
  avatar_url: string | null;
  position: number;
  value: number;
  seasons: number | null;
  champion_seasons: string[] | null;
}
export type HallOfFameData = Partial<Record<Metric, Entry[]>>;
export class HallOfFame {
  #grid = h('div', undefined, 'hof-grid');
  #season = h('select', undefined, 'hof-season');
  #seasons: Awaited<ReturnType<Ranked['seasons']>> = [];
  #data?: HallOfFameData;
  #scope = '';
  #generation = 0;
  #timer?: ReturnType<typeof setInterval>;
  #refreshing = false;
  #active = false;

  constructor(
    pane: HTMLElement,
    private api: Ranked,
    private profile: (id: string) => void,
    back: () => void,
  ) {
    const header = h('header', undefined, 'hof-header');
    const heading = h('h2', 'Hall of Fame');
    heading.tabIndex = -1;
    const button = h('button', 'Back', 'hof-back');
    button.type = 'button';
    button.setAttribute('aria-label', 'Back to Player Leaderboard');
    button.onclick = back;
    this.#season.setAttribute('aria-label', 'Hall of Fame season');
    this.#season.append(new Option('Overall', ''));
    this.#season.onchange = () => {
      this.#scope = this.#season.value;
      this.#data = undefined;
      this.#grid.scrollTop = 0;
      void this.#load(true);
    };
    const actions = h('div', undefined, 'hof-header-actions');
    actions.append(this.#season, button);
    header.append(heading, actions);
    pane.append(header, this.#grid);
  }

  open() {
    if (this.#timer !== undefined) return;
    void this.#load(!this.#data);
    this.#timer = setInterval(() => {
      if (!document.hidden && !this.#refreshing && (!this.#scope || this.#active))
        void this.#load(false);
    }, 30_000);
  }

  close() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    ++this.#generation;
    this.#refreshing = false;
  }

  async #load(showLoading: boolean) {
    const generation = ++this.#generation;
    const scope = this.#scope;
    this.#refreshing = true;
    if (showLoading) this.#status('Loading Hall of Fame…');
    try {
      const [seasons, data] = await Promise.all([
        this.api.seasons(),
        this.api.hallOfFameView(scope || null),
      ]);
      if (generation !== this.#generation) return;
      const active = seasons.some(season => season.id === scope && season.active && !season.ends_at);
      if (JSON.stringify(this.#seasons) !== JSON.stringify(seasons)) {
        this.#seasons = seasons;
        this.#season.replaceChildren(new Option('Overall', ''), ...seasons.map(season =>
          new Option(season.active && !season.ends_at ? `${season.name} · Live` : season.name, season.id)));
        this.#season.value = scope;
      }
      if (active !== this.#active || JSON.stringify(this.#data) !== JSON.stringify(data)) {
        this.#active = active;
        this.#data = data;
        this.#render(data);
      }
    } catch {
      if (generation !== this.#generation || this.#data) return;
      this.#status('Could not load the Hall of Fame.');
      const retry = h('button', 'Retry');
      retry.type = 'button';
      retry.onclick = () => void this.#load(true);
      this.#grid.append(retry);
    } finally {
      if (generation === this.#generation) this.#refreshing = false;
    }
  }

  #status(message: string) {
    const status = h('p', message, 'hof-status');
    status.setAttribute('role', 'status');
    this.#grid.replaceChildren(status);
  }

  #row(entry: Entry, metric: Metric, pinned: boolean) {
    const row = h('div', undefined, pinned ? 'hof-row hof-first' : 'hof-row');
    const playerId = entry.player_id;
    const action = playerId ? h('button', undefined, 'hof-racer player-with-portrait')
      : h('span', undefined, 'hof-racer player-with-portrait');
    const name = h('span', undefined, 'hof-identity');
    name.append(h('span', entry.display_name, 'hof-name'));
    const detail = entry.champion_seasons?.map(season => season.replace(/^Season\s+(\d+)$/i, 'S$1')).join(', ') ??
      (entry.seasons ? `${entry.seasons} ${entry.seasons === 1 ? 'season' : 'seasons'}` : '');
    if (detail) name.append(h('small', detail, 'hof-detail'));
    action.append(profilePicture(entry.display_name, entry.avatar_url), name);
    const value = metric === 'average_finish' && this.#scope ? `#${entry.value.toLocaleString()}`
      : metric === 'average_finish' || metric === 'average_race_finish' ? entry.value.toFixed(2)
      : metric === 'win_rate' ? `${entry.value.toFixed(1)}%`
      : entry.value.toLocaleString();
    row.append(h('span', `#${entry.position}`, 'hof-position'), action, h('span', value, 'hof-value'));
    if (action instanceof HTMLButtonElement && playerId) {
      action.type = 'button';
      action.onclick = () => this.profile(playerId);
      clickableRow(row, action);
    }
    return row;
  }

  #render(data: HallOfFameData) {
    this.#grid.replaceChildren();
    for (const [metric, defaultLabel] of categories) {
      const label = this.#scope && metric === 'average_finish'
        ? this.#active ? 'Current season rank' : 'Final season rank'
        : this.#scope && metric === 'grandmaster_seasons'
          ? this.#active ? 'Current Grandmasters' : 'Grandmasters'
          : defaultLabel;
      const board = h('section', undefined, 'hof-board');
      const heading = h('h3', label);
      heading.id = `hof-${metric}`;
      if (metric === 'win_rate') heading.append(h('small', '20+ matches', 'hof-qualifier'));
      board.setAttribute('aria-labelledby', heading.id);
      board.append(heading);
      const [first, ...others] = data[metric] ?? [];
      if (first) board.append(this.#row(first, metric, true));
      const list = h('div', undefined, 'hof-runners-up');
      if (others.length) {
        list.setAttribute('role', 'region');
        list.setAttribute('aria-label', `${label} additional places`);
        list.tabIndex = 0;
        list.append(...others.map(entry => this.#row(entry, metric, false)));
      } else if (!first) {
        const empty = metric === 'win_rate' ? 'Requires 20 rated matches.'
          : metric === 'titles' && this.#active ? 'Awarded at season end.' : 'No records yet.';
        list.append(h('p', empty, 'hof-status'));
      }
      board.append(list);
      this.#grid.append(board);
    }
  }
}
