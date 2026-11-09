import type { ReplayReadout } from './native-replay.ts';
import { edgeClearance, visibleHudRect } from './hud-layout.ts';

/** Checkpoint standings, never final placements leaked ahead of playback. */
export function replayOrder(rows: ReplayReadout['rows']) {
  const group = (r: ReplayReadout['rows'][number]) =>
    r.status === 'finished' ? 0 : r.status === 'dnf' ? 2 : 1;
  return [...rows].sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.finish !== null && b.finish !== null ? a.finish - b.finish : 0) ||
      b.checkpoint - a.checkpoint ||
      a.crossing - b.crossing ||
      a.index - b.index,
  );
}
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

/** Uses the live race HUD's scoreboard, score-row, racer-name, car-skin and time
 * classes. Only the extra speed column and replay lifecycle differ. */
export function showReplayHUD(root: ShadowRoot, snapshot: () => ReplayReadout | null) {
  const style = document.createElement('style');
  style.textContent = `.hud.replay-standings{top:64px;width:min(460px,calc(100vw - 8px));max-height:40vh}
  .hud.replay-standings .scoreboard{margin:0}.hud.replay-standings .ranking-heading{display:flex}
  .hud.replay-standings .score-entry{display:block}.hud.replay-standings .scoreboard .score-row{grid-template-columns:20px minmax(0,1fr) 66px 100px}
  .replay-standings .replay-speed{text-align:right;white-space:nowrap;font-size:18px;font-weight:400}.replay-speed small{font-size:11px;margin-left:3px;color:inherit;opacity:.8}
  @media(max-width:650px),(max-height:500px){.hud.replay-standings{width:min(320px,calc(100vw - 8px));max-height:45vh}.hud.replay-standings .scoreboard .score-row{grid-template-columns:16px minmax(0,1fr) 53px 66px}.hud.replay-standings .ranking-heading{padding:6px 10px}.hud.replay-standings .ranking-heading>strong{font-size:18px}.replay-standings .replay-speed{font-size:15px}.replay-speed small{font-size:9px}}
  @media(max-width:500px){.hud.replay-standings{width:calc(100vw - 8px);max-height:30vh}}`;
  const panel = document.createElement('section');
  panel.className = 'hud replay-standings';
  panel.setAttribute('aria-label', 'Replay standings and speeds');
  const board = document.createElement('div');
  board.className = 'scoreboard single-round-ranked';
  const heading = document.createElement('div');
  heading.className = 'ranking-heading';
  const title = document.createElement('strong');
  title.textContent = 'RACE STANDINGS';
  title.title = 'Replay order at the latest checkpoint';
  heading.append(title);
  board.append(heading);
  panel.append(board);
  root.append(style, panel);
  const entries = new Map<
    number,
    {
      entry: HTMLDivElement;
      row: HTMLDivElement;
      position: HTMLElement;
      image: HTMLImageElement;
      name: HTMLSpanElement;
      speed: HTMLSpanElement;
      time: HTMLSpanElement;
    }
  >();
  const update = () => {
    const state = snapshot();
    panel.hidden =
      !state || [...document.querySelectorAll('.graph-ui')].some((e) => !!visibleHudRect(e));
    if (!state) return;
    const obstacles = [
      ...document.querySelectorAll(
        '.preview-toolbar-ui,.game-toolbar-ui > .button-container,.time-bar-ui,.input-visualizer-ui,.timer-ui > div,.checkpoint-ui,.speedometer-ui,#polycup-queue-controls',
      ),
    ]
      .map((e) => visibleHudRect(e))
      .filter((r): r is DOMRect => r !== null);
    const lane = panel.getBoundingClientRect();
    const clearance = edgeClearance({ left: lane.left, right: lane.right }, obstacles, innerHeight);
    panel.style.top = Math.max(8, clearance.top) + 'px';
    panel.style.maxHeight =
      Math.max(0, Math.min(innerHeight * 0.4, innerHeight - clearance.top - clearance.bottom)) +
      'px';
    for (const [i, r] of replayOrder(state.rows).entries()) {
      let el = entries.get(r.index);
      if (!el) {
        const entry = document.createElement('div'),
          row = document.createElement('div'),
          position = document.createElement('strong'),
          identity = document.createElement('div'),
          nameGroup = document.createElement('span'),
          image = document.createElement('img'),
          name = document.createElement('span'),
          speed = document.createElement('span'),
          time = document.createElement('span');
        entry.className = 'score-entry compact-row replay-standing';
        entry.dataset.racer = String(r.index);
        row.className = 'score-row';
        position.className = 'position';
        identity.className = 'score-identity';
        nameGroup.className = 'racer-name grow';
        image.className = 'car-skin';
        image.alt = '';
        image.src = new URL('images/car_thumbnail_placeholder.png', document.baseURI).href;
        speed.className = 'replay-speed';
        time.className = 'time';
        nameGroup.append(image, name);
        identity.append(nameGroup);
        row.append(position, identity, speed, time);
        entry.append(row);
        el = { entry, row, position, image, name, speed, time };
        entries.set(r.index, el);
      }
      el.entry.dataset.status = r.status;
      el.row.classList.toggle('highlighted', r.index === state.selected);
      el.position.textContent = r.status === 'dnf' ? '—' : String(i + 1);
      el.name.textContent = r.name;
      el.name.title = r.name;
      if (r.portrait && el.image.src !== r.portrait) el.image.src = r.portrait;
      const speed = r.status === 'dnf' ? '—' : r.speed === null ? '…' : String(Math.round(r.speed));
      if (el.speed.dataset.value !== speed) {
        el.speed.dataset.value = speed;
        const unit = document.createElement('small');
        unit.textContent = 'km/h';
        el.speed.replaceChildren(document.createTextNode(speed), unit);
      }
      el.time.textContent =
        r.status === 'dnf'
          ? 'DNF'
          : r.finish !== null
            ? clock(r.finish)
            : r.crossing > 0
              ? clock(r.crossing)
              : '—';
      el.time.title =
        r.status === 'dnf'
          ? 'Recording ended without a finish'
          : r.finish !== null
            ? 'Finish time'
            : 'Latest checkpoint time';
      board.append(el.entry);
    }
  };
  update();
  const timer = setInterval(update, 100);
  return () => {
    clearInterval(timer);
    panel.remove();
    style.remove();
  };
}
