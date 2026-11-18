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
export interface HallOfFamePreview {
  captured_at: string;
  views: { label: string; finalized?: boolean; boards: HallOfFameData }[];
}

export class HallOfFame {
  #grid = h('div', undefined, 'hof-grid');
  #data?: HallOfFameData;
  #request?: Promise<void>;

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
    header.append(heading, button);
    pane.append(header, this.#grid);
  }

  open() {
    if (this.#request) return;
    if (!this.#data) this.#status('Loading Hall of Fame…');
    this.#request = this.#load().then(data => {
      this.#data = data;
      this.#render(data);
    }, () => {
      if (this.#data) return;
      this.#status('Could not load the Hall of Fame.');
      const retry = h('button', 'Retry');
      retry.type = 'button';
      retry.onclick = () => this.open();
      this.#grid.append(retry);
    }).finally(() => { this.#request = undefined; });
  }

  async #load() {
    if (window.location.hostname === 'pilot.polycup.online') {
      const preview = await this.api.hallOfFamePreview().catch(() => null);
      const archive = preview?.views.find(view => view.finalized === true);
      if (archive) return archive.boards;
    }
    return this.api.hallOfFame();
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
    const value = metric === 'average_finish' || metric === 'average_race_finish' ? entry.value.toFixed(2)
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
    for (const [metric, label] of categories) {
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
        list.append(h('p', metric === 'win_rate' ? 'Requires 20 rated matches.' : 'No records yet.', 'hof-status'));
      }
      board.append(list);
      this.#grid.append(board);
    }
  }
}
