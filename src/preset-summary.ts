import { element as h } from './dom.ts';
import type { CupRules } from './presets.ts';
import { ruleTabs, type RuleCategory } from './rule-tabs.ts';

export function presetSummary(
  rules: CupRules,
  tabs?: {
    selected: RuleCategory;
    changed: (key: RuleCategory) => void;
    disconnectPolicy?: 'dnf' | 'void';
  },
) {
  const summary = h('div', undefined, 'preset-overview');
  const group = (title: string, entries: [string, string][]) => {
    const section = h('section', undefined, 'rule-group');
    section.setAttribute('aria-label', `${title} rules`);
    section.append(h('h3', title));
    const list = h('dl');
    for (const [label, value] of entries) {
      const row = h('div', undefined, 'rule-pair');
      row.append(h('dt', `${label}:`), h('dd', value));
      list.append(row);
    }
    section.append(list);
    summary.append(section);
  };
  group('Race', [
    ['Mode', rules.mode === 'teams' ? 'Teams · 2v2–4v4' : 'Free-for-all'],
    [
      'Rounds per track',
      rules.singleRound ? '1' : rules.singleTrack ? 'Until a winner' : String(rules.roundsPerTrack),
    ],
    [
      rules.singleRound ? 'Format' : rules.finalist ? 'Finalist target' : 'Points to win',
      rules.singleRound ? 'One round' : String(rules.pointsToWin),
    ],
    ...(rules.mode === 'teams'
      ? [['Ace / Victory / Draw', '3–0 / 2–1 / 1–1'] as [string, string]]
      : [['Finalist', rules.finalist ? 'Enabled' : 'Disabled'] as [string, string]]),
    [
      'To win',
      rules.mode === 'teams'
        ? 'First to 10; overtime if tied'
        : rules.singleRound
          ? 'Fastest finish'
          : rules.finalist
            ? 'Win as a finalist'
            : 'Lead at the target',
    ],
    ['Leaderboard uploads', rules.uploadLeaderboardTimes ? 'On' : 'Off'],
  ]);
  const tracks: [string, string][] = [
    [
      'Selection',
      rules.singleTrack
        ? 'One random track'
        : rules.selection === 'random'
          ? 'Random rotation'
          : 'Racer draft',
    ],
    [
      'Pool',
      rules.pool
        .filter((c) => c !== 'custom')
        .map((c) => (c === 'official' ? 'Main' : 'Community'))
        .join(' + ') || 'Custom only',
    ],
    ['Custom tracks', rules.pool.includes('custom') ? 'Allowed' : 'Disabled'],
  ];
  if (rules.selection === 'draft')
    tracks.push(
      ['Bans per racer', String(rules.bansPerRacer)],
      ['Picks per racer', String(rules.picksPerRacer)],
    );
  else tracks.push(['Bans / picks', 'None']);
  group('Tracks', tracks);
  const timing: [string, string][] = [
    [
      'Warmup',
      rules.warmup === 'off'
        ? 'Disabled'
        : rules.warmup === 'first-visit'
          ? 'First visit only'
          : 'Every visit',
    ],
  ];
  if (rules.warmup !== 'off') {
    timing.push([
      'Duration',
      rules.warmupTiming === 'fixed'
        ? `${rules.warmupSeconds}s`
        : `${rules.warmupMultiplier}× WR, min. ${rules.warmupMinimumSeconds}s`,
    ]);
    if (rules.warmupTiming === 'wr') timing.push(['Without a WR', `${rules.warmupSeconds}s`]);
    timing.push(['End warmup early', rules.readyEndsWarmup ? 'All racers ready' : 'Disabled']);
  }
  timing.push(
    ['Finish window', `${rules.finishTimeoutSeconds}s`],
    ['Round break', `${rules.roundBreakSeconds}s`],
  );
  group('Timing', timing);
  const racers: [string, string][] = [
    ['Mid-Cup changes', rules.allowRacerChanges ? 'Allowed' : 'Locked'],
  ];
  if (rules.allowRacerChanges)
    racers.push(['New racers', '0 points, next round'], ['Returning racers', 'Score retained']);
  else racers.push(['Reconnection', 'Score retained']);
  racers.push([
    'Spectator free camera',
    rules.allowSpectatorFreecam !== false ? 'Allowed' : 'Disabled',
  ]);
  if (tabs?.disconnectPolicy)
    racers.push(['On disconnect', tabs.disconnectPolicy === 'void' ? 'Void round' : 'Mark DNF']);
  group('Racers', racers);

  const scoring = h('table', undefined, 'rule-points');
  scoring.append(h('caption', 'Points by finishing position'));
  const head = h('thead'),
    places = h('tr'),
    body = h('tbody'),
    points = h('tr');
  rules.points.forEach((value, index) => {
    const place = h('th', `${index + 1}${['st', 'nd', 'rd'][index] ?? 'th'}`);
    place.scope = 'col';
    places.append(place);
    points.append(h('td', String(value)));
  });
  head.append(places);
  body.append(points);
  scoring.append(head, body);
  if (rules.mode !== 'teams') summary.append(scoring);
  if (tabs) {
    const groups = [...summary.querySelectorAll<HTMLElement>(':scope > .rule-group')];
    if (rules.mode !== 'teams') groups[0].append(scoring);
    summary.replaceChildren(
      ruleTabs(
        groups.map((panel, i) => ({
          key: (['race', 'tracks', 'timing', 'players'] as const)[i],
          label: ['Race', 'Tracks', 'Timing', 'Players'][i],
          panel,
        })),
        tabs.selected,
        tabs.changed,
      ),
    );
  }
  return summary;
}
