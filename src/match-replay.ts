import { launchNativeReplay } from './native-replay.ts';
import { showReplayHUD } from './replay-hud.ts';

export interface MatchReplay {
  match_id: string;
  game_version: string;
  available: boolean;
  round: number | null;
  track: string | null;
  rounds: number[];
  players: {
    player_id: string;
    name: string;
    style: string | null;
    place: number | null;
    available: boolean;
    dnf?: boolean;
    finish: number | null;
    native_finish: number | null;
    time_offset: number | null;
    recording?: string;
  }[];
}
export interface ReplayGhost {
  name: string;
  style: string | null;
  finish: number;
  nativeFinish: number;
  offset: number;
  dnf: boolean;
  inputs: Record<'up' | 'right' | 'down' | 'left' | 'reset', number[]>;
}

/** Native 0.6.3 recordings have five delta-coded uint24 toggle lists. Keep
 * their original millisecond precision, including the race-start clock offset.
 * Bound decompression before handing data to the native ghost worker. */
export async function replayGhost(player: MatchReplay['players'][number]): Promise<ReplayGhost> {
  const { recording, native_finish: finish, time_offset: offset } = player;
  if (
    !recording ||
    recording.length > 131072 ||
    !/^[A-Za-z0-9_-]+$/.test(recording) ||
    !Number.isSafeInteger(finish) ||
    finish! < 1 ||
    finish! > 3600000 ||
    !Number.isSafeInteger(offset) ||
    offset! < 0 ||
    offset! > 3600000 ||
    player.finish !== finish! + offset!
  )
    throw Error('This replay recording is unavailable.');
  const raw = Uint8Array.from(atob(recording.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  const reader = new Blob([raw])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072) throw Error('Replay recording is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  cursor = 0;
  const read = () => {
    if (cursor + 3 > size) throw Error('Replay recording is incomplete.');
    const n = bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16);
    cursor += 3;
    return n;
  };
  let events = 0;
  const inputs = {} as ReplayGhost['inputs'];
  for (const key of ['up', 'right', 'down', 'left', 'reset'] as const) {
    const count = read();
    if ((events += count) > 8192 || cursor + count * 3 > size)
      throw Error('Replay recording is invalid.');
    const times: number[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      const delta = read();
      if (i && !delta) throw Error('Replay recording is invalid.');
      at += delta;
      if (at > 5999999 || at + offset! > 5999999) throw Error('Replay recording is invalid.');
      times.push(at);
    }
    inputs[key] = times;
  }
  if (cursor !== size) throw Error('Replay recording is invalid.');
  return {
    name: player.name + (player.dnf ? ' · DNF' : ''),
    style: player.style,
    finish: player.finish!,
    nativeFinish: finish!,
    offset: offset!,
    dnf: !!player.dnf,
    inputs,
  };
}

export async function watchMatchReplay(root: ShadowRoot, replay: MatchReplay, signal: AbortSignal) {
  if (replay.game_version !== '0.6.3' || !replay.track || !replay.available)
    throw Error('This match has no saved replay.');
  const players = replay.players.filter((p) => p.available);
  if (!players.length || players.length > 16) throw Error('This match has no saved replay.');
  const ghosts = await Promise.all(players.map(replayGhost));
  if (signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
  // Release modal inertness while watching, then restore exactly the previous
  // history/profile stack on Exit. A ranked handoff owns the UI if it interrupts.
  let saved: { dialog: HTMLDialogElement; modal: boolean }[] = [];
  const restore = () => {
    for (const { dialog, modal } of saved) {
      if (!dialog.isConnected || dialog.open) continue;
      if (modal) dialog.showModal();
      else dialog.open = true;
    }
    if (saved.some((s) => s.dialog.classList.contains('cup-hub')))
      document.body.classList.add('polycup-menu-covered');
    saved = [];
  };
  try {
    const { ended, snapshot } = await launchNativeReplay(replay.track, ghosts, signal, () => {
      saved = [...root.querySelectorAll<HTMLDialogElement>('dialog[open]')].map((dialog) => ({
        dialog,
        modal: dialog.matches(':modal'),
      }));
      for (const { dialog } of [...saved].reverse()) dialog.close();
      document.body.classList.remove('polycup-menu-covered');
    });
    const removeHUD=showReplayHUD(root,snapshot);
    void ended.then((reason) => {
      removeHUD();
      if (reason === 'exit') restore();
      else saved = [];
    });
  } catch (error) {
    restore();
    throw error;
  }
}
