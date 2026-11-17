import { validateRespawnRecording } from './respawn-recording.ts';
import type { InputRun } from './ranked-inputs.ts';

/** Archive the chronological run, never a stitched native upload surrogate. */
export async function respawnReplayRun(value: unknown, round: number, track: string,
  offset: number, dnf: boolean): Promise<InputRun> {
  const trace = validateRespawnRecording(value);
  if (!!dnf !== (trace.finishMs === null) || !Number.isSafeInteger(offset) || offset < 0)
    throw Error('Respawn replay does not match the race result.');
  const raw = JSON.stringify(trace);
  if (raw.length > 4194304) throw Error('Respawn replay is too large.');
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const recording = btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  if (recording.length > 131072) throw Error('Respawn replay is too large.');
  return { gameVersion:'0.6.3', round, track, nativeFinish:trace.elapsedMs,
    finish:trace.elapsedMs + offset, timeOffset:offset, captureScope:'attempt',
    recordingFormat:'respawn-v1', recording, dnf };
}
