/** Keep a title on one line inside its existing slot, without moving its neighbours. */
const pending = new Set<HTMLElement>();
const tracked = new Set<HTMLElement>();
let frame = 0;
const fit = (node: HTMLElement) => {
  if (!node.isConnected || node.hidden) return;
  node.style.removeProperty('font-size');
  node.style.removeProperty('line-height');
  const base = getComputedStyle(node);
  const size = parseFloat(base.fontSize),
    line = base.lineHeight;
  const available = node.clientWidth;
  if (!available || !size || node.scrollWidth <= available) return;
  // Reserve a pixel for glyph overhang and device-pixel rounding.
  let next = Math.max(1, Math.floor(((size * (available - 1)) / node.scrollWidth) * 10) / 10);
  node.style.lineHeight = line;
  node.style.fontSize = next + 'px';
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
  for (const entry of entries) schedule(entry.target as HTMLElement);
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
      pending.delete(node);
    }
}
void document.fonts.ready.then(() => {
  for (const node of tracked) schedule(node);
});
