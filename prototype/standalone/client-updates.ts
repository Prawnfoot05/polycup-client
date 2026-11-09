type Build = { id: string; protocol: number };
export function installClientUpdates(
  root: HTMLElement,
  local: Build,
  active: () => boolean,
  reload = () => location.reload(),
) {
  const banner = document.createElement('aside');
  banner.className = 'polycup-update';
  banner.setAttribute('popover', 'manual');
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', 'PolyCup service notice');
  const heading = document.createElement('div'),
    title = document.createElement('strong'),
    toggle = document.createElement('button'),
    content = document.createElement('div');
  heading.className = 'polycup-update-heading';
  title.textContent = 'Update available';
  content.className = 'polycup-update-content';
  toggle.type = 'button';
  toggle.className = 'polycup-update-toggle';
  toggle.textContent = '\u2212';
  toggle.setAttribute('aria-label', 'Minimize service notice');
  toggle.setAttribute('aria-expanded', 'true');
  let minimized: boolean | undefined;
  toggle.onclick = () => {
    minimized = !content.hidden;
    render();
  };
  const text = document.createElement('span'),
    button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload to update';
  // Updates belong to the application, not the currently mounted hub tab.
  const update = document.createElement('dialog');
  update.className = 'polycup-update-dialog';
  update.setAttribute('aria-labelledby', 'polycup-update-title');
  update.setAttribute('aria-describedby', 'polycup-update-description');
  const updateTitle = document.createElement('h2');
  updateTitle.id = 'polycup-update-title';
  const updateText = document.createElement('p');
  updateText.id = 'polycup-update-description';
  updateText.textContent = 'Refresh to continue with the latest version of PolyCup.';
  const updateButton = button.cloneNode(true) as HTMLButtonElement;
  updateButton.autofocus = true;
  update.append(updateTitle, updateText, updateButton);
  update.addEventListener('cancel', event => event.preventDefault());
  update.addEventListener('keydown', event => event.stopPropagation());
  update.addEventListener('keyup', event => event.stopPropagation());
  document.body.append(update);
  const updateStyle = document.createElement('style');
  updateStyle.textContent = `
    .polycup-update-dialog{box-sizing:border-box;position:fixed;inset:0;margin:auto;width:460px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);padding:32px;border:1px solid #485d7f;border-top:4px solid #ffd76b;background:#222c54;color:#fff;box-shadow:0 16px 64px #080e2080;font:400 20px/1.5 ForcedSquare,Arial,sans-serif;text-align:left;overflow:auto}
    .polycup-update-dialog::backdrop{background:#080e20c9;backdrop-filter:blur(3px)}
    .polycup-update-dialog h2{margin:0;font:italic 400 32px/1.2 ForcedSquare,Arial,sans-serif;color:#ffd76b}
    .polycup-update-dialog p{margin:16px 0 28px;color:#bdcbe5}
    .polycup-update-dialog button{display:block;box-sizing:border-box;width:auto;min-height:48px;margin:0 0 0 auto;padding:10px 24px;border:0;border-radius:0;background:#ffd76b;color:#121b3a;font:italic 700 20px/1.4 ForcedSquare,Arial,sans-serif;font-synthesis:weight style;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);cursor:pointer}
    .polycup-update-dialog button:focus-visible{text-decoration:underline;text-underline-offset:4px}
    @media(max-width:500px),(max-height:450px){.polycup-update-dialog{padding:24px}.polycup-update-dialog h2{font-size:28px}}
  `;
  document.head.append(updateStyle);
  heading.append(title, toggle);
  content.append(text, button);
  banner.append(heading, content);
  root.append(banner);
  const style = document.createElement('style');
  style.textContent =
    '.polycup-update{position:fixed;inset:auto 16px 16px auto;box-sizing:border-box;margin:0;width:300px;max-width:calc(100vw - 24px);padding:12px 16px;border:1px solid #485d7f;border-top:3px solid #ffd76b;background:#192042;color:#fff;box-shadow:0 8px 24px #0c142766;font:400 17px/1.4 ForcedSquare,Arial,sans-serif}.polycup-update[hidden],.polycup-update [hidden]{display:none}.polycup-update-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.polycup-update-heading strong{font:inherit;color:#ffd76b}.polycup-update button{width:auto;min-height:44px;margin:0;font:italic 400 18px ForcedSquare,Arial,sans-serif;background:#112052;color:#fff;cursor:pointer}.polycup-update .polycup-update-toggle{width:44px;height:44px;padding:0;clip-path:none;font-style:normal;font-size:24px;background:transparent}.polycup-update-content{display:flex;flex-direction:column;gap:12px;padding-top:4px}.polycup-update-content button{align-self:flex-end;padding:8px 16px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)}.polycup-update button:focus-visible{outline:2px solid #ffd76b;outline-offset:-3px}.polycup-update button:disabled{opacity:.45;cursor:default}@media(max-width:900px){.polycup-update{right:12px;bottom:92px;width:280px;max-height:calc(100dvh - 108px);overflow:auto}}';
  root.append(style);
  let current: Build | undefined, pending: Promise<void> | undefined;
  let serviceNotice = '';
  const position = () => {
    if (banner.hidden || !banner.matches(':popover-open')) return;
    const play = root.closest('.cup-hub')?.querySelector('.hub-activities')?.getBoundingClientRect();
    const bottom = play && play.height ? play.top : innerHeight - 16;
    banner.style.bottom = 'auto';
    banner.style.top = Math.max(12, Math.min(innerHeight - banner.offsetHeight - 12, bottom - banner.offsetHeight - 12)) + 'px';
  };
  const required = () => !!current && current.protocol !== local.protocol;
  const available = () => !!current && current.id !== local.id;
  const render = (prioritize = false) => {
    const hub = root.closest('dialog');
    const surface = root.getRootNode() as Document | ShadowRoot;
    const otherModal = Array.from(surface.querySelectorAll('dialog[open]')).some(
      (dialog) => dialog !== hub && dialog.matches(':modal'),
    );
    const updateAvailable = available();
    const showUpdate = updateAvailable && !active();
    updateTitle.textContent = required() ? 'Update required' : 'Update available';
    if (showUpdate) {
      if (update.open && prioritize) update.close();
      if (!update.open) update.showModal();
    } else if (update.open) update.close();
    banner.hidden = updateAvailable || !serviceNotice || !!root.closest('[hidden]') || (hub !== null && !hub.open) || otherModal;
    if (!banner.hidden && !banner.matches(':popover-open')) banner.showPopover();
    else if (banner.hidden && banner.matches(':popover-open')) banner.hidePopover();
    button.disabled = active();
    button.hidden = true;
    title.textContent = 'Server status';
    text.textContent = serviceNotice;
    text.hidden = !text.textContent;
    content.hidden = minimized ?? innerHeight < 500;
    toggle.textContent = content.hidden ? '+' : '\u2212';
    toggle.setAttribute('aria-expanded', String(!content.hidden));
    toggle.setAttribute('aria-label', content.hidden ? 'Expand service notice' : 'Minimize service notice');
    position();
  };
  const layout = new ResizeObserver(position);
  layout.observe(root);
  layout.observe(banner);
  const visibility = new MutationObserver(render);
  visibility.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  const dialog = root.closest('dialog');
  if (dialog) visibility.observe(dialog, { attributes: true, attributeFilter: ['open', 'hidden'] });
  const modals = new MutationObserver(records => render(records.some(record =>
    record.target instanceof HTMLDialogElement && record.target !== update && record.target.open,
  )));
  modals.observe(root.getRootNode(), { subtree: true, attributes: true, attributeFilter: ['open'] });
  if (root.getRootNode() !== document)
    modals.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  const resize = () => render();
  window.addEventListener('resize', resize);
  async function check() {
    if (pending) return pending;
    pending = (async () => {
      const r = await fetch('/release', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw Error('Could not check the current PolyCup version. Try again.');
      const b = await r.json();
      if (!/^[a-f0-9]{16}$/.test(b.id) || !Number.isSafeInteger(b.protocol) || b.protocol < 1)
        throw Error('Invalid PolyCup release information.');
      current = b;
      render();
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  updateButton.onclick = () => {
    if (!active()) reload();
  };
  const timer = setInterval(() => {
    render();
    void check().catch(() => {});
  }, 30000);
  const focus = () => void check().catch(() => {});
  window.addEventListener('focus', focus);
  void check().catch(() => {});
  return {
    check,
    render,
    required,
    banner,
    setServiceNotice(value: string) {
      serviceNotice = value;
      render();
    },
    async beforeQueue() {
      await check();
      if (available()) throw Error('Update PolyCup before joining ranked.');
    },
    dispose() {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      visibility.disconnect();
      modals.disconnect();
      layout.disconnect();
      window.removeEventListener('resize', resize);
      banner.remove();
      style.remove();
      update.remove();
      updateStyle.remove();
    },
  };
}
