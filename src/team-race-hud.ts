import { element as h } from './dom.ts';
import { currentMatch } from './cup.ts';
import { standings, recordTrack } from './standings.ts';
import { teamOf, teamMvp, TEAM_IDS, TEAM_NAMES, teamsEnabled, type TeamId } from './teams.ts';
import { formatTime as time } from './time.ts';
import { edgeClearance, visibleHudRect } from './hud-layout.ts';
import type { CupState } from './types.ts';

/** Persistent score cells keep one round's award animation alive across snapshots. */
export class TeamRaceHud {
  #root = h('section', undefined, 'team-race-header');
  #track = h('strong', '', 'team-match-track');
  #phase = h('span', '', 'team-match-phase');
  #announcement = h('div', undefined, 'team-round-announcement');
  #scores = new Map<TeamId, HTMLElement>();
  #gains = new Map<TeamId, HTMLElement>();
  #scope = '';
  #rounds = 0;
  #scoreKey = '';
  #until = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;
  #animations: Animation[] = [];
  #hiddenHints = new Map<HTMLElement, string>();
  #onComplete: () => void;

  constructor(parent: HTMLElement | ShadowRoot, onComplete: () => void) {
    this.#onComplete = onComplete;
    this.#root.hidden = true;
    const bar = h('div', undefined, 'team-match-bar');
    const middle = h('div', undefined, 'team-match-info');
    middle.append(this.#track, this.#phase);
    for (const team of TEAM_IDS) {
      const cell = h('div', undefined, 'team-match-score');
      cell.dataset.team = team;
      const score = h('strong', '0'),
        gain = h('span', '', 'team-match-gain');
      score.setAttribute('aria-label', `${TEAM_NAMES[team]} match score`);
      gain.hidden = true;
      cell.append(score, gain);
      this.#scores.set(team, score);
      this.#gains.set(team, gain);
      bar.append(cell);
      if (team === 'blue') bar.append(middle);
    }
    this.#announcement.hidden = true;
    this.#announcement.setAttribute('role', 'status');
    this.#announcement.setAttribute('aria-live', 'polite');
    this.#root.append(bar, this.#announcement);
    parent.append(this.#root);
  }

  get presentingResult() {
    return performance.now() < this.#until;
  }

  #syncHints(root: HTMLElement | null, hide: boolean) {
    for (const [hint, visibility] of this.#hiddenHints) {
      if (!hide || !root?.contains(hint)) {
        hint.style.visibility = visibility;
        this.#hiddenHints.delete(hint);
      }
    }
    if (!hide) return;
    for (const hint of root?.querySelectorAll<HTMLElement>('.hint-ui') ?? []) {
      if (!this.#hiddenHints.has(hint)) this.#hiddenHints.set(hint, hint.style.visibility);
      hint.style.visibility = 'hidden';
    }
  }

  #cancel() {
    clearTimeout(this.#timer);
    cancelAnimationFrame(this.#frame);
    this.#animations.forEach((a) => a.cancel());
    this.#animations = [];
    this.#until = 0;
    this.#announcement.hidden = true;
    for (const gain of this.#gains.values()) gain.hidden = true;
  }

  update(
    state: CupState | null,
    visible: boolean,
    nativeHud: HTMLElement | null,
    lane: HTMLElement,
  ) {
    const match =
      state && teamsEnabled(state) && state.phase !== 'registration' ? currentMatch(state) : null;
    // Driving instructions have no action between rounds and overlap the award strip.
    this.#syncHints(nativeHud, !!match && ['between-rounds', 'complete'].includes(state!.phase));
    if (!state || !match) {
      this.#root.hidden = true;
      this.#scope = this.#scoreKey = '';
      this.#cancel();
      lane.style.removeProperty('--team-header-bottom');
      return;
    }
    const scope = `${state.id}:${state.matchIndex}`;
    const initial = this.#scope !== scope;
    if (initial) {
      this.#cancel();
      this.#scope = scope;
      this.#rounds = match.rounds;
      this.#scoreKey = '';
    }
    const totals = match.teamScores!;
    const scoreKey = `${match.rounds}:${totals.blue}:${totals.red}`;
    this.#root.hidden = !visible;
    this.#track.textContent =
      state.tracks.find((t) => t.id === recordTrack(state))?.name ?? state.name;
    this.#track.title = this.#track.textContent;
    const overtime = totals.blue >= 10 && totals.blue === totals.red;
    this.#phase.textContent =
      state.phase === 'warmup'
        ? 'Warmup'
        : state.phase === 'loading'
          ? 'Loading track'
          : overtime
            ? 'Overtime'
            : `Round ${state.runtime?.round ?? Math.max(1, match.rounds)}`;
    this.#phase.classList.toggle('is-overtime', overtime);
    if (scoreKey !== this.#scoreKey) {
      const scored =
        !initial &&
        match.rounds > this.#rounds &&
        visible &&
        ['between-rounds', 'complete'].includes(state.phase);
      this.#cancel();
      this.#scoreKey = scoreKey;
      this.#rounds = match.rounds;
      for (const team of TEAM_IDS) this.#scores.get(team)!.textContent = String(totals[team]);
      const last = match.roundsLog.at(-1);
      if (scored && last?.teamPoints) {
        const gains = last.teamPoints;
        const winner =
          state.phase === 'complete' && match.winners.length
            ? teamOf(state, match.winners[0])!
            : gains.blue === gains.red
              ? null
              : gains.blue > gains.red
                ? 'blue'
                : 'red';
        const message =
          state.phase === 'complete' && winner
            ? `${TEAM_NAMES[winner]} team wins`
            : last.teamOutcome === 'draw'
              ? 'Draw'
              : last.teamOutcome === 'no-finish'
                ? 'No finish'
                : winner
                  ? `${TEAM_NAMES[winner]} team wins the round`
                  : 'Round complete';
        this.#announcement.replaceChildren(
          h('strong', message),
          h(
            'small',
            state.phase === 'complete' && last.teamOutcome !== 'forfeit'
              ? 'Match complete'
              : last.teamOutcome === 'ace'
                ? 'Ace'
                : last.teamOutcome === 'victory'
                  ? 'Victory'
                  : last.teamOutcome === 'forfeit'
                    ? 'Forfeit'
                    : overtime
                      ? 'Overtime'
                      : '',
          ),
        );
        this.#announcement.dataset.team = winner ?? '';
        this.#announcement.hidden = false;
        this.#until = performance.now() + 2300;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const team of TEAM_IDS) {
          const gain = this.#gains.get(team)!;
          gain.textContent = `+${gains[team]}`;
          gain.hidden = false;
          if (!reduced)
            this.#animations.push(
              gain.animate(
                [
                  { opacity: 0, transform: 'translateY(12px) scale(.7)' },
                  { opacity: 1, transform: 'translateY(0) scale(1.12)', offset: 0.25 },
                  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.65 },
                  { opacity: 0, transform: 'translateY(-24px) scale(.8)' },
                ],
                { duration: 1600, easing: 'ease-out', fill: 'forwards' },
              ),
            );
          this.#scores.get(team)!.textContent = String(
            reduced ? totals[team] : totals[team] - gains[team],
          );
        }
        if (!reduced) {
          this.#animations.push(
            this.#announcement.animate(
              [
                { opacity: 0, transform: 'translateY(-10px)' },
                { opacity: 1, transform: 'translateY(0)' },
              ],
              { duration: 250, fill: 'both', easing: 'ease-out' },
            ),
          );
          const start = performance.now();
          const tick = () => {
            const p = Math.max(0, Math.min(1, (performance.now() - start - 800) / 650));
            for (const team of TEAM_IDS)
              this.#scores.get(team)!.textContent = String(
                totals[team] - gains[team] + Math.round(gains[team] * p),
              );
            if (p < 1) this.#frame = requestAnimationFrame(tick);
          };
          this.#frame = requestAnimationFrame(tick);
        }
        this.#timer = setTimeout(() => {
          this.#cancel();
          this.#onComplete();
        }, 2300);
      }
    }
    if (visible) {
      const parts = nativeHud
        ? [
            ...nativeHud.querySelectorAll(
              '.game-toolbar-ui > .button-container,.game-toolbar-ui > .info-container,.timer-ui > .left,.timer-ui > .center,.timer-ui > .right',
            ),
          ]
            .map((e) => visibleHudRect(e))
            .filter((r): r is DOMRect => !!r)
        : [];
      const top = Math.max(
        6,
        edgeClearance(this.#root.getBoundingClientRect(), parts, innerHeight, 6).top,
      );
      this.#root.style.top = `${top}px`;
      const header = this.#root.getBoundingClientRect(),
        bounds = lane.getBoundingClientRect();
      const bottom = this.presentingResult
        ? Math.max(
            header.bottom,
            header.top + this.#announcement.offsetTop + this.#announcement.offsetHeight,
          )
        : header.bottom;
      lane.style.setProperty(
        '--team-header-bottom',
        bounds.right > header.left && bounds.left < header.right ? `${bottom + 8}px` : '0px',
      );
    }
  }
}

