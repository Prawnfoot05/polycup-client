export interface PlayerActivity {
  kind: string;
  track?: string;
  queued?: boolean;
}
export interface ActivityPresence {
  online: boolean;
  label: string;
  away: boolean;
}
/** Records interaction time only; never records keys, pointer positions or input contents. */
export class ActivityTracker {
  #lastInput = Date.now();
  constructor(private read: () => PlayerActivity = () => ({ kind: 'menu' })) {
    const active = () => {
      this.#lastInput = Date.now();
    };
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'focus'])
      if (typeof window !== 'undefined') window.addEventListener(event, active, { passive: true });
  }
  sample() {
    const value = this.read();
    const driving = ['ranked', 'casual', 'spectating', 'practice'].includes(value.kind);
    return {
      ...value,
      track: (value.track ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100),
      away:
        (typeof document !== 'undefined' && document.hidden) ||
        (!driving && Date.now() - this.#lastInput >= 120000),
    };
  }
}
