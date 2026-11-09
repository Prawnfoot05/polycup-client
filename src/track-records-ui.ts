import { tracks as rankedTracks } from '../supabase/catalogs/polytrack-0.6.3.json';
const trackNames = new Map(rankedTracks.map((t) => [t.id, t.name]));
import { element as h } from './dom.ts';
import type { Ranked, TrackDirectoryEntry, TrackBoard } from './ranked.ts';
import type { LibraryTrack } from './game-types.ts';
import { formatTime, formatGap } from './time.ts';
import { profilePicture } from './profile-picture.ts';
import { playerLooks } from './player-looks.ts';
const PAGE = 25;
type Context = { season: string; friends: boolean; user: string | null };
/** Lazy, paginated records. No background polling or per-track HTTP requests. */
export class TrackRecordsUI {
  #element = h('section', undefined, 'track-records');
  #searchControl = h('div', undefined, 'track-directory-search');
  get element() {
    return this.#element;
  }
  get searchControl() {
    return this.#searchControl;
  }
  #controls = h('div', undefined, 'track-record-controls');
  #body = h('div', undefined, 'track-record-body');
  #footer = h('div', undefined, 'track-record-footer');
  #feedback = h('div', undefined, 'track-record-feedback');
  #generation = 0;
  #context?: Context;
  #track = '';
  #focus: string | null = null;
  #offset = 0;
  #search = '';
  #directory: TrackDirectoryEntry[] = [];
  #artwork = new Map<string, LibraryTrack['thumbnail']>();
  #cache = new Map<string, { at: number; value: unknown }>();
  constructor(
    private api: Ranked,
    private user: () => string | null,
    private profile?: (id: string) => void,
    private artwork?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[],
    private selectionChanged?: () => void,
  ) {
    this.element.setAttribute('aria-label', 'Ranked track records');
    this.element.id = 'polycup-track-records-panel';
    this.element.setAttribute('role', 'tabpanel');
    this.#feedback.setAttribute('role', 'status');
    this.#feedback.hidden = true;
    this.searchControl.hidden = true;
    this.element.append(this.#controls, this.#feedback, this.#body, this.#footer);
  }
  stop() {
    this.searchControl.hidden = true;
    ++this.#generation;
  }
  invalidate() {
    this.#cache.clear();
    this.stop();
  }
  select(track: string, player: string | null = null) {
    this.#track = track;
    this.#focus = player;
    this.#offset = 0;
  }
  get hasTrack() {
    return !!this.#track;
  }
  #refresh() {
    if (this.selectionChanged) this.selectionChanged();
    else void this.show(this.#context!);
  }
  async #cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const item = this.#cache.get(key);
    if (item && Date.now() - item.at < 60000) return item.value as T;
    const value = await load();
    this.#cache.set(key, { at: Date.now(), value });
    if (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value!);
    return value;
  }
  #button(label: string, action: () => void, className = '') {
    const b = h('button', label, className);
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  #art(id: string) {
    const box = h('span', undefined, 'track-record-art');
    box.setAttribute('aria-hidden', 'true');
    try {
      const thumbnail = this.#artwork.get(id);
      if (thumbnail) {
        const img = h('img');
        img.alt = '';
        img.loading = 'lazy';
        img.draggable = false;
        box.append(img);
        img.onerror = () => {
          img.hidden = true;
        };
        void Promise.resolve(thumbnail)
          .then((src) => {
            if (src && img.isConnected) img.src = src;
          })
          .catch(() => {
            img.hidden = true;
          });
      }
    } catch {}
    return box;
  }
  #table(headings: string[]) {
    const table = h('table'),
      head = h('thead'),
      row = h('tr');
    for (const label of headings) {
      const th = h('th', label);
      th.scope = 'col';
      row.append(th);
    }
    head.append(row);
    table.append(head);
    return table;
  }
  async show(context: Context) {
    // The catalogue is a common track list; friendship only scopes an individual board.
    if (!this.#track) context = { ...context, friends: false };
    const generation = ++this.#generation;
    this.searchControl.hidden = true;
    if (this.#context?.user !== context.user) {
      this.#cache.clear();
      this.#directory = [];
      this.#body.replaceChildren();
      this.#controls.replaceChildren();
      this.#footer.replaceChildren();
    }
    if (
      this.#context &&
      (this.#context.friends !== context.friends || this.#context.season !== context.season)
    ) {
      this.#body.replaceChildren();
      this.#controls.replaceChildren();
      this.#footer.replaceChildren();
    }
    this.#context = context;
    const track = this.#track,
      focus = this.#focus,
      offset = this.#offset;
    const key = JSON.stringify(context);
    if (context.friends && !context.user) {
      this.#body.replaceChildren(
        h('p', 'Sign in to view your friends’ track records.', 'track-record-empty'),
      );
      this.#controls.replaceChildren();
      this.#footer.replaceChildren();
      this.#feedback.hidden = true;
      this.#body.inert = this.#footer.inert = false;
      this.#body.removeAttribute('aria-busy');
      return;
    }
    this.#feedback.setAttribute('role', 'status');
    this.#body.setAttribute('aria-busy', 'true');
    this.#body.inert = this.#footer.inert = true;
    this.#feedback.hidden = false;
    this.#feedback.textContent = this.#body.childElementCount ? 'Updating…' : 'Loading records…';
    try {
      const [directory, board] = await Promise.all([
        this.#cached<TrackDirectoryEntry[]>(key, () =>
          this.api.trackDirectory(context.season || null, context.friends),
        ),
        track
          ? this.#cached<TrackBoard>(key + ':' + track + ':' + focus + ':' + offset, () =>
              this.api.trackBoard(track, context.season || null, context.friends, focus, offset),
            )
          : null,
      ]);
      if (generation !== this.#generation || this.user() !== context.user) return;
      this.#directory = directory
        .map((t) => ({ ...t, name: trackNames.get(t.track_id) || t.name || t.track_id }))
        .sort((a, b) => {
          const category =
            (a.category === 'official' ? 0 : 1) - (b.category === 'official' ? 0 : 1);
          return (
            category ||
            a.name.localeCompare(b.name, undefined, { numeric: true }) ||
            a.track_id.localeCompare(b.track_id)
          );
        });
      this.#feedback.hidden = true;
      try {
        this.#artwork = new Map((this.artwork?.() ?? []).map((t) => [t.id, t.thumbnail]));
      } catch {
        this.#artwork.clear();
      }
      if (track && board) this.#drawBoard(board);
      else this.#drawDirectory();
    } catch {
      if (generation !== this.#generation) return;
      this.#feedback.hidden = false;
      this.#feedback.setAttribute('role', 'alert');
      this.#feedback.replaceChildren(
        h('span', 'Track records unavailable.'),
        this.#button('Retry', () => {
          this.#cache.clear();
          void this.show(context);
        }),
      );
    } finally {
      if (generation === this.#generation) {
        this.#body.removeAttribute('aria-busy');
        this.#body.inert = this.#footer.inert = false;
      }
    }
  }
  #drawDirectory() {
    const search = h('input');
    search.type = 'search';
    search.placeholder = 'Search tracks';
    search.setAttribute('aria-label', 'Search ranked tracks');
    search.value = this.#search;
    search.oninput = () => {
      this.#search = search.value;
      draw();
    };
    this.searchControl.replaceChildren(search);
    this.searchControl.hidden = false;
    this.#controls.hidden = true;
    this.#controls.replaceChildren();
    this.#footer.replaceChildren();
    const draw = () => {
      const rows = this.#directory.filter((t) =>
        t.name.toLocaleLowerCase().includes(this.#search.trim().toLocaleLowerCase()),
      );
      const table = this.#table(['Track', 'Racers', 'Your PB', '#']),
        body = h('tbody');
      table.className = 'track-directory-table';
      for (const t of rows) {
        const row = h('tr'),
          cell = h('td'),
          link = this.#button(
            '',
            () => {
              this.select(t.track_id);
              this.#refresh();
            },
            'track-record-link',
          );
        const label = h('span');
        label.append(
          h('strong', t.name),
          h('small', t.category === 'official' ? 'Main track' : 'Community track'),
        );
        link.append(this.#art(t.track_id), label);
        cell.append(link);
        row.append(
          cell,
          h('td', String(t.players)),
          h('td', t.own_time == null ? '—' : formatTime(t.own_time)),
          h('td', t.own_position == null ? '—' : String(t.own_position)),
        );
        body.append(row);
      }
      table.append(body);
      this.#body.replaceChildren(table);
      if (!rows.length)
        this.#body.append(h('p', this.#search ? 'No matching tracks.' : '—', 'track-record-empty'));
    };
    draw();
  }
  #drawBoard(board: TrackBoard) {
    this.searchControl.hidden = true;
    this.#controls.hidden = false;
    const selected = this.#directory.find((t) => t.track_id === this.#track),
      select = h('select');
    select.setAttribute('aria-label', 'Track');
    for (const t of this.#directory) {
      const o = h('option', t.name);
      o.value = t.track_id;
      select.append(o);
    }
    if (!selected) {
      const o = h('option', this.#track);
      o.value = this.#track;
      select.append(o);
    }
    select.value = this.#track;
    select.onchange = () => {
      this.select(select.value, this.#focus);
      this.#refresh();
    };
    const back = this.#button('All tracks', () => {
      this.select('');
      this.#refresh();
    });
    this.#controls.replaceChildren(back, this.#art(this.#track), select);
    const table = this.#table(['#', 'Player', 'Best time', 'Gap']),
      body = h('tbody');
    table.className = 'track-board-table';
    for (const r of board.entries) {
      const row = h('tr'),
        name = h('td'),
        link = this.#button('', () => this.profile?.(r.player_id), 'track-player-link');
      link.append(
        profilePicture(r.display_name, r.avatar_url ?? undefined),
        h('span', r.display_name),
      );
      name.append(link);
      row.classList.toggle('is-self', r.player_id === this.user());
      row.classList.toggle('is-focus', r.player_id === this.#focus);
      row.append(
        h('td', String(r.position)),
        name,
        h('td', formatTime(r.time_ms)),
        h(
          'td',
          r.time_ms === board.best_time
            ? '—'
            : formatGap(r.time_ms - (board.best_time ?? r.time_ms)),
        ),
      );
      row.title = 'Set ' + new Date(r.achieved_at).toLocaleDateString();
      row.dataset.playerBanner = 'off';
      playerLooks.decorate(row, r.player_id);
      body.append(row);
    }
    table.append(body);
    this.#body.replaceChildren(table);
    if (!board.entries.length)
      this.#body.append(h('p', 'No ranked times yet.', 'track-record-empty'));
    const previous = this.#button('‹', () => {
      this.#offset = Math.max(0, this.#offset - PAGE);
      void this.show(this.#context!);
    });
    previous.setAttribute('aria-label', 'Previous page');
    previous.className = 'track-page-arrow';
    previous.disabled = !this.#offset;
    const next = this.#button('›', () => {
      this.#offset += PAGE;
      void this.show(this.#context!);
    });
    next.setAttribute('aria-label', 'Next page');
    next.className = 'track-page-arrow';
    for (const [button, right] of [[previous, false], [next, true]] as const) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 20 20');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', right ? 'M5 2h5l8 8-8 8H5l8-8z' : 'M15 2h-5l-8 8 8 8h5l-8-8z');
      svg.append(path);
      button.replaceChildren(svg);
    }
    next.disabled = this.#offset + PAGE >= board.total;
    const center = h('div', undefined, 'track-record-page');
    const pages = h('div', undefined, 'track-page-controls');
    pages.append(previous,
      h('span', 'Page ' + (Math.floor(this.#offset / PAGE) + 1) + ' · ' + board.total + ' racers'),
      next);
    center.append(pages);
    if (board.focus && !board.entries.some((r) => r.player_id === board.focus!.player_id)) {
      const r = board.focus;
      center.append(
        this.#button(
          (r.player_id === this.user() ? 'Your record' : 'Player record') + ' · #' + r.position,
          () => {
            this.#offset = Math.floor(r.row_index / PAGE) * PAGE;
            void this.show(this.#context!);
          },
        ),
      );
    }
    const index = this.#directory.findIndex(t => t.track_id === this.#track);
    const adjacent = (step: number) => {
      const button = this.#button(step < 0 ? 'Previous track' : 'Next track', () => {
        const track = this.#directory[index + step];
        if (!track) return;
        this.select(track.track_id, this.#focus);
        this.#refresh();
      }, 'track-adjacent');
      button.disabled = index < 0 || !this.#directory[index + step];
      return button;
    };
    this.#footer.replaceChildren(adjacent(-1), center, adjacent(1));
  }
}
