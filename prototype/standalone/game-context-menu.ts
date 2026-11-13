/** Keep a keyboard-bound brake from opening the browser's context menu. */
export function protectGameContextMenu(driving: () => boolean, target: Window = window) {
  const editable = (event: Event) => event.composedPath().some(node =>
    node instanceof HTMLElement && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)));
  const key = (event: KeyboardEvent) => {
    if ((event.code === 'ContextMenu' || event.key === 'ContextMenu' ||
      (event.shiftKey && event.code === 'F10')) && !editable(event) && driving()) event.preventDefault();
  };
  const menu = (event: Event) => { if (!editable(event) && driving()) event.preventDefault(); };
  target.addEventListener('keydown', key, true);
  target.addEventListener('contextmenu', menu, true);
  return () => { target.removeEventListener('keydown', key, true); target.removeEventListener('contextmenu', menu, true); };
}
