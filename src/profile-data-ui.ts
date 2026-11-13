import { element as h } from './dom.ts';
import { clickableRow } from './clickable-row.ts';
import { profilePicture } from './profile-picture.ts';
import { formatTime } from './time.ts';
import { officialLapTime } from './official-position.ts';
import type { LibraryTrack } from './game-types.ts';
import type { PlayerProfile } from './social.ts';
import type {
  ProfileDataEntry,
  ProfileDataPage,
  ProfileDataQuery,
  ProfileListKind,
} from './profile-data.ts';
import css from './profile-data.css';

export const profileDataCSS = css;
type Column = { key: string; label: string; render?: (row: ProfileDataEntry) => string };
const number = (n: unknown) =>
  typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–';
const percent = (n: unknown) => (typeof n === 'number' ? number(n) + '%' : '–');
const clock = (n: number | null | undefined) => (n ? formatTime(n) : '–');
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const change = (n: number | null | undefined) =>
  n == null ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + number(Math.abs(n));

/** One on-demand, paged view. The caller retains the overview DOM while it is open. */
export function profileDataView(options: {
  profile: PlayerProfile;
  kind: ProfileListKind;
  season?: string | null;
  seasons?: { id: string; name: string }[];
  load: (query: ProfileDataQuery) => Promise<ProfileDataPage>;
  back: () => void;
  close: () => void;
  player: (id: string) => void;
  track?: (id: string) => void;
  artwork?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[];
}) {
  const query: ProfileDataQuery = {
    kind: options.kind,
    season: options.season,
    search: '',
    sort: options.kind === 'tracks' ? 'matches' : 'last_played',
    direction: 'desc',
    minimum: 1,
    offset: 0,
  };
  let generation = 0,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let last: ProfileDataPage | undefined;
  let columnMode = 'results';
  const root = h('section', undefined, 'profile-data-view');
  const heading = h('header', undefined, 'profile-data-heading');
  const back = h('button', 'Back to profile', 'profile-data-back');
  back.type = 'button';
  back.onclick = options.back;
  const identity = h('div', undefined, 'profile-data-identity');
  identity.append(
    profilePicture(options.profile.display_name, options.profile.avatar_url),
    h('span', options.profile.display_name),
  );
  const close = h('button', '×', 'social-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close profile');
  close.onclick = options.close;
  const title = h('h2');
  const scope = h('select', undefined, 'profile-data-scope');
  scope.setAttribute('aria-label', 'Stats season');
  for (const season of options.seasons ?? []) {
    const option = h('option', season.name);
    option.value = season.id;
    scope.append(option);
  }
  scope.hidden = !scope.options.length;
  scope.value = options.season ?? '';
  scope.onchange = () => {
    query.season = scope.value;
    query.offset = 0;
    void refresh();
  };
  const summary = h('dl', undefined, 'profile-data-summary');
  heading.append(back, identity, summary, scope, close);
  const toolbar = h('div', undefined, 'profile-data-toolbar');
  const search = h('input');
  search.type = 'search';
  search.maxLength = 80;
  search.placeholder = 'Search tracks';
  search.setAttribute('aria-label', 'Search tracks');
  const status = h('span', '', 'profile-data-status');
  status.setAttribute('role', 'status');
  const modes = h('div', undefined, 'profile-data-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'View columns');
  const modeButtons: HTMLButtonElement[] = [];
  for (const [value, label] of [
    ['results', 'Results'],
    ['pace', 'Times'],
  ]) {
    const button = h('button', label);
    button.type = 'button';
    button.dataset.columns = value;
    button.setAttribute('aria-pressed', String(value === columnMode));
    button.onclick = () => {
      if (columnMode === value) return;
      columnMode = value;
      query.sort = columnMode === 'pace' ? 'best_time' : 'matches';
      query.direction = columnMode === 'pace' ? 'asc' : 'desc';
      query.offset = 0;
      renderHeader();
      void refresh();
    };
    modeButtons.push(button);
    modes.append(button);
  }
  toolbar.append(search, modes, status);
  const error = h('div', undefined, 'profile-data-error social-error');
  error.hidden = true;
  const scroll = h('div', undefined, 'profile-data-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'Statistics table');
  const table = h('table');
  const thead = h('thead'),
    tbody = h('tbody');
  table.append(thead, tbody);
  scroll.append(table);
  const empty = h('p', '', 'profile-data-empty');
  empty.hidden = true;
  scroll.append(empty);
  const footer = h('footer', undefined, 'profile-data-footer');
  const previous = h('button', 'Previous'),
    next = h('button', 'Next'),
    page = h('span');
  previous.type = next.type = 'button';
  previous.onclick = () => {
    query.offset = Math.max(0, query.offset - 25);
    void refresh();
  };
  next.onclick = () => {
    query.offset += 25;
    void refresh();
  };
  footer.append(previous, page, next);
  title.className = 'pc-sr-only';
  root.append(heading, title, toolbar, error, scroll, footer);
  const art = new Map<string, LibraryTrack['thumbnail']>();
  try {
    for (const item of options.artwork?.() ?? []) art.set(item.id, item.thumbnail);
  } catch {
    /* Native library may still be loading. */
  }
  const columns = (): Column[] =>
    query.kind === 'tracks'
      ? columnMode === 'results'
        ? [
            { key: 'name', label: 'Track' },
            { key: 'matches', label: 'Matches' },
            { key: 'wins', label: 'Wins' },
            { key: 'win_rate', label: 'Win rate', render: (r) => percent(r.win_rate) },
            { key: 'podiums', label: 'Podiums' },
            { key: 'average_place', label: 'Avg. place' },
            { key: 'rating_change', label: 'Rating Δ', render: (r) => change(r.rating_change) },
            { key: 'last_played', label: 'Last played', render: (r) => date(r.last_played) },
          ]
        : [
            { key: 'name', label: 'Track' },
            { key: 'finishes', label: 'Finishes' },
            { key: 'best_time', label: 'Best time', render: (r) => clock(r.best_time) },
            {
              key: 'record_position',
              label: 'Track rank',
              render: (r) => (r.record_position ? '#' + number(r.record_position) : '–'),
            },
            {
              key: 'record_gap',
              label: 'Gap',
              render: (r) => (r.record_gap == null ? '–' : '+' + formatTime(r.record_gap)),
            },
            { key: 'average_time', label: 'Avg. time', render: (r) => clock(r.average_time) },
            { key: 'rating_change', label: 'Rating Δ', render: (r) => change(r.rating_change) },
            { key: 'last_played', label: 'Last played', render: (r) => date(r.last_played) },
          ]
      : [
          { key: 'name', label: 'Player' },
          { key: 'matches', label: 'Matches' },
          { key: 'ahead', label: 'Ahead' },
          { key: 'behind', label: 'Behind' },
          { key: 'tied', label: 'Tied' },
          { key: 'wins', label: 'Match wins' },
          { key: 'win_rate', label: 'Win rate', render: (r) => percent(r.win_rate) },
          { key: 'average_place', label: 'Avg. place' },
          { key: 'rating_change', label: 'Rating Δ', render: (r) => change(r.rating_change) },
          { key: 'last_played', label: 'Last played', render: (r) => date(r.last_played) },
        ];
  const renderHeader = () => {
    const active = (root.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
    const focusedSort = active && thead.contains(active) ? active.dataset.sortStat : undefined;
    title.textContent = query.kind === 'tracks' ? 'Track performance' : 'Played with';
    root.dataset.kind = query.kind;
    root.dataset.columns = columnMode;
    modes.hidden = query.kind !== 'tracks';
    for (const button of modeButtons)
      button.setAttribute('aria-pressed', String(button.dataset.columns === columnMode));
    search.placeholder = query.kind === 'tracks' ? 'Search tracks' : 'Search players';
    search.setAttribute('aria-label', search.placeholder);
    const row = h('tr');
    for (const col of columns()) {
      const th = h('th');
      th.scope = 'col';
      {
        const button = h('button', col.label);
        button.type = 'button';
        button.dataset.sortStat = col.key;
        const arrow = h(
          'span',
          query.sort === col.key ? (query.direction === 'asc' ? '▲' : '▼') : '',
        );
        arrow.setAttribute('aria-hidden', 'true');
        button.append(arrow);
        button.onclick = () => {
          query.direction =
            query.sort === col.key
              ? query.direction === 'desc'
                ? 'asc'
                : 'desc'
              : [
                    'name',
                    'best_time',
                    'record_position',
                    'record_gap',
                    'average_time',
                    'average_place',
                  ].includes(col.key)
                ? 'asc'
                : 'desc';
          query.sort = col.key;
          query.offset = 0;
          renderHeader();
          void refresh();
        };
        if (query.sort === col.key)
          th.setAttribute('aria-sort', query.direction === 'asc' ? 'ascending' : 'descending');
        th.append(button);
      }
      row.append(th);
    }
    thead.replaceChildren(row);
    if (focusedSort)
      thead
        .querySelector<HTMLElement>(`[data-sort-stat="${focusedSort}"]`)
        ?.focus({ preventScroll: true });
  };
  const draw = (data: ProfileDataPage) => {
    if (data.season) scope.value = data.season.id;
    summary.replaceChildren();
    for (const [label, value] of [
      [query.kind === 'tracks' ? 'Tracks played' : 'Players met', number(data.summary.items)],
      ['Matches', number(data.summary.matches)],
      ['Wins', number(data.summary.wins)],
      ['Win rate', percent(data.summary.win_rate)],
    ]) {
      const stat = h('div');
      stat.append(h('dt', label), h('dd', value));
      summary.append(stat);
    }
    tbody.replaceChildren();
    for (const entry of data.entries) {
      const row = h('tr');
      for (const col of columns()) {
        const td = h('td');
        td.dataset.column = col.key;
        if (col.key === 'name') {
          const action = h('button', undefined, 'profile-data-name');
          action.type = 'button';
          const portrait =
            query.kind === 'tracks'
              ? h('span', undefined, 'profile-data-art')
              : profilePicture(entry.name, entry.avatar_url);
          if (entry.track_id && art.has(entry.track_id)) {
            const image = h('img');
            image.alt = '';
            image.loading = 'lazy';
            image.draggable = false;
            portrait.append(image);
            Promise.resolve(art.get(entry.track_id))
              .then((src) => {
                if (src && image.isConnected) image.src = src;
              })
              .catch(() => image.remove());
            image.onerror = () => image.remove();
          }
          const label = h('span');
          label.append(
            h('strong', entry.name),
            h(
              'small',
              query.kind === 'tracks'
                ? entry.category === 'official'
                  ? 'Main track'
                  : 'Community track'
                : 'First met ' + date(entry.first_played),
            ),
          );
          action.append(portrait, label);
          if (query.kind === 'players') action.onclick = () => options.player(entry.player_id!);
          else if (options.track) action.onclick = () => options.track!(entry.track_id!);
          else action.disabled = true;
          td.append(action);
          if (!action.disabled) clickableRow(row, action);
        } else if (col.key === 'best_time') {
          td.append(officialLapTime(entry.track_id, entry.best_time, '–'));
        } else {
          td.textContent = col.render
            ? col.render(entry)
            : number(entry[col.key as keyof ProfileDataEntry]);
          if (col.key === 'rating_change')
            td.classList.add(
              (entry.rating_change ?? 0) > 0
                ? 'is-gain'
                : (entry.rating_change ?? 0) < 0
                  ? 'is-loss'
                  : 'is-neutral',
            );
        }
        row.append(td);
      }
      tbody.append(row);
    }
    empty.hidden = !!data.entries.length;
    empty.textContent = data.total
      ? '–'
      : query.search || query.minimum > 1
        ? 'No matching results.'
        : '–';
    page.textContent = data.total
      ? `${query.offset + 1}–${Math.min(query.offset + 25, data.total)} of ${number(data.total)}`
      : '0 results';
    previous.disabled = query.offset === 0;
    next.disabled = query.offset + 25 >= data.total;
    scroll.scrollTop = 0;
    root.scrollTop = 0;
  };
  async function refresh() {
    clearTimeout(timer);
    const current = ++generation;
    status.textContent = 'Updating…';
    root.setAttribute('aria-busy', 'true');
    error.hidden = true;
    previous.disabled = next.disabled = true;
    try {
      const data = await options.load({ ...query });
      if (disposed || generation !== current) return;
      if (query.offset && !data.entries.length && data.total) {
        query.offset = Math.floor((data.total - 1) / 25) * 25;
        void refresh();
        return;
      }
      last = data;
      draw(data);
      status.textContent = '';
    } catch {
      if (disposed || generation !== current) return;
      status.textContent = last ? 'Showing previous results' : '';
      error.replaceChildren(h('span', 'Could not load statistics.'));
      const retry = h('button', 'Retry');
      retry.type = 'button';
      retry.onclick = () => void refresh();
      const dismiss = h('button', '×');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Dismiss error');
      dismiss.onclick = () => {
        error.hidden = true;
      };
      error.append(retry, dismiss);
      error.hidden = false;
      previous.disabled = next.disabled = true;
    } finally {
      if (!disposed && generation === current) root.removeAttribute('aria-busy');
    }
  }
  search.oninput = () => {
    query.search = search.value;
    query.offset = 0;
    ++generation;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 220);
  };
  renderHeader();
  void refresh();
  return {
    element: root,
    dispose: () => {
      disposed = true;
      ++generation;
      clearTimeout(timer);
    },
  };
}
