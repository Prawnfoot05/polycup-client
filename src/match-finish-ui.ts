import { teamChip } from './team-ui.ts';
import type { TeamId } from './teams.ts';
import teamsCSS from './teams.css';
import { installErrorDismissal, retryDismissedErrors } from './dismissible-errors.ts';
import { RewardReveal, type RewardUnlock } from './reward-reveal.ts';
import { resultXP } from './xp-progress.ts';
import { winStreak, winStreakCSS, streakLength } from './win-streak.ts';
import { playerLooks, levelSlot } from './player-looks.ts';
import { rankBadge } from './rank-badge.ts';
import type { RankedProfile } from './ranked.ts';
import rankCSS from './ranked-queue.css';
import { profilePictureCSS } from './profile-picture.ts';
import { element as h } from './dom.ts';
import { clickableRow } from './clickable-row.ts';
import { placing, ratingNumber } from './ranked-format.ts';
import { officialLapTime } from './official-position.ts';
import css from './match-finish.css';
import themeCSS from './interface-theme.css';
import { SharedChatUI, sharedChatCSS } from './shared-chat-ui.ts';
import { protectUITouches } from './touch-ui.ts';
import { paintTrackBanner, trackBannerCSS } from './track-banner.ts';
export interface FinishRow {
  team?: TeamId;
  id: string;
  name: HTMLElement;
  place: number | null;
  score?: string;
  rank?: Pick<RankedProfile, 'tier' | 'rating' | 'gm_position' | 'provisional'> | null;
  before?: number | null;
  after?: number | null;
  abandoned?: boolean;
  winStreak?: number;
  streakBefore?: number;
  streakBonus?: number;
  baseGain?: number;
  dnf?: boolean;
  time_ms?: number | null;
}
export interface FinishView {
  teams?: HTMLElement;
  key: string;
  ranked: boolean;
  title: string;
  subtitle: string;
  track?: string;
  trackId?: string;
  trackArt?: string | Promise<string>;
  openTrackRecords?: () => void | Promise<void>;
  rows: FinishRow[];
  self?: string;
  pending?: boolean;
  notice?: string;
  xpGained?: number;
  xpBefore?: number;
  xpAfter?: number;
  unlocks?: RewardUnlock[];
  chat?: SharedChatUI;
  actions: { label: string; primary?: boolean; run: () => void | Promise<void> }[];
}
/** One finish surface: settlement updates it in place, never opens a second popup. */
export class MatchFinishUI {
  #dialog = h('dialog', undefined, 'match-finish polycup-surface');
  get dialog() {
    return this.#dialog;
  }
  #frame = 0;
  #rewardTimer = 0;
  #rewards = new RewardReveal();
  #key = '';
  #settled = false;
  #busy = false;
  #chat?: SharedChatUI;
  #content = h('div', undefined, 'finish-content');
  #chatToggle = h('button', 'Match chat', 'finish-chat-toggle');
  constructor(shadow?: ShadowRoot) {
    if (!shadow) {
      const root = h('div');
      document.body.append(root);
      shadow = root.attachShadow({ mode: 'open' });
    }
    protectUITouches(shadow);
    installErrorDismissal(shadow);
    shadow.append(
      h(
        'style',
        themeCSS +
          rankCSS +
          profilePictureCSS +
          sharedChatCSS +
          winStreakCSS +
          css +
          trackBannerCSS +
          teamsCSS,
      ),
      this.dialog,
    );
    this.dialog.setAttribute('aria-label', 'Match results');
    this.dialog.addEventListener('cancel', (e) => e.preventDefault());
    this.#chatToggle.type = 'button';
    this.#chatToggle.setAttribute('aria-expanded', 'false');
    this.#chatToggle.onclick = () => {
      const expanded = this.dialog.classList.toggle('chat-expanded');
      this.#chatToggle.setAttribute('aria-expanded', String(expanded));
      if (this.#chat) this.#chat.visible = expanded;
    };
  }
  setQueue(message: string, cancel: () => Promise<void>, waiting = false, practice?: () => void) {
    clearTimeout(this.#rewardTimer);
    this.#rewards.hide();
    const status = this.dialog.querySelector('.finish-status')!;
    status.textContent = message;
    const footer = this.dialog.querySelector('footer')!;
    const existing = footer.querySelector<HTMLButtonElement>('[data-cancel-queue]');
    const button = existing ?? h('button', 'Cancel queue');
    button.type = 'button';
    button.dataset.cancelQueue = '';
    button.disabled = waiting;
    button.onclick = async () => {
      button.disabled = true;
      try {
        await cancel();
      } catch (e) {
        this.dialog.querySelector('.finish-error')!.textContent = (e as Error).message;
        button.disabled = false;
      }
    };
    if (!existing) footer.replaceChildren(status, button);
    let practiceButton = footer.querySelector<HTMLButtonElement>('[data-queue-practice]');
    if (practice && !practiceButton) {
      practiceButton = h('button', 'Practice');
      practiceButton.type = 'button';
      practiceButton.dataset.queuePractice = '';
      footer.insertBefore(practiceButton, button);
    }
    if (practiceButton) {
      practiceButton.disabled = waiting;
      practiceButton.onclick = practice ?? null;
    }
  }
  get isOpen() {
    return this.dialog.open;
  }
  close() {
    clearTimeout(this.#rewardTimer);
    this.#rewards.hide();
    this.#chat?.stop();
    this.#chat?.element.remove();
    this.#chat = undefined;
    this.#chatToggle.remove();
    this.dialog.classList.remove('chat-expanded');
    cancelAnimationFrame(this.#frame);
    this.dialog.close();
    this.#key = '';
    this.#settled = false;
  }
  show(view: FinishView) {
    this.dialog.dataset.errorScope = 'result:' + view.key;
    if (this.#chat !== view.chat) {
      this.#chat?.stop();
      this.#chat?.element.remove();
      this.#chat = view.chat;
      this.dialog.classList.remove('chat-expanded');
      this.#chatToggle.setAttribute('aria-expanded', 'false');
    }
    this.dialog.classList.toggle('with-chat', !!this.#chat);
    this.dialog.classList.toggle('is-casual', !view.ranked);
    this.dialog.classList.toggle(
      'has-winner',
      view.rows.some((row) => row.place === 1 && !row.abandoned && !row.dnf),
    );
    const animate = this.#key !== view.key || !this.#settled;
    if (this.#key !== view.key || view.pending) {
      clearTimeout(this.#rewardTimer);
      this.#rewards.hide();
    }
    this.#key = view.key;
    this.#settled = !view.pending;
    cancelAnimationFrame(this.#frame);
    const header = h('header'),
      eyebrow = h('p', view.ranked ? 'Ranked result' : 'Lobby results', 'finish-mode');
    const titleLine = h('div', undefined, 'finish-title-line');
    titleLine.append(h('h1', view.title));
    const trackRow = h('div', undefined, 'finish-track-row');
    const trackLabel = h('p', undefined, 'finish-subtitle');
    if (view.trackArt) {
      const art = h('span', undefined, 'finish-track-art');
      art.setAttribute('aria-hidden', 'true');
      const image = h('img');
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.onerror = () => art.remove();
      art.append(image);
      trackLabel.append(art);
      void Promise.resolve(view.trackArt).then(src => {
        if (!src) art.remove();
        else if (image.isConnected) image.src = src;
      }).catch(() => art.remove());
    }
    trackLabel.append(h('span', view.track || view.subtitle));
    trackRow.append(trackLabel);
    header.append(eyebrow, titleLine);
    if (view.openTrackRecords && !view.pending) {
      const link = h('button', 'Track records', 'finish-track-records');
      link.type = 'button';
      link.onclick = async () => {
        if (this.#busy) return;
        this.#busy = true;
        link.disabled = true;
        this.dialog
          .querySelectorAll<HTMLButtonElement>('footer button')
          .forEach((b) => (b.disabled = true));
        try {
          await view.openTrackRecords!();
        } catch (e) {
          const error = this.dialog.querySelector('.finish-error');
          if (error) error.textContent = (e as Error).message;
        } finally {
          this.#busy = false;
          link.disabled = false;
          this.dialog
            .querySelectorAll<HTMLButtonElement>('footer button')
            .forEach((b) => (b.disabled = false));
        }
      };
      trackRow.append(link);
    }
    paintTrackBanner(header, view.track);
    const own = view.rows.find((row) => row.id === view.self);
    const winners = view.rows.filter((row) => row.place === 1 && !row.abandoned && !row.dnf);
    const winner = winners.length === 1 ? winners[0] : undefined;
    const winningStreak = streakLength(winner?.winStreak);
    if (view.ranked && !view.pending && winner && winningStreak) {
      const streak = winStreak(winningStreak);
      if (animate && winningStreak > (winner.streakBefore ?? winningStreak))
        streak.classList.add('is-earned');
      titleLine.append(streak);
    }
    let xp: ReturnType<typeof resultXP> | undefined;
    if (view.ranked && !view.pending && view.xpGained) {
      if (typeof view.xpBefore === 'number' && typeof view.xpAfter === 'number') {
        xp = resultXP(view.xpBefore, view.xpAfter);
        header.append(xp.element);
        xp.update(
          animate && !matchMedia('(prefers-reduced-motion: reduce)').matches
            ? view.xpBefore
            : view.xpAfter,
        );
      } else header.append(h('p', `+${view.xpGained} XP`, 'finish-xp'));
    }
    if (
      view.ranked &&
      !view.pending &&
      own &&
      streakLength(own.streakBefore) &&
      own.winStreak === 0
    )
      header.append(h('p', `Streak ended · ${own.streakBefore} wins`, 'finish-streak-ended'));
    header.append(trackRow);
    const board = h('div', undefined, 'finish-board');
    if (view.teams) board.append(view.teams);
    const columns = h('div', undefined, 'finish-columns');
    for (const label of [
      '#',
      'Player',
      ...(view.ranked ? ['Time'] : []),
      view.ranked ? 'Rating' : 'Points',
      view.ranked ? 'Change' : '',
    ]) {
      const column = h('span', label);
      if (label === '#') {
        column.replaceChildren(h('span', 'Place', 'pc-sr-only'), h('span', '#'));
        column.lastElementChild!.setAttribute('aria-hidden', 'true');
      }
      columns.append(column);
    }
    board.append(columns);
    const counts: { rating: HTMLElement; delta: HTMLElement; from: number; to: number }[] = [];
    for (const row of view.rows) {
      const item = h('div', undefined, 'finish-row');
      item.dataset.playerBanner = 'off';
      item.classList.toggle('is-you', row.id === view.self);
      item.classList.toggle('is-winner', row.place === 1 && !row.abandoned && !row.dnf);
      const name = h('div', undefined, 'finish-player');
      name.append(row.name);
      const profileAction = row.name instanceof HTMLButtonElement ? row.name : row.name.querySelector<HTMLButtonElement>('button');
      if (profileAction && !profileAction.disabled) clickableRow(item, profileAction);
      if (row.team) {
        item.dataset.team = row.team;
        name.append(teamChip(row.team));
      }
      if (row.dnf && !row.abandoned && !view.ranked)
        name.append(h('span', 'DNF', 'finish-departure'));
      if (row.abandoned) name.append(h('span', 'Conceded / left', 'finish-departure'));
      const rating = h(
        'span',
        view.ranked ? (view.pending ? '—' : ratingNumber(row.after)) : (row.score ?? '—'),
        'finish-rating',
      );
      let counter = rating;
      if (view.ranked) {
        const badge = rankBadge(
          row.rank ??
            (typeof row.after === 'number'
              ? { rating: row.after, tier: 'provisional', provisional: true, gm_position: null }
              : null),
        );
        rating.replaceChildren(badge);
        counter =
          badge.querySelector<HTMLElement>(
            row.rank?.tier === 'grandmaster'
              ? '.ranked-rating-value small'
              : '.ranked-rating-value>span',
          ) ?? h('span');
      }
      const difference =
        typeof row.after === 'number' && typeof row.before === 'number'
          ? row.after - row.before
          : null;
      const delta = h(
        'span',
        view.ranked
          ? view.pending
            ? ''
            : difference === null
              ? typeof row.after === 'number'
                ? 'First rating'
                : '—'
              : signed(difference)
          : '',
        'finish-change',
      );
      const deltaValue = h('span', delta.textContent ?? '');
      delta.replaceChildren(deltaValue);
      if (view.ranked && !view.pending && row.streakBonus && row.baseGain !== undefined) {
        const breakdown = `+${row.baseGain} match · +${row.streakBonus} streak`;
        delta.title = breakdown;
        delta.append(h('small', `+${row.streakBonus} streak`, 'finish-streak-bonus'));
        delta.setAttribute('aria-label', `${signed(difference ?? 0)} total; ${breakdown}`);
      }
      if (difference !== null)
        delta.classList.add(difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral');
      item.append(h('span', row.dnf ? '—' : placing(row.place), 'finish-place'), name);
      if (view.ranked)
        item.append(
          officialLapTime(view.trackId, row.time_ms, row.dnf ? 'DNF' : '–', 'finish-time'),
        );
      item.append(rating, delta);
      if (view.ranked) {
        // Level chip leads the name so long names truncate before it does.
        const label = name.querySelector('.player-account-label>span:first-child');
        // The result retains its identity nodes while entering/leaving the queue.
        // Repainting must reuse the slot rather than prepend another level chip.
        if (label && !label.querySelector('[data-player-level]')) label.prepend(levelSlot());
        playerLooks.decorate(item, row.id);
      }
      board.append(item);
      if (!view.pending && difference !== null)
        counts.push({ rating: counter, delta: deltaValue, from: row.before!, to: row.after! });
    }
    const status = h(
      'p',
        view.pending ? (view.notice || 'Confirming ratings…') : (view.notice ?? ''),
      'finish-status',
    );
    status.setAttribute('role', 'status');
    const error = h('p', '', 'finish-error');
    error.setAttribute('role', 'alert');
    const footer = h('footer');
    footer.append(status);
    for (const action of view.actions) {
      const button = h('button', action.label, action.primary ? 'primary' : '');
      button.type = 'button';
      button.onclick = async () => {
        if (this.#busy) return;
        retryDismissedErrors(this.dialog);
        this.#busy = true;
        footer.querySelectorAll('button').forEach((b) => (b.disabled = true));
        button.textContent = 'Please wait…';
        try {
          await action.run();
        } catch (e) {
          const current = this.dialog.querySelector('.finish-error');
          if (current) current.textContent = (e as Error).message;
        } finally {
          this.#busy = false;
          button.textContent = action.label;
          footer.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      };
      footer.append(button);
    }
    const previousBoard = this.#content.querySelector('.finish-board');
    if (previousBoard) previousBoard.replaceWith(board);
    else this.#content.prepend(board);
    if (this.#chat) {
      if (!this.#chat.element.parentElement || this.#chat.element.parentElement !== this.#content)
        this.#content.append(this.#chatToggle, this.#chat.element);
      this.#chat.onUnread = (count) => {
        this.#chatToggle.textContent = count ? `Match chat (${count})` : 'Match chat';
      };
      this.#chat.visible =
        !matchMedia('(max-width:950px), (max-height:500px)').matches ||
        this.dialog.classList.contains('chat-expanded');
      this.#chat.start();
    } else {
      this.#content.querySelector('.shared-chat')?.remove();
      this.#chatToggle.remove();
    }
    if (this.dialog.open && this.#content.parentElement === this.dialog) {
      this.dialog.querySelector(':scope>header')!.replaceWith(header);
      this.dialog.querySelector(':scope>.finish-error')!.replaceWith(error);
      this.dialog.querySelector(':scope>footer')!.replaceWith(footer);
    } else this.dialog.replaceChildren(header, this.#content, error, footer);
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.append(this.#rewards.element);
    if (animate && !view.pending && view.unlocks?.length) {
      clearTimeout(this.#rewardTimer);
      this.#rewardTimer = window.setTimeout(
        () => {
          if (!this.dialog.open) return;
          const covered = [header, this.#content, error, footer];
          const restore = () => {
            covered.forEach((node) => (node.inert = false));
            footer.querySelector('button')?.focus();
          };
          if (this.#rewards.show(`${view.self}:${view.key}`, view.unlocks!, restore))
            covered.forEach((node) => (node.inert = true));
        },
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1850,
      );
    }
    if (animate && !view.pending && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1000),
          ease = 1 - (1 - t) ** 3;
        for (const c of counts) {
          c.rating.textContent = ratingNumber(Math.round(c.from + (c.to - c.from) * ease));
          c.delta.textContent = signed(Math.round((c.to - c.from) * ease));
        }
        const xpTime = Math.min(1, (now - start) / 1600);
        if (xp && typeof view.xpBefore === 'number' && typeof view.xpAfter === 'number')
          xp.update(
            Math.round(view.xpBefore + (view.xpAfter - view.xpBefore) * (1 - (1 - xpTime) ** 2)),
          );
        if (t < 1 || (xp && xpTime < 1)) this.#frame = requestAnimationFrame(tick);
      };
      tick(start);
    }
  }
}
function signed(n: number) {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + ratingNumber(Math.abs(n));
}
