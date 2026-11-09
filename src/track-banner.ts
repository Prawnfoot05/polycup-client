import { clientAsset } from './client-assets.ts';
import catalog from './track-banner-catalog.json';
import css from './track-banner.css';

export const trackBannerCSS = css;
type TrackBanner = { track: string; file: string };
const key = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function trackBannerURL(track?: string) {
  const art = (catalog as TrackBanner[]).find((item) => key(item.track) === key(track ?? ''));
  return art ? clientAsset(`track-banners/${art.file}`, import.meta.url || document.baseURI) : '';
}

/** Decorative artwork never gates connection, settlement or the visible heading. */
export function paintTrackBanner(header: HTMLElement, track?: string) {
  const url = trackBannerURL(track);
  if (!url) return;
  const image = document.createElement('img');
  image.className = 'track-header-art';
  image.alt = '';
  image.hidden = true;
  image.decoding = 'async';
  image.onload = () => {
    image.hidden = false;
    header.classList.add('has-track-banner');
  };
  image.onerror = () => image.remove();
  header.prepend(image);
  image.src = url;
}
