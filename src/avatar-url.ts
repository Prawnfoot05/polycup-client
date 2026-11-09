import { accountConfig } from './account-config.ts';
import { discordIdentity } from './account-flow.ts';
/** Only Discord or this environment's own avatar bucket can decorate accounts. */
export function avatarURL(raw?: string | null, storageOrigin = accountConfig.url) {
  const discord = discordIdentity({ avatar_url: raw }).avatar;
  if (discord) return discord;
  try {
    if (typeof raw !== 'string' || raw.length > 2048) return '';
    const url = new URL(raw),
      trusted = new URL(storageOrigin);
    if (url.protocol !== 'https:' || url.origin !== trusted.origin || url.username || url.password)
      return '';
    if (
      !/^\/storage\/v1\/object\/public\/polycup-avatars\/[0-9a-f-]{36}\/(?:[ab]|[0-9a-f-]{36})\.webp$/.test(
        url.pathname,
      )
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}
