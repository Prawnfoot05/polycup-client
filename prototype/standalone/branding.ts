import type { PolyModLoader } from '../../src/game-types.ts';
import wordmark from '../../assets/polycup-wordmark.svg';
import css from './branding.css';

/** Standalone presentation only. Keep the game's credits and restriction notices. */
export function registerStandaloneBranding(runtime: PolyModLoader, insert: unknown) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  runtime.registerGlobalMixin({
    type: insert,
    token: '((0, R.gn)(this, Mh, "f").src = "images/logo.svg"),',
    func: `(Mh.get(this).src=${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(wordmark)}`)}),
      (Mh.get(this).alt='PolyCup'),(Mh.get(this).dataset.polycupBrand='true'),`,
  });
  runtime.registerGlobalMixin({
    type: insert,
    token: '(0, R.gn)(this, Dh, "f").classList.remove("hidden");',
    func: `
      if (!al.lT() && !al.xD()) {
        const notice=Dh.get(this);
        notice.classList.add('polycup-original-credit');
        const link=(label,url)=>{const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
        const original=document.createElement('p'),credits=document.createElement('p');
        original.append('Based on ',link('PolyTrack','https://www.crazygames.com/game/polytrack'),', created by ',link('Kodub','https://www.kodub.com/'),'.');
        credits.append('Unofficial community mod, built with ',link('PolyModLoader','https://polymodloader.com/'),'.');
        notice.replaceChildren(original,credits);
        const footer=notice.parentElement.querySelector(':scope > .info');
        const loaderCredit=footer?.querySelector('a[href*="polymodloader.com"]');
        if(loaderCredit){loaderCredit.href='source/index.html';loaderCredit.title='PolyModLoader source & licences';}
      }
    `,
  });
}
