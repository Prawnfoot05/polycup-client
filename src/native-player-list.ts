import type { LobbyPlayer, NativeConnection, PolyModLoader } from './game-types.ts';

/** Presentation only: the host remains in transport membership and peer routing. */
export function visibleNativePlayers<T extends Pick<LobbyPlayer, 'id'>>(
  players: T[], rankedRacers: readonly number[] | null | undefined,
) {
  return rankedRacers ? players.filter(player => rankedRacers.includes(player.id)) : players;
}

export function registerNativePlayerList(pml: PolyModLoader, insert: unknown) {
  if (pml.polyVersion !== '0.6.3') return;
  pml.registerGlobalMixin({
    type: insert,
    token: 'let e = (0, R.gn)(this, hr, "f").getPlayers();',
    func: `e = window.polycupPrototype?.visibleNativePlayers?.((0, R.gn)(this, hr, "f"),e) ?? e;`,
  });
}

export function rankedPlayerList(
  connection: NativeConnection, players: LobbyPlayer[],
  activeConnection: NativeConnection | null | undefined, rankedRacers: readonly number[] | null | undefined,
) {
  return visibleNativePlayers(players, connection === activeConnection ? rankedRacers : null);
}
