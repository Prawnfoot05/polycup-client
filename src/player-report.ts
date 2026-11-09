import { element as h } from './dom.ts';
import { protectUITouches } from './touch-ui.ts';

export function playerReport(
  root: ShadowRoot,
  name: string,
  send: (reason: string, details: string, nonce: string) => Promise<void>,
) {
  const dialog = h('dialog', undefined, 'social-dialog player-report polycup-surface');
  dialog.setAttribute('aria-label', 'Report player');
  const header = h('header'),
    form = h('form'),
    reason = h('select'),
    details = h('textarea');
  const title = h('h2', 'Report player'),
    close = h('button', '×', 'social-close');
  const target = h('p', name, 'report-target'),
    error = h('p', '', 'social-error');
  const actions = h('footer'),
    cancel = h('button', 'Cancel', 'quiet'),
    submit = h('button', 'Send report', 'primary');
  let busy = false,
    disposed = false,
    pending: { reason: string; details: string; nonce: string } | undefined;
  close.type = cancel.type = 'button';
  close.setAttribute('aria-label', 'Close report');
  const dispose = () => {
    disposed = true;
    dialog.close();
    dialog.remove();
  };
  const dismiss = () => {
    if (!busy) dispose();
  };
  close.onclick = cancel.onclick = dismiss;
  dialog.oncancel = (event) => {
    event.preventDefault();
    dismiss();
  };
  reason.setAttribute('aria-label', 'Report reason');
  for (const [value, label] of [
    ['profile', 'Inappropriate profile'],
    ['harassment', 'Harassment'],
    ['cheating', 'Cheating'],
    ['other', 'Other'],
  ]) {
    const option = h('option', label);
    option.value = value;
    reason.append(option);
  }
  details.rows = 3;
  details.maxLength = 1000;
  details.placeholder = 'Additional details (optional)';
  details.setAttribute('aria-label', 'Additional details');
  error.setAttribute('role', 'alert');
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const note = details.value.trim();
    if (!pending || pending.reason !== reason.value || pending.details !== note)
      pending = { reason: reason.value, details: note, nonce: crypto.randomUUID() };
    busy = true;
    error.textContent = '';
    submit.textContent = 'Sending…';
    for (const control of [submit, cancel, close, reason, details]) control.disabled = true;
    try {
      await send(pending.reason, pending.details, pending.nonce);
      if (disposed) return;
      const done = h('button', 'Done', 'primary');
      done.type = 'button';
      done.onclick = dispose;
      form.replaceChildren(h('p', 'Report sent.', 'report-sent'), done);
      done.focus();
      busy = false;
      close.disabled = false;
    } catch (e) {
      if (disposed) return;
      error.textContent = (e as Error).message;
      busy = false;
      submit.textContent = 'Send report';
      for (const control of [submit, cancel, close, reason, details]) control.disabled = false;
    }
  };
  header.append(title, close);
  actions.append(cancel, submit);
  form.append(target, reason, details, error, actions);
  dialog.append(header, form);
  root.append(dialog);
  protectUITouches(root);
  dialog.showModal();
  reason.focus();
  return { dispose, cancel: dismiss, element: dialog };
}
