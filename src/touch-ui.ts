const boundaries = new WeakSet<EventTarget>();
const keyboardTargets = new WeakSet<HTMLElement>();

/** Request the phone keyboard inside the trusted tap, even if focus was already
 * restored by a modal. Never blur/recreate the field or cancel caret selection. */
export function enableTouchKeyboard(input: HTMLInputElement | HTMLTextAreaElement) {
  if (keyboardTargets.has(input)) return;
  keyboardTargets.add(input);
  input.inputMode = 'text';
  let touchEndedAt = -Infinity;
  input.addEventListener('touchend', (event) => {
    if (event.isTrusted) touchEndedAt = performance.now();
  }, { passive: true });
  input.addEventListener('click', (event) => {
    const tap = event as MouseEvent & {
      pointerType?: string;
      sourceCapabilities?: { firesTouchEvents?: boolean } | null;
    };
    // WebKit can label a touch-generated compatibility click as a mouse event.
    const fromTouch = tap.pointerType === 'touch' || tap.sourceCapabilities?.firesTouchEvents ||
      performance.now() - touchEndedAt < 500;
    touchEndedAt = -Infinity;
    if (!event.isTrusted || input.disabled || input.readOnly || !fromTouch) return;
    input.focus({ preventScroll: true });
    // Optional Chrome API. Other browsers keep their normal tap-to-edit path.
    try {
      (navigator as Navigator & { virtualKeyboard?: { show(): void } }).virtualKeyboard?.show();
    } catch { /* An unavailable keyboard request must not interrupt editing. */ }
  });
}

/** Native driving listeners run at window and prevent default on shadow hosts.
 * Keep menu gestures inside their UI so native touch handling cannot cancel
 * browser-generated clicks, field focus or scrolling while a race still exists.
 */
export function protectUITouches(root: ShadowRoot | HTMLElement) {
  if (boundaries.has(root)) return;
  boundaries.add(root);
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
    root.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
}
