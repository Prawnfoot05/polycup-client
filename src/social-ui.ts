import { chooseAvatarPicture, avatarEditorCSS } from './avatar-editor.ts';
import { playerReport } from './player-report.ts';
import { installErrorDismissal } from './dismissible-errors.ts';
import { playerName } from './cosmetics.ts';
import { winStreak, winStreakCSS, streakLength } from './win-streak.ts';
import { playerLooks, levelChip } from './player-looks.ts';
import { drawTyping, typingCSS } from './typing-ui.ts';
import type { TypingSignal } from './typing.ts';
import { playerAchievements, paintPlayerAchievements, cosmetic } from './cosmetics.ts';
import { rewardLadder } from './reward-ladder.ts';
import { rewardEditor, rewardEditorCSS, rewardGoal } from './reward-editor.ts';
import { element as h } from './dom.ts';
import { rankBadge, rankColours } from './rank-badge.ts';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
import type { Social, PlayerProfile, DirectMessage } from './social.ts';
import type { ProfileAccent } from './social.ts';
import {
  accentHex,
  paintProfileAccent,
  profileAccentPicker,
  profileAccentCSS,
} from './profile-accent.ts';
import { ratingNumber } from './ranked-format.ts';
import { profileRatingHistory } from './profile-rating-history.ts';
import { alignProfileCards } from './profile-layout.ts';
import { rewardRarity, rarityOrder } from './reward-rarity.ts';
import { paintBanner, bannerURL, bannerMetadata } from './banner.ts';
import { socialIcon } from './social-icons.ts';
import { ReplyComposer, replyAction, replyQuote, messageReplyCSS, type MessageReply } from './message-reply.ts';
import { tracks as rankedTracks } from '../supabase/catalogs/polytrack-0.6.3.json';
import type { Friends } from './friends.ts';
import type { LibraryTrack } from './game-types.ts';
import css from './social.css';
import rankCSS from './ranked-queue.css';

