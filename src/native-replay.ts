export const REPLAY_EVENT = 'polycup-watch-replay';
export interface ReplayReadout {
  time: number;
  selected: number;
  rows: {
    index: number;
    name: string;
    portrait?: string;
    checkpoint: number;
    crossing: number;
    speed: number | null;
    finish: number | null;
    status: 'racing' | 'finished' | 'dnf' | 'loading';
  }[];
}
export function launchNativeReplay(
  track: string,
  ghosts: import('./match-replay.ts').ReplayGhost[],
  signal: AbortSignal,
  started: () => void,
): Promise<{ ended: Promise<'exit' | 'interrupted'>; snapshot: () => ReplayReadout | null }> {
  return new Promise((resolve, reject) => {
    let done = false;
    let finish!: (reason: 'exit' | 'interrupted') => void;
    const ended = new Promise<'exit' | 'interrupted'>((resolve) => {
      finish = resolve;
    });
    const request = {
      track,
      ghosts,
      accepted: false,
      cancel: () => {},
      snapshot: (): ReplayReadout | null => null,
      started,
      ended: finish,
      complete: (error?: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(Error(error));
        else resolve({ ended, snapshot: () => request.snapshot() });
      },
    };
    const abort = () => {
      request.cancel();
      request.complete('Replay cancelled.');
    };
    const timer = setTimeout(() => {
      request.cancel();
      request.complete('Replay loading timed out. Try again.');
    }, 50000);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: request }));
    if (!request.accepted)
      request.complete('Replay viewing is not available in this game version.');
  });
}
