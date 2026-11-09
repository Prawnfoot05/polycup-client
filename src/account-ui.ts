import { playerLooks, playerLooksCSS } from './player-looks.ts';
import { playerAchievements } from './cosmetics.ts';
import { installErrorDismissal } from './dismissible-errors.ts';
import { element as h } from './dom.ts';
import { SocialUI } from './social-ui.ts';
import { PolyCupAccount } from './account.ts';
import { discordIdentity } from './account-flow.ts';
import css from './account.css';
import discordMark from '../assets/discord-mark.svg';
import { desktopAuth } from './desktop-auth.ts';
import { FriendsUI, type FriendsView } from './friends-ui.ts';
import { RankedHistoryUI } from './ranked-history-ui.ts';
import { socialIcon, type SocialIcon } from './social-icons.ts';
import type { LibraryTrack } from './game-types.ts';
import type { PlayerActivity } from './activity.ts';

export class AccountUI {
  #friendsOnly = false;
  #inviteRoom?: { id: string; instance: string };
  #joinInvite?: (code: string) => Promise<void>;
  setInviteJoin(join: (code: string) => Promise<void>) {
    this.#joinInvite = join;
  }
  openFriends(room?: { id: string; instance: string }) {
    this.#friendsOnly = true;
    this.#inviteRoom = room;
    this.#view = 'friends';
    this.open();
  }
  #embedded = false;
  #embeddedFooterLeading?: HTMLElement;
  #signOutAllowed: () => boolean = () => true;
  setSignOutAllowed(check: () => boolean) {
    this.#signOutAllowed = check;
  }
  #home: ShadowRoot;
  #dialog = h('dialog', undefined, 'rules-dialog account-dialog polycup-surface');
  #body = h('div', undefined, 'rules-dialog-body account-body');
  #header = h('div', undefined, 'account-social-header');
  #nav = h('nav', undefined, 'account-tabs');
  #footer = h('footer', undefined, 'account-footer');
  #account?: PolyCupAccount;
  #error = '';
  #code = '';
  #copied = false;
  #nameOwner: string | null = null;
  #view: FriendsView = 'friends';
  #historyUI: RankedHistoryUI;
  #socialUI?: SocialUI;
  #ensureSocial() {
    if (this.#account && !this.#socialUI)
      this.#socialUI = new SocialUI(
        this.#home,
        this.#account.social,
        this.#account.friends,
        (id, name, match) => this.openHistory(id, name, match),
        () => {
          this.#view = 'friends';
          this.#render();
        },
        (name) => this.#account!.updateName(name),
        this.options.trackArt,
        (track, player) => this.openTrackRecords(track, player),
        async (code) => {
          if (!this.#joinInvite) throw Error('Open the lobby browser to join.');
          await this.#joinInvite(code);
        },
      );
    return this.#socialUI;
  }
  /** Native track previews, shared with the hub's embedded match history. */
  get trackArt() {
    return this.options.trackArt;
  }
  openProfile(id: string, editPicture = false) {
    void this.#ensureSocial()?.openProfile(id, editPicture);
  }
  get socialOpen() {
    return this.#socialUI?.isOpen ?? false;
  }
  socialKey(event: KeyboardEvent) {
    this.#socialUI?.key(event);
  }
  closeSocial() {
    this.#socialUI?.close();
  }
  openMessages(peer?: string) {
    this.#ensureSocial()?.openMessages(peer);
  }
  #trackNavigation?: (track: string, player?: string, season?: string) => boolean;
  setTrackNavigation(navigate: (track: string, player?: string, season?: string) => boolean) {
    this.#trackNavigation = navigate;
  }
  openTrackRecords(track: string, player?: string, season?: string) {
    if (this.#trackNavigation?.(track, player, season)) this.closeSocial();
  }
  #historyNavigation?: (id: string, name: string, match?: string) => boolean;
  #identityChanged?: () => void;
  #lastIdentity: string | null = null;
  setIdentityChanged(changed: () => void) {
    this.#identityChanged = changed;
  }
  setHistoryNavigation(navigate: (id: string, name: string, match?: string) => boolean) {
    this.#historyNavigation = navigate;
  }
  setFriendlyChallenge(challenge: (person: import('./friends.ts').FriendPerson) => Promise<void>) {
    this.#friendsUI.setChallenge(challenge);
  }
  #friendsUI = new FriendsUI(
    () => this.#render(),
    (person) => {
      if (this.#account) this.openHistory(person.player_id, person.display_name);
    },
    (person) => this.openProfile(person.player_id),
    (person) => this.openMessages(person.player_id),
    () => {
      this.#view = 'find';
      this.#render();
    },
    (id) =>
      this.#account?.social.inbox.find((row) => row.player_id === id && !row.blocked_by_me)
        ?.unread ?? 0,
  );
  openHistory(id: string, name: string, match?: string) {
    if (this.#historyNavigation?.(id, name, match)) return;
    if (this.#account) this.#historyUI.open(this.#account.ranked, id, name, match);
  }
  get account() {
    return this.#account;
  }
  get isOpen() {
    return this.#dialog.open && !this.#embedded;
  }
  mount(container: HTMLElement, footerLeading?: HTMLElement) {
    this.#friendsOnly = false;
    this.#inviteRoom = undefined;
    this.#dialog.close();
    this.#embedded = true;
    this.#embeddedFooterLeading = footerLeading;
    this.#dialog.classList.add('account-embedded');
    this.#dialog.style.display = '';
    container.append(this.#dialog);
    this.#dialog.open = true;
    this.#render();
    if (this.#account?.user) void playerLooks.refreshProgression(this.#account.user.id, true);
  }
  unmount() {
    this.#dialog.style.display = 'none';
    this.#dialog.close();
    this.#embedded = false;
    this.#embeddedFooterLeading = undefined;
    this.#dialog.classList.remove('account-embedded');
    this.#home.append(this.#dialog);
  }
  close() {
    this.#dialog.close();
  }
  constructor(
    shadow: ShadowRoot,
    private options: {
      managedRanked?: boolean;
      activity?: () => PlayerActivity;
      localPreview?: boolean;
      trackArt?: () => Pick<LibraryTrack, 'id' | 'thumbnail'>[];
    } = {},
  ) {
    this.#home = shadow;
    installErrorDismissal(shadow);
    this.#historyUI = new RankedHistoryUI(
      shadow,
      (id) => this.openProfile(id),
      () => this.#account?.user?.id ?? null,
      options.trackArt,
      (track, player, season) => this.openTrackRecords(track, player, season),
    );
    shadow.append(h('style', css + playerLooksCSS));
    const close = this.#button('×', () => this.#dialog.close());
    close.className = 'account-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    this.#nav.setAttribute('aria-label', 'Account views');
    this.#dialog.append(this.#header, close, this.#nav, this.#body, this.#footer);
    this.#dialog.setAttribute('aria-label', 'PolyCup account');
    this.#dialog.addEventListener('click', (e) => {
      if (e.target !== this.#dialog) return;
      const r = this.#dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        this.#dialog.close();
    });
    shadow.append(this.#dialog);
    // Restore saved sign-ins and presence when the game opens, not on first visit
    // to this panel. Auth errors must never prevent ordinary Cup play.
    try {
      if (!this.options.localPreview)
        this.#account = new PolyCupAccount(
          () => this.#render(),
          sessionStorage,
          localStorage,
          this.options.managedRanked,
          this.options.activity,
        );
    } catch {
      this.#error = 'Account storage is unavailable. Allow browser storage to sign in.';
    }
    window.addEventListener('message', (e) => {
      if (this.#account?.accepts(e))
        void this.#act(async () => {
          if (await this.#account!.complete(e.data.code)) this.#code = '';
        });
    });
    desktopAuth()?.onReturn?.((code) => {
      const attempt = this.#account?.pending?.attempt;
      if (!attempt || typeof code !== 'string') return;
      void this.#act(async () => {
        let success = false;
        try {
          success = await this.#account!.complete(code);
          if (success) this.#code = '';
        } finally {
          await desktopAuth()?.finishReturn?.(attempt, success);
        }
      });
    });
  }
  #button(label: string, action: () => void | Promise<void>, primary = false) {
    const button = h('button', label, primary ? 'primary' : 'quiet');
    button.type = 'button';
    button.disabled = this.#account?.busy ?? false;
    button.addEventListener('click', () => {
      if (button.type !== 'submit') void this.#act(action);
    });
    return button;
  }
  #iconButton(label: string, glyph: SocialIcon, action: () => void | Promise<void>) {
    const button = this.#button('', action);
    button.className = 'account-icon-button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(socialIcon(glyph));
    return button;
  }
  #discordButton(label: string, action: () => Promise<void>) {
    const button = this.#button(label, action);
    button.className = 'discord-sign-in';
    const icon = h('span', undefined, 'discord-mark');
    icon.innerHTML = discordMark;
    icon.setAttribute('aria-hidden', 'true');
    button.replaceChildren(icon, h('span', label));
    return button;
  }
  async #act(action: () => void | Promise<void>) {
    this.#error = '';
    try {
      await action();
    } catch (error) {
      this.#error =
        error instanceof Error ? error.message : 'Account action failed. Please try again.';
    }
    this.#render();
  }
  open() {
    if (this.#embedded) this.unmount();
    this.#dialog.style.display = '';
    this.#dialog.showModal();
    void this.#act(async () => {
      if (!this.options.localPreview)
        this.#account ??= new PolyCupAccount(
          () => this.#render(),
          sessionStorage,
          localStorage,
          this.options.managedRanked,
          this.options.activity,
        );
      await this.#account?.refresh();
      void this.#account?.friends.refresh();
    });
    this.#render();
  }
  #render() {
    const identity = this.#account?.user?.id ?? null;
    this.#dialog.dataset.errorScope = 'account:' + (identity ?? 'guest');
    if (identity !== this.#lastIdentity) {
      this.#lastIdentity = identity;
      this.#identityChanged?.();
    }
    if (!this.#dialog.open) return;
    const focused = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    const focusId =
      focused instanceof HTMLElement && this.#dialog.contains(focused) ? focused.id : '';
    const input =
      focused instanceof HTMLInputElement && this.#dialog.contains(focused) ? focused : null;
    const selection = input?.id
      ? { id: input.id, start: input.selectionStart, end: input.selectionEnd }
      : null;
    this.#renderBody();
    if (focusId && !selection && this.#dialog.open)
      this.#dialog
        .querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)
        ?.focus({ preventScroll: true });
    if (selection && this.#dialog.open) {
      const replacement = this.#dialog.querySelector<HTMLInputElement>(`#${selection.id}`);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        replacement.setSelectionRange(selection.start, selection.end);
      }
    }
  }
  #renderBody() {
    const a = this.#account;
    if (this.#nameOwner !== (a?.user?.id ?? null)) {
      this.#nameOwner = a?.user?.id ?? null;
      this.#view = 'friends';
      this.#friendsUI.reset();
    }
    this.#body.replaceChildren();
    playerLooks.undecorate(this.#header);
    this.#header.replaceChildren();
    this.#nav.replaceChildren();
    this.#footer.replaceChildren();
    this.#dialog.setAttribute('aria-label', this.#friendsOnly ? 'Friends' : 'PolyCup account');
    this.#dialog.classList.toggle('friends-only', this.#friendsOnly);
    if (this.#friendsOnly) {
      this.#header.append(h('h2', 'Friends'));
      this.#nav.hidden = true;
      this.#footer.hidden = true;
      if (a?.user)
        this.#body.append(
          this.#friendsUI.render(a.friends, 'friends', this.#inviteRoom, this.#joinInvite),
        );
      else
        this.#body.append(
          h('p', 'Sign in from the server finder to invite friends.', 'account-note'),
        );
      if (this.#error) this.#body.append(h('p', this.#error, 'account-error'));
      return;
    }
    if (this.#embeddedFooterLeading) this.#footer.append(this.#embeddedFooterLeading);
    this.#footer.hidden = !a?.user && !this.#embeddedFooterLeading;
    this.#nav.hidden = !a?.user;
    if (a?.user) {
      const identity = discordIdentity(a.user.user_metadata);
      const portrait = h(
        'button',
        Array.from(identity.name)[0]?.toUpperCase() || '?',
        'account-avatar',
      );
      portrait.type = 'button';
      portrait.title = 'View your profile';
      portrait.setAttribute('aria-label', 'View your profile');
      portrait.onclick = () => this.openProfile(a.user!.id);
      if (identity.avatar) {
        const avatar = h('img');
        avatar.alt = '';
        avatar.referrerPolicy = 'no-referrer';
        avatar.src = identity.avatar;
        avatar.onerror = () => avatar.remove();
        portrait.append(avatar);
      }
      const labels = h('div', undefined, 'account-header-labels');
      const displayName = h('h2');
      const profileName = h('button', a.profileName || identity.name, 'account-profile-name');
      profileName.type = 'button';
      profileName.title = profileName.textContent || '';
      profileName.setAttribute('aria-label', 'View your profile');
      profileName.onclick = () => this.openProfile(a.user!.id);
      displayName.append(profileName);
      labels.append(displayName);
      const title = h('span', undefined, 'player-title account-player-title');
      title.dataset.playerTitle = '';
      title.hidden = true;
      labels.append(title);
      labels.append(playerAchievements());
      const signOut = this.#button('Sign out', () => a.signOut());
      signOut.disabled ||= !this.#signOutAllowed();
      if (!this.#signOutAllowed()) signOut.title = 'Leave your Cup before signing out.';
      this.#footer.append(signOut);
      this.#header.append(portrait, labels);
      const xp = h('div', undefined, 'account-xp');
      xp.dataset.playerXp = '';
      xp.hidden = true;
      this.#header.append(xp);
      playerLooks.decorate(this.#header, a.user.id);
    } else {
      this.#header.append(h('h2', this.#embedded ? 'Guest' : 'PolyCup account'));
    }
    if (this.#error || a?.signInError) {
      const error = h('p', this.#error || a!.signInError, 'account-error');
      error.setAttribute('role', 'alert');
      this.#body.append(error);
    }
    if (!a) {
      this.#body.append(
        h(
          'p',
          this.options.localPreview
            ? 'Local preview: test accounts only.'
            : 'Opening your account…',
        ),
      );
      if (this.options.localPreview && this.#embeddedFooterLeading)
        this.#footer.append(this.#embeddedFooterLeading);
      return;
    }
    if (a.user) {
      const incoming = a.friends.rows.filter(
        (r) => r.status === 'pending' && r.direction === 'incoming',
      ).length;
      for (const [view, label, glyph] of [
        ['friends', 'Friends', 'friends'],
        ['requests', incoming ? `Requests (${incoming})` : 'Requests', 'requests'],
        ['find', 'Add friend', 'search'],
      ] as const) {
        const tab = this.#button(label, () => {
          this.#view = view;
          void a.friends.refresh();
        });
        tab.className = this.#view === view ? 'selected' : 'quiet';
        tab.id = `account-view-${view}`;
        tab.title = label;
        tab.setAttribute('aria-label', label);
        tab.replaceChildren(socialIcon(glyph), h('span', label));
        tab.setAttribute('aria-current', this.#view === view ? 'page' : 'false');
        this.#nav.append(tab);
      }
      if (a.profileError) this.#body.append(h('p', a.profileError, 'account-error'));
      this.#body.append(this.#friendsUI.render(a.friends, this.#view, undefined, this.#joinInvite));
    } else if (a.pending) {
      const manual = Boolean(
        (desktopAuth()?.requiresReturnCode && !a.pending.relayRead) || a.browserBlocked,
      );
      const message = a.browserBlocked
        ? a.pending.relayRead
          ? 'The browser could not open. Copy the sign-in link into your browser. This window will finish signing you in.'
          : 'The browser could not open. Copy the sign-in link into your browser, then paste the return code below.'
        : manual
          ? 'Sign in in your browser, then paste the return code below.'
          : 'Waiting for Discord…';
      const status = h('p', message, 'account-sign-in-status');
      status.setAttribute('role', 'status');
      const actions = h('div', undefined, 'account-sign-in-actions');
      actions.append(this.#discordButton('Open Discord', () => a.reopen()));
      if (!manual)
        actions.append(
          this.#iconButton(
            this.#copied ? 'Link copied' : 'Copy sign-in link',
            this.#copied ? 'check' : 'copy',
            async () => {
              await navigator.clipboard.writeText(a.pending!.url);
              this.#copied = true;
            },
          ),
        );
      if (manual) {
        actions.classList.add('account-sign-in-manual');
        const copyLink = this.#button(
          this.#copied ? 'Link copied' : 'Copy sign-in link',
          async () => {
            await navigator.clipboard.writeText(a.pending!.url);
            this.#copied = true;
          },
        );
        actions.append(copyLink);
        const link = h('input');
        link.readOnly = true;
        link.value = a.pending.url;
        link.setAttribute('aria-label', 'Sign-in link');
        link.addEventListener('click', () => link.select());
        actions.append(link);
      }
      const details = h('div', undefined, 'account-return-code');
      const form = h('form', undefined, 'account-return-form');
      const label = h('label', 'Return code');
      const input = h('input');
      input.value = this.#code;
      input.placeholder = 'Return code';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.id = 'polycup-return-code';
      label.htmlFor = input.id;
      input.addEventListener('input', () => {
        this.#code = input.value;
      });
      const complete = h('button', a.busy ? 'Signing in…' : 'Finish sign-in', 'primary');
      complete.type = 'submit';
      complete.disabled = a.busy;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void this.#act(async () => {
          if (await a.complete(this.#code)) {
            this.#code = '';
            void desktopAuth()
              ?.cancelReturn?.()
              .catch(() => {});
          }
        });
      });
      const row = h('div', undefined, 'account-return-row');
      row.append(input, complete);
      form.append(label, row);
      details.append(form);
      const cancel = this.#button('Cancel sign-in', () => {
        a.cancel();
        this.#copied = false;
        this.#code = '';
      });
      cancel.className = 'account-sign-in-cancel';
      this.#body.append(status, actions, details, cancel);
    } else {
      this.#body.append(
        this.#discordButton(a.busy ? 'Opening Discord…' : 'Sign in with Discord', () => a.begin()),
      );
    }
  }
}
