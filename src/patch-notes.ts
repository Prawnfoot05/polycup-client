import { element as h } from './dom.ts';
import releases from './release-notes.json';
import css from './patch-notes.css';
export const patchNotesCSS = css;

/** Bundled release notes remain available without a database request. */
export class PatchNotes {
  #dialog = h('dialog', undefined, 'patch-notes polycup-surface');
  constructor(shadow: ShadowRoot) {
    const title = h('h2', 'Patch notes');
    title.id = 'polycup-patch-notes-title';
    this.#dialog.setAttribute('aria-labelledby', title.id);
    const header = h('header'), close = h('button', '×', 'quiet');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close patch notes');
    close.onclick = () => this.close();
    header.append(title, close);
    const body = h('div', undefined, 'patch-notes-body');
    for (const [index, release] of releases.entries()) {
      const section = h('details', undefined, 'patch-notes-release');
      section.open = index === 0;
      const summary = h('summary');
      summary.append(h('strong', 'PolyCup ' + release.version));
      if (release.date) {
        const date = h('time', new Date(release.date + 'T12:00:00Z').toLocaleDateString(undefined,
          { year: 'numeric', month: 'short', day: 'numeric' }));
        date.dateTime = release.date;
        summary.append(date);
      }
      const list = h('ul');
      for (const entry of release.entries) list.append(h('li', entry));
      section.append(summary, list);
      for (const note of release.notes) section.append(h('p', note, 'patch-notes-note'));
      body.append(section);
    }
    this.#dialog.append(header, body);
    shadow.append(h('style', css), this.#dialog);
  }
  open() { if (!this.#dialog.open) this.#dialog.showModal(); }
  close() { this.#dialog.close(); }
}
