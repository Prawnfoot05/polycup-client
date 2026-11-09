import { installErrorDismissal } from './dismissible-errors.ts';
import { playerName as playerLabel } from './cosmetics.ts';
import { playerLooks } from './player-looks.ts';
import { element as h } from './dom.ts';
import { protectUITouches } from './touch-ui.ts';
import type { Ranked, RankedHistoryEntry, RankedMatchResult, InputReview } from './ranked.ts';
import css from './ranked-history.css';
import rankCSS from './ranked-queue.css';
import { rankBadge } from './rank-badge.ts';
import type { LibraryTrack } from './game-types.ts';
import { tracks as rankedTracks } from '../supabase/catalogs/polytrack-0.6.3.json';

import { historyReviewWarning } from './history-review-warning.ts';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
import { placing, ratingChange, ratingNumber as number } from './ranked-format.ts';
import { watchMatchReplay } from './match-replay.ts';
import type { CasualHistoryEntry, CasualMatchResult } from './ranked.ts';
export { placing, ratingChange } from './ranked-format.ts';

const trackNames = new Map(rankedTracks.map((track) => [track.id, track.name]));

const PAGE_SIZE = 20;

export class RankedHistoryUI {
  #scope: 'ranked' | 'casual' = 'ranked';
  #scopeTabs = h('nav', undefined, 'history-scope-tabs');
  #casualRows: CasualHistoryEntry[] = [];
  #dialog = h('dialog', undefined, 'ranked-history polycup-surface');
  #title = h('h2', 'Match history');
  #name = h('span', undefined, 'ranked-history-name');
  #matchTrack = h('div', undefined, 'history-match-track');
  #body = h('div', undefined, 'ranked-history-body');
  #footer = h('footer');
  #generation = 0;
  #offset = 0;
  #player = '';
  #identityGeneration = 0;
  #client?: Ranked;
  #rows: RankedHistoryEntry[] = [];
  #checks: InputReview[] | null = null;
  #hasContent = false;
  #feedback = h('div', undefined, 'ranked-history-feedback');
  #replayAbort?: AbortController;
  #shadow: ShadowRoot;

