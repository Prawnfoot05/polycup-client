import { element as h } from './dom.ts';
import { placing, ratingNumber } from './ranked-format.ts';
import type { ProfileHighlights } from './ranked.ts';
import { rankColours } from './rank-badge.ts';
import { profilePicture } from './profile-picture.ts';

let chartSequence = 0;

/** One focusable timeline works with pointer, touch and arrow keys. No chart dependency. */
export function profileRatingHistory(
  history: ProfileHighlights['rating_history'],
  playerId?: string,
  openMatch?: (match: string) => void,
) {
  const series = history.filter((p) => Number.isFinite(p.rating)).slice(-50);
  const colour = (tier: ProfileHighlights['rating_history'][number]['tier']) =>
    rankColours[tier] ?? rankColours.provisional;
  const section = h('section', undefined, 'profile-rating-history');
  const header = h('div', undefined, 'profile-chart-heading');
  header.append(h('h4', 'Rating history'));
  if (series.length)
    header.append(h('span', 'Last ' + series.length + (series.length === 1 ? ' match' : ' matches')));
  section.append(header);
  if (!series.length) {
    section.append(h('p', '–', 'social-note'));
    return section;
  }
  const low = Math.min(...series.map((p) => p.rating)),
    high = Math.max(...series.map((p) => p.rating));
  const pad = Math.max(50, (high - low) * 0.15),
    min = Math.max(0, Math.floor(low - pad)),
    max = Math.ceil(high + pad);
  const x = (i: number) => (series.length === 1 ? 50 : 4 + (i / (series.length - 1)) * 92);
  const y = (value: number) => 12 + ((max - value) / (max - min)) * 76;
  const plot = h('div', undefined, 'profile-chart');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'slider');
  plot.setAttribute('aria-label', 'Rating history, use arrow keys to inspect matches' + (openMatch ? ', Enter to open the match result' : ''));
  plot.setAttribute('aria-valuemin', '1');
  plot.setAttribute('aria-valuemax', String(series.length));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 600 140');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, className: string) => {
    const node = document.createElementNS(ns, 'path');
    node.setAttribute('d', d);
    node.setAttribute('class', className);
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    return node;
  };
  svg.append(path('M24 17H576 M24 70H576 M24 123H576', 'profile-chart-grid'));
  // Match the recorded tiers at each point; blend only between those points.
  // User-space coordinates also work for a completely flat rating history.
  const gradient = document.createElementNS(ns, 'linearGradient');
  gradient.id = 'profile-rating-line-' + ++chartSequence;
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  gradient.setAttribute('x1', '24');
  gradient.setAttribute('x2', '576');
  for (let i = 0; i < series.length; i++) {
    const stop = document.createElementNS(ns, 'stop');
    stop.setAttribute('offset', String(series.length === 1 ? 0 : i / (series.length - 1)));
    stop.setAttribute('stop-color', colour(series[i].tier));
    gradient.append(stop);
  }
  const defs = document.createElementNS(ns, 'defs');
  defs.append(gradient);
  const line = path(
    series.map((p, i) => `${i ? 'L' : 'M'}${x(i) * 6} ${y(p.rating) * 1.4}`).join(' '),
    'profile-chart-line',
  );
  line.style.stroke = `url(#${gradient.id})`;
  svg.append(defs, line);
  plot.append(svg);
  // Keep point sizes in CSS pixels rather than stretching them with the SVG.
  for (let i = 0; i < series.length; i++) {
    const dot = h('span', undefined, 'profile-chart-dot');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.left = x(i) + '%';
    dot.style.top = y(series[i].rating) + '%';
    dot.style.backgroundColor = colour(series[i].tier);
    plot.append(dot);
  }
  const marker = h('span', undefined, 'profile-chart-marker');
  marker.setAttribute('aria-hidden', 'true');
  plot.append(marker);
  const axes = h('div', undefined, 'profile-chart-axis');
  axes.append(h('span', ratingNumber(max)), h('span', ratingNumber(min)));
  plot.append(axes);
  const readout = h('p', undefined, 'profile-chart-readout');
  const tip = h('div', undefined, 'profile-chart-tooltip');
  tip.id = 'profile-match-' + chartSequence;
  tip.popover = 'auto';
  tip.setAttribute('role', 'tooltip');
  const tipContent = h('div', undefined, 'profile-chart-tooltip-content');
  tip.append(tipContent);
  let selected = series.length - 1;
  let tipIndex = -1;
  let pinned = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let listeners: AbortController | undefined;
  const isTipOpen = () => tip.matches(':popover-open');
  const cleanup = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    listeners?.abort();
    listeners = undefined;
    pinned = false;
    plot.removeAttribute('aria-describedby');
  };
  const hideTip = () => {
    cleanup();
    if (isTipOpen()) tip.hidePopover();
  };
  const activate = () => {
    const match = series[selected].match_id;
    if (!match || !openMatch) return false;
    hideTip();
    openMatch(match);
    return true;
  };
  const showTip = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    const point = series[selected];
    if (!point.participants?.length || !plot.isConnected) { hideTip(); return; }
    if (tipIndex !== selected) {
      tipIndex = selected;
      const date = new Date(point.at).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const roster = h('ul');
      for (const player of point.participants) {
        const row = h('li');
        row.classList.toggle('is-profile-player', player.player_id === playerId);
        row.append(
          h('span', placing(player.place), 'profile-chart-place'),
          profilePicture(player.display_name, player.avatar_url),
          h('span', player.display_name, 'profile-chart-player-name'),
        );
        roster.append(row);
      }
      tipContent.replaceChildren(h('p', date, 'profile-chart-match-date'), roster);
    }
    if (!isTipOpen()) {
      tip.showPopover();
      listeners = new AbortController();
      const { signal } = listeners;
      // Close rather than leaving a floating bubble behind as its graph scrolls away.
      section.getRootNode().addEventListener('scroll', event => {
        if (!(event.target instanceof Node) || !tip.contains(event.target)) hideTip();
      }, { capture: true, signal });
      window.addEventListener('resize', hideTip, { signal });
    }
    plot.setAttribute('aria-describedby', tip.id);
    const anchor = marker.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(8, Math.min(center - bounds.width / 2, innerWidth - bounds.width - 8));
    const above = anchor.top - bounds.height - 12 >= 8;
    tip.dataset.side = above ? 'above' : 'below';
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, Math.min(
      above ? anchor.top - bounds.height - 12 : anchor.bottom + 12,
      innerHeight - bounds.height - 8,
    )) + 'px';
    tip.style.setProperty('--tip-anchor', Math.max(16, Math.min(center - left, bounds.width - 16)) + 'px');
  };
  const hideLater = () => {
    clearTimeout(hideTimer);
    if (!pinned) hideTimer = setTimeout(hideTip, 140);
  };
  plot.addEventListener('polycup-chart-dismiss', hideTip);
  plot.addEventListener('pointerleave', hideLater);
  plot.addEventListener('blur', hideTip);
  plot.addEventListener('focus', () => { if (plot.matches(':focus-visible')) showTip(); });
  tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  tip.addEventListener('pointerleave', hideLater);
  tip.addEventListener('toggle', () => { if (!isTipOpen()) cleanup(); });
  const select = (index: number) => {
    selected = Math.max(0, Math.min(series.length - 1, index));
    const point = series[selected];
    marker.style.left = x(selected) + '%';
    marker.style.top = y(point.rating) + '%';
    marker.style.backgroundColor = colour(point.tier);
    const change =
      point.change === null
        ? 'First rating'
        : `${point.change >= 0 ? '+' : '−'}${ratingNumber(Math.abs(point.change))}`;
    const date = new Date(point.at).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const changeValue = h('span', change, 'profile-chart-change');
    if (point.change !== null && point.change !== 0)
      changeValue.classList.add(point.change > 0 ? 'is-gain' : 'is-loss');
    readout.replaceChildren(
      h('strong', ratingNumber(point.rating)),
      changeValue,
      h('span', `${date} · ${placing(point.place)} / ${point.players}`),
    );
    plot.setAttribute('aria-valuenow', String(selected + 1));
    plot.setAttribute(
      'aria-valuetext',
      `Match ${selected + 1} of ${series.length}, rating ${point.rating}, ${change}, ${date}, ${placing(point.place)} of ${point.players}` +
        (point.participants?.length ? '. Players: ' + point.participants.map(p => p.display_name).join(', ') : ''),
    );
  };
  const pointAt = (clientX: number, clientY: number, radius: number) => {
    const bounds = plot.getBoundingClientRect();
    let nearest = -1;
    let distance = radius;
    // Measure in screen pixels on both axes, including when the plot is stretched.
    for (let i = 0; i < series.length; i++) {
      const gap = Math.hypot(
        clientX - (bounds.left + bounds.width * x(i) / 100),
        clientY - (bounds.top + bounds.height * y(series[i].rating) / 100),
      );
      if (gap <= distance) { nearest = i; distance = gap; }
    }
    return nearest;
  };
  plot.onpointermove = (event) => {
    if (event.pointerType === 'mouse') {
      const index = pointAt(event.clientX, event.clientY, 10);
      plot.style.cursor = index >= 0 && series[index].match_id && openMatch ? 'pointer' : '';
      if (index < 0) { if (!hideTimer) hideLater(); return; }
      select(index);
      showTip();
    }
  };
  plot.onclick = (event) => {
    const index = pointAt(event.clientX, event.clientY, event.pointerType === 'touch' ? 22 : 10);
    if (index < 0) { hideTip(); return; }
    if (openMatch && series[index].match_id) {
      select(index);
      activate();
      return;
    }
    if (pinned && isTipOpen() && index === selected) { hideTip(); return; }
    select(index);
    pinned = true;
    showTip();
  };
  plot.onkeydown = (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && openMatch && series[selected].match_id) {
      event.preventDefault();
      activate();
      return;
    }
    if (event.key === 'Escape' && isTipOpen()) {
      event.preventDefault();
      hideTip();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    select(
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? series.length - 1
          : selected + (event.key === 'ArrowLeft' ? -1 : 1),
    );
    pinned = false;
    showTip();
  };
  select(selected);
  section.append(plot, readout, tip);
  return section;
}
