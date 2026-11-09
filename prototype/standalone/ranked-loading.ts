import { playerLooks } from '../../src/player-looks.ts';
import { playerAchievements } from '../../src/cosmetics.ts';
import { rankBadge } from '../../src/rank-badge.ts';
import badgeCss from '../../src/ranked-queue.css';
import themeCSS from '../../src/interface-theme.css';
import { profilePicture, profilePictureCSS } from '../../src/profile-picture.ts';
import { protectUITouches } from '../../src/touch-ui.ts';
import { paintTrackBanner, trackBannerCSS } from '../../src/track-banner.ts';
import { winStreak, winStreakCSS, streakLength } from '../../src/win-streak.ts';
export class RankedLoading {
  root = document.createElement('div');
  shadow = this.root.attachShadow({ mode: 'open' });
  match = '';
  started = 0;
  timer?: ReturnType<typeof setInterval>;
  updateElapsed() {
    const label = this.shadow.querySelector<HTMLElement>('.load-elapsed');
    if (!label) return;
    const seconds = Math.floor((Date.now() - this.started) / 1000);
    label.hidden = seconds < 15;
    label.textContent = `Still preparing your match · ${seconds}s elapsed`;
  }
  portraits = new Map<string, { name: string; url: string; node: HTMLElement }>();
  preview?: { source: Promise<string> | string; node: HTMLImageElement };
  constructor() {
    protectUITouches(this.shadow);
    this.root.id = 'prototype-ranked-loading';
    this.root.hidden = true;
    this.root.style.cssText = 'position:fixed;inset:0;z-index:100300;';
    const style = document.createElement('style');
    style.textContent =
      themeCSS +
      badgeCss +
      profilePictureCSS +
      trackBannerCSS +
      winStreakCSS +
      `
    :host{font:400 18px ForcedSquare,Arial,sans-serif;color:#fff}
    *{box-sizing:border-box} .veil{height:100%;overflow:auto;display:grid;place-items:safe center;background:#10162de0;backdrop-filter:blur(7px);padding:24px}
    .banner{width:min(920px,100%);background:var(--pc-panel);box-shadow:0 16px 60px #0005}
    header{display:flex;align-items:center;gap:24px;padding:22px 28px;background:var(--pc-action)}
    .track-preview{position:relative;width:128px;height:112px;min-width:0;min-height:0;flex:none;overflow:hidden;background:var(--pc-action)}
    .track-preview img{position:absolute;inset:0;display:block;width:100%;height:100%;min-width:0;min-height:0;max-width:100%;max-height:100%;padding:8px;object-fit:contain}
    .track-preview img[hidden]{display:none}
    .track-heading{min-width:0;display:flex;flex-direction:column;gap:7px}
    .mode{color:var(--pc-muted);font-size:17px}
    h1{font:italic 400 44px/1.1 ForcedSquare,Arial,sans-serif;margin:0;overflow-wrap:anywhere}
    .players{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:20px 28px;gap:12px}
    .player{container:player-loading / inline-size;min-width:0;display:grid;grid-template-columns:52px minmax(0,1fr);gap:5px 14px;align-items:center;padding:12px 14px;background:var(--pc-canvas)}
    .player-portrait{grid-column:1;grid-row:1 / 3;width:52px;height:52px;font-size:26px;border-radius:4px}
    .load-identity{grid-column:2;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px}.load-identity .player-achievements{--medal-size:24px}.name{grid-column:2;margin:0;min-width:0;max-width:100%;font:400 20px/1.15 ForcedSquare,Arial,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .player-detail{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;min-width:0}.load-rank{display:flex;align-items:center;gap:8px}.player-detail .state{margin-left:auto}.load-rank .win-streak{gap:4px;font-size:16px}.load-rank .win-streak img{width:16px;height:20px}
    @container player-loading (min-width:360px){.load-identity{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px}.load-identity>.name{grid-column:1;grid-row:1}.load-identity>.player-title{grid-column:1;grid-row:2}.load-identity>[data-player-achievements]{grid-column:2;grid-row:1 / 3}}
    .state{display:flex;align-items:center;gap:8px;color:var(--pc-muted);font-size:16px}.dot{width:7px;height:7px;background:#7f91b0;border-radius:50%;flex:none}.ready{color:#74dfb4}.ready .dot{background:#74dfb4}
    footer{border-top:2px solid var(--pc-canvas);padding:15px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px;color:var(--pc-muted);font-size:16px}.load-status{display:flex;flex-direction:column;gap:6px}.load-elapsed{font:400 16px/1.4 ForcedSquare,Arial,sans-serif;color:var(--pc-muted)}.load-elapsed[hidden]{display:none}.progress{width:60px;flex:none;height:3px;background:#405071;overflow:hidden}.progress:after{content:'';display:block;width:24px;height:3px;background:var(--pc-gold);animation:load 1.3s ease-in-out infinite alternate}
    .ranked-rating-badge{width:112px;height:34px}.ranked-rating-value{font-size:30px}.ranked-rating-badge.is-grandmaster .ranked-rating-value{font-size:18px}.ranked-rating-value small{font-size:14px}
    @keyframes load{to{transform:translateX(36px)}}@media(prefers-reduced-motion:reduce){.progress:after{animation:none}}
    @media(max-width:600px){.veil{padding:12px}header{padding:18px;gap:16px}.track-preview{width:76px;height:76px}h1{font-size:32px}.mode{font-size:15px}.players{grid-template-columns:1fr;padding:14px;gap:8px}.player{padding:12px;gap:6px 12px}.name{font-size:19px}.state{font-size:15px}footer{padding:14px 18px;font-size:15px}}
    @media(max-height:500px){.veil{padding:10px}header{padding:12px 20px;gap:16px}.track-preview{width:70px;height:60px}h1{font-size:30px}.mode{font-size:14px}.players{padding:12px 20px;gap:8px}.player{padding:8px 10px;grid-template-columns:40px minmax(0,1fr);column-gap:10px}.player-portrait{width:40px;height:40px;font-size:22px}.name{font-size:18px}.state{font-size:15px;gap:5px}.ranked-rating-badge{width:100px;height:30px}.ranked-rating-value{font-size:27px}.ranked-rating-badge.is-grandmaster .ranked-rating-value{font-size:16px}.ranked-rating-value small{font-size:12px}footer{padding:10px 20px}}
    @media(max-width:360px){.player{grid-template-columns:40px minmax(0,1fr);column-gap:10px}.player-portrait{width:40px;height:40px;font-size:22px}.name{font-size:18px}.state{font-size:15px;gap:5px}.ranked-rating-badge{width:88px;height:26px}.ranked-rating-value{font-size:23px}.ranked-rating-badge.is-grandmaster .ranked-rating-value{font-size:14px}.ranked-rating-value small{font-size:11px}}
    /* One identity block: medals beside the name, status beside the rating. */
    .player{grid-template-columns:84px minmax(0,1fr);grid-template-rows:44px 34px;gap:6px 14px;align-items:start}
    .player>.player-portrait{grid-column:1;grid-row:1 / 3;width:84px;height:84px;align-self:start}
    .load-identity{grid-column:2;grid-row:1;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:23px 18px;gap:3px 10px;align-items:center}
    .load-identity>.name{grid-column:1;grid-row:1}
    .load-identity>.player-title{grid-column:1;grid-row:2;margin:0}
    .load-identity>[data-player-achievements]{grid-column:2;grid-row:1 / 3;align-self:start;transform:translateY(-2px);--medal-size:22px}
    .player-detail{grid-column:2;grid-row:2;align-self:end;flex-wrap:nowrap;gap:8px}
    .load-rank{flex:none}
    .player-detail .state{min-width:0;justify-content:flex-end;white-space:nowrap}
    .player-detail .state>span:last-child{overflow:hidden;text-overflow:ellipsis}
    @media(max-height:500px),(max-width:600px){
     .player{grid-template-columns:66px minmax(0,1fr);grid-template-rows:36px 26px;gap:4px 10px}
     .player>.player-portrait{width:66px;height:66px}
     .load-identity{grid-template-rows:19px 14px;gap:3px 6px}.load-identity>.player-title{font-size:14px}.load-identity>[data-player-achievements]{--medal-size:18px;gap:3px}
     .ranked-rating-badge{width:88px;height:26px}.ranked-rating-value{font-size:23px}
    }
    `;
    this.shadow.append(style);
    document.body.append(this.root);
  }
  show(
    match: string,
    players: any[],
    track: string,
    states: Record<string, string> = {},
    stage = 'Connecting racers',
    thumbnail?: Promise<string> | string,
  ) {
    if (this.match !== match || this.root.hidden) this.started = Date.now();
    if (!this.timer) this.timer = setInterval(() => this.updateElapsed(), 1000);
    if (this.match !== match) {
      this.portraits.clear();
      this.preview = undefined;
    }
    this.match = match;
    this.root.hidden = false;
    let veil = this.shadow.querySelector('.veil');
    if (!veil) {
      veil = document.createElement('div');
      veil.className = 'veil';
      this.shadow.append(veil);
    }
    const banner = document.createElement('section');
    banner.className = 'banner';
    banner.setAttribute('aria-label', 'Ranked match loading');
    const header = document.createElement('header'),
      title = document.createElement('h1'),
      heading = document.createElement('div'),
      mode = document.createElement('span'),
      preview = document.createElement('div');
    mode.className = 'mode';
    mode.textContent = 'Ranked match';
    heading.className = 'track-heading';
    title.textContent = track || 'Selecting track';
    heading.append(mode, title);
    preview.className = 'track-preview';
    preview.setAttribute('aria-hidden', 'true');
    if (thumbnail) {
      if (this.preview?.source !== thumbnail) {
        const image = document.createElement('img');
        image.alt = '';
        image.hidden = true;
        image.onload = () => {
          image.hidden = false;
        };
        image.onerror = () => {
          image.hidden = true;
        };
        this.preview = { source: thumbnail, node: image };
        // Thumbnail generation must never delay admission or native track loading.
        Promise.resolve(thumbnail)
          .then((src) => {
            if (src) image.src = src;
          })
          .catch(() => {});
      }
      preview.append(this.preview.node);
    }
    header.append(preview, heading);
    paintTrackBanner(header, track);
    const list = document.createElement('div');
    list.className = 'players';
    for (const p of players) {
      const col = document.createElement('div');
      col.className = 'player';
      const n = document.createElement('p');
      n.className = 'name';
      n.append(p.name);
      n.title = p.name;
      const state = document.createElement('div'),
        dot = document.createElement('span'),
        label = document.createElement('span');
      const text = states[p.account] || 'Connecting';
      state.className = 'state' + (text === 'Ready' ? ' ready' : '');
      dot.className = 'dot';
      label.textContent = text;
      state.append(dot, label);
      const url = p.avatar_url || '';
      let portrait = this.portraits.get(p.account);
      if (!portrait || portrait.name !== p.name || portrait.url !== url) {
        portrait = { name: p.name, url, node: profilePicture(p.name, url) };
        this.portraits.set(p.account, portrait);
      }
      const detail = document.createElement('div');
      detail.className = 'player-detail';
      const rank = document.createElement('div');
      rank.className = 'load-rank';
      rank.append(rankBadge(p.rank));
      if (streakLength(p.win_streak)) rank.append(winStreak(p.win_streak));
      detail.append(rank, state);
      const title = document.createElement('span');
      title.className = 'player-title';
      title.dataset.playerTitle = '';
      title.hidden = true;
      const identity = document.createElement('div');
      identity.className = 'load-identity';
      identity.append(n, title, playerAchievements());
      col.append(portrait.node, identity, detail);
      playerLooks.decorate(col, p.account);
      list.append(col);
    }
    const footer = document.createElement('footer'),
      label = document.createElement('span'),
      progress = document.createElement('span');
    label.textContent = stage;
    label.setAttribute('role', 'status');
    progress.className = 'progress';
    progress.setAttribute('aria-hidden', 'true');
    const status = document.createElement('div'),
      elapsed = document.createElement('span');
    status.className = 'load-status';
    elapsed.className = 'load-elapsed';
    elapsed.hidden = true;
    status.append(label, elapsed);
    footer.append(status, progress);
    banner.append(header, list, footer);
    veil.replaceChildren(banner);
    this.updateElapsed();
  }
  hide() {
    this.root.hidden = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
