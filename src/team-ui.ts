import { element as h } from './dom.ts';
import { TEAM_NAMES, teamStandings, type TeamId } from './teams.ts';
import type { CupState } from './types.ts';

export function teamChip(team: TeamId) {
  const chip = h('span', TEAM_NAMES[team], 'team-chip');
  chip.dataset.team = team;
  chip.title = `${TEAM_NAMES[team]} team`;
  return chip;
}
export function teamSummary(state: CupState) {
  const summary = h('section', undefined, 'team-scores');
  summary.setAttribute('aria-label', state.phase === 'registration' ? 'Teams' : 'Team standings');
  for (const team of teamStandings(state)) {
    const card = h('div', undefined, 'team-score');
    card.dataset.team = team.id;
    card.classList.toggle('is-winner', team.winner);
    card.append(
      teamChip(team.id),
      h(
        'strong',
        state.phase === 'registration' ? `${team.members.length} racers` : String(team.score),
        'team-total',
      ),
    );
    if (state.phase !== 'registration')
      card.append(
        h(
          'small',
          team.winner
            ? 'Winner'
            : team.overtime
              ? 'Overtime'
              : `/ ${state.matches[state.matchIndex].target}`,
        ),
      );
    summary.append(card);
  }
  const match = state.matches[state.matchIndex],
    last = match?.roundsLog.at(-1);
  if (state.phase !== 'registration' && last?.teamOutcome) {
    const labels = {
      ace: 'Ace',
      victory: 'Victory',
      draw: 'Draw',
      'no-finish': 'No finish',
      forfeit: 'Forfeit',
    };
    const overtime = teamStandings(state).some((team) => team.overtime);
    const status = h(
      'small',
      labels[last.teamOutcome] + (overtime ? ' · Overtime' : ''),
      'team-round-outcome',
    );
    if (overtime) status.classList.add('is-overtime');
    summary.append(status);
  }
  return summary;
}
