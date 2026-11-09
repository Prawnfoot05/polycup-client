import { element as h } from './dom.ts';
import { profileAccents } from './social.ts';
import css from './profile-accent.css';
export const profileAccentCSS = css;
export function accentHex(value?: string): `#${string}` {
  return /^#[\da-f]{6}$/i.test(value ?? '')
    ? (value!.toLowerCase() as `#${string}`)
    : value && Object.hasOwn(profileAccents, value)
      ? profileAccents[value as keyof typeof profileAccents]
      : profileAccents.gold;
}
export function paintProfileAccent(node: HTMLElement, value: string) {
  const hex = accentHex(value);
  node.style.setProperty('--profile-accent', hex);
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const light = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = light[0] * 0.2126 + light[1] * 0.7152 + light[2] * 0.0722;
  // The selected colour stays on the trim; dark colours must not hide headings.
  node.style.setProperty(
    '--profile-accent-text',
    (luminance + 0.05) / (0.027 + 0.05) >= 4.5 ? hex : '#ffffff',
  );
}
export function profileAccentPicker(
  initial: string,
  change: (hex: `#${string}`) => void,
  banner: () => string,
) {
  const root = h('section', undefined, 'profile-accent-picker');
  root.setAttribute('aria-label', 'Accent colour');
  const wheel = h('canvas');
  wheel.width = wheel.height = 240;
  wheel.setAttribute('aria-label', 'Colour wheel');
  const controls = h('div', undefined, 'accent-controls');
  const valueLabel = h('label', 'Brightness'),
    value = h('input');
  value.type = 'range';
  value.min = '0';
  value.max = '100';
  value.setAttribute('aria-label', 'Brightness');
  valueLabel.append(value);
  const hexLabel = h('label', 'Hex colour'),
    row = h('div', undefined, 'accent-hex-row'),
    native = h('input'),
    hex = h('input');
  native.type = 'color';
  native.setAttribute('aria-label', 'Choose accent colour');
  hex.type = 'text';
  hex.maxLength = 7;
  hex.pattern = '#[0-9a-fA-F]{6}';
  hex.required = true;
  hex.spellcheck = false;
  hex.setAttribute('aria-label', 'Hex colour');
  row.append(native, hex);
  hexLabel.append(row);
  const dropper = h('button', 'Pick colour', 'accent-eyedropper');
  dropper.type = 'button';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M15 2 22 9 19 12 17 10 8 19 2 22 5 16 14 7 12 5Z');
  svg.append(path);
  dropper.prepend(svg);
  const sample = h('canvas'),
    hint = h('p', '', 'accent-hint');
  sample.className = 'accent-banner-sample';
  sample.hidden = true;
  sample.setAttribute('aria-label', 'Pick a colour from your banner');
  hint.setAttribute('role', 'status');
  controls.append(hexLabel, valueLabel, dropper, hint);
  root.append(wheel, controls, sample);
  let hue = 0,
    saturation = 0,
    brightness = 1;
  const hsvRGB = (hh: number, ss: number, vv: number) => {
    const f = (n: number) => {
      const k = (n + hh / 60) % 6;
      return vv * (1 - ss * Math.max(0, Math.min(k, 4 - k, 1)));
    };
    return [f(5), f(3), f(1)];
  };
  const draw = () => {
    const ctx = wheel.getContext('2d')!,
      pixels = ctx.createImageData(240, 240);
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 240; x++) {
        const dx = x - 120,
          dy = y - 120,
          radius = Math.hypot(dx, dy);
        const rgb = hsvRGB(
          ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
          Math.min(1, radius / 116),
          brightness,
        );
        const i = (y * 240 + x) * 4;
        rgb.forEach((v, n) => (pixels.data[i + n] = Math.round(v * 255)));
        pixels.data[i + 3] = Math.round(Math.max(0, Math.min(1, 117 - radius)) * 255);
      }
    ctx.putImageData(pixels, 0, 0);
    const angle = (hue * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(
      120 + Math.cos(angle) * saturation * 116,
      120 + Math.sin(angle) * saturation * 116,
      6,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = '#10182b';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const set = (colour: string, notify = true) => {
    const colourHex = accentHex(colour);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colourHex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    if (delta)
      hue =
        ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) *
          60 +
          360) %
        360;
    saturation = max ? delta / max : 0;
    brightness = max;
    native.value = hex.value = colourHex;
    hex.setCustomValidity('');
    value.value = String(Math.round(max * 100));
    draw();
    if (notify) change(colourHex);
  };
  const emitHSV = () =>
    set(
      '#' +
        hsvRGB(hue, saturation, brightness)
          .map((v) =>
            Math.round(v * 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join(''),
    );
  const pick = (event: PointerEvent) => {
    const bounds = wheel.getBoundingClientRect(),
      dx = ((event.clientX - bounds.left) * 240) / bounds.width - 120,
      dy = ((event.clientY - bounds.top) * 240) / bounds.height - 120;
    hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    saturation = Math.min(1, Math.hypot(dx, dy) / 116);
    emitHSV();
  };
  wheel.onpointerdown = (event) => {
    wheel.setPointerCapture(event.pointerId);
    pick(event);
  };
  wheel.onpointermove = (event) => {
    if (wheel.hasPointerCapture(event.pointerId)) pick(event);
  };
  value.oninput = () => {
    brightness = Number(value.value) / 100;
    emitHSV();
  };
  native.oninput = () => set(native.value);
  hex.oninput = () => {
    const colour = hex.value.startsWith('#') ? hex.value : '#' + hex.value;
    if (/^#[\da-f]{6}$/i.test(colour)) set(colour);
    else hex.setCustomValidity('Enter a six-digit hex colour, for example #85e0bc.');
  };
  const bannerSample = async () => {
    const url = banner();
    if (!url) {
      hint.textContent = 'Select a banner to sample its colours.';
      return;
    }
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
      if (!root.isConnected) return;
      sample.width = 720;
      sample.height = Math.round((720 * img.naturalHeight) / img.naturalWidth);
      sample.getContext('2d')!.drawImage(img, 0, 0, sample.width, sample.height);
      sample.hidden = false;
      hint.textContent = 'Tap a colour in the banner.';
    } catch {
      hint.textContent = 'Banner unavailable. Use the wheel or hex colour.';
    }
  };
  sample.onpointerdown = (event) => {
    const bounds = sample.getBoundingClientRect();
    const pixel = sample
      .getContext('2d')!
      .getImageData(
        Math.min(
          sample.width - 1,
          Math.max(0, Math.floor(((event.clientX - bounds.left) * sample.width) / bounds.width)),
        ),
        Math.min(
          sample.height - 1,
          Math.max(0, Math.floor(((event.clientY - bounds.top) * sample.height) / bounds.height)),
        ),
        1,
        1,
      ).data;
    set(
      '#' +
        [...pixel]
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
    );
    sample.hidden = true;
    hint.textContent = '';
  };
  type Dropper = { open: () => Promise<{ sRGBHex: string }> };
  const EyeDropper = (window as unknown as { EyeDropper?: new () => Dropper }).EyeDropper;
  dropper.textContent = EyeDropper ? 'Pick colour' : 'Pick from banner';
  dropper.prepend(svg);
  dropper.onclick = async () => {
    if (!EyeDropper) {
      await bannerSample();
      return;
    }
    try {
      const result = await new EyeDropper().open();
      if (root.isConnected) set(result.sRGBHex);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') await bannerSample();
    }
  };
  set(initial, false);
  return root;
}
