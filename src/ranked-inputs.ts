import type { Ranked } from './ranked.ts';
export interface InputRun {
  gameVersion: '0.6.3';
  round: number;
  track: string;
  finish: number;
  nativeFinish: number;
  timeOffset: number;
  captureScope?: 'attempt' | 'after_reset';
  recording: string;
  dnf?: boolean;
}
export interface PendingInput {
  match: string;
  player: string;
  instance: string;
  run: InputRun;
  at: number;
}
const KEY = 'polycup.ranked.inputs.pilot.v1';
/** Independent of rating delivery. Each racer submits only their own native
 * recording. Persistence and retries survive closing the game mid-Cup. */
export class RankedInputOutbox {
  #busy = false;
  #retryAfter = new Map<string, number>();
  #capacityAfter = new Map<string, number>();
  #key(item: PendingInput) {
    return `${item.player}:${item.match}:${item.run.round}`;
  }
  constructor(
    private api: Pick<Ranked, 'inputReviewEnabled' | 'submitInputRun'>,
    private user: () => string | null,
    private storage: Storage,
    private key = KEY,
    private retryMs?: number,
    private issue?: (
      item: Omit<PendingInput, 'at'>,
      state: 'retrying' | 'rejected' | 'storage_failed',
    ) => void,
  ) {}
  #reported = new Set<string>();
  #report(item: Omit<PendingInput, 'at'>, state: 'retrying' | 'rejected' | 'storage_failed') {
    const key = `${this.#key(item as PendingInput)}:${state}`;
    if (this.#reported.has(key)) return;
    if (this.#reported.size >= 600) this.#reported.clear();
    this.#reported.add(key);
    try {
      this.issue?.(item, state);
    } catch {
      /* Diagnostics cannot interrupt recording delivery. */
    }
  }
  #read(): PendingInput[] {
    try {
      const rows = JSON.parse(this.storage.getItem(this.key) || '[]');
      return Array.isArray(rows)
        ? rows.filter(
            (r) => r && typeof r.player === 'string' && r.run && Date.now() - r.at < 86400000,
          )
        : [];
    } catch {
      return [];
    }
  }
  enqueue(item: Omit<PendingInput, 'at'>) {
    const rows = this.#read();
    if (
      rows.some(
        (r) => r.player === item.player && r.match === item.match && r.run.round === item.run.round,
      )
    )
      return;
    rows.push({ ...item, at: Date.now() });
    if (rows.length > 200 || JSON.stringify(rows).length > 3500000) {
      this.#report(item, 'storage_failed');
      return;
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(rows));
      void this.flush();
    } catch {
      this.#report(item, 'storage_failed');
      /* Never interrupt racing on storage quota errors. */
    }
  }
  async flush() {
    if (this.#busy) return;
    const player = this.user();
    if (player && (this.#capacityAfter.get(player) ?? 0) > Date.now()) return;
    const item = this.#read().find(
      (r) => r.player === player && (this.#retryAfter.get(this.#key(r)) ?? 0) <= Date.now(),
    );
    if (!player || !item) return;
    this.#busy = true;
    try {
      if (!(await this.api.inputReviewEnabled()) || this.user() !== player) return;
      const accepted = await this.api.submitInputRun(item.match, item.instance, item.run);
      if (this.user() !== player) return;
      if (!accepted) {
        this.#retryAfter.set(this.#key(item), Date.now() + (this.retryMs ?? 60000));
        return;
      }
      this.storage.setItem(
        this.key,
        JSON.stringify(
          this.#read().filter(
            (r) =>
              !(r.player === player && r.match === item.match && r.run.round === item.run.round),
          ),
        ),
      );
    } catch (e) {
      if (this.user() !== player) return;
      if ((e as { code?: string }).code === 'PC001') {
        this.#report(item, 'rejected');
        this.storage.setItem(
          this.key,
          JSON.stringify(this.#read().filter((r) => this.#key(r) !== this.#key(item))),
        );
      } else if ((e as { code?: string }).code === 'PC002') {
        this.#capacityAfter.set(player, Date.now() + 300000);
      } else {
        this.#report(item, 'retrying');
        this.#retryAfter.set(this.#key(item), Date.now() + (this.retryMs ?? 30000));
      }
      // A rejected or offline row cannot starve later rounds/Cups.
    } finally {
      this.#busy = false;
    }
  }
}
