/** Shared client contract. The PML adapter supplies its platform explicitly. */
export const RANKED_CLIENT_PROTOCOL = 2;
/** Gameplay-compatible patch releases share this identity with existing hosts. */
export const CUP_WIRE_VERSION = '0.6.3';
export const NATIVE_GAME_VERSION = '0.6.3';
export type ClientPlatform = Readonly<{
  distribution: 'standalone' | 'pml';
  serviceOrigin: string;
}>;
const SERVICE_ORIGINS = Object.freeze({
  production: 'https://polycup.online',
  pilot: 'https://pilot.polycup.online',
});
export function standalonePlatform(origin: string): ClientPlatform {
  const url = new URL(origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')))
    throw Error('Invalid standalone service origin');
  return Object.freeze({ distribution: 'standalone', serviceOrigin: origin });
}
export function pmlPlatform(environment: keyof typeof SERVICE_ORIGINS = 'production'): ClientPlatform {
  const serviceOrigin = SERVICE_ORIGINS[environment];
  if (!serviceOrigin) throw Error('Unknown PolyCup environment');
  return Object.freeze({ distribution: 'pml', serviceOrigin });
}
const RANKED_ACTIONS = new Set([
  'queue', 'identity', 'admission', 'room-status', 'concede', 'cooldown', 'result',
  'input-policy', 'input', 'input-review', 'replay-input', 'replay-issue', 'register',
]);
export function rankedEndpoint(platform: ClientPlatform, action: string) {
  if (!RANKED_ACTIONS.has(action)) throw Error('Unknown ranked service action');
  if (platform.distribution === 'standalone') {
    standalonePlatform(platform.serviceOrigin);
    return '/ranked/' + action;
  }
  if (platform.distribution !== 'pml' || !Object.values(SERVICE_ORIGINS).some(origin => origin === platform.serviceOrigin))
    throw Error('Untrusted PolyCup service origin');
  return platform.serviceOrigin + '/ranked/' + action;
}
