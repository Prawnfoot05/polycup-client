/** Spread read retries after an outage without replaying a player's action. */
export class PollRetry {
  private failures = 0;
  private until = 0;
  ready(now: number) { return now >= this.until; }
  reset() { this.failures = 0; this.until = 0; }
  failed(now: number, active: boolean, random = Math.random()) {
    const ceiling = active ? 8000 : 30000;
    const delay = Math.min(ceiling, 2000 * 2 ** Math.min(this.failures++, 4));
    this.until = now + Math.round(delay * (0.8 + 0.2 * random));
    return this.until;
  }
}
