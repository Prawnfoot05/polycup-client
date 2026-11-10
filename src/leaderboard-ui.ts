import { TrackRecordsUI } from './track-records-ui.ts';
import type { LibraryTrack } from './game-types.ts';
import { installErrorDismissal } from './dismissible-errors.ts';
import { playerLooks } from './player-looks.ts';
import { element as h } from './dom.ts';
import type { Ranked, StandingEntry, LeaderboardSort } from './ranked.ts';
import { rankBadge } from './rank-badge.ts';
import css from './leaderboard.css';
import rankCSS from './ranked-queue.css';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
import { positionNumber } from './ranked-format.ts';
type Tab = 'global' | 'friends';
type Entry = StandingEntry;
const PAGE = 25;
export class LeaderboardUI {
  #dialog = h('dialog', undefined, 'cup-leaderboard polycup-surface');
  #body = h('div', undefined, 'leaderboard-body');
  #footer = h('footer');
  #tabs = h('nav', undefined, 'leaderboard-tabs');
  #tab: Tab = 'global';
  #mode: 'players' | 'tracks' = 'players';
  #types = h('nav', undefined, 'leaderboard-types');
  #tracks: TrackRecordsUI;
  #page = 0;
  #sort: LeaderboardSort = 'rating';
  #direction: 'asc' | 'desc' = 'desc';
  #focusSort: LeaderboardSort | null = null;
  #generation = 0;
  #cache = new Map<string, { at: number; rows: Entry[] }>();
  #season = h('select');
  #seasonKey = '';
  #seasonsLoaded = false;
  #embedded = false;
  #displayed?: {
    user: string | null;
    tab: Tab;
    page: number;
    sort: LeaderboardSort;
    direction: 'asc' | 'desc';
    season: string;
  };
  #feedback = h('div', undefined, 'leaderboard-feedback');
  mount(container: HTMLElement) {
    this.close();
    if (this.#embedded) {
      container.append(this.#dialog);
      return;
    }
    this.#embedded = true;
    this.#dialog.classList.add('hub-embedded-view');
    this.#dialog.setAttribute('role', 'region');
    this.#dialog.querySelector<HTMLButtonElement>('header button')!.hidden = true;
    this.#dialog.querySelector('header')!.hidden = true;
    const controls = h('div', undefined, 'leaderboard-toolbar');
    this.#tabs.before(controls);
    this.#types.hidden = true;
    controls.append(this.#tabs, this.#tracks.recordLeadersControl, this.#tracks.searchControl, this.#season);
    container.append(this.#dialog);
  }
  close() {
    ++this.#generation;
    this.#tracks.stop();
    this.#dialog.close();
  }
  constructor(
    shadow: ShadowRoot,
    private api: Ranked,
    private user: () => string | null,
    private history: (id: string, name: string) => void,
    private profile?: (id: string) => void,
    artwork?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[],
  ) {
    this.#tracks = new TrackRecordsUI(api, user, profile, artwork, () => void this.#load());
    this.#types.setAttribute('aria-label', 'Leaderboard type');
    for (const [key, label] of [
      ['players', 'Players'],
      ['tracks', 'Tracks'],
    ] as const) {
      const b = this.#button(label, () => {
        this.#mode = key;
        void this.#load();
      });
      b.dataset.mode = key;
      b.setAttribute('aria-pressed', String(key === 'players'));
      this.#types.append(b);
    }
    const header = h('header');
    header.append(
      h('h2', 'Leaderboards'),
      this.#button('×', () => this.#dialog.close(), 'Close leaderboards'),
    );
    this.#dialog.setAttribute('aria-label', 'Leaderboards');
    installErrorDismissal(shadow);
    this.#season.setAttribute('aria-label', 'Ranked season');
    this.#season.hidden = true;
    this.#season.onchange = () => {
      this.#seasonKey = this.#season.value;
      this.#page = 0;
      void this.#load();
    };
    header.insertBefore(this.#season, header.lastChild);
    this.#tabs.setAttribute('role', 'tablist');
    this.#tabs.setAttribute('aria-label', 'Leaderboard scope');
    this.#body.setAttribute('role', 'tabpanel');
    this.#body.setAttribute('tabindex', '0');
    this.#body.id = 'polycup-leaderboard-panel';
    this.#feedback.hidden = true;
    this.#feedback.setAttribute('role', 'status');
    this.#dialog.append(
      header,
      this.#types,
      this.#tabs,
      this.#tracks.recordLeadersControl,
      this.#tracks.searchControl,
      h('p', 'Swipe for more stats', 'leaderboard-scroll-hint'),
      this.#body,
      this.#feedback,
      this.#footer,
      this.#tracks.element,
    );
    shadow.append(h('style', rankCSS + css + profilePictureCSS), this.#dialog);
    this.#dialog.addEventListener('close', () => {
      if (!this.#dialog.open) {
        ++this.#generation;
        this.#tracks.stop();
      }
    });
    this.#tabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      this.#tab =
        e.key === 'Home'
          ? 'global'
          : e.key === 'End'
            ? 'friends'
            : this.#tab === 'global'
              ? 'friends'
              : 'global';
      this.#page = 0;
      void this.#load();
      this.#tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
    });
  }
  open(mode?: 'players' | 'tracks') {
    if (mode) this.#mode = mode;
    this.#page = 0;
    // Embedded panels are tab content, not dialogs: show() runs native dialog
    // autofocus and can move focus from the selected tab to the season picker.
    if (!this.#dialog.open) {
      if (this.#embedded) this.#dialog.open = true;
      else this.#dialog.showModal();
    }
    void this.#load();
    if (this.#seasonsLoaded) return;
    this.#seasonsLoaded = true;
    void this.api
      .seasons?.()
      .then((seasons) => {
        if (!this.#dialog.open || !seasons.length) return;
        this.#season.replaceChildren();
        for (const season of seasons) {
          const option = h('option', season.name);
          option.value = season.id;
          this.#season.append(option);
        }
        if (!seasons.some((s) => s.id === this.#seasonKey))
          this.#seasonKey = seasons.find((s) => s.active)?.id ?? seasons[0].id;
        this.#season.value = this.#seasonKey;
        this.#season.hidden = false;
        void this.#load();
      })
      .catch(() => {
        this.#seasonsLoaded = false;
      });
  }
  prepareTrack(track: string, player: string | null = null, season?: string) {
    this.#mode = 'tracks';
    this.#tab = 'global';
    this.#tracks.invalidate();
    this.#tracks.select(track, player);
    if (season) this.#seasonKey = season;
  }
  openTrack(track: string, player: string | null = null, season?: string) {
    this.prepareTrack(track, player, season);
    this.open();
  }
  invalidate() {
    this.#tracks.invalidate();
    this.#cache.clear();
    ++this.#generation;
    if (this.#dialog.open) void this.#load();
  }
  #button(text: string, action: () => void, label?: string) {
    const b = h('button', text, 'quiet');
    b.type = 'button';
    b.onclick = action;
    if (text === 'Retry') b.dataset.errorRetry = '';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  #renderScope(tab: Tab) {
    const hadFocus = this.#tabs.contains((this.#tabs.getRootNode() as ShadowRoot).activeElement);
    this.#tabs.replaceChildren();
    for (const [key, label] of [
      ['global', 'Global'],
      ['friends', 'Friends'],
    ] as const) {
      const button = this.#button(label, () => {
        this.#tab = key;
        this.#page = 0;
        void this.#load();
      });
      button.setAttribute('role', 'tab');
      button.id = 'leaderboard-tab-' + key;
      button.setAttribute(
        'aria-controls',
        this.#mode === 'tracks' ? this.#tracks.element.id : this.#body.id,
      );
      button.setAttribute('aria-selected', String(tab === key));
      button.tabIndex = tab === key ? 0 : -1;
      this.#tabs.append(button);
    }
    this.#body.setAttribute('aria-labelledby', 'leaderboard-tab-' + tab);
    this.#tracks.element.setAttribute('aria-labelledby', 'leaderboard-tab-' + tab);
    if (hadFocus) this.#tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
  }
  async #load() {
    const tracks = this.#mode === 'tracks';
    this.#tabs.hidden = tracks && !this.#tracks.hasTrack;
    this.#body.hidden = this.#footer.hidden = tracks;
    this.#dialog.querySelector<HTMLElement>('.leaderboard-scroll-hint')!.hidden = tracks;
    this.#tracks.element.hidden = !tracks;
    for (const b of this.#types.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.#mode));
    if (tracks) {
      ++this.#generation;
      this.#feedback.hidden = true;
      this.#renderScope(this.#tab);
      void this.#tracks.show({
        season: this.#seasonKey,
        friends: this.#tab === 'friends',
        user: this.user(),
      });
      return;
    }
    this.#tracks.stop();
    const generation = ++this.#generation,
      user = this.user(),
      tab = this.#tab,
      page = this.#page,
      sort = this.#sort,
      direction = this.#direction;
    const season = this.#seasonKey;
    if (this.#displayed && this.#displayed.user !== user) {
      this.#displayed = undefined;
      this.#body.replaceChildren();
      this.#footer.replaceChildren();
    }
    if (!this.#displayed) this.#renderScope(tab);
    if (tab === 'friends' && !user) {
      this.#displayed = undefined;
      this.#renderScope(tab);
      this.#footer.replaceChildren();
      this.#body.inert = this.#footer.inert = false;
      this.#body.removeAttribute('aria-busy');
      this.#feedback.hidden = true;
      this.#body.replaceChildren(
        h('p', 'Sign in with Discord to view your friends’ standings.', 'leaderboard-empty'),
      );
      return;
    }
    const key =
        season + ':' + (user ?? 'guest') + ':' + tab + ':' + sort + ':' + direction + ':' + page,
      cached = this.#cache.get(key);
    if (!this.#displayed) this.#body.replaceChildren(h('p', 'Loading…', 'leaderboard-empty'));
    this.#feedback.hidden = !this.#displayed;
    this.#feedback.replaceChildren(h('span', 'Updating…'));
    this.#feedback.setAttribute('role', 'status');
    this.#body.inert = this.#footer.inert = true;
    if (
      this.#displayed &&
      [...this.#season.options].some((o) => o.value === this.#displayed!.season)
    )
      this.#season.value = this.#displayed.season;
    this.#body.setAttribute('aria-busy', 'true');
    try {
      const rows: Entry[] =
        cached && Date.now() - cached.at < 60000
          ? cached.rows
          : await this.api.standings(
              season || null,
              tab === 'friends',
              sort,
              direction,
              PAGE + 1,
              page * PAGE,
            );
      if (generation !== this.#generation || user !== this.user() || !this.#dialog.open) return;
      this.#cache.set(key, { rows, at: cached?.rows === rows ? cached.at : Date.now() });
      if (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value!);
      this.#displayed = { user, tab, page, sort, direction, season };
      this.#renderScope(tab);
      this.#season.value = season;
      this.#feedback.hidden = true;
      this.#footer.replaceChildren();
      this.#body.replaceChildren();
      if (!rows.length)
        this.#body.append(
          h(
            'p',
            tab === 'friends'
              ? 'No ranked standings among your friends yet.'
              : 'No ranked standings yet.',
            'leaderboard-empty',
          ),
        );
      else {
        const table = h('table');
        const caption = h(
          'caption',
          'Ranked standings. Select a column heading to sort; select it again to reverse the order.',
          'pc-sr-only',
        );
        table.append(caption);
        const head = h('thead'),
          titles = h('tr');
        for (const [label, stat] of [
          ['#', null],
          ['Player', 'name'],
          ['Rank', 'rating'],
          ['Level', 'level'],
          ['Matches', 'matches'],
          ['Wins', 'wins'],
          ['Win rate', 'win_rate'],
        ] as const) {
          const th = h('th');
          th.scope = 'col';
          if (!stat) {
            th.textContent = label;
            th.title = 'Rating position; unchanged by sorting';
          } else {
            if (sort === stat)
              th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
            const button = this.#button(
              label,
              () => {
                this.#direction =
                  this.#sort === stat
                    ? this.#direction === 'desc'
                      ? 'asc'
                      : 'desc'
                    : stat === 'name'
                      ? 'asc'
                      : 'desc';
                this.#sort = stat;
                this.#page = 0;
                this.#focusSort = stat;
                void this.#load();
              },
              'Sort by ' + (stat === 'rating' ? 'rating' : label.toLowerCase()),
            );
            button.className = 'leaderboard-sort';
            button.dataset.stat = stat;
            const icon = h('span', undefined, 'leaderboard-sort-icon');
            icon.dataset.direction = sort === stat ? direction : 'none';
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
            th.append(button);
          }
          titles.append(th);
        }
        head.append(titles);
        table.append(head);
        const body = h('tbody');
        for (const row of rows.slice(0, PAGE)) {
          const tr = h('tr');
          tr.classList.toggle('is-self', row.player_id === user);
          const position = h(
            'td',
            positionNumber(tab === 'friends' ? row.friend_position : row.leaderboard_position),
          );
          const globalPosition = positionNumber(row.leaderboard_position);
          position.title =
            globalPosition === '—'
              ? 'Global position unavailable'
              : 'Global position ' + globalPosition;
          const name = h('td');
          name.append(
            this.#button(
              row.display_name,
              () =>
                this.profile
                  ? this.profile(row.player_id)
                  : this.history(row.player_id, row.display_name),
              (this.profile ? 'View profile for ' : 'Match history for ') + row.display_name,
            ),
          );
          const playerButton = name.querySelector('button')!;
          playerButton.classList.add('player-with-portrait');
          playerButton.replaceChildren(
            profilePicture(row.display_name, row.avatar_url),
            h('span', row.display_name),
          );
          const rank = h('td');
          rank.append(rankBadge({ ...row, provisional: false }));
          tr.append(
            position,
            name,
            rank,
            h('td', typeof row.level === 'number' ? row.level.toLocaleString() : '—'),
            h('td', row.rated_matches.toLocaleString()),
            h('td', row.wins.toLocaleString()),
            h('td', row.win_rate.toFixed(1).replace(/\.0$/, '') + '%'),
          );
          tr.dataset.playerBanner = 'off';
          playerLooks.decorate(tr, row.player_id);
          body.append(tr);
        }
        table.append(body);
        this.#body.append(table);
      }
      const previous = this.#button('Previous', () => {
        --this.#page;
        void this.#load();
      });
      previous.disabled = !page;
      const next = this.#button('Next', () => {
        ++this.#page;
        void this.#load();
      });
      next.disabled = rows.length <= PAGE;
      this.#footer.append(previous, h('span', 'Page ' + (page + 1)), next);
    } catch {
      if (generation !== this.#generation) return;
      if (this.#displayed) {
        const shown = this.#displayed;
        this.#tab = shown.tab;
        this.#page = shown.page;
        this.#sort = shown.sort;
        this.#direction = shown.direction;
        this.#seasonKey = shown.season;
        this.#season.value = shown.season;
        this.#feedback.hidden = false;
        this.#feedback.setAttribute('role', 'alert');
        this.#feedback.replaceChildren(
          h('span', 'Could not update standings. Your current view is kept.'),
          this.#button('Retry', () => {
            this.#tab = tab;
            this.#page = page;
            this.#sort = sort;
            this.#direction = direction;
            this.#seasonKey = season;
            void this.#load();
          }),
        );
        return;
      }
      this.#feedback.hidden = true;
      this.#body.replaceChildren(
        Object.assign(h('p', 'Standings are unavailable.', 'leaderboard-empty'), { role: 'alert' }),
        this.#button('Retry', () => void this.#load()),
      );
    } finally {
      if (generation === this.#generation) {
        this.#body.removeAttribute('aria-busy');
        this.#body.inert = this.#footer.inert = false;
        if (this.#focusSort) {
          this.#body
            .querySelector<HTMLButtonElement>('[data-stat="' + this.#focusSort + '"]')
            ?.focus({ preventScroll: true });
          this.#focusSort = null;
        }
      }
    }
  }
}
