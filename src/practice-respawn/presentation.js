// Presentation only. Never writes a physics car state or changes driving inputs.
import { copiumSplit, formatCopiumSplit } from './copium-split.mjs';
export function installRollingPresentation(runtime) {
  const api = runtime.getFromPolyTrack(`({
  read:g=>{if(!(g instanceof Is)||!Xa.get(g)||fs.get(g)?.isEnabled)return null;
   const reference=_s.call(g);
   return{car:Xa.get(g),renderer:la.get(g),timer:_a.get(g)?.element.querySelector('.timer-ui'),
    reference:reference?{name:reference.settings.nickname,finish:reference.settings.time.numberOfFrames,
     checkpoints:reference.checkpoints.map(cp=>cp.time.numberOfFrames)}:null};},
  hook:prepare=>{const update=Is.prototype.update;Is.prototype.update=function(...args){
   const renderer=la.get(this),draw=renderer.update,game=this;
   renderer.update=function(...renderArgs){try{prepare(game);}catch(error){window.rollingRespawn.presentationError=String(error.message??error);}return draw.apply(this,renderArgs);};
   try{return update.apply(this,args);}finally{renderer.update=draw;}
  };}
 })`);
  let state = null,
    recovery = null,
    identity = '',
    debug = null;
  const views = new WeakMap();
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const display = (ms) => {
    ms = Math.max(0, Math.floor(ms ?? 0));
    return (
      String(Math.floor(ms / 60000)).padStart(2, '0') +
      ':' +
      String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
      '.' +
      String(ms % 1000).padStart(3, '0')
    );
  };
  const style = document.createElement('style');
  style.textContent = `
 .timer-ui>.center{position:relative}
 .timer-ui .rolling-copium{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:240px;pointer-events:none;color:var(--text-color);font:inherit}
 .timer-ui .rolling-copium[hidden]{display:none!important}
 .timer-ui.up .rolling-copium{top:calc(100% + 8px);bottom:auto}
 .rolling-copium-heading{display:flex;justify-content:center;align-items:baseline;gap:12px;height:26px;text-shadow:1px 1px 1px var(--surface-color),-1px -1px 1px var(--surface-color)}
 .rolling-copium-heading h2{margin:0;font:inherit;font-size:20px;font-weight:normal}
 .rolling-copium-split{font-size:17px;color:var(--text-color);white-space:nowrap}
 .rolling-copium-split.ahead{color:#5f5}.rolling-copium-split.behind{color:#f55}
 .rolling-copium-split[hidden]{display:none!important}
 .rolling-copium-bar{background:var(--surface-color);padding:5px 7px;clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 100%,0 100%)}
 .rolling-copium-bar p{margin:0;padding:0;background:var(--surface-tertiary-color);font:inherit;font-size:32px;line-height:1.12;color:var(--text-color);clip-path:polygon(6px 0,calc(100% - 6px) 0,100% 100%,0 100%);white-space:nowrap}
 .timer-ui.up .rolling-copium-bar{clip-path:polygon(0 0,100% 0,calc(100% - 8px) 100%,8px 100%)}
 .timer-ui.up .rolling-copium-bar p{clip-path:polygon(0 0,100% 0,calc(100% - 6px) 100%,6px 100%)}
 `;
  document.head.append(style);
  window.addEventListener('rolling-status', (event) => {
    state = event.detail;
    if (state.phase === 'waiting') {
      recovery = null;
      identity = '';
      return;
    }
    const key = `${state.carId}:${state.respawns}:${state.lastRespawn?.mode}:${state.lastRespawn?.target}`;
    if (key !== identity) {
      identity = key;
      if (state.phase === 'replaying') recovery = { end: state.elapsed + state.replayRemaining };
      else if (state.lastRespawn?.mode === 'standing' && recovery)
        recovery = { end: state.elapsed };
      else recovery = null;
    }
  });
  api.hook((game) => {
    const current = api.read(game);
    if (!current) return;
    const { car, renderer, timer } = current;
    let view = views.get(game);
    if (!view || view.car !== car) {
      view?.hud?.root.remove();
      view = { car, locked: false, previousCamera: null, hud: null, reference: null,
        recoveryKey: '', rearUntil: car.getTime().numberOfFrames + 200 };
      views.set(game, view);
    }
    const frames = car.getTime().numberOfFrames;
    const recoveryKey = state?.respawns > 0
      ? `${state.carId}:${state.respawns}:${state.lastRespawn?.mode}` : '';
    if (recoveryKey !== view.recoveryKey) {
      view.recoveryKey = recoveryKey;
      view.rearUntil = frames + 200;
    }
    // A standing/start-line reset has no replay lock. Re-seed native camera
    // history after the new pose arrives too, rather than retaining its old
    // position in front of the teleported car. Respect cockpit selection.
    if (frames < view.rearUntil) car.resetRollingCamera();
    const locked = !!recovery && state?.phase !== 'error' && frames < recovery.end;
    if (locked) {
      if (!view.locked) view.previousCamera = renderer.camera;
      car.resetRollingCamera();
      renderer.setCamera(car.cameraOrbit);
      car.setVisible(true);
      car.setOpacity(0.3);
    } else if (view.locked) {
      car.setOpacity(1);
      if (view.previousCamera) renderer.setCamera(view.previousCamera);
      car.setVisible(true);
      view.previousCamera = null;
    }
    view.locked = locked;
    // Native PB admission can replace the self ghost on the finish callback.
    // Keep the target we were racing rather than comparing against that new PB.
    if (state?.phase !== 'finished') view.reference = current.reference;
    const split = copiumSplit(state, view.reference);
    if (timer && !view.hud) {
      const center = timer.querySelector(':scope>.center');
      if (center) {
        const root = node('section', 'rolling-copium'),
          heading = node('div', 'rolling-copium-heading'),
          label = node('h2', '', 'Run estimate'),
          difference = node('span', 'rolling-copium-split'),
          bar = node('div', 'rolling-copium-bar'),
          value = node('p', 'rolling-copium-value', '00:00.000');
        root.setAttribute('aria-label', 'Run estimate timer');
        root.hidden = true;
        heading.append(label, difference);
        bar.append(value);
        root.append(heading, bar);
        center.append(root);
        view.hud = { root, difference, value };
      }
    }
    if (view.hud) {
      view.hud.root.hidden = !(state?.respawns > 0 && state.phase !== 'waiting');
      view.hud.value.textContent = display(state?.copium);
      view.hud.difference.hidden = !split;
      view.hud.difference.textContent = split ? formatCopiumSplit(split.delta) : '';
      view.hud.difference.classList.toggle('ahead', !!split && split.delta < 0);
      view.hud.difference.classList.toggle('behind', !!split && split.delta > 0);
    }
    const p = car.getPosition(),
      q = car.getQuaternion(),
      forward = p.clone().set(0, 0, 1).applyQuaternion(q),
      delta = renderer.camera.position.clone().sub(p);
    debug = {
      locked,
      opacity: car.getRollingOpacity(),
      cameraBehind: delta.dot(forward) < 0,
      cameraBackDistance: -delta.dot(forward),
      cameraIsChase: renderer.camera === car.cameraOrbit,
      frames,
      handoverAt: recovery?.end ?? null,
      copiumText: view.hud?.value.textContent,
      split,
      splitText: view.hud?.difference.textContent,
      referenceName: view.reference?.name ?? null,
      hudAttached: !!view.hud,
      hudVisible: !!view.hud && !view.hud.root.hidden,
      physicsTouched: false,
    };
  });
  window.rollingRespawn.presentation = () => debug;
}
