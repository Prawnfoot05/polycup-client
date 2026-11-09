// Public client configuration. Never add administrative keys to the mod.
export const accountConfig = {
  url: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  publishableKey: 'sb_publishable_DEVELOPMENT_PLACEHOLDER',
  callback: 'https://prawnfoot05.github.io/PolyCup/auth/',
};

/** Only the standalone shell calls this, before constructing any account client. */
export function configureStandaloneAccount(value: typeof accountConfig) {
  const url = new URL(value.url);
  const callback = new URL(value.callback);
  if (url.origin !== value.url || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(value.url) ||
      !value.publishableKey || callback.origin !== location.origin || callback.pathname !== '/auth/')
    throw new Error('Invalid standalone account environment');
  Object.assign(accountConfig, value);
}
