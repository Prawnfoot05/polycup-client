import css from './dismissible-errors.css';

// Explicit message roles/classes only. Red rating losses, offline labels and
// destructive actions are outcomes/controls, not dismissible error notices.
const selector =
  '[role="alert"],.error,.account-error,.social-error,.finder-error,.finish-error,.accept-error,.preset-field-error,#prototype-error,[data-error-notice]';
const installed = new WeakSet<ShadowRoot | HTMLElement>();
const notices = new WeakMap<
  HTMLElement,
  { text: string; key: string; store: Map<string, Set<string>> }
>();
const dismissals = new WeakMap<Node, Map<string, Set<string>>>();

function storeFor(element: HTMLElement) {
  const root = element.getRootNode();
  let store = dismissals.get(root);
  if (!store) dismissals.set(root, (store = new Map()));
  return store;
}

function ensureStyle(home: Node) {
  const styles = home instanceof ShadowRoot ? home : document.head;
  if (!styles.querySelector('style[data-error-dismissal-style]')) {
    const style = document.createElement('style');
    style.dataset.errorDismissalStyle = '';
    style.textContent = css;
    styles.append(style);
  }
}

function scopeKey(element: HTMLElement) {
  const parts: string[] = [];
  const context = element.closest<HTMLElement>('[data-error-scope]')?.dataset.errorScope;
  if (context) parts.push(context);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.id) {
      parts.push('#' + node.id);
      break;
    }
    parts.push(
      node.tagName +
        '.' +
        [...node.classList]
          .filter((c) => !c.startsWith('pc-error-'))
          .sort()
          .join('.'),
    );
    if (node.tagName === 'DIALOG') break;
  }
  return parts.join('/');
}

/** Reset on an explicit attempt. Polling/redraws do not constitute a retry. */
export function retryDismissedErrors(scope: ParentNode) {
  const elements = [...scope.querySelectorAll<HTMLElement>(selector)];
  if (scope instanceof HTMLElement && scope.matches(selector)) elements.push(scope);
  for (const element of elements) {
    const prior = notices.get(element);
    (prior?.store ?? storeFor(element)).delete(prior?.key ?? scopeKey(element));
    element.removeAttribute('data-error-dismissed');
  }
}

/** One behavior for persistent text nodes and errors recreated by render().
 * The button contains an SVG with no text so callers comparing textContent,
 * retaining drafts, or clearing errors still see exactly their original value.
 */
export function installErrorDismissal(root: ShadowRoot | HTMLElement) {
  if (installed.has(root)) return;
  installed.add(root);
  ensureStyle(root.getRootNode());
  root.addEventListener(
    'submit',
    (event) => {
      if (event.target instanceof HTMLFormElement) retryDismissedErrors(event.target);
    },
    true,
  );
  root.addEventListener(
    'click',
    (event) => {
      const action = event.composedPath().find((node) => node instanceof HTMLButtonElement) as
        | HTMLButtonElement
        | undefined;
      if (action?.hasAttribute('data-error-retry'))
        retryDismissedErrors(action.closest('dialog,section,form') ?? root);
    },
    true,
  );

  const sync = (element: HTMLElement) => {
    if (!root.contains(element)) return;
    const button = element.querySelector<HTMLButtonElement>(':scope > .pc-error-dismiss');
    const text = element.textContent?.trim() ?? '';
    const prior = notices.get(element);
    if (!element.matches(selector) || !text) {
      if (prior?.text) prior.store.get(prior.key)?.delete(prior.text);
      notices.delete(element);
      button?.remove();
      if (element.classList.contains('pc-error-notice'))
        element.classList.remove('pc-error-notice');
      element.removeAttribute('data-error-dismissed');
      return;
    }
    const store = storeFor(element),
      key = scopeKey(element);
    ensureStyle(element.getRootNode());
    notices.set(element, { text, key, store });
    const hidden = store.get(key)?.has(text) ?? false;
    if (element.hasAttribute('data-error-dismissed') !== hidden)
      element.toggleAttribute('data-error-dismissed', hidden);
    if (!element.classList.contains('pc-error-notice')) element.classList.add('pc-error-notice');
    if (button) return;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pc-error-dismiss';
    close.setAttribute('aria-label', 'Dismiss error');
    close.title = 'Dismiss error';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', 'M3 3L13 13M13 3L3 13');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.5');
    icon.append(path);
    close.append(icon);
    close.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = notices.get(element);
      if (!current) return;
      let hidden = current.store.get(current.key);
      if (!hidden) current.store.set(current.key, (hidden = new Set()));
      hidden.add(current.text);
      // Bound the cache even in a long-lived game with changing server messages.
      if (hidden.size > 16) hidden.delete(hidden.values().next().value!);
      if (current.store.size > 128) current.store.delete(current.store.keys().next().value!);
      element.setAttribute('data-error-dismissed', '');
      // The closed message must not retain invisible keyboard focus.
      const context = element.closest('dialog,form,section') ?? element.parentElement;
      const next =
        context &&
        [
          ...context.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ].find(
          (node) =>
            !element.contains(node) &&
            node.getClientRects().length &&
            !node.closest('[hidden],[inert]'),
        );
      next?.focus({ preventScroll: true });
    };
    element.append(close);
  };
  const collect = (node: Node, pending: Set<HTMLElement>) => {
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) return;
    const owner = element.closest<HTMLElement>(selector);
    if (owner && root.contains(owner)) pending.add(owner);
    if (notices.has(element)) pending.add(element);
    element.querySelectorAll<HTMLElement>(selector).forEach((item) => pending.add(item));
  };
  const observer = new MutationObserver((records) => {
    const pending = new Set<HTMLElement>();
    for (const record of records) {
      // A character edit does not require walking the rest of the interface.
      if (record.type === 'characterData') {
        const owner = record.target.parentElement?.closest<HTMLElement>(selector);
        if (owner) pending.add(owner);
      } else {
        collect(record.target, pending);
        record.addedNodes.forEach((node) => collect(node, pending));
      }
    }
    pending.forEach(sync);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['role', 'class', 'hidden', 'data-error-notice', 'data-error-scope'],
  });
  root.querySelectorAll<HTMLElement>(selector).forEach(sync);
}