  #embedded = false;
  mount(container: HTMLElement) {
    this.close();
    this.#embedded = true;
    this.#dialog.classList.add('hub-embedded-view');
    this.#dialog.setAttribute('role', 'region');
    this.#dialog.querySelector<HTMLButtonElement>('header button')!.hidden = true;
    container.append(this.#dialog);
  }

  constructor(
    shadow: ShadowRoot,
    private profile?: (id: string) => void,
    private viewer?: () => string | null,
    private trackArt?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[],
    _trackRecords?: (track: string, player?: string, season?: string) => void,
  ) {
    this.#shadow = shadow;
    protectUITouches(shadow);
    installErrorDismissal(shadow);
    shadow.append(h('style', css + rankCSS + profilePictureCSS));
    const header = h('header');
    const title = h('div');
    title.append(this.#title, this.#name, this.#matchTrack);
    const close = this.#button('×', () => this.close());
    close.setAttribute('aria-label', 'Close match history');
    header.append(title, close);
    this.#title.id = 'polycup-history-title-' + crypto.randomUUID();
    this.#dialog.setAttribute('aria-labelledby', this.#title.id);
    this.#body.setAttribute('aria-live', 'polite');
    this.#feedback.hidden = true;
    this.#feedback.setAttribute('role', 'status');
    this.#scopeTabs.setAttribute('aria-label', 'Match type');
    for (const scope of ['ranked','casual'] as const) {
      const button = this.#button(scope === 'ranked' ? 'Ranked' : 'Casual', () => {
        if (this.#scope === scope) return;
        this.#scope = scope; this.#offset = 0; this.#hasContent = false;
        this.#matchTrack.replaceChildren(); this.#paintScope(); void this.#load();
      });
      button.dataset.scope = scope;
      this.#scopeTabs.append(button);
    }
    this.#paintScope();
    this.#dialog.append(header, this.#scopeTabs, this.#body, this.#feedback, this.#footer);
    this.#dialog.addEventListener('close', () => {
      if (!this.#dialog.open) ++this.#generation;
    });
    this.#dialog.addEventListener('cancel', () => {
      ++this.#generation;
    });
    shadow.append(this.#dialog);
  }

  open(client: Ranked, playerId: string, name: string, match?: string) {
    if (match) this.#scope = 'ranked';
    this.#paintScope();
    this.#dialog.dataset.errorScope = 'history:' + playerId;
    if (this.#player !== playerId || this.#client !== client) {
      this.#hasContent = false;
      this.#rows = [];
      this.#checks = null;
      this.#title.textContent = 'Match history';
    }
    this.#client = client;
    this.#player = playerId;
    const own = this.viewer ? playerId === this.viewer() : name === 'Your matches';
    this.#dialog.dataset.owner = own ? 'self' : 'other';
    const identityGeneration = ++this.#identityGeneration;
    const paintIdentity = (avatar?: string) => {
      if (own) this.#name.textContent = name;
      else {
        this.#name.replaceChildren(profilePicture(name, avatar), h('span', name));
        playerLooks.decorate(this.#name, playerId);
      }
    };
    playerLooks.undecorate(this.#name);
    paintIdentity();
    if (!own && typeof client.pictures === 'function')
      void client
        .pictures([playerId])
        .then((pictures) => {
          if (identityGeneration === this.#identityGeneration && this.#dialog.open)
            paintIdentity(pictures[playerId]);
        })
        .catch(() => {});
    this.#offset = 0;
    if (!this.#dialog.open) {
      if (this.#embedded) this.#dialog.open = true;
      else this.#dialog.showModal();
    }
    if (match) void this.#details(match);
    else void this.#load();
  }

  close() {
    this.#replayAbort?.abort();
    ++this.#identityGeneration;
    ++this.#generation;
    this.#dialog.close();
  }

  #button(label: string, action: () => void, disabled = false) {
    const button = h('button', label);
    if (label === 'Retry') button.dataset.errorRetry = '';
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = action;
    return button;
  }

  #pending() {
    if (!this.#hasContent) {
      this.#body.replaceChildren(h('p', 'Loading…', 'ranked-history-note'));
      this.#footer.replaceChildren();
    }
    this.#feedback.hidden = !this.#hasContent;
    this.#feedback.replaceChildren(h('span', 'Updating…'));
    this.#feedback.setAttribute('role', 'status');
    this.#body.setAttribute('aria-busy', 'true');
    this.#body.inert = this.#footer.inert = true;
  }

  #ready() {
    this.#body.setAttribute('aria-busy', 'false');
    this.#body.inert = this.#footer.inert = false;
    this.#feedback.hidden = true;
  }

  #error(retry: () => void) {
    this.#ready();
    if (this.#hasContent) {
      this.#feedback.hidden = false;
      this.#feedback.setAttribute('role', 'alert');
      this.#feedback.replaceChildren(
        h('span', 'Could not update match history. Your current view is kept.'),
        this.#button('Retry', retry),
      );
      return;
    }
    const error = h('p', 'Match history is unavailable. Try again.', 'ranked-history-note');
    error.setAttribute('role', 'alert');
    this.#body.replaceChildren(error, this.#button('Retry', retry));
    this.#footer.replaceChildren(
      this.#button('Back', () => this.#scope === 'casual'
        ? (this.#casualRows.length ? this.#casualList() : this.close())
        : (this.#rows.length ? this.#list() : this.close())),
    );
  }

  async #load(offset = this.#offset) {
    if (this.#scope === 'casual') return this.#loadCasual(offset);
    const generation = ++this.#generation;
    this.#pending();
    try {
      // One extra row determines Next without a separate count query.
      const rows = await this.#client!.history(this.#player, PAGE_SIZE + 1, offset);
      if (generation !== this.#generation || !this.#dialog.open) return;
      let checks: InputReview[] | null = null;

      try {
        checks = await this.#client!.inputReview(rows.slice(0, PAGE_SIZE).map((r) => r.match_id));
      } catch {
        // Review availability must not add noise to otherwise readable results.
      }
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#rows = rows;
      this.#checks = checks;
      this.#offset = offset;
      this.#list();
    } catch {
      if (generation === this.#generation && this.#dialog.open)
        this.#error(() => void this.#load(offset));
    }
  }

  #list() {
    this.#replayAbort?.abort();
    ++this.#generation;
    this.#dialog.dataset.view = 'list';
    this.#hasContent = true;
    this.#title.textContent = 'Match history';
    this.#ready();
    this.#body.replaceChildren();
    if (!this.#rows.length)
      this.#body.append(h('p', 'No rated matches yet.', 'ranked-history-note'));
    else {
      // Rows from polycup_ranked_history_v2 read like results; older rows keep the plain layout.
      const rich = this.#rows.some((row) => row.opponents !== undefined);
      this.#body.classList.toggle('is-rich', rich);
      const heading = h('div', undefined, 'ranked-history-columns');
      for (const label of rich
        ? ['Place', 'Track', 'Racers', 'Rank', 'Change']
        : ['Place', 'Date', 'Rating', 'Change'])
        heading.append(h('span', label));
      this.#body.append(heading);
      const artwork = new Map<string, LibraryTrack['thumbnail']>();
      try {
        for (const track of this.trackArt?.() ?? []) artwork.set(track.id, track.thumbnail);
      } catch {
        // The native library may still be loading; rows keep their track names.
      }
      for (const row of this.#rows.slice(0, PAGE_SIZE)) {
        const button = this.#button('', () => void this.#details(row.match_id));
        button.className = 'ranked-history-row';
        button.title = 'View match';
        const time = h(
          'time',
          new Date(row.finished_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
        );
        time.dateTime = row.finished_at;
        time.title = new Date(row.finished_at).toLocaleString();
        const place = h('span', undefined, 'ranked-history-place');
        place.append(h('strong', placing(row.place)), h('small', ` / ${row.player_count}`));
        if (rich) {
          button.classList.toggle('is-win', row.place === 1);
          button.append(
            place,
            this.#track(row, time, artwork),
            this.#racers(row),
            row.tier
              ? rankBadge({
                  tier: row.tier,
                  rating: row.rating_after,
                  gm_position: row.gm_position_at_start ?? null,
                  provisional: row.tier === 'provisional',
                })
              : h('span', number(row.rating_after)),
            this.#delta(row.rating_before, row.rating_after),
          );
        } else
          button.append(
            place,
            time,
            h('span', number(row.rating_after)),
            this.#delta(row.rating_before, row.rating_after),
          );
        button.setAttribute(
          'aria-label',
          `View match: ${placing(row.place)} of ${row.player_count}${row.track_id && trackNames.has(row.track_id) ? ' on ' + trackNames.get(row.track_id) : ''}, ${time.title}`,
        );
        const entry = h('div', undefined, 'ranked-history-entry');
        entry.append(button);
        this.#body.append(entry);
        const flags =
          this.#checks?.filter((c) => c.match_id === row.match_id && c.status === 'flagged') ?? [];
        if (flags.length) entry.append(historyReviewWarning(flags));
      }
    }
    this.#footer.replaceChildren(
      this.#button(
        'Previous',
        () => {
          void this.#load(Math.max(0, this.#offset - PAGE_SIZE));
        },
        this.#offset === 0,
      ),
      h('span', `Page ${this.#offset / PAGE_SIZE + 1}`),
      this.#button(
        'Next',
        () => {
          void this.#load(this.#offset + PAGE_SIZE);
        },
        this.#rows.length <= PAGE_SIZE,
      ),
    );
  }

  #track(
    row: Pick<RankedHistoryEntry, 'track_id'>,
    time: HTMLElement,
    artwork: Map<string, LibraryTrack['thumbnail']>,
  ) {
    const cell = h('span', undefined, 'ranked-history-track');
    const art = h('span', undefined, 'ranked-history-track-art');
    art.setAttribute('aria-hidden', 'true');
    const thumbnail = row.track_id ? artwork.get(row.track_id) : undefined;
    if (thumbnail) {
      const image = h('img');
      image.alt = '';
      image.loading = 'lazy';
      image.draggable = false;
      image.addEventListener('error', () => (image.hidden = true));
      art.append(image);
      Promise.resolve(thumbnail)
        .then((src) => {
          if (src && image.isConnected) image.src = src;
        })
        .catch(() => (image.hidden = true));
    }
    const label = h('span');
    label.append(
      h('strong', (row.track_id && trackNames.get(row.track_id)) || 'Track unavailable'),
      time,
    );
    cell.append(art, label);
    return cell;
  }

  /** Up to three opponent portraits in finishing order, then a count of the rest. */
  #racers(row: RankedHistoryEntry) {
    const cell = h('span', undefined, 'ranked-history-racers');
    const others = row.opponents ?? [];
    cell.title = others.map((o) => `${placing(o.place ?? 0)} ${o.display_name}`).join(', ');
    for (const other of others.slice(0, 3))
      cell.append(profilePicture(other.display_name, other.avatar_url ?? undefined));
    if (others.length > 3) cell.append(h('span', '+' + (others.length - 3), 'ranked-history-more'));
    return cell;
  }

  #delta(before: number | null, after: number | null) {
    const span = h('span', ratingChange(before, after), 'ranked-history-change');
    if (before !== null && after !== null)
      span.classList.add(after > before ? 'positive' : after < before ? 'negative' : 'neutral');
    return span;
  }

  async #details(matchId: string) {
    if (this.#scope === 'casual') return this.#casualDetails(matchId);
    this.#replayAbort?.abort();
    const generation = ++this.#generation;
    this.#pending();
    try {
      const result = await this.#client!.match(matchId);
      if (generation !== this.#generation || !this.#dialog.open) return;
      if (!result) throw new Error('Match unavailable');
      let checks: InputReview[] | null = null;
      try {
        checks = await this.#client!.inputReview([matchId]);
      } catch {
        // Optional review lookup: only actual flags receive an indicator.
      }
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#result(result, checks);
    } catch {
      if (generation === this.#generation && this.#dialog.open)
        this.#error(() => void this.#details(matchId));
    }
  }

  #paintScope() {
    for (const button of this.#scopeTabs.querySelectorAll<HTMLButtonElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.scope === this.#scope));
  }
  async #loadCasual(offset: number) {
    const generation = ++this.#generation;
    this.#pending();
    try {
      const rows = await this.#client!.casualHistory(this.#player,PAGE_SIZE+1,offset);
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#casualRows = rows; this.#offset = offset; this.#casualList();
    } catch {
      if (generation === this.#generation && this.#dialog.open) this.#error(() => void this.#loadCasual(offset));
    }
  }
  #casualList() {
    ++this.#generation; this.#ready(); this.#hasContent = true;
    this.#dialog.dataset.view = 'list'; this.#title.textContent = 'Match history';
    this.#matchTrack.replaceChildren(); this.#body.classList.remove('is-rich'); this.#body.replaceChildren();
    const headings = h('div',undefined,'casual-history-columns');
    for (const label of ['Place','Lobby','Mode','Rounds']) headings.append(h('span',label));
    if (this.#casualRows.length) this.#body.append(headings);
    else this.#body.append(h('p','No completed casual matches yet.','ranked-history-note'));
    for (const row of this.#casualRows.slice(0,PAGE_SIZE)) {
      const button = this.#button('',() => void this.#casualDetails(row.match_id));
      button.className = 'casual-history-row';
      const place = h('span',undefined,'ranked-history-place');
      place.append(h('strong',placing(row.place)),h('small',` / ${row.player_count}`));
      const name = h('span',undefined,'casual-history-name');
      name.append(h('strong',row.title),h('time',new Date(row.finished_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})));
      button.append(place,name,h('span',row.mode==='teams'?'Teams':'FFA'),h('span',String(row.rounds)));
      this.#body.append(button);
    }
    this.#footer.replaceChildren(
      this.#button('Previous',() => void this.#loadCasual(Math.max(0,this.#offset-PAGE_SIZE)),this.#offset===0),
      h('span',`Page ${Math.floor(this.#offset/PAGE_SIZE)+1}`),
      this.#button('Next',() => void this.#loadCasual(this.#offset+PAGE_SIZE),this.#casualRows.length<=PAGE_SIZE),
    );
  }
  async #casualDetails(match: string) {
    const generation = ++this.#generation; this.#pending();
    try {
      const result = await this.#client!.casualResult(match);
      if (generation !== this.#generation || !this.#dialog.open) return;
      if (!result) throw Error('Match unavailable');
      this.#paintCasualResult(result);
    } catch {
      if (generation === this.#generation && this.#dialog.open) this.#error(() => void this.#casualDetails(match));
    }
  }
  #paintCasualResult(result: CasualMatchResult) {
    this.#ready(); this.#hasContent = true; this.#dialog.dataset.view = 'match';
    this.#title.textContent = 'Match result'; this.#matchTrack.textContent = result.title;
    this.#body.replaceChildren();
    const heading = h('div',undefined,'casual-result-columns');
    for (const label of ['#','Player','Points']) heading.append(h('span',label));
    this.#body.append(heading);
    for (const player of result.players) {
      const row = h('div',undefined,'casual-result-row');
      row.classList.toggle('is-you', player.player_id === this.#player);
      if (player.team) row.dataset.team = player.team;
      const name = this.#button('',() => { if (player.player_id) this.profile?.(player.player_id); });
      name.className = 'player-with-portrait';
      name.disabled = !player.player_id || !this.profile;
      name.append(profilePicture(player.display_name,player.avatar_url),h('span',player.display_name));
      row.append(h('span',placing(player.place)),name,h('span',String(player.score)));
      this.#body.append(row);
    }
    this.#body.append(h('p',`${result.mode==='teams'?'Teams':'FFA'} · ${result.rounds} ${result.rounds===1?'round':'rounds'} · ${new Date(result.finished_at).toLocaleString()}`,'ranked-history-note'));
    this.#footer.replaceChildren(this.#button('Back',() => this.#casualList()));
  }

  #result(result: RankedMatchResult, checks: InputReview[] | null = null) {
    this.#dialog.dataset.view = 'match';
    this.#hasContent = true;
    this.#title.textContent = 'Match result';
    this.#ready();
    const metadata = h(
      'p',
      `${result.season ? result.season.name + ' · ' : ''}${new Date(result.finished_at).toLocaleString()}${result.rounds > 1 ? ` · ${result.rounds} rounds` : ''}`,
      'ranked-history-note match-result-metadata',
    );
    this.#body.replaceChildren();
    const artwork = new Map<string, LibraryTrack['thumbnail']>();
    try {
      for (const track of this.trackArt?.() ?? []) artwork.set(track.id, track.thumbnail);
    } catch {}
    this.#matchTrack.replaceChildren(
      this.#track({ track_id: result.track_id }, h('span'), artwork),
    );
    const columns = h('div', undefined, 'ranked-result-columns');
    for (const label of ['#', 'Player', 'Rating', 'Change']) {
      const column = h('span', label);
      if (label === '#') {
        column.replaceChildren(h('span', 'Place', 'pc-sr-only'), h('span', '#'));
        column.lastElementChild!.setAttribute('aria-hidden', 'true');
      }
      columns.append(column);
    }
    this.#body.append(columns);
    for (const player of result.players) {
      const row = h('div', undefined, 'ranked-result-row');
      row.classList.toggle('is-you', player.player_id === this.#player);
      const playerName = h(
        this.profile ? 'button' : 'span',
        undefined,
        'ranked-result-player player-with-portrait',
      );
      if (this.profile) {
        playerName.setAttribute('type', 'button');
        playerName.setAttribute('aria-label', 'View profile for ' + player.display_name);
        playerName.onclick = () => this.profile!(player.player_id);
      }
      playerName.append(
        profilePicture(player.display_name, player.avatar_url),
        playerLabel(player.display_name),
      );
      const position = h('span', placing(player.place));
      if (position.textContent === '—') {
        position.title = 'No placement recorded';
        position.setAttribute('aria-label', 'No placement recorded');
      }
      const change = this.#delta(player.rating_before, player.rating_after);
      if (player.streak_bonus && player.base_gain !== undefined) {
        change.title = `+${player.base_gain} match · +${player.streak_bonus} streak`;
        change.setAttribute('aria-label', change.textContent + '; ' + change.title);
      }
      row.append(position, playerName, h('span', number(player.rating_after)), change);
      playerLooks.decorate(row, player.player_id);
      this.#body.append(row);
      const flags =
        checks?.filter((c) => c.player_id === player.player_id && c.status === 'flagged') ?? [];
      if (flags.length) playerName.append(historyReviewWarning(flags, true));
    }
    this.#body.append(metadata);
    this.#footer.replaceChildren(
      this.#button('Back', () => {
        if (this.#rows.length) this.#list();
        else void this.#load();
      }),
    );
    if (typeof this.#client?.replay === 'function') void this.#replayAction(result.match_id);
  }

  async #replayAction(matchId: string) {
    const generation = this.#generation,
      client = this.#client!;
    const actions = h('div', undefined, 'ranked-history-replay');
    const button = this.#button('Watch replay', () => {}, true);
    button.title = 'Checking saved recordings…';
    actions.append(button);
    this.#body.append(actions);
    const current = () =>
      actions.isConnected &&
      this.#dialog.open &&
      client === this.#client &&
      this.#dialog.dataset.view === 'match';
    const load = async () => {
      try {
        const replay = await client.replay(matchId);
        if (generation !== this.#generation || !current()) return;
        if (!replay?.available) {
          button.textContent = 'Replay unavailable';
          button.title =
            'No complete recordings are saved for this match. Replays are kept for 30 days.';
          return;
        }
        button.disabled = false;
        button.title = replay.players.some((p) => !p.available)
          ? 'Watch saved runs. Some recordings are unavailable.'
          : 'Watch this match';
        const rounds = replay.rounds.length > 1 ? h('select') : null;
        if (rounds) {
          rounds.setAttribute('aria-label', 'Replay round');
          for (const n of replay.rounds) {
            const option = h('option', 'Round ' + n);
            option.value = String(n);
            rounds.append(option);
          }
          actions.prepend(rounds);
        }
        button.onclick = async () => {
          if (button.disabled) return;
          this.#replayAbort?.abort();
          const abort = (this.#replayAbort = new AbortController());
          button.disabled = true;
          button.textContent = 'Loading replay…';
          if (rounds) rounds.disabled = true;
          try {
            const full = await client.replay(
              matchId,
              true,
              rounds ? Number(rounds.value) : replay.round,
            );
            if (!current() || abort.signal.aborted) return;
            if (!full?.available) throw Error('This replay is no longer available.');
            await watchMatchReplay(this.#shadow, full, abort.signal);
          } catch (error) {
            if (abort.signal.aborted) return;
            this.#feedback.hidden = false;
            this.#feedback.setAttribute('role', 'alert');
            this.#feedback.replaceChildren(
              h(
                'span',
                error instanceof Error ? error.message : 'Could not load replay. Try again.',
              ),
            );
          } finally {
            button.disabled = false;
            button.textContent = 'Watch replay';
            if (rounds) rounds.disabled = false;
          }
        };
      } catch {
        if (!current()) return;
        button.textContent = 'Retry replay';
        button.disabled = false;
        button.title = 'Could not check saved recordings';
        button.onclick = () => {
          button.disabled = true;
          void load();
        };
      }
    };
    await load();
  }
}
