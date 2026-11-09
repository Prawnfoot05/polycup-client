import { rulesFor } from './presets.ts';
import type { CupState, Match, PlayerId } from './types.ts';

export const TEAM_IDS = ['blue', 'red'] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAM_NAMES: Record<TeamId, string> = { blue: 'Blue', red: 'Red' };
export const isTeamId = (value: unknown): value is TeamId => value === 'blue' || value === 'red';
export const teamsEnabled = (s: CupState | null) => rulesFor(s).mode === 'teams';
export const teamOf = (s: CupState, id: PlayerId) => s.roster.find((p) => p.id === id)?.team;
export const teamMembers = (s: CupState, team: TeamId) => s.roster.filter((p) => p.team === team);

/** Assign only new racers. Existing choices survive preset edits and reconnects. */
export function syncTeams(s: CupState) {
  if (!teamsEnabled(s)) {
    for (const racer of s.roster) delete racer.team;
    return;
  }
  for (const racer of s.roster)
    if (!isTeamId(racer.team))
      racer.team = teamMembers(s, 'blue').length <= teamMembers(s, 'red').length ? 'blue' : 'red';
}
export function teamSetupError(s: CupState) {
  if (!teamsEnabled(s)) return '';
  const blue = teamMembers(s, 'blue').length,
    red = teamMembers(s, 'red').length;
  return blue < 2 || blue > 4 || blue !== red || blue + red !== s.roster.length
    ? 'Teams need equal sides of 2–4 racers.'
    : '';
}
function requireTeamSetup(s: CupState) {
  if (
    !teamsEnabled(s) ||
    s.draftStartsAt !== undefined ||
    s.phase !== 'registration' ||
    (s.draft && s.draft.stage !== 'roster')
  )
    throw new Error('Return to team setup before changing sides.');
}
export function assignTeam(s: CupState, id: number, team: unknown) {
  requireTeamSetup(s);
  const racer = s.roster.find((p) => p.id === id);
  if (!racer || !isTeamId(team)) throw new Error('Choose a racer and a valid team.');
  if (racer.team !== team && teamMembers(s, team).length >= 4)
    throw new Error('A team can have at most four racers.');
  racer.team = team;
  s.draftReady = [];
  delete s.draftStartsAt;
  s.revision++;
}
/** Players may join or switch their own side only while setup is open. */
export function joinTeam(s: CupState, id: number, name: string, team: unknown) {
  requireTeamSetup(s);
  if (!isTeamId(team) || !Number.isSafeInteger(id) || id <= 0)
    throw new Error('Choose a valid team.');
  let racer = s.roster.find((p) => p.id === id);
  if (!racer) {
    if (s.roster.length >= 8 || teamMembers(s, team).length >= 4)
      throw new Error('That team is full.');
    racer = { id, name: name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64), team };
    s.roster.push(racer);
  }
  assignTeam(s, id, team);
}
export function shuffleTeams(s: CupState, random = Math.random) {
  requireTeamSetup(s);
  const racers = [...s.roster];
  for (let i = racers.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [racers[i], racers[j]] = [racers[j], racers[i]];
  }
  racers.forEach((racer, i) => {
    racer.team = TEAM_IDS[i % 2];
  });
  s.draftReady = [];
  delete s.draftStartsAt;
  s.revision++;
}
export function teamTotal(_s: CupState, m: Match, team: TeamId) {
  return m.teamScores?.[team] ?? 0;
}
/** MVP uses committed race contributions, including earned points before departure. */
export function teamMvp(s: CupState) {
  const match = s.matches[s.matchIndex];
  const points = match ? Math.max(0, ...match.players.map((id) => match.scores[id] ?? 0)) : 0;
  return {
    points,
    ids: points ? match.players.filter((id) => match.scores[id] === points) : [],
  };
}
export function teamStandings(s: CupState, m = s.matches[s.matchIndex]) {
  return TEAM_IDS.map((id) => ({
    id,
    name: TEAM_NAMES[id],
    members: teamMembers(s, id),
    score: m ? teamTotal(s, m, id) : 0,
    overtime:
      !!m && teamTotal(s, m, 'blue') >= 10 && teamTotal(s, m, 'blue') === teamTotal(s, m, 'red'),
    gain: m?.roundsLog.at(-1)?.teamPoints?.[id] ?? 0,
    winner: !!m && m.winners.some((p) => teamOf(s, p) === id),
  })).sort((a, b) => Number(b.winner) - Number(a.winner) || b.score - a.score);
}

