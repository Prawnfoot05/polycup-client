/** Only the native game's endpoints may leave the dedicated service origin. */
export function nativeRoute(
  input: string,
  serviceOrigin: string,
  nativeOrigin: string | undefined,
  casual: boolean,
) {
  const url = new URL(input, serviceOrigin);
  if (!nativeOrigin || url.origin !== serviceOrigin || !url.pathname.startsWith('/v6/'))
    return url.href;
  // Garage profile reads and writes use the token-authorized fixed relay.
  if (url.pathname === '/v6/user') return url.href;
  // Track-record reads use the fixed, cached relay; the native API rejects our origin.
  if (['/v6/leaderboard', '/v6/leaderboardUserEntry', '/v6/recordings', '/v6/trackOfTheWeek'].includes(url.pathname) ||
      /^\/v6\/trackOfTheWeek\/(image|track)\/[a-f0-9]{64}$/.test(url.pathname)) return url.href;
  const multiplayer =
    url.pathname.includes('/multiplayer/') || url.pathname.endsWith('/iceServers');
  if (multiplayer && !casual) return url.href;
  const target = new URL(nativeOrigin);
  url.protocol = target.protocol;
  url.host = target.host;
  return url.href;
}
export function casualSocket(
  input: string,
  serviceOrigin: string,
  nativeOrigin: string | undefined,
  casual: boolean,
) {
  const url = new URL(input, serviceOrigin);
  const local = new URL(serviceOrigin);
  if (
    !nativeOrigin ||
    !casual ||
    url.host !== local.host ||
    !/^\/v6\/multiplayer\/(host|join)$/.test(url.pathname)
  )
    return url.href;
  const target = new URL(nativeOrigin);
  url.host = target.host;
  url.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.delete('ticket');
  return url.href;
}