export function teamRaceStandings(
  state: CupState,
  name: (id: number) => HTMLElement,
  self: number | null,
) {
  const board = h('section', undefined, 'team-live-standings');
  board.setAttribute('aria-label', 'Team race standings');
  board.append(h('h2', 'Round standings'));
  const rows = standings(state);
  const last = currentMatch(state).roundsLog.at(-1);
  if (state.phase !== 'racing' && last)
    rows.sort(
      (a, b) =>
        Number(a.dnf) - Number(b.dnf) ||
        (a.frames ?? Infinity) - (b.frames ?? Infinity) ||
        a.id - b.id,
    );
  for (const racer of rows) {
    const team = teamOf(state, racer.id)!;
    const row = h('div', undefined, 'team-race-row');
    row.dataset.team = team;
    row.classList.toggle('is-you', racer.id === self);
    const place =
      racer.frames === undefined
        ? state.phase === 'racing' && !racer.dnf
          ? rows.indexOf(racer) + 1
          : '—'
        : rows.findIndex((other) => other.frames === racer.frames) + 1;
    row.append(
      h('span', String(place), 'team-race-place'),
      name(racer.id),
      h('strong', racer.gain ? `+${racer.gain}` : '', 'team-race-points'),
      h(
        'span',
        racer.dnf
          ? 'DNF'
          : racer.frames === undefined
            ? '—'
            : racer.delta && racer.delta > 0
              ? `+${(racer.delta / 1000).toFixed(3)}`
              : time(racer.frames),
        'team-race-time',
      ),
    );
    board.append(row);
  }
  const mvp = teamMvp(state);
  const mvpRow = h('div', undefined, 'team-mvp');
  const names = mvp.ids.map((id) => state.roster.find((p) => p.id === id)?.name ?? 'Racer');
  const leaders = h('span', names.join(' / ') || '—', 'team-mvp-names');
  leaders.title = names.join(' / ');
  mvpRow.append(
    h('small', mvp.ids.length > 1 ? 'Shared MVP' : 'MVP'),
    leaders,
    h('strong', mvp.points ? `${mvp.points} pts` : ''),
  );
  board.append(mvpRow);
  return board;
}
