import { startCue } from './countdown.ts';
import type { LoadedTrack } from './game-types.ts';

export type SoloTrack = LoadedTrack & { category: 'official' | 'community' };
type NativePractice = {
  current: () => object;
  available: () => boolean;
  load: (id: string) => Promise<SoloTrack | null>;
  launch: (track: SoloTrack) => void;
};
type Rotation = {
  pool: string[];
  bag: string[];
  last?: string;
  game?: object;
  resumeLoad?: () => void;
  advance?: Promise<boolean>;
  startedAt?: number;
  transition?: {
    kind: 'start' | 'advance';
    remaining: number;
    at: number;
    action: () => void;
  };
};

export class RankedPracticeRun {
  #native?: NativePractice;
  #run?: Rotation;
  #timer?: ReturnType<typeof setTimeout>;
  #held = false;
  #cueFrame?: number;

  constructor(
    private readonly showError: (message: string) => void,
    private readonly renderCue?: () => void,
  ) {}

  bind(native: NativePractice) { this.#native = native; }

  async start(pool: string[], pickerOpen: () => boolean) {
    if (!this.#native?.available()) throw new Error('Leave the current session before starting ranked practice.');
    if (!pool.length) throw new Error('No active ranked track pool.');
    this.cancel();
    const run: Rotation = { pool: [...new Set(pool)], bag: [] };
    this.#run = run;
    try { if (!(await this.#next(run, () => !pickerOpen())) && this.#run === run) this.cancel(); }
    catch (error) { if (this.#run === run) this.cancel(); throw error; }
  }

  cancel() {
    this.#run?.resumeLoad?.();
    this.#run = undefined;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#refreshCue();
  }

  setHeld(held: boolean) {
    if (held === this.#held) return;
    this.#held = held;
    const run = this.#run;
    if (!run) return;
    if (held) {
      const transition = run.transition;
      if (transition) transition.remaining = Math.max(0, transition.at - performance.now());
      clearTimeout(this.#timer);
      run.startedAt = undefined;
    } else {
      this.#arm(run);
      run.resumeLoad?.();
    }
    this.#refreshCue();
  }

  #refreshCue() {
    if (!this.renderCue) return;
    if (this.#cueFrame !== undefined) cancelAnimationFrame(this.#cueFrame);
    this.#cueFrame = undefined;
    this.renderCue();
    if (this.countdownCue()) {
      this.#cueFrame = requestAnimationFrame(() => {
        this.#cueFrame = undefined;
        this.#refreshCue();
      });
    }
  }

  #schedule(run: Rotation, kind: 'start' | 'advance', remaining: number, action: () => void) {
    clearTimeout(this.#timer);
    run.transition = { kind, remaining, at: 0, action };
    this.#arm(run);
  }

  #arm(run: Rotation) {
    const transition = run.transition;
    if (!transition || this.#held) return;
    transition.at = performance.now() + transition.remaining;
    this.#timer = setTimeout(() => {
      if (this.#run !== run || run.transition !== transition || this.#held) return;
      run.transition = undefined;
      if (this.#native?.current() === run.game) transition.action();
    }, transition.remaining);
  }

  async #next(run: Rotation, cancelled = () => false) {
    const native = this.#native!;
    const scene = native.current();
    if (!run.bag.length) {
      run.bag = [...run.pool];
      for (let i = run.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [run.bag[i], run.bag[j]] = [run.bag[j], run.bag[i]];
      }
      if (run.bag.length > 1 && run.bag.at(-1) === run.last) {
        const end = run.bag.length - 1;
        [run.bag[0], run.bag[end]] = [run.bag[end], run.bag[0]];
      }
    }
    while (run.bag.length) {
      const id = run.bag.pop()!;
      const track = await native.load(id).catch(() => null);
      while (this.#held && this.#run === run)
        await new Promise<void>(resolve => { run.resumeLoad = resolve; });
      run.resumeLoad = undefined;
      if (this.#run !== run || native.current() !== scene) return false;
      if (cancelled()) return false;
      if (!native.available()) throw new Error('Ranked practice was interrupted.');
      if (!track) continue;
      run.last = id;
      native.launch(track);
      return true;
    }
    throw new Error('Could not load a ranked track.');
  }

  entered(game: object, start: () => void) {
    const run = this.#run;
    if (!run) return;
    run.game = game;
    run.advance = undefined;
    run.startedAt = undefined;
    this.#schedule(run, 'start', 3000, () => {
      start();
      run.startedAt = performance.now();
      this.#refreshCue();
    });
    this.#refreshCue();
  }

  countdownCue() {
    const run = this.#run;
    if (!run?.game || this.#held || this.#native?.current() !== run.game) return '';
    const now = performance.now();
    if (run.transition?.kind === 'start') return startCue(Math.max(1, run.transition.at - now));
    return run.startedAt === undefined ? '' : startCue(run.startedAt - now);
  }

  waiting(game: object) {
    return this.#run?.game === game && this.#run.transition?.kind === 'start';
  }

  #advance(game: object, token?: { isCancelled: boolean }) {
    const run = this.#run;
    if (!run || run.game !== game || this.#held) return Promise.resolve(false);
    if (run.advance) return run.advance;
    if (run.transition?.kind === 'advance') {
      clearTimeout(this.#timer);
      run.transition = undefined;
    }
    run.advance = this.#next(run, () => token?.isCancelled === true).catch(error => {
      if (this.#run === run && !token)
        this.showError(error instanceof Error ? error.message : 'Could not load a ranked track.');
      return false;
    }).then(launched => {
      if (!launched) run.advance = undefined;
      // The native button's failure dialog belongs to the old scene.
      return launched || this.#run !== run;
    });
    return run.advance;
  }

  finish(game: object) {
    const run = this.#run;
    if (run?.game !== game || run.advance || run.transition) return;
    this.#schedule(run, 'advance', 2000, () => void this.#advance(game));
  }

  skip(game: object, token?: { isCancelled: boolean }) {
    return this.#advance(game, token);
  }

  discard(game: object) {
    if (this.#run?.game !== game) return false;
    if (!this.waiting(game)) void this.skip(game);
    return true;
  }
}
