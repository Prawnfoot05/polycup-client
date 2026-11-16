/** Watch-only chronological recordings. Never encode these as native upload inputs. */
export interface RespawnRecording {
  schema: 1;
  kind: 'full-run-with-respawns';
  simulation: 'PolyTrack 0.6.3';
  frameMs: 1;
  leadInMs?: number;
  complete: true;
  officialUploadEligible: false;
  finishMs: number | null;
  elapsedMs: number;
  informationalCopiumMs: number;
  events: (
    | {
        type: 'inputs';
        at: number;
        logicalFrame: number;
        live: number;
        applied: number;
        replaying: boolean;
      }
    | {
        type: 'respawn';
        at: number;
        mode: 'flying' | 'standing';
        fromFrame: number;
        target: number;
        entry: number;
        checkpoint: number;
        rebuildMs: number;
        upgrade: boolean;
      }
    | { type: 'finish'; at: number; logicalFrame: number }
  )[];
}

export function validateRespawnRecording(value: unknown): RespawnRecording {
  const fail = (): never => {
    throw Error('Respawn replay is incomplete or invalid.');
  };
  if (!value || typeof value !== 'object') return fail();
  const r = value as RespawnRecording;
  const int = (n: unknown, max = 5999999): n is number =>
    Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
  if (
    r.schema !== 1 ||
    r.kind !== 'full-run-with-respawns' ||
    r.simulation !== 'PolyTrack 0.6.3' ||
    r.frameMs !== 1 ||
    r.complete !== true ||
    r.officialUploadEligible !== false ||
    !int(r.elapsedMs) ||
    r.elapsedMs < 1 ||
    !int(r.informationalCopiumMs) ||
    r.informationalCopiumMs > r.elapsedMs ||
    (r.leadInMs !== undefined && r.leadInMs !== 1000) ||
    (r.finishMs !== null && r.finishMs !== r.elapsedMs) ||
    !Array.isArray(r.events) ||
    !r.events.length ||
    r.events.length > 20000
  )
    return fail();
  let previous = 0,
    finish = 0,
    respawns = 0,
    rebuildWork = 0;
  for (const e of r.events) {
    if (!e || !int(e.at) || e.at < previous || e.at > r.elapsedMs) return fail();
    previous = e.at;
    if (e.type === 'inputs') {
      if (
        !int(e.logicalFrame) ||
        !int(e.live, 31) ||
        !int(e.applied, 31) ||
        typeof e.replaying !== 'boolean' ||
        e.at === r.elapsedMs
      )
        return fail();
    } else if (e.type === 'respawn') {
      if (
        !['flying', 'standing'].includes(e.mode) ||
        !int(e.fromFrame) ||
        !int(e.target) ||
        !int(e.entry) ||
        e.entry > e.target ||
        e.target > e.fromFrame + 1000 ||
        !int(e.checkpoint, 65535) ||
        !int(e.rebuildMs) ||
        e.at + e.rebuildMs + (e.mode === 'standing' ? 1 : 0) > r.elapsedMs ||
        typeof e.upgrade !== 'boolean' ||
        (e.mode === 'flying' && e.upgrade) ||
        ++respawns > 256 ||
        (rebuildWork += e.target) > 5000000
      )
        return fail();
    } else if (e.type === 'finish') {
      if (++finish !== 1 || !int(e.logicalFrame) || e.at !== r.finishMs || e !== r.events.at(-1))
        return fail();
    } else return fail();
  }
  if ((r.finishMs !== null) !== !!finish || r.events[0].type !== 'inputs' || r.events[0].at !== 0)
    return fail();
  // Own a bounded copy. The caller cannot mutate a running viewer through its original object.
  return JSON.parse(JSON.stringify(r)) as RespawnRecording;
}
