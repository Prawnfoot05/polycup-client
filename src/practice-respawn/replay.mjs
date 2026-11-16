import { RollingRespawn } from './core.mjs';
export { RollingRespawn, readState } from './core.mjs';
import { validateRespawnRecording } from '../respawn-recording.ts';
const bits = (c) =>
  (c.up ? 1 : 0) | (c.right ? 2 : 0) | (c.down ? 4 : 0) | (c.left ? 8 : 0) | (c.reset ? 16 : 0);
const controls = (m) => ({
  up: !!(m & 1),
  right: !!(m & 2),
  down: !!(m & 4),
  left: !!(m & 8),
  reset: !!(m & 16),
});
const stamp = (buffer, at) => {
  const out = buffer.slice(0),
    b = new Uint8Array(out);
  b[4] = at & 255;
  b[5] = (at >>> 8) & 255;
  b[6] = (at >>> 16) & 255;
  return out;
};

/** One output per elapsed millisecond, including failed attempts and rebuild holds.
 * Only the original WASM is allowed to generate poses. No recorded pose is trusted. */
export class RespawnPlayback {
  constructor(recording, native) {
    this.recording = validateRespawnRecording(recording);
    this.clock = 0;
    this.core = new RollingRespawn({ ...native, now: () => this.clock });
    this.index = 0;
    this.at = 0;
    this.live = 0;
    this.last = null;
    this.pending = null;
    this.checked = false;
  }
  fail() {
    throw Error('Respawn replay does not reproduce its recorded timeline.');
  }
  verifyEnd() {
    if (this.checked) return;
    const r = this.recording,
      c = this.core;
    if (
      this.index !== r.events.length ||
      c.elapsed !== r.elapsedMs ||
      c.frame !== r.informationalCopiumMs ||
      c.finished !== (r.finishMs !== null)
    )
      this.fail();
    this.checked = true;
  }
  next() {
    if (this.at >= this.recording.elapsedMs) {
      this.verifyEnd();
      return stamp(this.last, ++this.at);
    }
    if (this.pending) {
      const end = this.pending.end;
      this.at++;
      const out = stamp(this.at === end ? this.pending.final : this.pending.hold, this.at);
      if (this.at === end) {
        this.last = this.pending.final;
        this.pending = null;
        if (this.at === this.recording.elapsedMs) this.verifyEnd();
      }
      return out;
    }
    const c = this.core,
      events = this.recording.events;
    let expected = null;
    while (this.index < events.length && events[this.index].at === c.elapsed) {
      const e = events[this.index++];
      if (e.type === 'respawn') {
        if (
          expected ||
          c.finished ||
          c.frame !== e.fromFrame ||
          c.checkpoint !== e.checkpoint ||
          (c.anchor?.frame ?? 0) !== e.target ||
          e.entry !== (e.mode === 'standing' ? e.target : Math.max(0, e.target - 1000)) ||
          (e.upgrade && c.lastRespawn?.mode !== 'flying')
        )
          this.fail();
        const hold = this.last;
        // Rebuild clock is replay data; CPU duration on this device must not alter it.
        let calls = 0;
        c.now = () => (calls++ ? e.rebuildMs : 0);
        const ok = e.mode === 'flying' ? c.respawn() : c.standingRespawn({ upgrade: e.upgrade });
        c.now = () => 0;
        if (!ok) this.fail();
        const end = c.elapsed,
          final = e.mode === 'standing' ? c.result : hold;
        if (end > this.at) {
          if (!hold || !final) this.fail();
          this.pending = { end, hold, final };
          return this.next();
        }
      } else if (e.type === 'inputs') {
        if (expected || e.logicalFrame !== c.frame || e.replaying !== !!c.replay) this.fail();
        this.live = e.live;
        expected = e;
      } else this.fail();
    }
    if (this.index < events.length && events[this.index].at < c.elapsed) this.fail();
    if (c.elapsed !== this.at || c.finished) this.fail();
    const out = c.step(controls(this.live));
    if (expected && bits(c.applied) !== expected.applied) this.fail();
    // The native worker transfers returned buffers to the renderer. Retain an
    // owned copy for reconstruction holds and finish/DNF padding.
    this.at = c.elapsed;
    this.last = out.slice(0);
    if (c.finished) {
      const e = events[this.index++];
      if (!e || e.type !== 'finish' || e.at !== c.elapsed || e.logicalFrame !== c.frame)
        this.fail();
    }
    if (this.at === this.recording.elapsedMs) this.verifyEnd();
    return out;
  }
}

/** Stateless presentation lookup also works after backwards seeking. */
export function respawnPresentation(recording, at) {
  let end = 0,
    started = false;
  for (const e of recording.events) {
    if (e.at > at) break;
    if (e.type === 'respawn') {
      started = true;
      end = e.mode === 'flying' ? e.at + e.rebuildMs + e.target - e.entry : e.at + e.rebuildMs + 1;
    }
  }
  return { started, locked: started && at < end };
}
