import { hasLayoutBox } from './visibility.ts';
import { nativeHudHidden } from './native-hud.ts';
import trophy from '../assets/toolbar-trophy.svg';
import { layoutCupHud, type HudElements } from './hud-layout.ts';
import css from './toolbar.css';

// Keep the launcher inside the native toolbar: native scaling, clipping, hover
// animation and auto-hide then apply without copying any game UI implementation.
export class CupToolbar {
  #fallback: HTMLElement;

  #toolbar: HTMLElement | null = null;
  #overlays: HudElements;
  #button: HTMLButtonElement;
  #schedule: () => void;
  #frame: number | null = null;
  #observer: MutationObserver;
  #modalRoots = new WeakSet<ShadowRoot>();
  #resize: ResizeObserver;
  #open: boolean = false;
  #cupActive = false;
  #ranked = false;

  constructor({
    fallback,
    hud,
    povHud,
    povRecordHud,
    inputHud,
    practiceHud,
    notice,
    roundTimer,
    toggle,
  }: HudElements & { fallback: HTMLElement; toggle: () => void }) {
    this.#fallback = fallback;

    this.#overlays = { hud, povHud, povRecordHud, inputHud, practiceHud, notice, roundTimer };
    this.#button = document.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'button polycup-toolbar-button';
    this.#button.title = 'PolyCup (F8)';
    this.#button.setAttribute('aria-keyshortcuts', 'F8');
    const icon = document.createElement('img');
    icon.className = 'button-icon polycup-trophy';
    icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trophy)}`;
    icon.alt = '';
    icon.draggable = false;
    this.#button.append(icon, document.createTextNode(' PolyCup'));
    this.#button.addEventListener('click', toggle);
    // Native game input listens on window and otherwise consumes Space/Enter.
    for (const type of ['keydown', 'keyup'] as const)
      window.addEventListener(
        type,
        (e) => {
          if (document.activeElement !== this.#button || !['Space', 'Enter'].includes(e.code))
            return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === 'keydown' && !e.repeat) this.#button.click();
        },
        { capture: true },
      );
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    this.#schedule = () => {
      if (this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.sync();
      });
    };
    this.#observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            r.type === 'childList' ||
            r.attributeName === 'open' ||
            r.target === document.body ||
            (r.target as Element).matches?.('#prototype-ranked-loading') ||
            (r.target as Element).closest?.('.game-ui,.menu-ui'),
        )
      )
        this.#schedule();
    });
    this.#observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    const root = fallback.getRootNode();
    if (root instanceof ShadowRoot)
      this.#observer.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
      });
    this.#resize = new ResizeObserver(this.#schedule);
    window.addEventListener('resize', this.#schedule);
    this.sync();
  }
  sync(open?: boolean, cupActive?: boolean, ranked?: boolean) {
    if (open !== undefined) this.#open = open;
    if (cupActive !== undefined) this.#cupActive = cupActive;
    if (ranked !== undefined) this.#ranked = ranked;
    const toolbar = document.querySelector<HTMLElement>('.game-toolbar-ui');
    if (toolbar !== this.#toolbar) {
      this.#resize.disconnect();
      this.#toolbar?.removeEventListener('transitionend', this.#schedule);
      this.#toolbar?.classList.remove('polycup-toolbar');
      this.#toolbar = toolbar;
      if (toolbar) {
        toolbar.classList.add('polycup-toolbar');
        this.#resize.observe(toolbar);
        toolbar.addEventListener('transitionend', this.#schedule);
      }
    }
    const container = toolbar?.querySelector(':scope > .button-container');
    toolbar?.classList.toggle('polycup-ranked', this.#ranked);
    if (container && this.#button.parentElement !== container) container.append(this.#button);
    if (!container) this.#button.remove();
    for (const button of toolbar?.querySelectorAll('button') ?? []) {
      if (button.textContent?.trim() === 'Change Track')
        button.classList.toggle('polycup-track-locked', this.#cupActive);
      if (button.textContent?.trim() === 'Invite')
        button.classList.toggle('polycup-track-locked', this.#ranked);
    }
    const menu = document.querySelector<HTMLElement>('.menu-ui > .main-buttons-container');
    const root = this.#fallback.getRootNode();
    // Standalone results and picture editors can own separate Shadow DOM surfaces.
    const modalRoots = new Set(
      [...document.body.children].flatMap((element) => element.shadowRoot ? [element.shadowRoot] : []),
    );
    if (root instanceof ShadowRoot) modalRoots.add(root);
    const nativeHidden = nativeHudHidden();
    for (const surface of modalRoots) {
      surface.host.toggleAttribute('data-native-hud-hidden', nativeHidden);
      if (this.#modalRoots.has(surface)) continue;
      this.#modalRoots.add(surface);
      this.#observer.observe(surface, { subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    this.#fallback.hidden =
      !hasLayoutBox(menu) ||
      getComputedStyle(menu).visibility !== 'visible' ||
      document.body.classList.contains('polycup-menu-covered') ||
      !!document.querySelector('#prototype-ranked-loading:not([hidden])') ||
      !!document.querySelector('dialog[open]') ||
      [...modalRoots].some((surface) => !!surface.querySelector('dialog[open]'));
    this.#button.setAttribute('aria-expanded', String(!!this.#open));
    this.#button.tabIndex = toolbar?.classList.contains('visible') ? 0 : -1;

    this.#overlays.inputHud.toggleAttribute('data-native-hud-hidden', nativeHidden);
    layoutCupHud(this.#overlays);
  }
}
