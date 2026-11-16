import { installRollingPresentation } from './presentation.js';
import { installPracticeReplays } from './replays.mjs';

export function installPracticeRespawns(runtime) {
  const workers = new Set(),
    statuses = new Map(),
    access = new WeakMap(),
    used = new WeakSet(),
    requests = new Map();
  const NativeWorker = window.Worker;
  let api = null,
    current = null,
    liveCar = null,
    lastTap = -Infinity,
    held = {};
  window.polycupPracticeCarAccess = (car, info) => {
    if (access.has(car)) return;
    access.set(car, info);
    car.resetRollingCamera = info.reset;
    car.getRollingOpacity = info.opacity;
  };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const d = event.data;
        if (!d?.rollingProto) return;
        event.stopImmediatePropagation();
        if (d.recording) {
          const r = requests.get(d.request);
          if (r) {
            clearTimeout(r.timer);
            requests.delete(d.request);
            r.resolve(d.trace);
          }
          return;
        }
        if (d.replayError) {
          window.dispatchEvent(new CustomEvent('rolling-replay-error', { detail: d }));
          return;
        }
        if (d.removed) {
          if (statuses.get(this)?.carId === d.carId) {
            statuses.delete(this);
            if (current?.worker === this) {
              current = null;
              window.dispatchEvent(
                new CustomEvent('rolling-status', {
                  detail: { phase: 'waiting', elapsed: 0, copium: 0, respawns: 0 },
                }),
              );
            }
          }
          return;
        }
        statuses.set(this, d);
        if (liveCar && access.get(liveCar)?.id === d.carId) {
          current = { worker: this, state: d };
          window.dispatchEvent(new CustomEvent('rolling-status', { detail: d }));
        }
      });
    }
    postMessage(data, ...args) {
      // Asset decoders and other mods may also own workers. Only the pinned
      // native simulation protocol receives Practice commands.
      if (data?.messageType === 0 && data.version === '0.6.3' && Array.isArray(data.trackParts))
        workers.add(this);
      if (data?.messageType === 3 && typeof data.trackData === 'string' && 'carRecording' in data)
        workers.add(this);
      return super.postMessage(data, ...args);
    }
    terminate() {
      workers.delete(this);
      statuses.delete(this);
      super.terminate();
    }
  };
  const context = (game) => api?.read(game) ?? null;
  const send = (message) => {
    if (!liveCar) return false;
    const id = access.get(liveCar)?.id;
    if (id === undefined || id === null) return false;
    for (const worker of workers) worker.postMessage({ ...message, carId: id });
    return true;
  };
  const manager = {
    context,
    used: (car) => !!car && used.has(car),
    finished(game, car) {
      api?.watch(game);
    },
    snapshot: () => current?.state ?? null,
    respawn(mode = 'flying', upgrade = false) {
      const info = api?.read(runtime.menuGame?.());
      if (
        !info ||
        info.car !== liveCar ||
        !current ||
        !api.ready(info.game) ||
        info.car.hasFinished() ||
        !info.car.hasStarted()
      )
        return false;
      used.add(liveCar);
      api.uploads(info.game, false);
      return send({ rollingRespawn: true, mode, upgrade });
    },
    tap() {
      const at = performance.now(),
        double = at - lastTap <= 300;
      lastTap = double ? -Infinity : at;
      return this.respawn(double ? 'standing' : 'flying', double);
    },
    recording() {
      return new Promise((resolve, reject) => {
        const id = access.get(liveCar)?.id;
        if (!current || id === undefined) return reject(Error('No practice recording.'));
        const request = crypto.randomUUID(),
          timer = setTimeout(() => {
            requests.delete(request);
            reject(Error('Replay recording unavailable.'));
          }, 5000);
        requests.set(request, { resolve, reject, timer });
        current.worker.postMessage({ rollingRecording: true, carId: id, request });
      });
    },
  };
  window.polycupPracticeRespawns = manager;
  // Shared HUD/replay modules use this local protocol; it has no network transport.
  window.rollingRespawn = manager;
  const resetEvent = (event) => {
    const game = runtime.menuGame?.(),
      info = api?.read(game);
    return (
      !!info &&
      api.ready(game) &&
      !info.car.hasFinished() &&
      event.composedPath().includes(info.resetButton)
    );
  };
  let touchAt = -Infinity;
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || !resetEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      touchAt = performance.now();
      manager.tap();
    },
    true,
  );
  window.addEventListener(
    'click',
    (event) => {
      if (!resetEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (performance.now() - touchAt > 500) manager.tap();
    },
    true,
  );
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
    window.addEventListener(
      type,
      (event) => {
        held = {};
        if (!api?.read(runtime.menuGame?.())) return;
        for (const touch of event.touches)
          for (const img of document.querySelectorAll('.touch-controls-ui img')) {
            const match = /arrow_(up|right|down|left)\.svg$/.exec(img.getAttribute('src') ?? '');
            if (!match) continue;
            const r = img.parentElement.getBoundingClientRect();
            if (
              touch.clientX >= r.left &&
              touch.clientX <= r.right &&
              touch.clientY >= r.top &&
              touch.clientY <= r.bottom
            )
              held[match[1]] = true;
          }
        if (resetEvent(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false },
    );
  window.addEventListener(
    'keydown',
    (event) => {
      const game = runtime.menuGame?.(),
        info = api?.read(game);
      if (
        !info ||
        !api.ready(game) ||
        info.car.hasFinished() ||
        event
          .composedPath()
          .some((e) => e?.matches?.('input,textarea,select,[contenteditable=true]'))
      )
        return;
      if (event.code !== 'KeyR' && !api.key(game, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) manager.tap();
    },
    true,
  );
  window.addEventListener('blur', () => {
    held = {};
    lastTap = -Infinity;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      held = {};
      lastTap = -Infinity;
    }
  });
  const setup = setInterval(() => {
    if (!runtime.menuDebug?.().loaded) return;
    clearInterval(setup);
    api = runtime.getFromPolyTrack(`({
   read:g=>g instanceof Is&&!Za.get(g)?.multiplayerConnection&&!ss.get(g)&&!window.polycupDedicatedNoRender?{game:g,car:Xa.get(g),resetButton:It.get(Ha.get(g))}:null,
   ready:g=>!bs.call(g)&&!fs.get(g).isEnabled,
   key:(g,event)=>ua.get(g).checkKeyBinding(event,ge.A.VehicleCheckpointReset),
   watch:g=>Na.get(g).setWatchButtonEnabled(true),
   uploads:(g,enabled)=>ya.set(g,enabled),
   held:(g,keys)=>{const input=qa.get(g);for(const key of Object.keys(keys))input[key]=true;},
   hook:prepare=>{const update=Is.prototype.update;Is.prototype.update=function(...args){prepare(this);return update.apply(this,args);};}
  })`);
    const originals = new WeakMap();
    api.hook((game) => {
      const info = api.read(game);
      if (!info) {
        liveCar = null;
        current = null;
        return;
      }
      const car = info.car;
      car.cameraOrbit; // Resolve native private worker ID without changing camera.
      if (car !== liveCar) {
        if (!originals.has(game))
          originals.set(game, runtime.getFromPolyTrack('g=>ya.get(g)')(game));
        liveCar = car;
        current = null;
        lastTap = -Infinity;
        api.uploads(game, originals.get(game));
        window.dispatchEvent(
          new CustomEvent('rolling-status', {
            detail: { phase: 'waiting', elapsed: 0, copium: 0, respawns: 0 },
          }),
        );
        send({ rollingEnable: true });
      }
      if (used.has(car)) api.uploads(game, false);
      if (api.ready(game) && Object.keys(held).length) api.held(game, held);
    });
    installRollingPresentation(runtime);
    manager.ready = true;
  }, 20);
  installPracticeReplays(runtime);
}