const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const trackNames = new Map(rankedTracks.map((track) => [track.id, track.name]));
export class SocialUI {
  #profile = h('dialog', undefined, 'social-dialog player-profile polycup-surface');
  #messages = h('dialog', undefined, 'social-dialog direct-messages polycup-surface');
  #inbox = h('aside', undefined, 'dm-inbox');
  #thread = h('section', undefined, 'dm-thread');
  #threadHeader = h('div', undefined, 'dm-thread-header');
  #log = h('div', undefined, 'dm-log');
  #form = h('form', undefined, 'dm-compose');
  #typing = h('div', undefined, 'chat-typing');
  #typingSignal?: TypingSignal;
  #typingUnsubscribe?: () => void;
  #input = h('textarea');
  #send = h('button', 'Send', 'primary');
  #error = h('p', '', 'social-error');
  #new = h('button', 'New messages', 'dm-new quiet');
  #peer = '';
  #owner: string | null;
  #profileGeneration = 0;
  #avatarPopup?: ReturnType<typeof chooseAvatarPicture>;
  #reportPopup?: ReturnType<typeof playerReport>;
  #profileData: PlayerProfile | null = null;
  #profileLayoutCleanup?: () => void;
  #generation = 0;
  #fetching = 0;
  #refreshAgain = false;
  #rows: DirectMessage[] = [];
  #person: PlayerProfile | null = null;
  #hasOlder = false;
  #loadError = false;
  #sending = false;
  #pending?: { peer: string; body: string; nonce: string; reply?: string };
  #replyDrafts = new Map<string, MessageReply>();
  #reply = new ReplyComposer(() => {
    this.#replyDrafts.delete(this.#peer); this.#pending = undefined; this.#input.focus();
  });
  #drafts = new Map<string, string>();
  #readThrough = new Map<string, string>();
  #blockedView = false;
  constructor(
    shadow: ShadowRoot,
    private api: Social,
    private friends: Friends,
    private history: (id: string, name: string, match?: string) => void,
    private showFriends?: () => void,
    private updateName?: (name: string) => Promise<void>,
    private trackArt?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[],
    private trackRecords?: (track: string, player?: string) => void,
    private joinInvite?: (code: string) => Promise<void>,
  ) {
    this.#owner = api.user;
    installErrorDismissal(shadow);
    for (const type of ['keyup', 'keypress'] as const)
      window.addEventListener(
        type,
        (event) => {
          if (this.isOpen) event.stopImmediatePropagation();
        },
        { capture: true },
      );
    shadow.append(
      h(
        'style',
        rankCSS +
          profilePictureCSS +
          css +
          rewardEditorCSS +
          profileAccentCSS +
          avatarEditorCSS +
          typingCSS + messageReplyCSS,
      ),
      this.#profile,
      this.#messages,
    );
    this.#profile.setAttribute('aria-label', 'Player profile');
    this.#messages.setAttribute('aria-label', 'Messages');
    const header = h('header');
    const back = this.#button('Conversations', () => {
      this.#saveDraft();
      this.#peer = '';
      ++this.#generation;
      this.#messages.classList.remove('has-thread');
      this.#renderInbox();
    });
    back.className = 'dm-back quiet';
    back.addEventListener('click', () => this.#stopTyping());
    header.append(
      h('h2', 'Messages'),
      back,
      this.#close('Close messages', () => this.#messages.close()),
    );
    const layout = h('div', undefined, 'dm-layout');
    this.#log.setAttribute('role', 'log');
    this.#log.tabIndex = 0;
    this.#log.setAttribute('aria-label', 'Conversation');
    // Avoid reading the whole conversation aloud again when older messages load.
    this.#log.setAttribute('aria-live', 'off');
    this.#new.hidden = true;
    this.#new.type = 'button';
    this.#new.onclick = () => {
      this.#bottom();
      this.#markRead();
    };
    this.#log.onscroll = () => {
      if (this.#nearBottom()) {
        this.#new.hidden = true;
        this.#markRead();
      }
    };
    this.#input.placeholder = 'Write a message…';
    this.#input.setAttribute('aria-label', 'Message');
    this.#input.maxLength = 2000;
    this.#input.rows = 2;
    this.#input.oninput = () => {
      this.#saveDraft();
      this.#updateSend();
      this.#typingSignal?.input(!!this.#input.value.trim());
    };
    this.#input.onblur = () => this.#typingSignal?.input(false);
    this.#input.onkeydown = (event) => {
      if (event.key === 'Escape' && this.#reply.value) {
        event.preventDefault(); event.stopPropagation();
        this.#reply.value = undefined; this.#replyDrafts.delete(this.#peer); this.#pending = undefined; return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        !matchMedia('(pointer:coarse)').matches
      ) {
        event.preventDefault();
        if (!this.#send.disabled) this.#form.requestSubmit();
      }
      event.stopPropagation();
    };
    this.#send.type = 'submit';
    this.#form.onsubmit = (event) => {
      event.preventDefault();
      void this.#sendMessage();
    };
    this.#form.append(this.#reply.element, this.#input, this.#send);
    this.#error.setAttribute('role', 'alert');
    this.#thread.append(
      this.#threadHeader,
      this.#log,
      this.#new,
      this.#error,
      this.#typing,
      this.#form,
    );
    layout.append(this.#inbox, this.#thread);
    this.#messages.append(header, layout);
    this.#messages.addEventListener('close', () => {
      if (!this.#messages.open) {
        this.#stopTyping();
        this.#saveDraft();
        ++this.#generation;
        this.api.active = false;
      }
    });
    this.#profile.addEventListener('close', () => {
      this.#reportPopup?.dispose();
      this.#avatarPopup?.dispose();
      this.#profileLayoutCleanup?.();
      if (!this.#profile.open) ++this.#profileGeneration;
    });
    this.api.subscribe(() => {
      if (this.#owner !== this.api.user) {
        this.#reportPopup?.dispose();
        this.#avatarPopup?.dispose();
        this.#profileData = null;
        this.#owner = this.api.user;
        ++this.#generation;
        ++this.#profileGeneration;
        this.#messages.close();
        this.#profile.close();
        this.#peer = '';
        this.#rows = [];
        this.#person = null;
        playerLooks.undecorate(this.#threadHeader);
        this.#threadHeader.replaceChildren();
        this.#drafts.clear();
      this.#replyDrafts.clear(); this.#reply.value = undefined;
        this.#readThrough.clear();
        this.#input.value = '';
        this.#pending = undefined;
        this.#sending = false;
        return;
      }
      if (this.#messages.open) {
        this.#renderInbox();
        if (this.#peer) void this.#refreshThread();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.#messages.open) {
        void this.api.refresh();
        this.#markRead();
      }
    });
    window.addEventListener('focus', () => {
      if (this.#messages.open) this.#markRead();
    });
  }
  get isOpen() {
    return this.#profile.open || this.#messages.open;
  }
  key(event: KeyboardEvent) {
    if (this.#reportPopup?.element.open && event.key === 'Escape') {
      event.preventDefault();
      this.#reportPopup.cancel();
      return;
    }
    if (this.#avatarPopup && event.key === 'Escape') {
      event.preventDefault();
      this.#avatarPopup.cancel();
      return;
    }
    const active = (this.#profile.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
    // The game-level keyboard guard calls us during capture, before stopping
    // the event from reaching controls inside the social dialog.
    if (
      this.#profile.open &&
      active?.matches('.profile-chart,.avatar-crop-preview,[data-avatar-edit]')
    )
      active.onkeydown?.call(active, event);
    if (event.code === 'F8') {
      event.preventDefault();
      this.close();
      return;
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      !matchMedia('(pointer:coarse)').matches &&
      (this.#messages.getRootNode() as ShadowRoot).activeElement === this.#input
    ) {
      event.preventDefault();
      if (!this.#send.disabled) this.#form.requestSubmit();
    }
  }
  close() {
    this.#reportPopup?.dispose();
    this.#avatarPopup?.dispose();
    this.#saveDraft();
    ++this.#generation;
    ++this.#profileGeneration;
    this.api.active = false;
    this.#messages.close();
    this.#profile.close();
  }
  #button(label: string, action: () => void | Promise<void>, primary = false) {
    const b = h('button', label, primary ? 'primary' : 'quiet');
    if (label === 'Retry') b.dataset.errorRetry = '';
    b.type = 'button';
    b.onclick = () =>
      void Promise.resolve()
        .then(action)
        .catch((e) => {
          const target = this.#profile.open
            ? this.#profile.querySelector('.social-error')
            : this.#error;
          if (target) target.textContent = (e as Error).message;
        });
    return b;
  }
  #close(label: string, action: () => void) {
    const b = this.#button('×', action);
    b.className = 'social-close';
    b.setAttribute('aria-label', label);
    return b;
  }
  async openProfile(id: string, editPicture = false) {
    this.#reportPopup?.dispose();
    this.#avatarPopup?.dispose();
    this.#profile.dataset.errorScope = 'profile:' + (this.api.user ?? 'guest') + ':' + id;
    const retained =
      this.#profileData?.player_id === id && !!this.#profile.querySelector('.profile-content');
    if (!retained) this.#profileLayoutCleanup?.();
    window.dispatchEvent(new Event('polycup-social-open'));
    const generation = ++this.#profileGeneration;
    const header = h('header');
    header.className = 'profile-dismiss';
    header.append(this.#close('Close profile', () => this.#profile.close()));
    if (!retained) this.#profile.replaceChildren(header, h('p', 'Loading profile…', 'social-note'));
    this.#profile.setAttribute('aria-busy', 'true');
    if (retained)
      this.#profile
        .querySelectorAll<HTMLButtonElement>('.profile-edit-icon,.profile-reward-edit')
        .forEach((button) => (button.disabled = true));
    if (!this.#profile.open) this.#profile.showModal();
    try {
      const p = await this.api.profile(id);
      if (generation !== this.#profileGeneration || !this.#profile.open) return;
      if (!p) throw Error('This player profile is unavailable.');
      this.#drawProfile(p, header);
      if (editPicture) this.#profile.querySelector<HTMLElement>('[data-avatar-edit]')?.click();
    } catch (e) {
      if (generation !== this.#profileGeneration || !this.#profile.open) return;
      if (retained && this.#profileData) {
        this.#drawProfile(this.#profileData, header);
        const notice = this.#profile.querySelector<HTMLElement>(':scope>.social-error')!;
        notice.replaceChildren(
          h('span', 'Could not refresh profile. Your current view is kept.'),
          this.#button('Retry', () => this.openProfile(id)),
        );
        return;
      }
      const note = h('p', (e as Error).message, 'social-error');
      note.setAttribute('role', 'alert');
      this.#profile.replaceChildren(
        header,
        note,
        this.#button('Retry', () => this.openProfile(id)),
      );
    } finally {
      if (generation === this.#profileGeneration) this.#profile.removeAttribute('aria-busy');
    }
  }
  #drawProfile(p: PlayerProfile, header: HTMLElement) {
    const previousScroll =
      this.#profileData?.player_id === p.player_id
        ? (this.#profile.querySelector('.profile-content')?.scrollTop ?? 0)
        : 0;
    this.#profileLayoutCleanup?.();
    this.#profileData = p;
    const accent = accentHex(p.accent);
    paintProfileAccent(this.#profile, accent);
    const body = h('div', undefined, 'profile-content');
    const banner = h('section', undefined, 'profile-banner');
    paintBanner(banner, p.banner_id);
    const hero = h('div', undefined, 'profile-identity');
    const labels = h('div', undefined, 'profile-identity-labels');
    const name = h('div', undefined, 'profile-name');
    const code = this.#button('', async () => {
      await navigator.clipboard.writeText(p.player_id);
      code.title = 'Copied';
      code.setAttribute('aria-label', 'Player code copied');
      code.classList.add('is-copied');
    });
    code.className = 'profile-copy';
    code.title = 'Copy player code';
    code.setAttribute('aria-label', 'Copy player code');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 8h12v13H8z M16 8V3H3v13h5');
    icon.append(path);
    code.append(icon);
    const displayName = h('h3', p.display_name);
    displayName.title = p.display_name;
    name.append(displayName, code);
    labels.append(name);
    const titleLine = h('div', undefined, 'profile-title-line');
    const portrait = profilePicture(p.display_name, p.avatar_url);
    hero.append(portrait, labels);
    const playerTitle = h('span', undefined, 'player-title');
    playerTitle.dataset.playerTitle = '';
    const identityRewards = h('div', undefined, 'profile-identity-rewards');
    titleLine.prepend(playerTitle);
    identityRewards.append(titleLine);
    labels.append(identityRewards);
    hero.dataset.playerBanner = 'off';
    playerLooks.set({
      player_id: p.player_id,
      avatar_url: p.avatar_url,
      banner_id: p.banner_id,
      ...(p.progression ? { level: p.progression.level } : {}),
      ...p.cosmetics,
    });
    playerLooks.decorate(hero, p.player_id);
    banner.append(hero);
    const rewards = h('div', undefined, 'profile-rewards'),
      badges = playerAchievements();
    const drawBadges = (ids: string[]) => {
      paintPlayerAchievements(badges, {
        achievement_ids: ids,
        achievement_variants: p.cosmetics?.achievement_variants,
      });
    };
    drawBadges(p.cosmetics?.achievement_ids ?? []);
    identityRewards.append(badges);
    banner.append(rewards);
    if (p.progression) {
      const xp = p.progression,
        level = h('div', undefined, 'profile-level');
      const progress = h('progress');
      progress.max = xp.next_level_xp;
      progress.value = xp.level_xp;
      progress.setAttribute(
        'aria-label',
        `Level ${xp.level}: ${xp.level_xp} / ${xp.next_level_xp} XP`,
      );
      level.append(
        levelChip(xp.level),
        progress,
        h('span', `${xp.level_xp.toLocaleString()} / ${xp.next_level_xp.toLocaleString()} XP`),
      );
      level.title = `${xp.xp.toLocaleString()} total XP`;
      rewards.append(level);
    }
    if (p.player_id !== this.api.user && (p.online !== null || p.presence)) {
      const presence = h(
        'p',
        p.presence?.label ?? (p.online ? 'Online' : 'Offline'),
        'profile-presence',
      );
      presence.classList.toggle(
        'is-online',
        !!(p.presence?.online ?? p.online) && !p.presence?.away,
      );
      rewards.append(presence);
    }
    const about = h('section', undefined, 'profile-about');
    if (p.bio) about.append(h('p', p.bio));
    banner.append(about);
    body.append(banner);
    const highlights = p.highlights;
    const numbers = highlights ?? p.stats;
    const rating = h('section', undefined, 'profile-ranked');
    rating.setAttribute('aria-label', 'Ranked summary');
    const summary = h('div', undefined, 'profile-summary');
    const seasonHeading = h('div', undefined, 'profile-season-heading');
    seasonHeading.append(h('h4', highlights?.season?.name ?? 'Ranked'));
    if (p.rank?.leaderboard_position)
      seasonHeading.append(h('span', 'Global #' + p.rank.leaderboard_position));
    const rankHeading = h('div', undefined, 'profile-rank-heading');
    const rankLabel = h('div', undefined, 'profile-rank-summary');
    rankLabel.append(h('style', winStreakCSS));
    const tier = p.rank?.tier ?? 'provisional';
    rankLabel.style.setProperty('--rank-colour', rankColours[tier] ?? rankColours.provisional);
    rankLabel.append(h('h4', p.rank ? tier[0].toUpperCase() + tier.slice(1) : 'Unranked'));
    const badge = h('div', undefined, 'profile-badge');
    badge.append(rankBadge(p.rank));
    rankHeading.append(badge, rankLabel);
    if (highlights?.rank_progress) {
      const target = highlights.rank_progress;
      const progress = h('progress');
      progress.max = 1;
      let note: string;
      if (!p.rank || p.rank.provisional) {
        progress.value = target.required > 0 ? target.played / target.required : 0;
        note = `${target.played} / ${target.required} placement matches`;
      } else if (target.next_floor !== null && target.next_tier) {
        progress.value = Math.max(
          0,
          Math.min(
            1,
            (p.rank.rating - target.floor) / Math.max(1, target.next_floor - target.floor),
          ),
        );
        const next = target.next_tier[0].toUpperCase() + target.next_tier.slice(1);
        note = `${ratingNumber(Math.max(0, target.next_floor - p.rank.rating))} to ${next}`;
      } else {
        progress.value = 1;
        note =
          tier === 'grandmaster' ? 'Top 10 Master players' : 'Grandmaster: top 10 Master players';
      }
      progress.setAttribute('aria-label', note);
      rankLabel.append(progress);
      if (tier !== 'grandmaster') {
        const detail = h(
          'p',
          target.next_floor !== null && p.rank && !p.rank.provisional
            ? ratingNumber(target.next_floor)
            : note,
          'profile-progress-note',
        );
        if (target.next_floor !== null && p.rank && !p.rank.provisional) {
          detail.classList.add('is-threshold');
          detail.title = note;
          detail.setAttribute('aria-label', note);
        }
        rankLabel.append(detail);
      }
    }
    if (streakLength(highlights?.current_win_streak))
      rankLabel.append(winStreak(highlights?.current_win_streak));
    const stats = h('dl', undefined, 'profile-stats');
    for (const [label, value] of [
      ['Matches', numbers.matches.toLocaleString()],
      ['Wins', numbers.wins.toLocaleString()],
      [
        'Win rate',
        numbers.win_rate === null ? '—' : numbers.win_rate.toFixed(1).replace(/\.0$/, '') + '%',
      ],
    ]) {
      const stat = h('div');
      stat.append(h('dt', String(label)), h('dd', String(value)));
      stats.append(stat);
    }
    summary.append(seasonHeading, rankHeading, stats);
    rating.append(summary);
    if (highlights) {
      const details = h('dl', undefined, 'profile-highlights');
      for (const [label, value, explanation] of [
        ['Peak rating', ratingNumber(highlights.peak_rating), 'Highest settled rating this season'],
        [
          'Podiums',
          highlights.podiums.toLocaleString(),
          'Finishes in the top three, including two-player matches',
        ],
        [
          'Average finish',
          highlights.average_place === null ? '—' : highlights.average_place.toFixed(1),
          'Average finishing position in rated matches',
        ],
        [
          'Best streak',
          streakLength(
            highlights.best_rewarded_streak ?? highlights.best_win_streak,
          ).toLocaleString(),
          'Consecutive completed ranked wins this season · Starts at 2',
        ],
      ]) {
        const stat = h('div');
        stat.title = explanation;
        stat.append(h('dt', label), h('dd', value));
        details.append(stat);
      }
      summary.append(details);
      rating.append(
        profileRatingHistory(highlights.rating_history, p.player_id, (match) => {
          this.#profile.close();
          this.#messages.close();
          this.history(p.player_id, p.display_name, match);
        }),
      );
    }
    if (p.progression) {
      const disciplines = h('dl', undefined, 'profile-disciplines');
      // Permanent progress toward reward tiers; the streak comes from the same catalogue progress.
      const streak = p.cosmetics?.items.find(
        (item) => cosmetic(item.id, 'title')?.metric === 'best_streak',
      )?.progress;
      for (const [label, n, metric] of [
        ['Fullspeed wins', p.progression.fullspeed_wins, 'fullspeed_wins'],
        ['Tech wins', p.progression.tech_wins, 'tech_wins'],
        // Permanent consecutive-win progress; the season best above is separate.
        ...(streak === undefined ? [] : ([['Streak titles', streak, 'best_streak']] as const)),
      ] as const)
        disciplines.append(rewardLadder(label, n, metric, metric !== 'best_streak'));
      // Ladders are permanent progress, unlike the season figures above them.
      summary.append(h('p', 'All time', 'profile-ladder-heading'), disciplines);
    }
    const columns = h('div', undefined, 'profile-columns');
    const side = h('aside', undefined, 'profile-side');
    const performance = h('section', undefined, 'profile-block');
    performance.setAttribute('aria-label', 'Track performance');
    performance.append(h('h4', 'Track performance'));
    const tracks = highlights?.track_performance ?? [];
    const artwork = new Map<string, LibraryTrack['thumbnail']>();
    try {
      for (const track of this.trackArt?.() ?? []) artwork.set(track.id, track.thumbnail);
    } catch {
      // A profile can open before the native track library has finished loading.
    }
    const trackList = h('div', undefined, 'profile-track-list');
    trackList.dataset.collapsedCount = '5';
    const drawTracks = (expanded: boolean) => {
      trackList.replaceChildren();
      for (const track of tracks.slice(0, expanded ? 20 : 5)) {
        const row = h(this.trackRecords ? 'button' : 'div', undefined, 'profile-performance-row');
        if (this.trackRecords) {
          row.setAttribute('type', 'button');
          row.setAttribute(
            'aria-label',
            'Track records for ' + (trackNames.get(track.track_id) ?? 'track'),
          );
          row.onclick = () => this.trackRecords!(track.track_id, p.player_id);
        }
        const art = h('div', undefined, 'profile-track-art');
        art.setAttribute('aria-hidden', 'true');
        const thumbnail = artwork.get(track.track_id);
        if (thumbnail) {
          const image = h('img');
          image.alt = '';
          image.loading = 'lazy';
          image.draggable = false;
          image.addEventListener('error', () => {
            image.hidden = true;
          });
          art.append(image);
          Promise.resolve(thumbnail)
            .then((src) => {
              if (src && image.isConnected) image.src = src;
            })
            .catch(() => {
              image.hidden = true;
            });
        }
        const label = h('div');
        label.append(
          h('strong', trackNames.get(track.track_id) ?? 'Track unavailable'),
          h('span', `${track.matches} ${track.matches === 1 ? 'match' : 'matches'}`),
        );
        const stats = h('div');
        stats.append(
          h('strong', `${track.win_rate.toFixed(1).replace(/\.0$/, '')}%`),
          h('span', `${track.wins} ${track.wins === 1 ? 'win' : 'wins'}`),
        );
        row.append(art, label, stats);
        trackList.append(row);
      }
    };
    drawTracks(false);
    performance.append(trackList);
    if (!tracks.length) performance.append(h('p', '–', 'social-note'));
    if (tracks.length > 5) {
      let expanded = false;
      const more = this.#button('Show more tracks', () => {
        expanded = !expanded;
        drawTracks(expanded);
        more.textContent = expanded ? 'Show fewer tracks' : 'Show more tracks';
        more.setAttribute('aria-expanded', String(expanded));
      });
      more.className = 'profile-show-more';
      more.setAttribute('aria-expanded', 'false');
      performance.append(more);
    }
    const together = h('section', undefined, 'profile-block');
    together.setAttribute('aria-label', 'Recently played with');
    together.append(h('h4', 'Recently played with'));
    const peers = highlights?.recent_opponents ?? [];
    const peerList = h('div', undefined, 'profile-peer-list');
    peerList.dataset.collapsedCount = '3';
    const drawPeers = (expanded: boolean) => {
      peerList.replaceChildren();
      for (const peer of peers.slice(0, expanded ? 10 : 3)) {
        const row = this.#button('', () => this.openProfile(peer.player_id));
        row.setAttribute('aria-label', 'View profile for ' + peer.display_name);
        row.className = 'profile-performance-row profile-peer';
        const label = h('div');
        const name = h('span', undefined, 'player-label player-account-label');
        name.append(h('span', peer.display_name));
        label.append(
          name,
          h('span', `${peer.matches} ${peer.matches === 1 ? 'match' : 'matches'} together`),
        );
        const stats = h('div');
        stats.title = 'Your wins in shared matches';
        stats.append(
          h('strong', `${peer.win_rate.toFixed(1).replace(/\.0$/, '')}%`),
          h('span', `${peer.wins} ${peer.wins === 1 ? 'win' : 'wins'}`),
        );
        row.append(profilePicture(peer.display_name, peer.avatar_url), label, stats);
        playerLooks.decorate(row, peer.player_id);
        peerList.append(row);
      }
    };
    drawPeers(false);
    together.append(peerList);
    if (!peers.length) together.append(h('p', '–', 'social-note'));
    if (peers.length > 3) {
      let expanded = false;
      const more = this.#button('Show more players', () => {
        expanded = !expanded;
        drawPeers(expanded);
        more.textContent = expanded ? 'Show fewer players' : 'Show more players';
        more.setAttribute('aria-expanded', String(expanded));
      });
      more.className = 'profile-show-more';
      more.setAttribute('aria-expanded', 'false');
      together.append(more);
    }
    side.append(performance, together);
    columns.append(rating, side);
    body.append(columns);
    if (p.relationship === 'self') {
      const editIcon = (name: string, run: () => void, className: string) => {
        const button = this.#button('', run);
        button.className = 'profile-edit-icon ' + className;
        button.title = name;
        button.setAttribute('aria-label', name);
        button.append(socialIcon('edit'));
        return button;
      };
      const restore = () => this.#drawProfile(p, header);
      const lockEdits = () => {
        portrait.inert = true;
        banner
          .querySelectorAll<HTMLButtonElement>('.profile-edit-icon,.profile-reward-edit')
          .forEach((b) => (b.disabled = true));
      };
      if (this.api.updateAvatar) {
        portrait.removeAttribute('aria-hidden');
        portrait.classList.add('profile-self-avatar');
        portrait.dataset.avatarEdit = '';
        portrait.setAttribute('role', 'button');
        portrait.setAttribute('aria-label', 'Edit picture');
        portrait.tabIndex = 0;
        const hint = h('span', undefined, 'avatar-edit-hint');
        hint.setAttribute('aria-hidden', 'true');
        hint.append(socialIcon('edit'));
        portrait.append(hint);
        portrait.onclick = () => {
          if (portrait.inert || this.#avatarPopup) return;
          const generation = this.#profileGeneration;
          this.#avatarPopup = chooseAvatarPicture(this.#profile.getRootNode() as ShadowRoot, {
            failed: (message) => {
              const notice = this.#profile.querySelector<HTMLElement>(':scope>.social-error');
              if (notice) {
                notice.textContent = message;
                notice.setAttribute('role', 'alert');
              }
            },
            closed: () => {
              this.#avatarPopup = undefined;
              if (portrait.isConnected && this.#profile.open) portrait.focus();
            },
            save: async (blob, source) => {
              const saved = await this.api.updateAvatar(blob, p.avatar_key, source);
              if (generation !== this.#profileGeneration || !this.#profile.open) return;
              p.avatar_url = saved.avatar_url;
              p.avatar_key = saved.avatar_key;
              await this.openProfile(p.player_id);
            },
          });
        };
        portrait.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            portrait.click();
          }
        };
      }
      const saveForm = (
        form: HTMLFormElement,
        label: string,
        values: () => [string, ProfileAccent, (string | null)?],
      ) => {
        const actions = h('div', undefined, 'profile-edit-actions');
        const cancel = this.#button('Cancel', restore),
          save = h('button', label, 'primary');
        save.type = 'submit';
        actions.append(cancel, save);
        const error = h('p', '', 'social-error');
        error.setAttribute('role', 'alert');
        form.onsubmit = (event) => {
          event.preventDefault();
          const controls = [
            ...form.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>(
              'button,input,textarea',
            ),
          ];
          const disabled = controls.map((c) => c.disabled);
          const data = values();
          controls.forEach((c) => (c.disabled = true));
          save.textContent = 'Saving…';
          const generation = this.#profileGeneration;
          void this.api
            .updateProfile(...data)
            .then(() => {
              if (generation === this.#profileGeneration && this.#profile.open) {
                p.bio = data[0];
                p.accent = data[1];
                if (data[2] !== undefined) p.banner_id = data[2];
                return this.openProfile(p.player_id);
              }
            })
            .catch((e) => {
              if (generation === this.#profileGeneration && this.#profile.open) {
                error.textContent = e.message;
                controls.forEach((c, i) => (c.disabled = disabled[i]));
                save.textContent = label;
              }
            });
        };
        return { actions, error };
      };
      const bioEdit = editIcon(
        'Edit bio',
        () => {
          lockEdits();
          const form = h('form', undefined, 'profile-edit profile-bio-edit');
          const label = h('label', 'Player bio'),
            input = h('textarea');
          input.maxLength = 160;
          input.rows = 2;
          input.value = p.bio;
          input.setAttribute('aria-label', 'Player bio');
          label.append(input);
          const { actions, error } = saveForm(form, 'Save bio', () => [input.value, accent]);
          form.append(label, actions, error);
          about.replaceChildren(form);
          input.focus();
        },
        'profile-bio-pencil',
      );
      const appearanceEdit = editIcon(
        'Edit profile',
        () => {
          lockEdits();
          const appearance = h('div', undefined, 'profile-appearance-options');
          let selectedAccent = accent,
            selectedBanner = p.banner_id ?? null;
          const colours = profileAccentPicker(
            accent,
            (hex) => {
              selectedAccent = hex;
              paintProfileAccent(this.#profile, hex);
            },
            () => bannerURL(selectedBanner),
          );
          const browser = h('section', undefined, 'profile-banner-picker');
          browser.setAttribute('aria-label', 'Banner browser');
          const options = [
            {
              id: '',
              name: 'No banner',
              requirement: 'open',
              target: 0,
              progress: 0,
              unlocked: true,
            },
            ...(p.progression?.banners ?? []),
          ].sort(
            (a, b) =>
              rarityOrder(bannerMetadata(a.id)?.rarity) - rarityOrder(bannerMetadata(b.id)?.rarity),
          );
          const folders = [
            ['open', 'Track banners'],
            ['fullspeed', 'Fullspeed'],
            ['tech', 'Tech'],
            ['level', 'Level rewards'],
          ].filter(([key]) => options.some((b) => b.requirement === key));
          const drawFolder = (key?: string, focusFirst = false) => {
            browser.replaceChildren();
            const navigation = h('div', undefined, 'banner-navigation');
            if (key) {
              const back = this.#button('Back to folders', () => drawFolder(undefined, true));
              back.className = 'banner-back';
              navigation.append(back, h('h4', folders.find(([id]) => id === key)![1]));
            }
            const grid = h('div', undefined, key ? 'banner-options' : 'banner-folders');
            if (key) browser.append(navigation);
            browser.append(grid);
            if (!key) {
              for (const [id, title] of folders) {
                const items = options.filter((b) => b.requirement === id && b.id);
                const folder = this.#button('', () => drawFolder(id, true));
                folder.className = 'banner-folder';
                folder.setAttribute('aria-label', 'Open ' + title);
                folder.append(
                  socialIcon('folder'),
                  h('strong', title),
                  h('span', `${items.length} banners`),
                );
                grid.append(folder);
              }
            } else
              for (const b of options.filter((b) => b.requirement === key)) {
                const card = this.#button('', () => {
                  selectedBanner = b.id || null;
                  paintBanner(banner, selectedBanner);
                  for (const other of grid.querySelectorAll<HTMLButtonElement>('button'))
                    other.setAttribute('aria-pressed', String(other.value === b.id));
                });
                card.className = 'banner-option';
                card.value = b.id;
                const rarityKey = bannerMetadata(b.id)?.rarity;
                const rarity = rewardRarity(rarityKey);
                if (b.id) {
                  card.dataset.rarity = rarityKey ?? 'common';
                  card.style.setProperty('--reward-rarity', rarity.color);
                  card.title = rarity.name;
                }
                card.disabled = !b.unlocked;
                card.setAttribute('aria-label', b.name);
                card.setAttribute('aria-pressed', String((selectedBanner ?? '') === b.id));
                const thumb = h('span', undefined, 'banner-thumbnail');
                const url = bannerURL(b.id);
                if (url) thumb.style.backgroundImage = `url("${url}")`;
                card.append(thumb, h('span', b.name));
                if (b.id) card.append(h('span', rarity.name, 'reward-rarity-label'));
                card.classList.toggle('is-locked', !b.unlocked);
                if (b.requirement !== 'open') {
                  card.append(
                    h(
                      'small',
                      b.requirement === 'level'
                        ? 'Player level'
                        : `${b.requirement === 'fullspeed' ? 'Fullspeed' : 'Tech'} wins · Ranked`,
                    ),
                  );
                  card.append(rewardGoal(b.progress, b.target));
                } else if (b.id) card.append(h('small', 'Available'));
                grid.append(card);
              }
            if (focusFirst)
              grid
                .querySelector<HTMLButtonElement>('button:not(:disabled)')
                ?.focus({ preventScroll: true });
          };
          drawFolder();
          appearance.append(browser);
          const editor = rewardEditor(p.cosmetics ?? { items: [] }, {
            banners: appearance,
            accent: colours,
            preview: (selection) => {
              playerLooks.preview(hero, { player_id: p.player_id, ...selection });
              drawBadges(selection.achievement_ids ?? []);
            },
            cancel: restore,
            // Swap the profile footer for the editor's own actions so Save is always reachable.
            actions: (footer) => {
              controls.classList.add('is-editing');
              controls.replaceChildren(footer);
            },
            save: async (selection) => {
              const generation = this.#profileGeneration;
              const cosmeticsChanged =
                selection.title_id !== (p.cosmetics?.title_id ?? null) ||
                selection.frame_id !== (p.cosmetics?.frame_id ?? null) ||
                JSON.stringify(selection.achievement_ids) !==
                  JSON.stringify(p.cosmetics?.achievement_ids ?? []);
              if (
                selectedAccent !== accentHex(p.accent) ||
                selectedBanner !== (p.banner_id ?? null)
              ) {
                await this.api.updateProfile(p.bio, selectedAccent, selectedBanner);
                if (generation !== this.#profileGeneration || !this.#profile.open) return;
                // Preserve successful writes if a later request needs a retry or Cancel.
                p.accent = selectedAccent;
                p.banner_id = selectedBanner;
              }
              if (cosmeticsChanged) {
                await this.api.updateCosmetics(selection);
                if (generation !== this.#profileGeneration || !this.#profile.open) return;
                p.cosmetics = { ...p.cosmetics!, ...selection };
              }
              playerLooks.set({
                player_id: p.player_id,
                banner_id: p.banner_id,
                ...(p.progression ? { level: p.progression.level } : {}),
                ...p.cosmetics,
              });
              await this.openProfile(p.player_id);
            },
          });
          editor.classList.add('profile-appearance-edit');
          body.insertBefore(editor, columns);
          editor.querySelector<HTMLButtonElement>('[role=tab]')?.focus({ preventScroll: true });
        },
        'profile-banner-pencil',
      );
      appearanceEdit.append(h('span', 'Edit profile'));
      if (this.updateName) {
        const rename = editIcon(
          'Edit name',
          () => {
            lockEdits();
            const form = h('form', undefined, 'profile-name-edit'),
              input = h('input');
            input.setAttribute('aria-label', 'PolyCup name');
            input.value = p.display_name;
            input.maxLength = 64;
            input.autocomplete = 'off';
            input.spellcheck = false;
            const save = editIcon('Save name', () => {}, 'profile-name-save');
            save.replaceChildren(socialIcon('check'));
            save.type = 'submit';
            const cancel = editIcon('Cancel name edit', restore, 'profile-name-cancel');
            cancel.replaceChildren(socialIcon('close'));
            const error = h('p', '', 'social-error');
            error.setAttribute('role', 'alert');
            form.append(input, save, cancel, error);
            form.onsubmit = (event) => {
              event.preventDefault();
              input.disabled = save.disabled = cancel.disabled = true;
              const generation = this.#profileGeneration;
              void this.updateName!(input.value)
                .then(() => {
                  if (generation === this.#profileGeneration && this.#profile.open) {
                    p.display_name = input.value.trim();
                    return this.openProfile(p.player_id);
                  }
                })
                .catch((e) => {
                  if (generation === this.#profileGeneration && this.#profile.open) {
                    error.textContent = e.message;
                    input.disabled = save.disabled = cancel.disabled = false;
                  }
                });
            };
            name.replaceChildren(form);
            input.focus();
            input.select();
          },
          'profile-name-pencil',
        );
        name.insertBefore(rename, code);
      }
      if (!p.bio) about.append(h('p', '–'));
      about.append(bioEdit);
      banner.append(appearanceEdit);
    }
    const actions = h('div', undefined, 'profile-actions');
    const profileError = h('p', '', 'social-error');
    profileError.setAttribute('role', 'alert');
    const act = (fn: () => Promise<unknown>) => async () => {
      const generation = this.#profileGeneration;
      for (const b of actions.querySelectorAll('button')) b.disabled = true;
      try {
        await fn();
        if (generation !== this.#profileGeneration || !this.#profile.open) return;
        await this.friends.refresh();
        if (generation === this.#profileGeneration && this.#profile.open)
          await this.openProfile(p.player_id);
      } catch (e) {
        profileError.textContent = (e as Error).message;
        for (const b of actions.querySelectorAll('button')) b.disabled = false;
      }
    };
    if (p.can_message)
      actions.append(
        this.#button(
          'Message',
          () => {
            this.#profile.close();
            this.openMessages(p.player_id);
          },
          true,
        ),
      );
    if (this.api.user && p.relationship === 'none' && !p.blocked_by_me)
      actions.append(
        this.#button(
          'Add friend',
          act(() => this.friends.request(p.player_id)),
        ),
      );
    if (p.relationship === 'incoming' && p.friendship_id)
      actions.append(
        this.#button(
          'Accept friend',
          act(() => this.friends.accept(p.friendship_id!)),
          true,
        ),
      );
    if (p.relationship === 'outgoing')
      actions.append(h('span', 'Friend request sent', 'social-note'));
    actions.append(
      this.#button('Match history', () => {
        this.#profile.close();
        this.#messages.close();
        this.history(p.player_id, p.display_name);
      }),
    );
    const footer = h('footer');
    if (this.api.user && p.relationship !== 'self') {
      const report = this.#button('Report player', () => {
        this.#reportPopup?.dispose();
        this.#reportPopup = playerReport(
          this.#profile.getRootNode() as ShadowRoot,
          p.display_name,
          (reason, details, nonce) => this.api.reportPlayer(p.player_id, reason, details, nonce),
        );
      });
      report.classList.add('report-player');
      footer.append(report);
      const block = this.#button(
        p.blocked_by_me ? 'Unblock player' : 'Block player',
        p.blocked_by_me
          ? act(() => this.api.block(p.player_id, false))
          : () => {
              footer.replaceChildren(
                h(
                  'p',
                  'Block this player? This removes your friendship and stops private messages.',
                ),
                this.#button('Cancel', () => this.#drawProfile(p, header)),
                this.#button(
                  'Block player',
                  act(() => this.api.block(p.player_id, true)),
                ),
              );
              footer.classList.add('confirm-block');
            },
      );
      block.classList.add('danger');
      footer.append(block);
    }
    if (p.relationship === 'self')
      footer.append(
        this.#button('Blocked players', () => {
          this.#profile.close();
          this.openMessages();
          void this.#showBlocked();
        }),
      );
    const controls = h('div', undefined, 'profile-controls');
    controls.append(actions, footer);
    this.#profile.replaceChildren(header, body, profileError, controls);
    body.scrollTop = previousScroll;
    const cleanupLayout = alignProfileCards(columns);
    this.#profileLayoutCleanup = () => {
      cleanupLayout();
      columns
        .querySelectorAll('.profile-chart')
        .forEach((chart) => chart.dispatchEvent(new Event('polycup-chart-dismiss')));
    };
  }
  openMessages(peer = '') {
    if (!this.api.user) return;
    window.dispatchEvent(new Event('polycup-social-open'));
    if (this.#person && (!peer || peer === this.#peer)) {
      this.api.active = true;
      if (!this.#messages.open) this.#messages.showModal();
      void this.#refreshThread();
      void this.api.refresh();
      return;
    }
    this.#saveDraft();
    ++this.#generation;
    this.#fetching = 0;
    this.#peer = '';
    this.#messages.classList.remove('has-thread');
    this.#blockedView = false;
    this.api.active = true;
    if (!this.#messages.open) this.#messages.showModal();
    this.#renderInbox();
    playerLooks.undecorate(this.#threadHeader);
    this.#threadHeader.replaceChildren();
    this.#log.replaceChildren(h('p', 'Choose a conversation or message a friend.', 'dm-empty'));
    this.#form.hidden = true;
    this.#error.textContent = '';
    this.#new.hidden = true;
    if (peer) void this.#select(peer);
    void this.api.refresh();
  }
  #renderInbox() {
    if (this.#blockedView) return;
    this.#inbox.replaceChildren();
    if (this.api.error)
      this.#inbox.append(
        h('p', this.api.error, 'social-error'),
        this.#button('Retry', () => this.api.refresh()),
      );
    if (!this.api.inbox.length && !this.api.error) {
      this.#inbox.append(h('p', 'No conversations yet.', 'social-note'));
      if (this.showFriends)
        this.#inbox.append(
          this.#button('View friends', () => {
            this.#messages.close();
            this.showFriends!();
          }),
        );
    }
    for (const row of this.api.inbox) {
      const button = this.#button('', () => this.#select(row.player_id));
      button.className = 'dm-conversation' + (this.#peer === row.player_id ? ' selected' : '');
      button.dataset.playerBanner = 'off';
      button.setAttribute(
        'aria-label',
        row.display_name + (row.unread ? ', ' + row.unread + ' unread' : ''),
      );
      const text = h('div');
      text.append(
        h('span', row.display_name, 'dm-peer-name'),
        h(
          'span',
          row.blocked_by_me ? 'Blocked' : (row.sent_by_me ? 'You: ' : '') + row.preview,
          'dm-preview',
        ),
      );
      button.append(profilePicture(row.display_name, row.avatar_url), text);
      playerLooks.decorate(button, row.player_id);
      if (row.unread)
        button.append(
          h('span', String(Math.min(99, row.unread)) + (row.unread > 99 ? '+' : ''), 'dm-unread'),
        );
      this.#inbox.append(button);
    }
  }
  async #showBlocked() {
    this.#blockedView = true;
    this.#inbox.replaceChildren(
      this.#button('Back to messages', () => {
        this.#blockedView = false;
        this.#renderInbox();
      }),
      h('p', 'Loading…', 'social-note'),
    );
    const owner = this.api.user;
    try {
      const rows = await this.api.blocked();
      if (owner !== this.api.user || !this.#messages.open || !this.#blockedView) return;
      this.#inbox.lastChild?.remove();
      if (!rows.length) this.#inbox.append(h('p', 'No blocked players.', 'social-note'));
      for (const p of rows)
        this.#inbox.append(this.#button(p.display_name, () => this.openProfile(p.player_id)));
    } catch (e) {
      if (owner === this.api.user) this.#error.textContent = (e as Error).message;
    }
  }
  #saveDraft() {
    if (this.#peer) this.#drafts.set(this.#peer, this.#input.value);
  }
  async #select(peer: string) {
    this.#stopTyping();
    this.#thread.dataset.errorScope = 'dm:' + (this.api.user ?? 'guest') + ':' + peer;
    this.#saveDraft();
    ++this.#generation;
    this.#fetching = 0;
    this.#peer = peer;
    this.#rows = [];
    this.#person = null;
    this.#hasOlder = false;
    this.#messages.classList.add('has-thread');
    this.#error.textContent = '';
    this.#new.hidden = true;
    this.#input.value = this.#drafts.get(peer) ?? '';
    this.#reply.value = this.#replyDrafts.get(peer);
    this.#form.hidden = true;
    this.#log.replaceChildren(h('p', 'Loading conversation…', 'social-note'));
    playerLooks.undecorate(this.#threadHeader);
    this.#threadHeader.replaceChildren();
    this.#renderInbox();
    await this.#refreshThread(true);
    if (
      this.#peer === peer &&
      this.#messages.open &&
      (this.#person as PlayerProfile | null)?.can_message
    ) {
      this.#typingSignal = this.api.typing?.(peer);
      this.#typingUnsubscribe = this.#typingSignal?.subscribe(() =>
        drawTyping(this.#typing, this.#typingSignal?.players ?? []),
      );
      this.#typingSignal?.start();
    }
  }
  #stopTyping() {
    this.#typingSignal?.stop();
    this.#typingUnsubscribe?.();
    this.#typingUnsubscribe = undefined;
    this.#typingSignal = undefined;
    this.#typing.replaceChildren();
  }
  async #refreshThread(initial = false, older = false) {
    if (!this.#peer || !this.#messages.open) return;
    if (this.#fetching === this.#generation + 1) {
      if (!older) this.#refreshAgain = true;
      return;
    }
    this.#refreshAgain = false;
    const generation = this.#generation,
      peer = this.#peer;
    this.#fetching = generation + 1;
    const pinned = initial || this.#nearBottom(),
      oldHeight = this.#log.scrollHeight,
      oldScroll = this.#log.scrollTop;
    try {
      const after = !initial && !older && !this.#rows.some(row => row.invitation?.active)
        ? (this.#rows.at(-1)?.id ?? null) : null;
      const page = await this.api.thread(peer, older ? (this.#rows[0]?.id ?? null) : null, after);
      if (generation !== this.#generation || peer !== this.#peer || !this.#messages.open) return;
      if (this.#loadError) {
        this.#error.textContent = '';
        this.#loadError = false;
      }
      this.#person = page.profile;
      if (!this.#person) throw Error('This player profile is unavailable.');
      const merged = new Map(this.#rows.map((row) => [row.id, row]));
      for (const row of page.messages) merged.set(row.id, row);
      this.#rows = [...merged.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (initial || older) this.#hasOlder = page.has_more;
      if (after && page.has_more) this.#refreshAgain = true;
      this.#drawThread();
      if (initial) this.#log.focus({ preventScroll: true });
      if (older) this.#log.scrollTop = this.#log.scrollHeight - oldHeight + oldScroll;
      else if (pinned) {
        this.#bottom();
        this.#markRead();
      } else if (page.messages.length) this.#new.hidden = false;
    } catch (e) {
      if (generation !== this.#generation) return;
      this.#loadError = true;
      this.#error.replaceChildren(
        h('span', (e as Error).message),
        this.#button('Retry', () => this.#refreshThread(initial, older)),
      );
    } finally {
      if (generation === this.#generation) {
        this.#fetching = 0;
        if (this.#refreshAgain) {
          this.#refreshAgain = false;
          void this.#refreshThread();
        }
      }
    }
  }
  #drawThread() {
    const p = this.#person!;
    const profile = this.#button('', () => this.openProfile(p.player_id));
    profile.className = 'dm-profile-link';
    const name = playerName(p.display_name);
    name.querySelector('[data-player-achievements]')?.remove();
    profile.append(profilePicture(p.display_name, p.avatar_url), name);
    this.#threadHeader.replaceChildren(profile);
    playerLooks.decorate(this.#threadHeader, p.player_id);
    if (!p.can_message)
      this.#threadHeader.append(
        h(
          'small',
          p.blocked_by_me ? 'Blocked' : 'Only friends can send new messages.',
          'social-note',
        ),
      );
    this.#log.replaceChildren();
    if (this.#hasOlder)
      this.#log.append(this.#button('Earlier messages', () => this.#refreshThread(false, true)));
    if (!this.#rows.length) this.#log.append(h('p', 'No messages yet.', 'dm-empty'));
    let day = '';
    let previous: DirectMessage | undefined;
    for (const row of this.#rows) {
      const date = new Date(row.created_at).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      if (date !== day) {
        this.#log.append(h('p', date, 'dm-day'));
        day = date;
        previous = undefined;
      }
      const message = h(
        'article',
        undefined,
        'dm-message' + (row.sender_id === this.api.user ? ' mine' : ''),
      );
      message.dataset.messageId = row.id;
      const elapsed = previous ? Date.parse(row.created_at) - Date.parse(previous.created_at) : -1;
      if (!row.reply && previous?.sender_id === row.sender_id && elapsed >= 0 && elapsed < 300000)
        message.classList.add('is-continuation');
      message.title = new Date(row.created_at).toLocaleString();
      const meta = h('div', undefined, 'dm-message-meta');
      const stamp = h('time', time(row.created_at));
      stamp.dateTime = row.created_at;
      stamp.title = new Date(row.created_at).toLocaleString();
      meta.append(h('span', row.sender_id === this.api.user ? 'You' : p.display_name), stamp);
      if (row.reply) message.append(replyQuote(row.reply, this.#log));
      message.append(meta);
      if (p.can_message) message.append(replyAction(() => {
        if (this.#sending) return;
        const target = { id: row.id, display_name: row.sender_id === this.api.user ? 'You' : p.display_name, body: row.body };
        this.#replyDrafts.set(this.#peer, target); this.#reply.value = target;
        this.#pending = undefined; this.#input.focus({ preventScroll: true });
      }));
      if (row.invitation) {
        const invite = row.invitation;
        const card = h('div',undefined,'dm-invite-card');
        card.append(h('strong',invite.title));
        if (!invite.friendly || invite.title !== 'Friendly 1v1')
          card.append(h('span',invite.friendly?'Friendly 1v1':'Lobby invitation','dm-invite-kind'));
        const active = invite.active && !!invite.expires_at && Date.parse(invite.expires_at)>Date.now();
        const own = row.sender_id === this.api.user;
        const join = this.#button(active ? own ? 'Invitation sent' : 'Join' : 'Invitation unavailable', async () => {
          if (!invite.code || !this.joinInvite) throw Error('Open the lobby browser to join.');
          await this.joinInvite(invite.code); this.close();
        },active && !own);
        join.disabled = !active || own || !this.joinInvite;
        card.append(join); message.append(card);
      } else message.append(h('p', row.body));
      this.#log.append(message);
      previous = row;
    }
    this.#form.hidden = false;
    this.#input.disabled = !p.can_message || this.#sending;
    this.#updateSend();
  }
  #nearBottom() {
    return this.#log.scrollHeight - this.#log.scrollTop - this.#log.clientHeight < 60;
  }
  #bottom() {
    this.#log.scrollTop = this.#log.scrollHeight;
    this.#new.hidden = true;
  }
  #markRead() {
    if (
      !this.#messages.open ||
      !this.#peer ||
      document.hidden ||
      !document.hasFocus() ||
      !this.#messages.contains((this.#messages.getRootNode() as ShadowRoot).activeElement) ||
      !this.#nearBottom()
    )
      return;
    const last = this.#rows.at(-1)?.id,
      peer = this.#peer,
      owner = this.api.user;
    if (!last || this.#readThrough.get(peer) === last) return;
    this.#readThrough.set(peer, last);
    void this.api.read(peer, last).catch(() => {
      if (owner === this.api.user && this.#readThrough.get(peer) === last)
        this.#readThrough.delete(peer);
    });
  }
  #updateSend() {
    this.#send.disabled = this.#sending || !this.#person?.can_message || !this.#input.value.trim();
    this.#send.textContent = this.#sending ? 'Sending…' : 'Send';
  }
  async #sendMessage() {
    if (this.#sending || !this.#peer) return;
    this.#typingSignal?.input(false);
    const peer = this.#peer,
      body = this.#input.value,
      owner = this.api.user;
    const pending =
      this.#pending?.peer === peer && this.#pending.body === body && this.#pending.reply === this.#reply.value?.id
        ? this.#pending
        : { peer, body, nonce: crypto.randomUUID(), reply: this.#reply.value?.id };
    this.#pending = pending;
    this.#sending = true;
    this.#input.disabled = true;
    this.#updateSend();
    this.#error.textContent = '';
    try {
      const row = await this.api.send(peer, body, pending.nonce, pending.reply);
      if (owner !== this.api.user) return;
      this.#pending = undefined;
      this.#drafts.delete(peer);
      this.#replyDrafts.delete(peer);
      if (this.#peer === peer) {
        this.#reply.value = undefined;
        this.#input.value = '';
        if (!this.#rows.some((m) => m.id === row.id)) this.#rows.push(row);
        this.#drawThread();
        this.#bottom();
        this.#markRead();
      }
    } catch (e) {
      if (owner === this.api.user && peer === this.#peer)
        this.#error.textContent = (e as Error).message + ' Your draft is kept; retry Send.';
    } finally {
      if (owner === this.api.user) {
        this.#sending = false;
        this.#input.disabled = !this.#person?.can_message;
        this.#updateSend();
        this.#input.focus({ preventScroll: true });
      }
    }
  }
}
