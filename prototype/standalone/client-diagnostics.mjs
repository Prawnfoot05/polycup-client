// Deliberately classify requests, never record full URLs, query strings or bodies.
export function requestResource(input, origin) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, origin);
    if (url.pathname === '/diagnostics') return null;
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(polycup_[a-z_]{1,64})$/);
    if (rpc) return 'rpc:' + rpc[1];
    if (url.pathname.startsWith('/auth/v1/')) return 'auth';
    if (url.pathname.startsWith('/storage/v1/')) return 'storage';
    if (url.pathname.startsWith('/functions/v1/')) return 'edge-function';
    if (url.origin !== new URL(origin).origin) return 'external';
    if (/^\/v6\/(?:leaderboard|leaderboardUserEntry|user|recordings|iceServers|trackOfTheWeek)$/.test(url.pathname)) return url.pathname;
    if (/^\/(?:casual\/admission|ranked\/[a-z-]{1,40})$/.test(url.pathname)) return url.pathname;
    if (/^\/(?:tracks|models|images|audio)\//.test(url.pathname)) return 'asset:' + url.pathname.split('/')[1];
    if (/\.(?:js|wasm|woff2?)$/.test(url.pathname)) return 'asset:runtime';
    return 'site-request';
  } catch { return null; }
}

export function errorLocation(error) {
  // Line/column in our shipped code is enough to locate a failure; no raw stack.
  const match = String(error?.stack ?? error?.filename ?? '').match(/\b(polycup\.js|(?:game-source|pml-game-source|simulation_worker|error_screen)\.?(?:bundle)?\.js|entry\.ts):(\d{1,7}):(\d{1,7})/);
  return match ? match[0] : undefined;
}

export function observeFetch(fetch, report, { origin, room, now = () => performance.now() }) {
  let scope = '', failures = 0, slow = 0;
  return (input, init) => {
    const key = room(), resource = key ? requestResource(input, origin) : null, at = now();
    // Return the original promise and preserve synchronous/native rejection behavior.
    const emit = (event, detail) => {
      if (!resource || room() !== key) return;
      if (scope !== key) { scope = key; failures = 0; slow = 0; }
      if (event === 'request_slow' ? slow++ >= 12 : failures++ >= 24) return;
      try {
        report(event, { resource, method: String(init?.method ?? input?.method ?? 'GET').toUpperCase(),
          durationMs: Math.min(120000, Math.max(0, Math.round(now() - at))), ...detail });
      } catch { /* Observability must never alter a request. */ }
    };
    let result;
    try { result = fetch(input, init); }
    catch (error) { emit('request_failed', { errorName: error?.name, location: errorLocation(error) }); throw error; }
    Promise.resolve(result).then(response => {
      if (response.status >= 400) emit('request_failed', { status: response.status });
      else if (now() - at >= 3000) emit('request_slow', { status: response.status });
    }, error => emit('request_failed', { errorName: error?.name, location: errorLocation(error) }));
    return result;
  };
}

export async function peerSnapshot(pc) {
  const out = { rtc: pc.connectionState, ice: pc.iceConnectionState, sctp: pc.sctp?.state ?? 'none' };
  try {
    const stats = await pc.getStats();
    const values = [...stats.values()];
    const transport = values.find(s => s.type === 'transport' && s.selectedCandidatePairId);
    const pair = transport ? stats.get(transport.selectedCandidatePairId) : values.find(s => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
    for (const [field, id] of [['localCandidate', pair?.localCandidateId], ['remoteCandidate', pair?.remoteCandidateId]]) {
      const type = stats.get(id)?.candidateType;
      if (['host', 'srflx', 'prflx', 'relay'].includes(type)) out[field] = type;
    }
    if (Number.isFinite(pair?.currentRoundTripTime)) out.rttMs = Math.round(pair.currentRoundTripTime * 1000);
    for (const field of ['bytesSent', 'bytesReceived']) if (Number.isSafeInteger(pair?.[field])) out[field] = pair[field];
  } catch { /* Closed peers may no longer supply stats. */ }
  return out;
}

// The server applies the same whitelist to hostile or outdated browser reports.
export function diagnosticFields(d) {
  const out = {};
  for (const [key, max] of Object.entries({nativeId:1000000, sessionId:Number.MAX_SAFE_INTEGER, peers:32, target:1000000, status:599, rttMs:120000, bytesSent:Number.MAX_SAFE_INTEGER, bytesReceived:Number.MAX_SAFE_INTEGER, closeCode:4999}))
    if (Number.isSafeInteger(d[key]) && d[key] >= 0 && d[key] <= max) out[key] = d[key];
  for (const key of ['online', 'clean']) if (typeof d[key] === 'boolean') out[key] = d[key];
  for (const [key, values] of Object.entries({method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], cupPhase:['registration','banning','picking','loading','warmup','countdown','racing','between-rounds','complete','menu'], rtc:['new','connecting','connected','disconnected','failed','closed'], ice:['new','checking','connected','completed','disconnected','failed','closed'], sctp:['connecting','connected','closed','none'], localCandidate:['host','srflx','prflx','relay'], remoteCandidate:['host','srflx','prflx','relay'], errorName:['Error','TypeError','AbortError','TimeoutError','NetworkError','InvalidStateError','OperationError']}))
    if (values.includes(d[key])) out[key] = d[key];
  if (typeof d.location === 'string' && errorLocation({stack:d.location}) === d.location) out.location = d.location;
  if (typeof d.trackId === 'string' && /^[a-f0-9]{32,128}$/i.test(d.trackId)) out.trackId = d.trackId;
  if (typeof d.resource === 'string' && /^(?:rpc:polycup_[a-z_]{1,64}|auth|storage|edge-function|external|site-request|asset:(?:tracks|models|images|audio|runtime)|\/v6\/(?:leaderboard|leaderboardUserEntry|user|recordings|iceServers|trackOfTheWeek)|\/(?:casual\/admission|ranked\/[a-z-]{1,40}))$/.test(d.resource)) out.resource = d.resource;
  return out;
}
