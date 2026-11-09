import { readFileSync } from 'node:fs';
const monogram = readFileSync(new URL('../../assets/polycup-monogram.svg', import.meta.url), 'utf8');
// Inline in the document so a failed application download still has usable UI.
function installStartupShell() {
  const root = document.getElementById('polycup-boot');
  const title = root.querySelector('h1');
  const detail = root.querySelector('p');
  const retry = root.querySelector('button');
  const reference = root.querySelector('small');
  let done = false, failed = false, phase = 'application', attempts = 0;
  const started = performance.now();
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!done) fn(); }, ms);
    timers.add(id);
  };
  const fail = (code = 'startup') => {
    if (done || failed) return;
    failed = true;
    root.classList.add('failed', 'recovery');
    title.textContent = 'Could not load PolyCup';
    detail.textContent = navigator.onLine === false
      ? 'You’re offline. Reconnect, then try again.'
      : 'The game could not load.';
    retry.hidden = false;
    const build = window.polycupBuild?.id || 'unknown';
    reference.textContent = 'Reference: ' + build.slice(0, 8) + ' / ' + phase;
    try {
      // Codes only: no URLs, credentials, player identities or network addresses.
      sessionStorage.setItem('polycup.startup.failure', JSON.stringify({
        build, phase, code, elapsedMs: Math.round(performance.now() - started),
      }));
    } catch {}
  };
  const onError = () => fail('script-error');
  const onRejection = () => fail('startup-rejection');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  retry.onclick = () => location.reload();
  const complete = () => {
    if (done) return;
    done = true;
    for (const id of timers) clearTimeout(id);
    clearInterval(watch);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    root.remove();
  };
  window.polycupBoot = {
    entered: false,
    stage(value) {
      if (done || failed) return;
      phase = value;
      detail.textContent = value === 'assets' ? 'Loading the game…' : 'Preparing the game…';
    },
    retry(attempt, total) {
      if (!done && !failed) detail.textContent = `Reconnecting… (${attempt} of ${total})`;
    },
    fail, complete,
  };
  const watch = setInterval(() => {
    if (window.polycupPrototype?.ready && window.polycupRuntime?.menuDebug?.().loaded)
      complete();
  }, 100);
  later(() => {
    if (!failed) {
      detail.textContent = 'Loading is taking longer than usual. You can wait or try again.';
      root.classList.add('recovery');
      retry.hidden = false;
    }
  }, 30000);
  const load = () => {
    if (done || failed) return;
    attempts++;
    const script = document.createElement('script');
    script.type = 'module';
    const url = new URL('polycup.js', document.baseURI);
    // A failed module URL is cached by the browser. Only retry before any app code ran.
    if (attempts > 1) url.searchParams.set('startup-retry', String(attempts));
    script.src = url.href;
    script.onerror = () => {
      script.remove();
      if (!window.polycupBoot.entered && attempts < 3) {
        window.polycupBoot.retry(attempts + 1, 3);
        later(load, attempts * 700);
      } else fail('application-module');
    };
    document.head.append(script);
  };
  load();
}

export function startupShell() {
  return `<style>
@font-face{font-family:PolyCupBoot;src:url('forced_square.woff2') format('woff2');font-display:swap}
html,body{margin:0;background:#141d36}#polycup-boot{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#141d36;color:#eff2ff;font:18px/1.4 PolyCupBoot,Arial,sans-serif}
#polycup-boot section{width:min(400px,100%);min-height:232px;display:grid;align-content:center;justify-items:center;box-sizing:border-box;text-align:center}
#polycup-boot .boot-loading{display:grid;place-items:center}
#polycup-boot .boot-monogram{width:177px;height:153px;overflow:visible;filter:drop-shadow(0 5px 10px #060d2580)}
#polycup-boot .boot-glint{animation:polycup-boot-glint 4.8s ease-in-out infinite;transform:translateX(0) skewX(-16deg)}
#polycup-boot h1,#polycup-boot small,#polycup-boot:not(.recovery) .boot-recovery{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#polycup-boot .boot-recovery{display:grid;justify-items:center;gap:18px}
#polycup-boot p{margin:0;max-width:32ch;color:#b3c2df;font-size:16px}
#polycup-boot button{position:relative;isolation:isolate;border:0;background:none;color:#15203d;min-height:48px;padding:10px 28px;font:italic 400 22px/1.2 PolyCupBoot,Arial,sans-serif;cursor:pointer}
#polycup-boot button::before{content:'';position:absolute;inset:0;z-index:-1;background:#ffda71;transform:skewX(-12deg)}
#polycup-boot button:hover::before{background:#ffe798}#polycup-boot button:focus-visible{outline:3px solid #eff2ff;outline-offset:6px}
#polycup-boot [hidden],#polycup-boot.recovery .boot-loading{display:none}
#polycup-boot noscript{display:block;max-width:32ch;margin-top:20px;font-size:16px;color:#b3c2df}
@keyframes polycup-boot-glint{0%,12%{transform:translateX(0) skewX(-16deg)}34%,100%{transform:translateX(360px) skewX(-16deg)}}
@media(prefers-reduced-motion:reduce){#polycup-boot .boot-glint{display:none}}
@media(max-height:400px){#polycup-boot .boot-monogram{width:142px;height:123px}#polycup-boot section{min-height:180px}}
</style><div id="polycup-boot" role="status" aria-live="polite"><section><h1>Loading PolyCup…</h1><div class="boot-loading" aria-hidden="true">${monogram}</div><div class="boot-recovery"><button type="button" hidden>Retry</button><p>Preparing the game…</p></div><small></small><noscript>JavaScript is needed to play PolyCup. Enable it, then reload this page.</noscript></section></div><script>(${installStartupShell.toString()})();</script>`;
}
