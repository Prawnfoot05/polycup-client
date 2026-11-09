/** Default checkVisibility semantics without requiring Safari 17.4 or newer.
 * Keep this function self-contained: the native menu embeds its source verbatim.
 * CSS visibility/opacity are intentionally not checked, just like the native API.
 */
export function hasLayoutBox<T extends Element>(element: T | null | undefined): element is T {
  if (!element) return false;
  if (typeof element.checkVisibility === 'function') return element.checkVisibility();
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  for (let current: Element | null = element; current;) {
    if (getComputedStyle(current).contentVisibility === 'hidden') return false;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return true;
}
