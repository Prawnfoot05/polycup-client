const boundaries = new WeakSet<EventTarget>();

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
