import {
  emptyCameras,
  parseCameras,
  sampleCamera,
  type Shot,
  type CameraPath,
} from './camera-path.ts';
import css from './camera-editor.css';
export function installCameraEditor(proto: any) {
  const c = proto.controller,
    key = 'polycup.camera-studio.v1';
  proto.prepare(false);
  document.body.classList.add('camera-authoring');
  const root = document.createElement('aside');
  root.className = 'camera-studio';
  root.setAttribute('aria-label', 'Track camera studio');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  document.body.append(root);
  const title = document.createElement('h1');
  title.textContent = 'Camera studio';
  const help = document.createElement('p');
  help.className = 'studio-note';
  help.textContent =
    'Hold right mouse to look · W A S D to move · Q / E down / up · Shift for speed';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Track');
  const tracks = c
    .availableTracks()
    .filter((t: any) => ['official', 'community'].includes(t.category));
  for (const t of tracks) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    select.append(o);
  }
  const status = document.createElement('p');
  status.className = 'studio-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Load a track to start composing.';
  const list = document.createElement('ol');
  list.className = 'studio-frames';
  list.setAttribute('aria-label', 'Camera keyframes');
  const controls = document.createElement('div');
  controls.className = 'studio-controls';
  const settings = document.createElement('div');
  settings.className = 'studio-settings';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = '1';
  scrub.step = '.01';
  scrub.value = '0';
  scrub.setAttribute('aria-label', 'Preview time');
  let game: any = null,
    pose: Shot = { time: 0, position: [0, 10, 0], quaternion: [0, 0, 0, 1], fov: 60 },
    selected = -1,
    path: CameraPath = { name: '', interpolation: 'smooth', frames: [] },
    id = '',
    playing = false,
    began = 0,
    looking = false,
    yaw = 0,
    pitch = 0;
  let saved = emptyCameras();
  try {
    saved = parseCameras(localStorage.getItem(key) || JSON.stringify(saved));
  } catch {}
  let savedPath = '';
  const dirty = () => !!id && JSON.stringify(path) !== savedPath;
  function persist() {
    if (!id) throw Error('Load a track first.');
    if (path.frames.length === 0) delete saved.tracks[id];
    else {
      const checked = parseCameras(JSON.stringify({ ...emptyCameras(), tracks: { [id]: path } }));
      saved.tracks[id] = checked.tracks[id];
    }
    localStorage.setItem(key, JSON.stringify(saved));
    savedPath = JSON.stringify(path);
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  const keys = new Set<string>();
  function button(label: string, action: () => void, primary = false) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = primary ? 'studio-primary' : '';
    b.onclick = () => {
      try {
        action();
      } catch (e: any) {
        status.textContent = e.message;
      }
    };
    return b;
  }
  function number(
    label: string,
    value: number,
    change: (n: number) => void,
    min = -100000,
    max = 100000,
  ) {
    const l = document.createElement('label');
    l.textContent = label;
    const n = document.createElement('input');
    n.type = 'number';
    n.step = '.1';
    n.min = String(min);
    n.max = String(max);
    n.value = String(Math.round(value * 100) / 100);
    n.onchange = () => {
      const v = Number(n.value);
      if (Number.isFinite(v) && v >= min && v <= max) change(v);
    };
    l.append(n);
    return l;
  }
  function orient() {
    const [x, y, z, w] = pose.quaternion;
    const fx = -2 * (x * z + w * y),
      fy = 2 * (w * x - y * z),
      fz = -(1 - 2 * (x * x + y * y));
    yaw = Math.atan2(-fx, -fz);
    pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
  }
  function edit() {
    settings.replaceChildren();
    const f = path.frames[selected];
    if (!f) return;
    settings.append(
      number(
        'Time (s)',
        f.time,
        (n) => {
          if (selected === 0 && n !== 0) return;
          if (
            n <= (path.frames[selected - 1]?.time ?? -1) ||
            n >= (path.frames[selected + 1]?.time ?? 16)
          )
            return;
          f.time = n;
          render();
        },
        0,
        15,
      ),
    );
    ['X', 'Y', 'Z'].forEach((label, i) =>
      settings.append(
        number(label, f.position[i], (n) => {
          f.position[i] = n;
          pose = structuredClone(f);
          playing = false;
        }),
      ),
    );
    settings.append(
      number(
        'Field of view',
        f.fov,
        (n) => {
          f.fov = n;
          pose = structuredClone(f);
        },
        15,
        120,
      ),
    );
  }
  function render() {
    list.replaceChildren();
    path.frames.forEach((f, i) => {
      const li = document.createElement('li');
      const b = button(`Shot ${i + 1} · ${f.time.toFixed(1)}s`, () => {
        selected = i;
        playing = false;
        pose = structuredClone(f);
        orient();
        render();
      });
      b.setAttribute('aria-pressed', String(i === selected));
      li.append(b);
      list.append(li);
    });
    scrub.max = String(path.frames.at(-1)?.time || 1);
    edit();
  }
  const load = button(
    'Load track',
    () => {
      void loadTrack();
    },
    true,
  );
  async function loadTrack() {
    if (dirty()) {
      if (path.frames.length === 1) {
        if (
          !confirm(
            'This track has only one keyframe and cannot be saved yet. Discard it and load another track?',
          )
        )
          return;
      } else
        try {
          persist();
        } catch (e: any) {
          status.textContent = e.message;
          return;
        }
    }
    load.disabled = true;
    playing = false;
    status.textContent = 'Loading track…';
    try {
      game = null;
      id = '';
      keys.clear();
      play.textContent = 'Preview';
      c.connection?.dispose();
      window.dispatchEvent(new Event('polycup-return-menu'));
      proto.ui.setMainMenuOpen(false);
      const track = tracks.find((t: any) => t.id === select.value);
      if (!track) throw Error('Track unavailable.');
      const loaded = await track.load();
      await proto.launchNativeRace('host', new AbortController().signal, loaded);
      game = c.game;
      if (!game) throw Error('Track did not become ready.');
      id = track.id;
      path = structuredClone(
        saved.tracks[id] ?? { name: track.name, interpolation: 'smooth', frames: [] },
      );
      selected = path.frames.length ? 0 : -1;
      easing.value = path.interpolation;
      savedPath = JSON.stringify(path);
      pose = path.frames[0]
        ? structuredClone(path.frames[0])
        : { ...c.native.camera(game), time: 0 };
      orient();
      c.native.enterFreecam(game);
      c.native.leaderboardUploads(game, false);
      c.requestPanel(false);
      const renderer = c.native.renderer(game),
        original = renderer.update,
        owned = game;
      renderer.update = function (...args: any[]) {
        if (game === owned) {
          c.native.visibility(owned, [], null);
          c.native.follow(owned, pose, -1);
        }
        return original.apply(this, args);
      };
      status.textContent = track.name + ' · Draft stays on this computer';
      render();
    } catch (e: any) {
      status.textContent = e.message;
    } finally {
      load.disabled = false;
    }
  }
  const capture = button(
    'Capture keyframe',
    () => {
      if (!game) throw Error('Load a track first.');
      const time = path.frames.length ? path.frames.at(-1)!.time + 1 : 0;
      if (time > 15 || path.frames.length >= 64) throw Error('The path is at its limit.');
      path.frames.push({
        time,
        position: [...pose.position],
        quaternion: [...pose.quaternion],
        fov: pose.fov,
      });
      selected = path.frames.length - 1;
      render();
    },
    true,
  );
  const replace = button('Update shot', () => {
    if (selected < 0) return;
    const time = path.frames[selected].time;
    path.frames[selected] = { ...structuredClone(pose), time };
    render();
  });
  const remove = button('Delete shot', () => {
    if (selected < 0) return;
    path.frames.splice(selected, 1);
    if (path.frames.length) path.frames[0].time = 0;
    selected = Math.min(selected, path.frames.length - 1);
    render();
  });
  const play = button('Preview', () => {
    if (path.frames.length < 2) throw Error('Capture at least two keyframes.');
    playing = !playing;
    began = performance.now();
    play.textContent = playing ? 'Stop preview' : 'Preview';
  });
  scrub.oninput = () => {
    if (path.frames.length < 2) return;
    playing = false;
    pose = sampleCamera(path, Number(scrub.value));
    orient();
  };
  const easing = document.createElement('select');
  easing.setAttribute('aria-label', 'Camera easing');
  for (const [value, text] of [
    ['smooth', 'Ease in / out'],
    ['linear', 'Constant speed'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    easing.append(o);
  }
  easing.onchange = () => (path.interpolation = easing.value as 'smooth' | 'linear');
  const save = button('Save draft', () => {
    persist();
    status.textContent = path.frames.length
      ? 'Draft saved for ' + path.name
      : 'Saved path removed for ' + path.name;
  });
  const exportButton = button('Export paths', () => {
    if (path.frames.length >= 2) {
      const checked = parseCameras(JSON.stringify({ ...emptyCameras(), tracks: { [id]: path } }));
      saved.tracks[id] = checked.tracks[id];
    }
    if (!Object.keys(saved.tracks).length) throw Error('Capture at least two keyframes first.');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'camera-sweeps.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Exported track paths. No paths were published.';
  });
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json';
  file.hidden = true;
  file.onchange = async () => {
    try {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 256000) throw Error('Camera file is too large.');
      const imported = parseCameras(await f.text());
      saved.tracks = { ...saved.tracks, ...imported.tracks };
      localStorage.setItem(key, JSON.stringify(saved));
      if (saved.tracks[id]) {
        path = structuredClone(saved.tracks[id]);
        selected = 0;
        pose = structuredClone(path.frames[0]);
        orient();
        easing.value = path.interpolation;
        savedPath = JSON.stringify(path);
        render();
      }
      status.textContent = 'Imported ' + Object.keys(imported.tracks).length + ' track paths.';
    } catch (e: any) {
      status.textContent = e.message;
    }
    file.value = '';
  };
  root.append(
    title,
    help,
    select,
    load,
    status,
    capture,
    list,
    settings,
    controls,
    scrub,
    easing,
    save,
    exportButton,
    button('Import paths', () => file.click()),
    file,
  );
  controls.append(replace, remove, play);
  const note = document.createElement('p');
  note.className = 'studio-note';
  note.textContent =
    'Aim for about 3 seconds. Ranked playback fits the existing countdown and ends before Go. No automatic camera paths are generated.';
  root.append(note);
  document.addEventListener('contextmenu', (e) => {
    if (!root.contains(e.target as Node)) e.preventDefault();
  });
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 2 && !root.contains(e.target as Node)) {
        looking = true;
        (document.activeElement as HTMLElement)?.blur();
        e.preventDefault();
      }
    },
    true,
  );
  document.addEventListener('mouseup', () => (looking = false));
  document.addEventListener('mousemove', (e) => {
    if (!looking || !game) return;
    playing = false;
    yaw -= e.movementX * 0.003;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003));
    const sy = Math.sin(yaw / 2),
      cy = Math.cos(yaw / 2),
      sp = Math.sin(pitch / 2),
      cp = Math.cos(pitch / 2);
    pose.quaternion = [cy * sp, sy * cp, -sy * sp, cy * cp];
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!game || root.contains(e.target as Node)) return;
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)
      ) {
        keys.add(e.code);
        playing = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener('keyup', (e) => keys.delete(e.code), true);
  window.addEventListener('blur', () => {
    keys.clear();
    looking = false;
  });
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (game) {
      if (playing) {
        const t = Math.min((now - began) / 1000, path.frames.at(-1)!.time);
        pose = sampleCamera(path, t);
        scrub.value = String(t);
        if (t >= path.frames.at(-1)!.time) {
          playing = false;
          play.textContent = 'Preview';
          orient();
        }
      } else {
        const speed = dt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 100 : 20),
          forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
          right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
        pose.position[0] +=
          (-Math.sin(yaw) * Math.cos(pitch) * forward + Math.cos(yaw) * right) * speed;
        pose.position[1] +=
          (Math.sin(pitch) * forward + Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))) * speed;
        pose.position[2] +=
          (-Math.cos(yaw) * Math.cos(pitch) * forward - Math.sin(yaw) * right) * speed;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  proto.cameraEditor = {
    root,
    get path() {
      return structuredClone(path);
    },
    get pose() {
      return structuredClone(pose);
    },
    get track() {
      return id;
    },
  };
}
