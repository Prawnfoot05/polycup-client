// Experimental local-only replay and handover. The physics binary is unchanged.
export const read24 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
export function readState(buffer) {
  const b = new Uint8Array(buffer),
    v = new DataView(buffer),
    finished = !!(b[11] & 2),
    at = finished ? 15 : 12;
  return {
    frame: read24(b, 4),
    speed: v.getFloat32(7, true),
    finished,
    checkpoint: v.getUint16(at, true),
    position: [0, 4, 8].map((i) => v.getFloat32(at + 2 + i, true)),
    quaternion: [0, 4, 8, 12].map((i) => v.getFloat32(at + 14 + i, true)),
  };
}
const mask = (c) =>
  (c.up ? 1 : 0) | (c.right ? 2 : 0) | (c.down ? 4 : 0) | (c.left ? 8 : 0) | (c.reset ? 16 : 0);
const controls = (m) => ({
  up: !!(m & 1),
  right: !!(m & 2),
  down: !!(m & 4),
  left: !!(m & 8),
  reset: !!(m & 16),
});
function write24(bytes, at, n) {
  bytes[at] = n & 255;
  bytes[at + 1] = (n >>> 8) & 255;
  bytes[at + 2] = (n >>> 16) & 255;
}
export class RollingRespawn {
  constructor({ step, reset, now = () => performance.now(), leadIn = 1000, maxFrames = 5999999 }) {
    this.stepNative = step;
    this.resetNative = reset;
    this.now = now;
    this.leadIn = leadIn;
    this.maxFrames = maxFrames;
    this.history = [];
    this.frame = 0;
    this.elapsed = 0;
    this.anchor = null;
    this.checkpoint = 0;
    this.checkpointTimes = [];
    this.replay = null;
    this.respawns = 0;
    this.finished = false;
    this.buffer = null;
    this.events = [];
    this.lastRespawn = null;
    this.error = null;
    this.fullJournal = [];
    this.journalComplete = true;
    this.lastJournalInput = '';
  }
  record(event) {
    if (this.fullJournal.length < 20000) this.fullJournal.push(event);
    else this.journalComplete = false;
  }
  recording() {
    return {
      schema: 1,
      kind: 'full-run-with-respawns',
      simulation: 'PolyTrack 0.6.3',
      frameMs: 1,
      leadInMs: this.leadIn,
      complete: this.journalComplete,
      officialUploadEligible: false,
      finishMs: this.finished ? this.elapsed : null,
      elapsedMs: this.elapsed,
      informationalCopiumMs: this.frame,
      events: this.fullJournal.map((event) => ({ ...event })),
    };
  }
  respawn() {
    if (this.finished || this.replay || !this.buffer || this.error) return false;
    const requestedAt = this.elapsed,
      fromFrame = this.frame,
      began = this.now(),
      target = this.anchor?.frame ?? 0,
      entry = Math.max(0, target - this.leadIn),
      saved = this.history.slice(0, target),
      anchor = this.anchor;
    this.resetNative();
    let raw;
    for (let f = 0; f < entry; f++) raw = this.stepNative(controls(saved[f]));
    const rebuildMs = Math.max(0, this.now() - began);
    this.elapsed += Math.ceil(rebuildMs);
    this.frame = entry;
    this.history.length = entry;
    this.respawns++;
    this.replay = target > entry ? { target, saved, anchor } : null;
    this.lastRespawn = {
      mode: 'flying',
      target,
      entry,
      rebuildMs,
      parity: null,
      positionError: null,
      speedError: null,
    };
    this.events.push({ type: 'respawn', elapsed: this.elapsed, ...this.lastRespawn });
    this.record({
      type: 'respawn',
      at: requestedAt,
      mode: 'flying',
      fromFrame,
      target,
      entry,
      checkpoint: this.checkpoint,
      rebuildMs: Math.ceil(rebuildMs),
      upgrade: false,
    });
    if (this.events.length > 128) this.events.shift();
    return true;
  }
  standingRespawn({ upgrade = false } = {}) {
    if (this.finished || !this.buffer || this.error) return false;
    const requestedAt = this.elapsed,
      fromFrame = this.frame,
      began = this.now(),
      target = this.anchor?.frame ?? 0,
      saved = (this.replay?.saved ?? this.history).slice(0, target);
    this.resetNative();
    for (let f = 0; f < target; f++) this.stepNative(controls(saved[f]));
    this.frame = target;
    this.history = saved;
    this.replay = null;
    this.finished = false;
    const raw = this.stepNative(controls(16));
    this.history[this.frame] = 16;
    this.frame++;
    const rebuildMs = Math.max(0, this.now() - began);
    this.elapsed += Math.ceil(rebuildMs) + 1;
    this.buffer = raw.slice(0);
    this.respawns += upgrade ? 0 : 1;
    const result = raw.slice(0);
    write24(new Uint8Array(result), 4, this.elapsed);
    this.result = result;
    // The reset tick is represented by the respawn event. Emit the next live
    // input state even when the held keys match those before the standing reset.
    this.lastJournalInput = '';
    this.lastRespawn = {
      mode: 'standing',
      target,
      entry: target,
      rebuildMs,
      parity: null,
      positionError: null,
      speedError: null,
    };
    this.events.push({ type: 'standing', elapsed: this.elapsed, target, upgrade });
    this.record({
      type: 'respawn',
      at: requestedAt,
      mode: 'standing',
      fromFrame,
      target,
      entry: target,
      checkpoint: this.checkpoint,
      rebuildMs: Math.ceil(rebuildMs),
      upgrade,
    });
    return true;
  }
  step(live) {
    if (this.finished) return this.result.slice(0);
    if (this.error) throw Error(this.error);
    if (this.frame >= this.maxFrames || this.elapsed >= this.maxFrames)
      throw Error('Practice recording limit reached; restart the run.');
    const replay = this.replay,
      applied = replay
        ? controls(replay.saved[this.frame])
        : controls(mask({ ...live, reset: false }));
    const raw = this.stepNative(applied),
      state = readState(raw);
    const inputKey = `${mask(live)}:${mask(applied)}:${!!replay}`;
    if (inputKey !== this.lastJournalInput) {
      this.record({
        type: 'inputs',
        at: this.elapsed,
        logicalFrame: this.frame,
        live: mask(live),
        applied: mask(applied),
        replaying: !!replay,
      });
      this.lastJournalInput = inputKey;
    }
    this.history[this.frame] = mask(applied);
    this.frame++;
    this.elapsed++;
    this.buffer = raw.slice(0);
    this.finished = state.finished;
    if (replay && this.frame === replay.target) {
      const expected = readState(replay.anchor.buffer),
        poseKeys = ['frame', 'speed', 'checkpoint', 'finished', 'position', 'quaternion'];
      this.lastRespawn.parity = poseKeys.every(
        (k) => JSON.stringify(expected[k]) === JSON.stringify(state[k]),
      );
      this.lastRespawn.positionError = Math.hypot(
        ...state.position.map((p, i) => p - expected.position[i]),
      );
      this.lastRespawn.speedError = Math.abs(state.speed - expected.speed);
      this.replay = null;
      this.events.push({ type: 'handover', elapsed: this.elapsed, ...this.lastRespawn });
      if (!this.lastRespawn.parity) {
        this.error = 'Checkpoint reconstruction differed; restart this run.';
        throw Error(this.error);
      }
    }
    if (!replay && state.checkpoint > this.checkpoint) {
      this.checkpoint = state.checkpoint;
      this.checkpointTimes[state.checkpoint - 1] = this.frame;
      this.anchor = { frame: this.frame, buffer: raw.slice(0) };
    }
    this.applied = applied;
    this.live = controls(mask(live));
    const result = raw.slice(0),
      bytes = new Uint8Array(result);
    write24(bytes, 4, this.elapsed);
    if (state.finished) write24(bytes, 12, this.elapsed);
    this.result = result.slice(0);
    if (state.finished) this.record({ type: 'finish', at: this.elapsed, logicalFrame: this.frame });
    return result;
  }
  status() {
    return {
      elapsed: this.elapsed,
      copium: this.frame,
      lost: Math.max(0, this.elapsed - this.frame),
      checkpoint: this.checkpoint,
      checkpointFrame: this.anchor?.frame ?? 0,
      checkpointTimes: this.checkpointTimes.slice(),
      respawns: this.respawns,
      phase: this.error
        ? 'error'
        : this.finished
          ? 'finished'
          : this.replay
            ? 'replaying'
            : 'driving',
      replayRemaining: this.replay ? this.replay.target - this.frame : 0,
      speed: this.buffer ? readState(this.buffer).speed : 0,
      applied: this.applied,
      live: this.live,
      lastRespawn: this.lastRespawn,
      error: this.error,
    };
  }
}
