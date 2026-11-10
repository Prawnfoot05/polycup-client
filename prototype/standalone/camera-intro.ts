import { parseCameras, sampleCamera, type CameraCatalog } from './camera-path.ts';
/** Cosmetic playback uses the existing countdown; it never delays the race. */
export async function installCameraIntros(proto: any) {
  let catalog: CameraCatalog;
  try {
    catalog = parseCameras(
      await (await fetch(new URL('camera-sweeps.json', import.meta.url))).text(),
    );
  } catch {
    return;
  }
  const c = proto.controller;
  let runId = '',
    active: any = null;
  function release() {
    if (active) {
      if (active.renderer.update === active.update) active.renderer.update = active.original;
      try {
        c.native.release(active.game, active.view);
      } catch {}
      active = null;
    }
  }
  setInterval(() => {
    const s = c.nativeState,
      run = s?.runtime;
    if (
      proto.dedicated ||
      !c.ranked ||
      !s?.preset?.rules.singleRound ||
      !c.game ||
      !run ||
      s.phase !== 'countdown' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      release();
      return;
    }
    const remaining = run.startsAt - c.now();
    if (remaining <= 350) {
      release();
      return;
    }
    if (runId === run.id) return;
    runId = run.id;
    const path = catalog.tracks[run.trackId];
    if (!path || remaining < 1000) return;
    const game = c.game,
      renderer = c.native.renderer(game),
      original = renderer.update;
    const duration = Math.min(path.frames.at(-1)!.time, (remaining - 350) / 1000);
    active = {
      game,
      renderer,
      original,
      view: c.native.drivingView(game),
      began: performance.now(),
      duration,
    };
    const owned = active;
    renderer.update = function (...args: any[]) {
      if (
        active !== owned ||
        c.game !== game ||
        c.nativeState?.phase !== 'countdown' ||
        c.now() >= run.startsAt - 350
      ) {
        if (active === owned) release();
        renderer.update = original;
        return original.apply(this, args);
      }
      const elapsed = (performance.now() - owned.began) / 1000;
      try {
        c.native.follow(
          game,
          sampleCamera(path, Math.min(1, elapsed / duration) * path.frames.at(-1)!.time),
          -1,
        );
      } catch {
        release();
        renderer.update = original;
      }
      return original.apply(this, args);
    };
    owned.update = renderer.update;
  }, 50);
}
