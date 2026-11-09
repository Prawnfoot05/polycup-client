import { element as h } from './dom.ts';
import type { InputReview } from './ranked.ts';

/** A flag is the only review state exposed in the history UI. */
export function historyReviewWarning(flags: InputReview[], detailed = false): HTMLElement {
  const wrap = h('span', undefined, 'history-review-warning');
  const trigger = h('button', undefined, 'history-review-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Possible copied inputs detected');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M12 3 22 21H2Z M12 9v5 M12 17v1');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  trigger.append(svg);
  const tip = h('span', undefined, 'history-review-tooltip');
  tip.id = 'history-review-' + crypto.randomUUID();
  tip.popover = 'auto';
  tip.setAttribute('role', 'tooltip');
  trigger.setAttribute('aria-describedby', tip.id);
  trigger.setAttribute('aria-expanded', 'false');
  tip.append(h('strong', 'Possible copied inputs detected'));
  tip.append(h('span', `${flags.length} flagged ${flags.length === 1 ? 'run' : 'runs'}.`));
  if (!detailed) tip.append(h('span', 'Open the match to see the affected players.'));
  else
    for (const run of flags) {
      const group = h('span', undefined, 'history-review-finding');
      group.append(h('b', `Round ${run.round}`));
      for (const finding of run.findings) {
        const seconds = (ms: number) => (ms / 1000).toFixed(3) + 's';
        group.append(
          h(
            'span',
            `${finding.kind === 'whole' ? 'Whole recorded attempt' : 'Exact segment'} · ${finding.transitions} control changes · ${(finding.coverage * 100).toFixed(1)}% coverage`,
          ),
          h(
            'span',
            `Run ${seconds(finding.start)}–${seconds(finding.end)} · Reference ${seconds(finding.referenceStart)}–${seconds(finding.referenceEnd)}`,
          ),
          h('span', `Reference #${finding.referenceRank} · ${finding.reference}`),
        );
      }
      tip.append(group);
    }
  let pinned = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
  const show = () => {
    clearTimeout(timer);
    if (!tip.isConnected) return;
    if (!tip.matches(':popover-open')) tip.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    tip.style.left =
      Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)) + 'px';
    tip.style.top =
      Math.max(
        8,
        anchor.bottom + bounds.height + 8 <= innerHeight
          ? anchor.bottom + 6
          : anchor.top - bounds.height - 6,
      ) + 'px';
  };
  const later = () => {
    if (!pinned) timer = setTimeout(hide, 140);
  };
  trigger.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') show();
  });
  trigger.addEventListener('pointerleave', later);
  trigger.addEventListener('focus', () => {
    if (trigger.matches(':focus-visible')) show();
  });
  trigger.addEventListener('blur', later);
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pinned && tip.matches(':popover-open')) {
      pinned = false;
      hide();
    } else {
      pinned = true;
      show();
    }
  });
  tip.addEventListener('pointerenter', () => clearTimeout(timer));
  tip.addEventListener('pointerleave', later);
  tip.addEventListener('toggle', () => {
    const open = tip.matches(':popover-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) pinned = false;
  });
  wrap.append(trigger, tip);
  return wrap;
}
