// Public endpoints only. Administrative keys and source identities stay server-side.
export async function beginSigninRelay(
  callback: string,
  attempt: string,
  reader: string,
  writer: string,
  fetcher: typeof fetch = fetch,
) {
  const pilot = new URL(callback).origin === 'https://pilot.polycup.online';
  const gateway = pilot ? 'polycup-signin-pilot' : 'polycup-signin';
  try {
    const response = await fetcher(`https://${gateway}.polytrack-world-cup.workers.dev/begin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attempt, reader, writer }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok && (await response.json())?.available === true;
  } catch {
    // Optional automatic return must never block PKCE/opener/manual sign-in.
    return false;
  }
}
