/** Keep a title on one line inside its existing slot, without moving its neighbours. */
const pending = new Set<HTMLElement>();
const tracked = new Set<HTMLElement>();
let frame = 0;
const widths = new WeakMap<HTMLElement, number>();
const fit = (node: HTMLElement) => {
  if (!node.isConnected || node.hidden) return;
  const available = node.clientWidth;
  if (!available || !node.parentElement) return;
  // Measure the stylesheet's natural size without resetting the visible title.
  // A live reset can change flex sizing and trigger another observer fit.
  const probe = node.cloneNode(false) as HTMLElement;
  probe.removeAttribute('id');
  probe.removeAttribute('data-player-title');
  probe.setAttribute('aria-hidden', 'true');
  probe.textContent = node.textContent;
  probe.style.removeProperty('font-size');
  probe.style.removeProperty('line-height');
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: 'max-content',
    maxWidth: 'none',
    minWidth: '0',
    height: 'auto',
    flex: 'none',
    contain: 'layout style',
  });
  node.parentElement.append(probe);
  const base = getComputedStyle(probe);
  const size = parseFloat(base.fontSize),
    line = base.lineHeight,
    natural = probe.scrollWidth;
  probe.remove();
  if (!size || !natural) return;
  // Reserve a pixel for glyph overhang and device-pixel rounding.
  let next =
    natural <= available
      ? size
      : Math.max(1, Math.floor(((size * (available - 1)) / natural) * 10) / 10);
  if (node.style.lineHeight !== line) node.style.lineHeight = line;
  if (node.style.fontSize !== next + 'px') node.style.fontSize = next + 'px';
  while (node.scrollWidth > available && next > 1) {
    next = Math.max(1, Math.round((next - 0.1) * 10) / 10);
    node.style.fontSize = next + 'px';
  }
};
const schedule = (node: HTMLElement) => {
  pending.add(node);
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const title of pending) fit(title);
      pending.clear();
    });
};
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const node = entry.target as HTMLElement,
      width = entry.contentRect.width;
    // Font fitting can change height; only a new available width needs refitting.
    if (widths.get(node) !== width) {
      widths.set(node, width);
      schedule(node);
    }
  }
});
export function fitPlayerTitle(node: HTMLElement) {
  if (!tracked.has(node)) {
    tracked.add(node);
    observer.observe(node);
  }
  schedule(node);
}
export function prunePlayerTitles() {
  for (const node of tracked)
    if (!node.isConnected) {
      observer.unobserve(node);
      tracked.delete(node);
      widths.delete(node);
      pending.delete(node);
    }
}
void document.fonts.ready.then(() => {
  for (const node of tracked) schedule(node);
});
document.fonts.addEventListener?.('loadingdone', () => {
  for (const node of tracked) schedule(node);
});
globalThis.window?.addEventListener?.('resize', () => {
  for (const node of tracked) schedule(node);
});
