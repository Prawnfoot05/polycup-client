/** Align the collapsed cards without letting expanded lists resize the other column. */
export function alignProfileCards(columns: HTMLElement) {
  let width = -1;
  let disposed = false;
  const naturalHeight = (card: HTMLElement, list?: string) => {
    const copy = card.cloneNode(true) as HTMLElement;
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.removeAttribute('id');
    for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
    if (list) {
      const element = copy.querySelector<HTMLElement>(list);
      const rows = element?.children;
      const count = Number(element?.dataset.collapsedCount ?? 3);
      if (rows) for (const row of [...rows].slice(count)) row.remove();
    }
    Object.assign(copy.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      width: card.getBoundingClientRect().width + 'px',
      minHeight: '0',
      height: 'auto',
      margin: '0',
      flex: 'none',
    });
    columns.append(copy);
    const height = copy.getBoundingClientRect().height;
    copy.remove();
    return height;
  };
  const update = (force = false) => {
    if (disposed) return;
    const next = columns.getBoundingClientRect().width;
    if (!next || (!force && next === width)) return;
    width = next;
    columns.style.removeProperty('--profile-first-row');
    columns.style.removeProperty('--profile-second-row');
    if (matchMedia('(max-width:900px)').matches) return;
    const summary = columns.querySelector<HTMLElement>('.profile-summary');
    const history = columns.querySelector<HTMLElement>('.profile-rating-history');
    const blocks = columns.querySelectorAll<HTMLElement>('.profile-block');
    if (!summary || blocks.length !== 2) return;
    columns.style.setProperty(
      '--profile-first-row',
      Math.ceil(Math.max(naturalHeight(summary), naturalHeight(blocks[0], '.profile-track-list'))) +
        'px',
    );
    if (history)
      columns.style.setProperty(
        '--profile-second-row',
        Math.ceil(
          Math.max(naturalHeight(history), naturalHeight(blocks[1], '.profile-peer-list')),
        ) + 'px',
      );
  };
  const observer = new ResizeObserver(() => update());
  observer.observe(columns);
  update();
  void document.fonts.ready.then(() => update(true));
  return () => {
    disposed = true;
    observer.disconnect();
  };
}
