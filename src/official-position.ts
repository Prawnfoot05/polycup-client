import { formatTime } from './time.ts';
import { rankedEndpoint, type ClientPlatform } from './client-platform.ts';

type Target = { track: string; frames: number; label: HTMLElement; node: HTMLElement; attempts: number; retryAt: number };
const targets = new Map<HTMLElement, Target>();
const cache = new Map<string, { until: number; position: number | null }>();
const observedRoots = new WeakSet<Node>();
const styledRoots = new WeakSet<Node>();
let scheduled = false,
  active = 0;
const queue: (() => Promise<void>)[] = [];
const pending = new Map<string, Target[]>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDue = Infinity;
function retryLater(at: number) {
  if (at >= retryDue) return;
  clearTimeout(retryTimer);
  retryDue = at;
  retryTimer = setTimeout(() => { retryDue = Infinity; schedule(); }, Math.max(0, at - Date.now()));
}
let serviceOrigin = '';
export function configureOfficialPositions(platform: ClientPlatform) {
  // Reuse the platform allowlist; no caller-selected upstream URLs.
  serviceOrigin = new URL(rankedEndpoint(platform, 'result'), location.origin).origin;
}
const css = `.pc-official-time{display:inline-grid;row-gap:.1em;align-content:center;justify-items:center;min-width:0;max-width:100%;vertical-align:middle;line-height:1.1;white-space:nowrap}.pc-official-time.has-comparison{grid-template-rows:1.1em .95em}.pc-lap-time{white-space:nowrap}.pc-official-position{font-size:.78em;color:#aebbd5;white-space:nowrap;font-weight:normal;line-height:1.2}.pc-official-position:empty{visibility:hidden}`;

function pump() {
  while (active < 2 && queue.length) {
    active++;
    void queue.shift()!().finally(() => {
      active--;
      pump();
    });
  }
}
function paint(label: HTMLElement, position: number | null) {
  if (position !== null && label.isConnected) {
    label.textContent = `(PT #${position.toLocaleString('en-US')})`;
    label.setAttribute('aria-label', `Current verified PolyTrack placement ${position}`);
  }
}
function flush() {
  scheduled = false;
  const batches = new Map<string, Map<number, HTMLElement[]>>();
  for (const [node, target] of targets) {
    if (!node.isConnected) {
      targets.delete(node);
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      rect.bottom < 0 ||
      rect.top > innerHeight ||
      rect.right < 0 ||
      rect.left > innerWidth
    )
      continue;
    if (target.retryAt > Date.now()) { retryLater(target.retryAt); continue; }
    targets.delete(node);
    const key = `${target.track}:${target.frames}`,
      old = cache.get(key);
    if (old && old.until > Date.now()) {
      if (old.position !== null) { paint(target.label, old.position); continue; }
      target.retryAt = old.until + 100;
      targets.set(node, target);
      retryLater(target.retryAt);
      continue;
    }
    if (pending.has(key)) {
      pending.get(key)!.push(target);
      continue;
    }
    pending.set(key, [target]);
    if (!batches.has(target.track)) batches.set(target.track, new Map());
    batches.get(target.track)!.set(target.frames, [target.label]);
  }
  for (const [track, batch] of batches) {
    const times = [...batch.keys()];
    for (let offset = 0; offset < times.length; offset += 8) {
      const frames = times.slice(offset, offset + 8);
      queue.push(async () => {
        const positions = new Map<number, number>();
        let retryable = true;
        try {
          if (
            !frames.some((time) =>
              pending.get(`${track}:${time}`)?.some((target) => target.node.isConnected),
            )
          )
            return;
          const response = await fetch(
            `${serviceOrigin}/native/official-positions?${new URLSearchParams({ track, times: frames.join(',') })}`,
            { credentials: 'omit', signal: AbortSignal.timeout(10000) },
          );
          retryable = ![400, 404].includes(response.status);
          if (response.ok) {
            const data = await response.json();
            for (const row of data.positions ?? [])
              if (
                frames.includes(row.frames) &&
                Number.isSafeInteger(row.position) &&
                row.position > 0
              )
                positions.set(row.frames, row.position);
          }
        } catch {
          /* Optional decoration. Retry transient failures without blocking results. */
        } finally {
          for (const time of frames) {
            const key = `${track}:${time}`,
              position = positions.get(time) ?? null;
            if (cache.size >= 512) cache.delete(cache.keys().next().value!);
            cache.set(key, { until: Date.now() + (position === null ? 15000 : 120000), position });
            for (const target of pending.get(key) ?? []) {
              paint(target.label, position);
              if (position === null && retryable && target.node.isConnected && target.attempts < 3) {
                target.retryAt = Date.now() + [16000, 45000, 120000][target.attempts++];
                targets.set(target.node, target);
                retryLater(target.retryAt);
              }
            }
            pending.delete(key);
          }
        }
      });
    }
  }
  pump();
}
function schedule() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flush);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('online', () => {
    for (const target of targets.values()) {
      target.retryAt = 0;
      const key = `${target.track}:${target.frames}`;
      if (cache.get(key)?.position === null) cache.delete(key);
    }
    schedule();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
}

/** Render immediately; all remote work begins after paint and never gates its caller. */
export function officialLapTime(
  track: string | null | undefined,
  frames: number | null | undefined,
  fallback = '—',
  className = '',
): HTMLElement {
  const node = document.createElement('span');
  node.className = `pc-official-time ${className}`;
  const value = document.createElement('span');
  value.className = 'pc-lap-time';
  value.textContent = typeof frames === 'number' && frames > 0 ? formatTime(frames) : fallback;
  node.append(value);
  if (!track || !/^[a-f0-9]{64}$/.test(track) || !Number.isSafeInteger(frames) || frames! <= 0)
    return node;
  node.classList.add('has-comparison');
  const label = document.createElement('small');
  label.className = 'pc-official-position';
  node.append(label);
  // The view may be assembled off-DOM. Registration runs only after insertion.
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    const root = node.getRootNode();
    if (!styledRoots.has(root)) {
      const style = document.createElement('style');
      style.textContent = css;
      (root instanceof ShadowRoot ? root : document.head).append(style);
      styledRoots.add(root);
    }
    if (!observedRoots.has(root)) {
      new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
      observedRoots.add(root);
    }
    targets.set(node, { track, frames: frames!, label, node, attempts: 0, retryAt: 0 });
    schedule();
  });
  return node;
}
