/** Extend the primary native button to the row without stealing nested actions,
 * text selection or keyboard navigation. Keep one accessible tab stop. */
export function clickableRow(row: HTMLElement, action: HTMLButtonElement) {
  row.classList.add('pc-clickable-row');
  action.dataset.rowAction = '';
  row.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || action.disabled || event.defaultPrevented) return;
    if (target.closest('button,a,input,select,textarea,[role="button"]')) return;
    if (row.ownerDocument.getSelection()?.toString()) return;
    action.click();
  });
}