/** Same finish-point projection is used by the HUD and the host scorer. */
export function teamRacePoints(s: CupState, order: number[]) {
  const m = s.matches[s.matchIndex],
    run = s.runtime!;
  const available = (run.racers ?? m.players).filter((id) => !run.sittingOut?.includes(id));
  const counts = TEAM_IDS.map((team) => available.filter((id) => teamOf(s, id) === team).length);
  const count = Math.min(...counts),
    points: Record<number, number> = {},
    raw = { blue: 0, red: 0 };
  const scoring = order.filter(
    (id, i) =>
      available.includes(id) &&
      order
        .slice(0, i)
        .filter((other) => available.includes(other) && teamOf(s, other) === teamOf(s, id)).length <
        count,
  );
  for (const id of scoring) {
    const place = scoring.findIndex((other) => run.finishes[other] === run.finishes[id]);
    points[id] = count * 2 - place;
    raw[teamOf(s, id)!] += points[id];
  }
  return { counts, count, points, raw, scoring };
}
/** Trackmania 2v2 outcomes, extended to equal-size larger teams by finish points.
 * Only the same number of connected racers score on either side after a departure.
 * A retirement stays a DNF; it never shrinks the scoring team to improve its result.
 */
export function scoreTeamRound(
  s: CupState,
  m: Match,
  order: number[],
  _placements: Record<number, number>,
) {
  const run = s.runtime!;
  const { counts, count, points, raw, scoring } = teamRacePoints(s, order);
  const teamPoints = { blue: 0, red: 0 };
  let outcome: import('./types.ts').TeamOutcome = 'no-finish';
  m.teamScores ??= { blue: 0, red: 0 };
  if (!count && Math.max(...counts)) {
    const winner = TEAM_IDS[counts[0] ? 0 : 1];
    teamPoints[winner] = Math.max(
      0,
      10 - m.teamScores[winner],
      m.teamScores[winner === 'blue' ? 'red' : 'blue'] + 1 - m.teamScores[winner],
    );
    outcome = 'forfeit';
  } else if (count && order.length) {
    if (scoring.length) {
      if (raw.blue === raw.red) {
        teamPoints.blue = teamPoints.red = 1;
        outcome = 'draw';
      } else {
        const winner = raw.blue > raw.red ? 'blue' : 'red',
          loser = winner === 'blue' ? 'red' : 'blue';
        const winning = scoring.filter((id) => teamOf(s, id) === winner);
        const opponents = scoring.filter((id) => teamOf(s, id) === loser);
        const ace =
          !opponents.length ||
          (winning.length === count &&
            Math.max(...winning.map((id) => run.finishes[id])) <
              Math.min(...opponents.map((id) => run.finishes[id])));
        teamPoints[winner] = ace ? 3 : 2;
        teamPoints[loser] = ace ? 0 : 1;
        outcome = ace ? 'ace' : 'victory';
      }
    }
  }
  for (const [id, gain] of Object.entries(points)) m.scores[Number(id)] += gain;
  for (const team of TEAM_IDS) m.teamScores[team] += teamPoints[team];
  if (
    Math.max(m.teamScores.blue, m.teamScores.red) >= 10 &&
    m.teamScores.blue !== m.teamScores.red
  ) {
    const winner = m.teamScores.blue > m.teamScores.red ? 'blue' : 'red';
    m.winners = m.players.filter((id) => teamOf(s, id) === winner);
  }
  return { points, teamPoints, outcome };
}
