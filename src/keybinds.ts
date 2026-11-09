import type { PolyModLoader } from './game-types.ts';

/** Browser key codes are storage identifiers, not player-facing labels. */
export function keyLabel(code: string) {
  const simple = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  if (simple) return simple[1] ?? simple[2];
  const labels: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓',
    ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
  };
  return labels[code] ?? code.replace(/^Numpad/, 'Num ');
}

// PML registers controls during init, before its native settings instance exists.
// Keep its rebindable settings, but only send key events once matching is safe.
export function registerReadyKeybind(
  pml: PolyModLoader,
  label: string,
  id: string,
  primary: string,
  callback: (event: KeyboardEvent) => void,
  target: Window = window,
) {
  const eventName = 'polycup-keydown-' + id;
  const originals = new WeakMap<KeyboardEvent, KeyboardEvent>();
  pml.registerKeybind(label, id, eventName, primary, null, (event) => {
    const original = originals.get(event);
    if (original) callback(original);
  });
  target.addEventListener('keydown', (original) => {
    if (typeof pml.settingClass?.checkKeyBinding !== 'function') return;
    const forwarded = new KeyboardEvent(eventName, { code: original.code });
    originals.set(forwarded, original);
    try {
      target.dispatchEvent(forwarded);
    } finally {
      originals.delete(forwarded);
    }
  });
}
