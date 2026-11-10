export interface Shot {
  time: number;
  position: number[];
  quaternion: number[];
  fov: number;
}
export interface CameraPath {
  name: string;
  interpolation: 'linear' | 'smooth';
  frames: Shot[];
}
export interface CameraCatalog {
  schema: 1;
  gameVersion: '0.6.3';
  tracks: Record<string, CameraPath>;
}
export const emptyCameras = (): CameraCatalog => ({ schema: 1, gameVersion: '0.6.3', tracks: {} });
export function parseCameras(text: string): CameraCatalog {
  if (text.length > 256000) throw Error('Camera file is too large.');
  const c = JSON.parse(text);
  if (
    c?.schema !== 1 ||
    c.gameVersion !== '0.6.3' ||
    !c.tracks ||
    typeof c.tracks !== 'object' ||
    Array.isArray(c.tracks) ||
    Object.keys(c.tracks).length > 250
  )
    throw Error('Expected a PolyTrack 0.6.3 camera file.');
  const out = emptyCameras();
  for (const [id, p] of Object.entries(c.tracks) as [string, any][]) {
    if (
      !/^[a-f0-9]{64}$/i.test(id) ||
      !p ||
      typeof p.name !== 'string' ||
      p.name.length > 100 ||
      !['linear', 'smooth'].includes(p.interpolation) ||
      !Array.isArray(p.frames) ||
      p.frames.length < 2 ||
      p.frames.length > 64
    )
      throw Error('Invalid track or camera path.');
    let prev = -1;
    const frames = p.frames.map((f: any, i: number) => {
      if (
        !Number.isFinite(f.time) ||
        f.time <= prev ||
        f.time > 15 ||
        (i === 0 && f.time !== 0) ||
        !Array.isArray(f.position) ||
        f.position.length !== 3 ||
        !f.position.every((n: any) => Number.isFinite(n) && Math.abs(n) < 100000) ||
        !Array.isArray(f.quaternion) ||
        f.quaternion.length !== 4 ||
        !f.quaternion.every(Number.isFinite) ||
        !Number.isFinite(f.fov) ||
        f.fov < 15 ||
        f.fov > 120
      )
        throw Error('Invalid camera keyframe. Start at 0s and keep times increasing, up to 15s.');
      const len = Math.hypot(...f.quaternion);
      if (len < 0.99 || len > 1.01) throw Error('Invalid camera orientation.');
      prev = f.time;
      return {
        time: f.time,
        position: [...f.position],
        quaternion: f.quaternion.map((n: number) => n / len),
        fov: f.fov,
      };
    });
    out.tracks[id] = { name: p.name, interpolation: p.interpolation, frames };
  }
  return out;
}
export function sampleCamera(path: CameraPath, time: number): Shot {
  const f = path.frames;
  if (time <= f[0].time) return structuredClone(f[0]);
  if (time >= f.at(-1)!.time) return structuredClone(f.at(-1)!);
  const index = f.findIndex((k) => k.time > time),
    a = f[index - 1],
    b = f[index];
  const raw = (time - a.time) / (b.time - a.time),
    t = path.interpolation === 'smooth' ? raw * raw * (3 - 2 * raw) : raw;
  let dot = a.quaternion.reduce((n, v, i) => n + v * b.quaternion[i], 0),
    q = [...b.quaternion];
  if (dot < 0) {
    dot = -dot;
    q = q.map((v) => -v);
  }
  let u = 1 - t,
    v = t;
  if (dot < 0.9995) {
    const angle = Math.acos(Math.min(1, dot)),
      sin = Math.sin(angle);
    u = Math.sin((1 - t) * angle) / sin;
    v = Math.sin(t * angle) / sin;
  }
  const quat = a.quaternion.map((x, i) => x * u + q[i] * v),
    len = Math.hypot(...quat);
  return {
    time,
    position: a.position.map((x, i) => x + (b.position[i] - x) * t),
    quaternion: quat.map((x) => x / len),
    fov: a.fov + (b.fov - a.fov) * t,
  };
}
