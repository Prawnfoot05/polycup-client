import { validateRespawnRecording } from '../respawn-recording.ts';
import { launchNativeReplay } from '../native-replay.ts';
import { showReplayHUD } from '../replay-hud.ts';
import { respawnPresentation } from './replay.mjs';
import { protectUITouches } from '../touch-ui.ts';

export function installPracticeReplays(runtime) {
  let api,
    saved = null,
    active = null;
  const store = 'polycup.practice.full-replay.v1';
  const watch = document.createElement('button'),
    save = document.createElement('button'),
    load = document.createElement('button');
  save.textContent = 'Save replay';
  load.textContent = 'Load replay';
  for (const b of [save, load]) {
    b.className = 'button';
    b.type = 'button';
    protectUITouches(b);
  }
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json';
  file.hidden = true;
  document.body.append(file);
  const error = (message) => {
    window.polycupPracticeRespawns.lastError = message;
    const toolbar = document.querySelector('.game-toolbar-ui');
    if (!toolbar) return;
    let status = toolbar.querySelector('.practice-replay-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'practice-replay-status';
      status.setAttribute('role', 'status');
      toolbar.append(status);
    }
    status.textContent = message;
  };
  const update = () => {
    save.disabled = !saved;
  };
  const buttonTimer = setInterval(() => {
    const g = runtime.menuGame?.(),
      info = window.polycupPracticeRespawns.context?.(g);
    if (!info) return;
    const toolbar = document.querySelector('.game-toolbar-ui>.button-container');
    if (!toolbar) return;
    if (!toolbar.contains(save)) toolbar.append(save, load);
    save.hidden = !window.polycupPracticeRespawns.used(info.car) || !info.car.hasFinished();
    load.hidden = info.car.hasStarted() && !info.car.hasFinished();
  }, 150);
  function validateBundle(value) {
    if (
      !value ||
      value.format !== 'polycup-respawn-replay' ||
      value.version !== 1 ||
      typeof value.track !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.track) ||
      typeof value.trackSave !== 'string' ||
      value.trackSave.length > 1048576 ||
      !value.metadata ||
      typeof value.metadata.name !== 'string' ||
      value.metadata.name.length > 256
    )
      throw Error('Invalid replay file.');
    const fullRun = validateRespawnRecording(value.fullRun);
    return {
      format: value.format,
      version: 1,
      track: value.track,
      trackSave: value.trackSave,
      metadata: {
        name: value.metadata.name,
        author:
          typeof value.metadata.author === 'string' ? value.metadata.author.slice(0, 256) : null,
        lastModified: null,
      },
      fullRun,
    };
  }
  async function capture() {
    const track = api.capture(runtime.menuGame());
    if (!track) throw Error('No practice run to save.');
    const fullRun = await window.rollingRespawn.recording();
    const result = validateBundle({
      ...track,
      format: 'polycup-respawn-replay',
      version: 1,
      fullRun,
    });
    saved = result;
    try {
      localStorage.setItem(store, JSON.stringify(result));
    } catch {
      error('Replay ready. Save it to a file to keep it.');
    }
    update();
    return result;
  }
  async function play(bundle = saved, otherGhosts = []) {
    if (!api || !bundle) throw Error('No saved replay.');
    const data = validateBundle(bundle);
    api.register(data);
    const r = data.fullRun;
    const ghost = {
      name: 'Practice run',
      style: null,
      finish: r.elapsedMs,
      nativeFinish: r.elapsedMs,
      offset: 0,
      dnf: r.finishMs === null,
      inputs: { up: [], right: [], down: [], left: [], reset: [] },
      fullRun: r,
    };
    const session = await launchNativeReplay(
      data.track,
      [ghost, ...otherGhosts],
      new AbortController().signal,
      () => {},
    );
    active = session;
    const root = document.querySelector('#polytrack-world-cup')?.shadowRoot;
    const remove = root ? showReplayHUD(root, session.snapshot) : () => {};
    void session.ended.then(() => {
      remove();
      if (active === session) active = null;
    });
    return session;
  }
  watch.onclick = () => void play().catch((e) => error(e.message));
  // The native post-finish Watch button must not replay its legacy input-only
  // surrogate after a respawn. Route it through the chronological viewer too.
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button');
      if (
        button?.querySelector('img[src$="quit.svg"]') &&
        window.polycupRuntime?.menuDebug?.().type === 'Is' &&
        window.rollingRespawn.snapshot()?.elapsed > 0 &&
        window.polycupPracticeRespawns.used(
          window.polycupPracticeRespawns.context(runtime.menuGame())?.car,
        )
      ) {
        // Queue capture before native teardown deletes the car. Leaving still happens immediately.
        void capture().catch((e) => error(e.message));
        return;
      }
      if (
        !button?.querySelector('img[src$="preview.svg"]') ||
        window.polycupRuntime?.menuDebug?.().type !== 'Is' ||
        window.rollingRespawn.snapshot()?.phase !== 'finished' ||
        !window.polycupPracticeRespawns.used(
          window.polycupPracticeRespawns.context(runtime.menuGame())?.car,
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void capture()
        .then((bundle) => play(bundle))
        .catch((e) => error(e.message));
    },
    true,
  );
  save.onclick = () => {
    if (!saved) return;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(saved)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'polycup-full-replay.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  load.onclick = () => file.click();
  file.onchange = async () => {
    try {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 5 * 1048576) throw Error('Replay file is too large.');
      saved = validateBundle(JSON.parse(await f.text()));
      localStorage.setItem(store, JSON.stringify(saved));
      update();
      await play();
    } catch (e) {
      error(e.message);
    } finally {
      file.value = '';
    }
  };
  try {
    const raw = localStorage.getItem(store);
    if (raw) saved = validateBundle(JSON.parse(raw));
  } catch {}
  update();
  window.addEventListener('rolling-status', (event) => {
    if (event.detail.phase === 'finished' && event.detail.respawns > 0)
      void capture().catch((e) => error(e.message));
  });
  window.addEventListener('rolling-replay-error', (event) => error(event.detail.error));
  const ready = setInterval(() => {
    if (!runtime?.menuDebug?.().loaded) return;
    clearInterval(ready);
    api = runtime.getFromPolyTrack(`(()=>{
   const tracks=new Map(),original=du.prototype.forEachOfficialTrack;
   du.prototype.forEachOfficialTrack=function(callback){for(const b of tracks.values())callback(b.track,'Replay',b.metadata,null,async()=>({trackData:b.data,trackMetadata:b.metadata}),'');return original.call(this,(id,...rest)=>{if(!tracks.has(id))callback(id,...rest);});};
   return {
    capture:g=>g instanceof Is?{track:Ta.get(g).getId(),trackSave:Ta.get(g).toSaveString(),metadata:Sa.get(g)}:null,
    register:b=>{const data=Ul.A.fromSaveString(b.trackSave);if(!data||data.getId()!==b.track)throw Error('Replay track does not match the recording.');tracks.set(b.track,{...b,data});},
    recording:ghost=>{if(!ghost.fullRun)return null;const recording=new ie.A(ghost.inputs),native=recording.serialize();recording.serialize=()=>({polycupRespawn:ghost.fullRun,native});
     const changes=ghost.fullRun.events.filter(e=>e.type==='inputs'||(e.type==='respawn'&&e.mode==='standing'));
     recording.getFrame=at=>{let lo=0,hi=changes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(changes[mid].at<=at)lo=mid+1;else hi=mid;}const event=changes[lo-1],mask=event?(event.type==='inputs'?event.applied:16):0;return {up:!!(mask&1),right:!!(mask&2),down:!!(mask&4),left:!!(mask&8),reset:!!(mask&16)};};return recording;},
    hook:prepare=>{const update=Sg.prototype.update;Sg.prototype.update=function(...args){const renderer=eg.get(this),draw=renderer.update,game=this;renderer.update=function(...rest){try{prepare(game);}catch(error){window.rollingRespawn.presentationError=String(error.message??error);}return draw.apply(this,rest);};try{return update.apply(this,args);}finally{renderer.update=draw;}};},
    read:g=>g instanceof Sg?{at:Math.round(lg.get(g)*1000),selected:ag.get(g),renderer:eg.get(g),ghosts:sg.get(g)}:null
   };
  })()`);
    const viewStates = new WeakMap();
    api.hook((game) => {
      const view = api.read(game);
      if (!view) return;
      for (const [index, ghost] of view.ghosts.entries()) {
        const trace = ghost.settings.recording.polycupFullRun;
        if (!trace) continue;
        const phase = respawnPresentation(trace, view.at),
          car = ghost.car;
        car.setOpacity(phase.locked ? 0.3 : 1);
        let state = viewStates.get(car);
        if (!state) {
          state = { locked: false, camera: null };
          viewStates.set(car, state);
        }
        if (index === view.selected) {
          if (phase.locked) {
            if (!state.locked) state.camera = view.renderer.camera;
            car.resetRollingCamera();
            view.renderer.setCamera(car.cameraOrbit);
            car.setVisible(true);
          } else if (state.locked) {
            if (state.camera) view.renderer.setCamera(state.camera);
            car.setVisible(view.renderer.camera !== car.cameraCockpit);
          }
          state.locked = phase.locked;
        } else state.locked = false;
      }
    });
    const crossings = new WeakMap();
    window.polycupRespawnReplay = {
      crossing: (ghost, time, checkpoint) => {
        let cache = crossings.get(ghost);
        if (!cache) {
          cache = { through: 0, checkpoint: 0, entries: [] };
          crossings.set(ghost, cache);
        }
        const through = Math.min(
          ghost.settings.polycupNativeEnd,
          ghost.replay.getLastFrame().numberOfFrames,
        );
        for (let at = cache.through + 1; at <= through; at++) {
          const cp = ghost.replay.getFrame(at)?.nextCheckpointIndex ?? 0;
          if (cp !== cache.checkpoint) {
            cache.entries.push({ at, cp });
            cache.checkpoint = cp;
          }
        }
        cache.through = through;
        for (let i = cache.entries.length - 1; i >= 0; i--) {
          const e = cache.entries[i];
          if (e.at <= time && e.cp === checkpoint) return e.at;
        }
        return 0;
      },
      recording: (ghost) => {
        if (!ghost.fullRun) return null;
        validateRespawnRecording(ghost.fullRun);
        const r = api.recording(ghost);
        r.polycupFullRun = ghost.fullRun;
        return r;
      },
    };
    window.rollingRespawn.replays = {
      capture,
      play,
      saved: () => saved,
      snapshot: () => active?.snapshot() ?? null,
      validateBundle,
    };
  }, 100);
}
