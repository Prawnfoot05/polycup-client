import catalog from './banner-catalog.json';
export interface BannerUnlock {
  id: string;
  name: string;
  requirement: 'open' | 'fullspeed' | 'tech' | 'level';
  target: number;
  progress: number;
  unlocked: boolean;
}
export interface PlayerProgression {
  xp: number;
  level: number;
  level_xp: number;
  next_level_xp: number;
  fullspeed_wins: number;
  tech_wins: number;
  banners: BannerUnlock[];
}
export function bannerURL(id?: string | null) {
  const banner = catalog.find((b) => b.id === id);
  const folder = banner?.requirement === 'open' ? 'tracks' : banner?.requirement;
  return banner
    ? new URL(`cosmetics/banners/${folder}/${banner.id}.png`, import.meta.url || document.baseURI)
        .href
    : '';
}
export function paintBanner(node: HTMLElement, id?: string | null) {
  const url = bannerURL(id);
  node.classList.toggle('has-artwork', !!url);
  node.style.backgroundImage = url ? `url("${url}")` : '';
}

export function bannerMetadata(id: string) {
  return catalog.find((item) => item.id === id);
}
