import { element as h } from './dom.ts';
import { protectUITouches } from './touch-ui.ts';
/** Crop locally; submit the whole source and the crop for server-side screening. */
export function avatarEditor(options: {
  image: ImageBitmap;
  source: File;
  save: (image: Blob, source: File) => Promise<void>;
  cancel: () => void;
  busyChanged?: (busy: boolean) => void;
}) {
  const form = h('form', undefined, 'profile-avatar-editor');
  form.setAttribute('aria-label', 'Profile picture');
  const canvas = h('canvas');
  canvas.className = 'avatar-crop-preview';
  canvas.width = canvas.height = 512;
  canvas.setAttribute('aria-label', 'Picture crop preview');
  canvas.tabIndex = 0;
  const ctx = canvas.getContext('2d')!;
  const output = h('canvas');
  output.width = output.height = 512;
  const crop = output.getContext('2d')!;
  const stage = h('div', undefined, 'avatar-crop-stage');
  const mask = h('span', undefined, 'avatar-crop-mask');
  mask.setAttribute('aria-hidden', 'true');
  stage.append(canvas, mask);
  const controls = h('div', undefined, 'avatar-crop-controls');
  const zoom = h('input');
  zoom.type = 'range';
  zoom.min = '1';
  zoom.max = '3';
  zoom.step = '0.01';
  zoom.value = '1';
  zoom.disabled = false;
  zoom.setAttribute('aria-label', 'Picture zoom');
  const error = h('p', '', 'social-error');
  error.setAttribute('role', 'alert');
  const actions = h('div', undefined, 'profile-edit-actions');
  const cancel = h('button', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = options.cancel;
  const save = h('button', 'Save picture', 'primary');
  save.type = 'submit';
  save.disabled = false;
  actions.append(cancel, save);
  controls.append(zoom);
  form.append(stage, controls, error, actions);
  let image: ImageBitmap | null = options.image,
    x = 0.5,
    y = 0.5,
    busy = false;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const draw = () => {
    ctx.clearRect(0, 0, 512, 512);
    if (!image) {
      ctx.fillStyle = '#2c3b66';
      ctx.fillRect(0, 0, 512, 512);
      return;
    }
    const size = Math.min(image.width, image.height) / Number(zoom.value);
    const scale = 384 / size;
    ctx.drawImage(
      image,
      64 - (image.width - size) * x * scale,
      64 - (image.height - size) * y * scale,
      image.width * scale,
      image.height * scale,
    );
    crop.clearRect(0, 0, 512, 512);
    crop.drawImage(
      image,
      (image.width - size) * x,
      (image.height - size) * y,
      size,
      size,
      0,
      0,
      512,
      512,
    );
  };
  draw();
  zoom.oninput = draw;
  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  canvas.onpointerdown = (e) => {
    if (!image || busy) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: x, top: y };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.id || !image) return;
    const r = canvas.getBoundingClientRect(),
      size = Math.min(image.width, image.height) / Number(zoom.value);
    x = clamp(
      drag.left -
        (((e.clientX - drag.x) / (r.width * 0.75)) * size) / Math.max(1, image.width - size),
    );
    y = clamp(
      drag.top -
        (((e.clientY - drag.y) / (r.height * 0.75)) * size) / Math.max(1, image.height - size),
    );
    draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = null;
  };
  canvas.onkeydown = (e) => {
    if (!image || busy) return;
    const d = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') x = clamp(x - d);
    else if (e.key === 'ArrowRight') x = clamp(x + d);
    else if (e.key === 'ArrowUp') y = clamp(y - d);
    else if (e.key === 'ArrowDown') y = clamp(y + d);
    else return;
    e.preventDefault();
    draw();
  };
  const submit = async () => {
    if (busy || !image) return;
    busy = true;
    options.busyChanged?.(true);
    error.textContent = '';
    [zoom, save, cancel].forEach((n) => (n.disabled = true));
    save.textContent = 'Checking picture…';
    try {
      let blob: Blob | null = null;
      for (const quality of [0.88, 0.74, 0.6]) {
        blob = await new Promise<Blob | null>((r) => output.toBlob(r, 'image/webp', quality));
        if (blob && blob.size <= 262144) break;
      }
      if (!blob || blob.type !== 'image/webp' || blob.size > 262144)
        throw Error('Could not resize this picture. Choose another.');
      await options.save(blob, options.source);
    } catch (e) {
      if (form.isConnected) {
        error.textContent = (e as Error).message;
        cancel.disabled = false;
        zoom.disabled = !image;
        save.disabled = !image;
        save.textContent = 'Save picture';
      }
    } finally {
      busy = false;
      options.busyChanged?.(false);
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    void submit();
  };
  return {
    element: form,
    get busy() {
      return busy;
    },
    dispose() {
      image?.close();
      image = null;
    },
  };
}
/** Keep the OS picker first: cancellation leaves the profile untouched. */
export function chooseAvatarPicture(
  root: ShadowRoot,
  options: {
    save: (image: Blob, source: File) => Promise<void>;
    failed: (message: string) => void;
    closed: () => void;
  },
) {
  const input = h('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg';
  input.hidden = true;
  (root.querySelector('dialog:modal') ?? root).append(input);
  let disposed = false,
    popup: ReturnType<typeof avatarEditorPopup> | undefined;
  const finish = () => {
    if (!disposed) {
      disposed = true;
      input.remove();
      options.closed();
    }
  };
  const dispose = () => {
    if (disposed) return;
    popup?.dispose();
    finish();
  };
  input.addEventListener('cancel', finish);
  input.onchange = () => {
    const selected = input.files?.[0];
    input.remove();
    if (!selected) {
      finish();
      return;
    }
    void (async () => {
      try {
        if (!['image/png', 'image/jpeg'].includes(selected.type) || selected.size > 8 * 1024 * 1024)
          throw Error('Choose a PNG or JPG up to 8 MB.');
        const image = await createImageBitmap(selected);
        if (disposed) {
          image.close();
          return;
        }
        if (image.width < 32 || image.height < 32 || image.width * image.height > 24000000) {
          image.close();
          throw Error('Choose a picture between 32 pixels and 24 megapixels.');
        }
        popup = avatarEditorPopup(root, {
          image,
          source: selected,
          save: options.save,
          closed: finish,
        });
      } catch (error) {
        if (!disposed) {
          options.failed((error as Error).message);
          finish();
        }
      }
    })();
  };
  input.click();
  return {
    dispose,
    cancel: () => {
      if (popup) popup.cancel();
      else finish();
    },
  };
}
/** A focused modal above the retained profile; native modal focus keeps the page inert. */
export function avatarEditorPopup(
  root: ShadowRoot,
  options: {
    image: ImageBitmap;
    source: File;
    save: (image: Blob, source: File) => Promise<void>;
    closed: () => void;
  },
) {
  const dialog = h('dialog', undefined, 'social-dialog avatar-picture-dialog polycup-surface');
  dialog.setAttribute('aria-label', 'Edit profile picture');
  const header = h('header');
  const title = h('h2', 'Profile picture');
  const close = h('button', '×', 'social-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close picture editor');
  let disposed = false;
  const editor = avatarEditor({
    image: options.image,
    source: options.source,
    cancel: () => cancel(),
    busyChanged: (busy) => {
      close.disabled = busy;
      dialog.setAttribute('aria-busy', String(busy));
    },
    save: async (image, source) => {
      await options.save(image, source);
      dispose();
    },
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    editor.dispose();
    dialog.close();
    dialog.remove();
    options.closed();
  }
  function cancel() {
    if (!editor.busy) dispose();
  }
  close.onclick = cancel;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener('close', () => {
    if (!disposed) dispose();
  });
  header.append(title, close);
  dialog.append(header, editor.element);
  root.append(dialog);
  protectUITouches(root);
  dialog.showModal();
  editor.element.querySelector<HTMLCanvasElement>('canvas')?.focus();
  return { element: dialog, cancel, dispose };
}
export const avatarEditorCSS = `
.avatar-picture-dialog{width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 24px);border-top:3px solid var(--pc-gold,#ffd76b)}
.avatar-picture-dialog>header{padding:12px 18px;gap:12px}
.avatar-picture-dialog>header h2{font-size:24px}
.avatar-picture-dialog::backdrop{background:#080f24b8;backdrop-filter:blur(4px)}
.avatar-picture-dialog .profile-avatar-editor{display:flex;flex-direction:column;gap:14px;padding:18px;margin:0;overflow:auto;min-height:0;background:var(--pc-panel,#192243)}
.avatar-crop-stage{position:relative;overflow:hidden;width:min(320px,100%);aspect-ratio:1;align-self:center;background:#101a39;flex:none}
.profile-avatar-editor canvas{display:block;width:100%;height:100%;background:#2c3b66;touch-action:none;cursor:grab;outline-offset:-3px}
.avatar-crop-preview:focus-visible{outline:2px solid var(--pc-muted,#b3c7df);outline-offset:2px}
.avatar-crop-mask{position:absolute;inset:12.5%;border:2px solid var(--pc-gold,#ffd76b);box-shadow:0 0 0 100vmax #080f2499;pointer-events:none}
.avatar-crop-controls{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0;width:100%}
.avatar-crop-controls small{color:var(--pc-muted,#b3c7df);font-size:15px;line-height:1.3}
.avatar-crop-controls input[type=file]{display:none}
.avatar-picture-dialog .avatar-file-label{align-self:flex-start;min-height:40px;padding:8px 16px}
.avatar-crop-controls input[type=range]{width:100%;height:28px;min-height:28px;margin:0;padding:0;clip-path:none;accent-color:var(--pc-gold)}
.profile-avatar-editor>.social-error{width:100%;font-size:16px}.profile-avatar-editor>.social-error:empty{display:none}
.avatar-picture-dialog .profile-edit-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;width:100%;padding-top:4px}
.avatar-picture-dialog .profile-edit-actions button{width:auto;min-height:44px;margin:0;font-size:18px;padding:8px 14px}
.profile-self-avatar{cursor:pointer}.avatar-edit-hint{display:grid;place-items:center;position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;background:#101a3938}.avatar-edit-hint svg{opacity:.65}.profile-self-avatar .avatar-edit-hint svg{width:26px;height:26px}:is(.account-avatar,.profile-self-avatar):is(:hover,:focus-visible)>.avatar-edit-hint{opacity:1}@media(hover:none){:is(.account-avatar,.profile-self-avatar)>.avatar-edit-hint{opacity:.45}}
@media(max-width:480px){.avatar-picture-dialog .profile-avatar-editor{padding:14px;gap:12px}.avatar-picture-dialog .profile-edit-actions{gap:6px}.avatar-picture-dialog .profile-edit-actions button{padding:8px 10px;font-size:16px}}
@media(max-height:540px) and (min-width:600px){.avatar-picture-dialog{width:min(800px,calc(100vw - 24px))}.avatar-picture-dialog .profile-avatar-editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);column-gap:20px}.avatar-crop-stage{width:min(248px,calc(100dvh - 126px));grid-column:1;grid-row:1/4}.avatar-crop-controls{grid-column:2}.profile-avatar-editor>.social-error,.avatar-picture-dialog .profile-edit-actions{grid-column:2}.avatar-picture-dialog .profile-edit-actions button{font-size:16px;padding:8px 10px}}
`;
