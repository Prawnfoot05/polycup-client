import { installErrorDismissal, retryDismissedErrors } from './dismissible-errors.ts';
import { RankedResultUI } from './ranked-result-ui.ts';
import { RankedSettlement } from './ranked-settlement.ts';
import { RankedInputOutbox } from './ranked-inputs.ts';
import { RankedNotifications } from './ranked-notifications.ts';
import type { RankedProfile } from './ranked.ts';
import { LeaderboardUI } from './leaderboard-ui.ts';
import { RankedHistoryUI } from './ranked-history-ui.ts';
import { element as h } from './dom.ts';
import { WaitingRoom, type WaitingRoomListing } from './waiting-room.ts';
import { WaitingRoomChat } from './waiting-room-chat.ts';
import { RoomHandoff, controllerRaceBridge } from './room-handoff.ts';
import { CUP_MENU_EVENT, menuIdentity, coverNativeMenu } from './native-cup-menu.ts';
import { VERSION } from './cup.ts';
import type { Controller } from './controller.ts';
import type { AccountUI } from './account-ui.ts';
import css from './cup-hub.css';
import { RankedRoom } from './ranked-room.ts';
import { RankedQueueUI } from './ranked-queue-ui.ts';
import { RankedReconnectUI } from './ranked-reconnect-ui.ts';
import { CupGuide } from './cup-guide.ts';
import { CommunityUI, sharedChatCSS } from './shared-chat-ui.ts';
import { PatchNotes, patchNotesCSS } from './patch-notes.ts';
import { SeasonCountdown } from './season-countdown.ts';

export interface CupHubOptions {
  rankedActivity?: HTMLElement;
  rankedActive?: () => boolean;
  localPreview?: boolean;
  casualAvailable?: boolean;
  beforeCasual?: () => void;
}

export class CupHub {
  #dialog = h('dialog', undefined, 'cup-hub polycup-surface');
  #social = h('aside', undefined, 'hub-social');
  #list = h('div', undefined, 'hub-list');
  #seasonCountdown = new SeasonCountdown();
  #error = h('p', undefined, 'error');
  #online = h('span', 'Online: —', 'hub-online-count');
  #onlineAt = 0;
  #onlineBusy = false;
  #back = h('button', 'Back', 'quiet hub-back');
  #account: AccountUI;
  #controller: Controller;
  #room?: WaitingRoom;
  #handoff?: RoomHandoff;
  #reconnectUI?: RankedReconnectUI;
  #rows: WaitingRoomListing[] = [];
  #entered: () => void;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #refreshing = false;
  #restored = false;
  #rankedOpening = false;
  #resultUI?: RankedResultUI;
  #notifications?: RankedNotifications;
  #settlement?: RankedSettlement;
  #inputOutbox?: RankedInputOutbox;
  #leaderboard?: LeaderboardUI;
  #history?: RankedHistoryUI;
  #view: 'browser' | 'leaderboards' | 'tracks' | 'history' | 'community' = 'browser';
  #community?: CommunityUI;
  #communityView = h('section', undefined, 'hub-data-view hub-community-view');
  #communityUnread = h('span', undefined, 'hub-community-unread');
  #viewTabs = h('nav', undefined, 'hub-view-tabs');
  #browserView = h('section', undefined, 'hub-browser-view');
  #boardView = h('section', undefined, 'hub-data-view');
  #trackView = h('section', undefined, 'hub-data-view');
  #historyView = h('section', undefined, 'hub-data-view');
  #historyNotice = h('p', 'Sign in to view your match history.', 'hub-history-notice');
  #viewUser: string | null = null;
  #resultShown = new Set<string>();
  #rankedBefore: { match: string; player: string; profile: RankedProfile | null } | null = null;
  #rankedEntered = '';
  #guide: CupGuide;
  #patchNotes: PatchNotes;
  get #rankedActive() {
    return this.options.rankedActive?.() ?? this.#account.account?.queue.active;
  }
  refreshAdmission() {
    for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>('[data-cup-admission]'))
      button.disabled =
        !!this.#rankedActive ||
        this.#busy ||
        this.options.localPreview === true ||
        this.options.casualAvailable === false ||
        button.dataset.incompatible === 'true';
  }
  get isOpen() {
    return this.#dialog.open;
  }
  get room() {
    return this.#room;
  }
  constructor(
    shadow: ShadowRoot,
    account: AccountUI,
    controller: Controller,
    entered: () => void,
    private options: CupHubOptions = {},
  ) {
    this.#account = account;
    this.#guide = new CupGuide(shadow);
    this.#patchNotes = new PatchNotes(shadow);
    account.setSignOutAllowed(() => !this.#room?.requiresAccount && !this.#rankedActive);
    this.#controller = controller;
    this.#entered = entered;
    if (account.account && !options.rankedActivity) {
      this.#notifications = new RankedNotifications(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
        () =>
          !document.hidden &&
          !this.#resultUI?.isOpen &&
          !controller.nativeState &&
          !this.#room?.snapshot &&
          !this.#rankedActive &&
          !shadow.querySelector('dialog[open]:not(.cup-hub):not(.account-embedded)'),
        (match, player, before) => this.#resultUI?.open(match, player, before),
      );
      setInterval(() => {
        this.#resultUI?.checkUser();
        void this.#notifications?.tick();
      }, 2000);
      window.addEventListener('online', () => this.#notifications?.wake());
      this.#settlement = new RankedSettlement(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
        () => {
          account.account?.queue.invalidateProfile();
          this.#leaderboard?.invalidate();
          void account.account?.queue.refresh();
          this.#notifications?.wake();
        },
      );
      setInterval(() => void this.#settlement?.flush(), 5000);
      this.#inputOutbox = new RankedInputOutbox(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
      );
      setInterval(() => void this.#inputOutbox?.flush(), 5000);
    }
    if (account.account)
      this.#resultUI = new RankedResultUI(
        shadow,
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        (id) => account.openHistory(id, 'Your matches'),
        {
          claim: (match, player) => this.#notifications!.claim(match, player),
          seen: (match, player) => this.#notifications!.seen(match, player),
          closed: (seen) => {
            setTimeout(() => {
              if (!this.#resultUI?.isOpen) {
                if (seen) this.#notifications?.wake();
                else this.#notifications?.snooze();
              }
            }, 0);
          },
        },
      );
    account.setInviteJoin(async (code) => {
      if (this.options.casualAvailable === false)
        throw new Error('Casual lobbies are not enabled in this standalone preview yet.');
      if (this.#rankedActive) throw new Error('Leave ranked before joining an invitation.');
      if (this.#room?.snapshot)
        throw new Error('Leave your current lobby before joining an invitation.');
      this.options.beforeCasual?.();
      await this.#ensure().joinCode(code, menuIdentity());
      account.close();
      this.#enter();
    });
    account.setFriendlyChallenge(async (person) => {
      if (this.#rankedActive || options.rankedActive?.()) throw Error('Leave the ranked queue or match before challenging a friend.');
      if (this.#room?.snapshot || controller.connection) throw Error('Leave your current lobby first.');
      this.options.beforeCasual?.();
      const room = this.#ensure();
      try {
        await room.create('Friendly 1v1', menuIdentity(), false);
        await room.makeFriendly(person.player_id);
        const snap = room.snapshot!;
        await account.account!.friends.invite(person.player_id, snap.id, room.instance);
        account.close();
        this.#enter();
      } catch (error) {
        if (room.snapshot) await room.leave().catch(() => {});
        throw error;
      }
    });
    shadow.append(h('style', css + sharedChatCSS + patchNotesCSS), this.#dialog);
    this.#dialog.setAttribute('aria-label', 'PolyCup');
    const header = h('header', undefined, 'hub-header');
    const brand = h('div', undefined, 'hub-brand');
    brand.append(h('h1', 'PolyCup'));
    this.#online.title =
      'Signed-in PolyCup players active in the last 90 seconds. Each account counts once.';
    this.#online.setAttribute('aria-label', 'Online players unavailable');
    brand.append(this.#online);
    header.append(brand);
    if (account.account) {
      this.#community = new CommunityUI(account.account.chat('community'), (id) =>
        account.openProfile(id),
      );
      this.#communityView.append(this.#community.element);
      this.#community.chat.onUnread = (count) => {
        this.#communityUnread.hidden = count === 0;
        this.#communityUnread.setAttribute('aria-label', count ? 'New community messages' : '');
      };
      this.#communityUnread.hidden = true;
      const board = new LeaderboardUI(
        shadow,
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        (id, name) => account.openHistory(id, name),
        (id) => account.openProfile(id),
        () => account.trackArt?.() ?? [],
      );
      this.#leaderboard = board;
      window.addEventListener('polycup-ranked-result', () => board.invalidate());
      if (options.rankedActivity) {
        board.mount(this.#boardView);
        this.#history = new RankedHistoryUI(
          shadow,
          (id) => account.openProfile(id),
          () => account.account?.user?.id ?? null,
          () => account.trackArt?.() ?? [],
          (track, player, season) => account.openTrackRecords(track, player, season),
        );
        this.#history.mount(this.#historyView);
        this.#historyView.append(this.#historyNotice);
        account.setTrackNavigation((track, player, season) => {
          if (!this.isOpen) return false;
          board.prepareTrack(track, player ?? null, season);
          this.#selectView('tracks');
          return true;
        });
        account.setHistoryNavigation((id, name, match) => {
          if (!this.isOpen) return false;
          this.#selectView('history', { id, name, match });
          return true;
        });
        account.setIdentityChanged(() => {
          this.#community?.stop();
          if (this.isOpen) this.#community?.start();
          if (this.isOpen) this.#selectView(this.#view);
        });
      }
    }

    this.#back.type = 'button';
    this.#back.addEventListener('click', () => this.close());
    const content = h('div', undefined, 'hub-content'),
      main = h('main', undefined, 'hub-main');
    const listActions = h('div', undefined, 'hub-list-actions');
    const codeForm = h('form', undefined, 'hub-code'),
      code = h('input');
    code.placeholder = 'Lobby code';
    code.maxLength = 10;
    code.setAttribute('aria-label', 'Lobby code');
    const join = this.#button('Join', () => {});
    join.dataset.cupAdmission = '';
    join.type = 'submit';
    codeForm.append(code, join);
    codeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.options.casualAvailable === false) return;
      void this.#act(async () => {
        this.options.beforeCasual?.();
        await this.#ensure().joinCode(code.value, menuIdentity());
        this.#enter();
      }, 'join');
    });
    const socialToggle = this.#button(
      'Friends',
      () => {
        const open = this.#dialog.classList.toggle('hub-social-open');
        socialToggle.setAttribute('aria-expanded', String(open));
        socialToggle.textContent = open ? 'Browse' : 'Friends';
      },
      true,
    );
    socialToggle.className = 'hub-mobile-social quiet';
    socialToggle.setAttribute('aria-label', 'Friends and account');
    socialToggle.setAttribute('aria-expanded', 'false');
    header.append(socialToggle);
    // Navigation must remain available while room restoration/list refresh is pending.
    const mobileBack = this.#button('Back', () => this.close(), true);
    mobileBack.className = 'hub-mobile-back quiet';
    header.append(mobileBack);
    const footer = h('form', undefined, 'hub-host'),
      name = h('input');
    name.placeholder = 'My lobby';
    name.id = 'polycup-host-name';
    name.value = '';
    name.maxLength = 64;
    name.setAttribute('aria-label', 'Lobby name');
    const host = this.#button('Host lobby', () => {});
    host.dataset.cupAdmission = '';
    host.className = 'primary';
    host.type = 'submit';
    const nameLabel = h('label', 'Lobby name', 'hub-activity-title');
    nameLabel.htmlFor = name.id;
    footer.append(nameLabel, name, host);
    footer.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.options.casualAvailable === false) return;
      this.options.beforeCasual?.();
      const dialog = h('dialog', undefined, 'rules-dialog create-cup-dialog polycup-surface');
      dialog.setAttribute('aria-label', 'Host lobby');
      dialog.append(h('h2', 'Host lobby'));
      const choices = h('fieldset', undefined, 'cup-visibility');
      choices.append(h('legend', 'Visibility'));
      let isPublic = false;
      for (const [label, value] of [
        ['Private', false],
        ['Public', true],
      ] as const) {
        const option = h('label'),
          radio = h('input');
        radio.type = 'radio';
        radio.name = 'cup-visibility';
        radio.value = label.toLowerCase();
        radio.checked = !value;
        radio.onchange = () => {
          isPublic = value;
        };
        option.append(radio, h('span', label));
        choices.append(option);
      }
      dialog.append(choices);
      const controls = h('div', undefined, 'controls');
      const cancel = h('button', 'Cancel', 'quiet');
      cancel.type = 'button';
      cancel.onclick = () => dialog.close();
      const create = h('button', 'Create lobby', 'primary');
      create.type = 'button';
      create.onclick = () => {
        dialog.close();
        void this.#act(async () => {
          if (controller.connection)
            throw new Error('Leave your current multiplayer game before hosting a lobby.');
          await this.#ensure().create(name.value.trim() || 'My lobby', menuIdentity(), isPublic);
          this.#enter();
        }, 'create');
      };
      controls.append(cancel, create);
      dialog.append(controls);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      shadow.append(dialog);
      dialog.showModal();
    });
    this.#error.hidden = true;
    this.#error.setAttribute('role', 'alert');
    installErrorDismissal(shadow);
    this.#list.setAttribute('aria-label', 'Public lobbies');
    const listHeader = h('div', undefined, 'hub-list-header');
    const refresh = this.#button('Refresh', () => this.refresh(), true);
    refresh.classList.add('hub-refresh');
    listActions.append(codeForm, refresh);
    listHeader.append(h('h2', 'Public lobbies'), listActions);
    const activities = h('div', undefined, 'hub-activities');
    activities.setAttribute('aria-label', 'Play options');
    activities.append(footer);
    if (options.rankedActivity) {
      this.#dialog.classList.add('hub-tabbed');
      this.#viewTabs.setAttribute('role', 'tablist');
      this.#viewTabs.setAttribute('aria-label', 'PolyCup views');
      for (const [key, label, pane] of [
        ['browser', 'Browser', this.#browserView],
        ['leaderboards', 'Player Leaderboard', this.#boardView],
        ['tracks', 'Track Leaderboard', this.#trackView],
        ['history', 'Match history', this.#historyView],
        ['community', 'Community', this.#communityView],
      ] as const) {
        const button = this.#button(label, () => this.#selectView(key), true);
        button.id = 'hub-tab-' + key;
        button.dataset.view = key;
        button.setAttribute('aria-label', label);
        if (key === 'leaderboards' || key === 'tracks') {
          button.replaceChildren(
            h('span', label, 'tab-full'),
            h('span', key === 'tracks' ? 'Tracks' : 'Players', 'tab-short'),
          );
        }
        if (key === 'history') {
          button.replaceChildren(h('span', label, 'tab-full'), h('span', 'History', 'tab-short'));
        }
        if (key === 'community') button.append(this.#communityUnread);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', 'hub-view-' + key);
        button.setAttribute('aria-selected', String(key === 'browser'));
        button.tabIndex = key === 'browser' ? 0 : -1;
        pane.id = 'hub-view-' + key;
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', button.id);
        pane.hidden = key !== 'browser';
        this.#viewTabs.append(button);
      }
      this.#viewTabs.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...this.#viewTabs.querySelectorAll<HTMLButtonElement>('button')];
        const i = buttons.findIndex((b) => b.dataset.view === this.#view);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (i + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next].click();
        buttons[next].focus();
      });
      this.#browserView.append(this.#error, listHeader, this.#list, this.#seasonCountdown.element);
      const views = h('div', undefined, 'hub-views');
      views.append(
        this.#browserView,
        this.#boardView,
        this.#trackView,
        this.#historyView,
        this.#communityView,
      );
      header.append(this.#viewTabs);
      const notes = this.#button('Patch notes', () => this.#patchNotes.open(), true);
      notes.classList.add('hub-patch-notes');
      header.append(notes);
      main.append(views, activities);
    } else main.append(this.#error, listHeader, this.#list, this.#seasonCountdown.element, activities);
    if (options.rankedActivity) {
      options.rankedActivity.addEventListener('polycup-leaderboards', () =>
        this.#selectView('leaderboards'),
      );
      options.rankedActivity.addEventListener('polycup-history', (event) =>
        this.#selectView('history', (event as CustomEvent).detail),
      );
      options.rankedActivity.addEventListener('polycup-rank-guide', () => this.#guide.ranks());
      options.rankedActivity.classList.add('hub-standalone-ranked');
      activities.append(options.rankedActivity);
    } else if (account.account) {
      const queue = account.account.queue;
      const queueUI = new RankedQueueUI(
        shadow,
        queue,
        () =>
          controller.connection
            ? 'Leave your multiplayer game before joining ranked.'
            : this.#room?.snapshot
              ? 'Leave your current lobby before joining ranked.'
              : null,
        () => {
          if (this.#room?.ranked && this.#room.snapshot && !this.#room.disconnected) this.#enter();
          else if (queue.snapshot?.match) void this.#enterRanked(queue.snapshot.match.id);
        },
        () => this.#leaderboard?.open(),
        () => this.#guide.ranks(),
      );
      activities.append(queueUI.element);
      this.#reconnectUI = new RankedReconnectUI(
        shadow,
        queue,
        () =>
          this.#dialog.open &&
          !this.#rankedOpening &&
          (!this.#room?.snapshot || !!this.#room.disconnected),
        () => {
          const match = queue.snapshot?.match;
          if (match) void this.#enterRanked(match.id);
        },
      );
      queue.subscribe(() => {
        const match = queue.snapshot?.match;
        if (
          match &&
          !match.left &&
          !match.abandoned &&
          match.status === 'drafting' &&
          !queue.confirmingAcceptance &&
          this.#rankedEntered !== match.id &&
          !this.#rankedOpening
        )
          void this.#enterRanked(match.id);
        if (!match) this.#rankedEntered = '';
        for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
          '[data-cup-admission]',
        ))
          button.disabled = queue.active || this.#busy || button.dataset.incompatible === 'true';
      });
    }
    content.append(this.#social, main);
    this.#dialog.append(header, content);
    if (options.rankedActivity) {
      const credit = h('footer', undefined, 'hub-attribution');
      const original = h('a', 'Original PolyTrack'),
        author = h('a', 'Kodub');
      original.href = 'https://www.crazygames.com/game/polytrack';
      author.href = 'https://www.kodub.com';
      for (const link of [original, author]) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      const credits = this.#button(
        'Credits',
        () => {
          const dialog = h('dialog', undefined, 'rules-dialog hub-credits polycup-surface');
          dialog.setAttribute('aria-label', 'Credits');
          const heading = h('header');
          const close = this.#button('×', () => dialog.close());
          close.setAttribute('aria-label', 'Close credits');
          heading.append(h('h2', 'Credits'), close);
          const body = h('div', undefined, 'hub-credits-body');
          const source = h('p');
          source.append(
            original.cloneNode(true),
            document.createTextNode(' by '),
            author.cloneNode(true),
          );
          const loader = h('a', 'PolyModLoader');
          loader.href = 'https://polymodloader.com';
          loader.target = '_blank';
          loader.rel = 'noopener noreferrer';
          const built = h('p', 'Built with ');
          built.append(loader, document.createTextNode('.'));
          body.append(
            source,
            built,
            h(
              'p',
              'PolyCup is unofficial and is not endorsed by Kodub, CrazyGames, Poki or itch.io.',
            ),
          );
          const licence = h('a', 'PolyModLoader source & licence');
          licence.href = '/source/index.html';
          licence.target = '_blank';
          licence.rel = 'noopener noreferrer';
          const contact = h('a', 'suchworth@gmail.com');
          contact.href = 'mailto:suchworth@gmail.com';
          const contactLine = h('p', 'Contact, privacy and account-deletion requests: ');
          contactLine.append(contact);
          const licenceLine = h('p');
          licenceLine.append(licence);
          body.append(licenceLine, contactLine);
          dialog.append(heading, body);
          dialog.addEventListener('close', () => dialog.remove(), { once: true });
          shadow.append(dialog);
          dialog.showModal();
        },
        true,
      );
      const contact = h('a', 'Contact');
      contact.href = 'mailto:suchworth@gmail.com';
      contact.setAttribute('aria-label', 'Contact PolyCup at suchworth@gmail.com');
      credit.append(original, document.createTextNode(' by '), author, credits, contact);
      this.#dialog.append(credit);
    }
    this.#dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    window.addEventListener(CUP_MENU_EVENT, () => this.open());
  }
  #selectView(
    view: 'browser' | 'leaderboards' | 'tracks' | 'history' | 'community',
    player?: { id: string; name: string; match?: string },
  ) {
    this.#view = view;
    this.#dialog.dataset.view = view;
    this.#dialog.classList.remove('hub-social-open');
    const socialToggle = this.#dialog.querySelector<HTMLButtonElement>('.hub-mobile-social');
    if (socialToggle) {
      socialToggle.textContent = 'Friends';
      socialToggle.setAttribute('aria-expanded', 'false');
    }
    this.#leaderboard?.close();
    this.#history?.close();
    this.#browserView.hidden = view !== 'browser';
    this.#boardView.hidden = view !== 'leaderboards';
    this.#trackView.hidden = view !== 'tracks';
    this.#historyView.hidden = view !== 'history';
    this.#communityView.hidden = view !== 'community';
    if (this.#community) this.#community.chat.visible = view === 'community';
    for (const button of this.#viewTabs.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = button.dataset.view === view;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const account = this.#account.account;
    this.#viewUser = account?.user?.id ?? null;
    if (view === 'leaderboards' || view === 'tracks') {
      this.#leaderboard?.mount(view === 'tracks' ? this.#trackView : this.#boardView);
      this.#leaderboard?.open(view === 'tracks' ? 'tracks' : 'players');
    }
    this.#viewTabs
      .querySelector<HTMLButtonElement>('[aria-selected=true]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (view === 'history') {
      const id = player?.id ?? account?.user?.id;
      this.#historyNotice.hidden = !!id;
      if (account && id)
        this.#history?.open(account.ranked, id, player?.name ?? 'Your matches', player?.match);
    }
  }
  async #enterRanked(id: string) {
    if (this.#rankedOpening) return;
    const account = this.#account.account!;
    this.#rankedOpening = true;
    this.#reconnectUI?.close();
    const player = account.user?.id;
    if (player) {
      this.#rankedBefore = { match: id, player, profile: null };
      void account.ranked
        .profile(player)
        .then((profile) => {
          if (this.#rankedBefore?.match === id && this.#rankedBefore.player === player) {
            this.#rankedBefore.profile = profile;
            this.#notifications?.rememberBefore(id, player, profile);
          }
        })
        .catch(() => {});
    }
    try {
      const room = new RankedRoom(account.directory, account.ranked, id, account.queue.instance, {
        list: () => this.#controller.availableTracks(),
        parse: () => {
          throw new Error('Custom tracks unavailable in ranked.');
        },
      });
      this.#handoff?.dispose();
      room.setInputHandler((item) => this.#inputOutbox?.enqueue(item));
      this.#room?.dismiss();
      this.#room = room;
      this.#controller.attachWaitingRoom(room, new WaitingRoomChat(room));
      this.#handoff = new RoomHandoff(room, controllerRaceBridge(this.#controller));
      let entered = false,
        observedDisconnected = false;
      room.subscribe(() => {
        if (entered && room.disconnected && room.snapshot && !observedDisconnected) {
          observedDisconnected = true;
          this.#controller.requestPanel(false);
          this.open();
        }
        if (entered && !room.snapshot) {
          this.#controller.releaseCup('Ranked Cup ended');
          this.#controller.requestPanel(false);
          this.open();
          if (this.#resultShown.has(id)) this.#resultUI?.reopen();
          else if (player)
            void account.ranked
              .resultStatus(id)
              .then((status) => {
                if (status && ['review', 'completed'].includes(status.status)) {
                  this.#resultShown.add(id);
                  this.#resultUI?.open(id, player, this.#rankedBefore?.profile ?? null);
                  account.queue.invalidateProfile();
                }
              })
              .catch(() => {});
          void account.queue.refresh();
        }
      });
      await room.enter(menuIdentity());
      if (!room.snapshot) throw new Error('This ranked match ended.');
      entered = true;
      this.#rankedEntered = id;
      this.#enter();
    } catch (e) {
      this.#controller.requestPanel(false);
      this.open();
      this.#error.textContent = `Could not open ranked Cup: ${(e as Error).message} Use Ranked match to retry.`;
      this.#error.hidden = false;
    } finally {
      this.#rankedOpening = false;
      this.#reconnectUI?.render();
    }
  }
  #ensure() {
    if (this.#room && !this.#room.ranked) return this.#room;
    if (!this.#account.account)
      throw new Error('Browser storage is unavailable. Enable it to host or join a Cup.');
    const c = this.#controller;
    this.#handoff?.dispose();
    const room = (this.#room = new WaitingRoom(this.#account.account.directory, {
      list: () => c.availableTracks(),
      parse: (code) => {
        const track = c.native.parse(code);
        if (!track?.trackData.hasStartingPoint())
          throw new Error('The track needs a starting point.');
        const id = track.trackData.getId();
        return {
          id,
          name: track.trackMetadata.name,
          category: c.native.trackLibrary?.isOfficialTrack(id)
            ? 'official'
            : c.native.trackLibrary?.isCommunityTrack(id)
              ? 'community'
              : 'custom',
        };
      },
    }));
    c.attachWaitingRoom(room, new WaitingRoomChat(room));
    this.#handoff = new RoomHandoff(room, controllerRaceBridge(c));
    let wasInRoom = false;
    room.subscribe(() => {
      if (wasInRoom && !room.snapshot) {
        c.requestPanel(false);
        this.open();
      }
      wasInRoom = !!room.snapshot;
    });
    return room;
  }
  #button(text: string, run: () => unknown, independent = false) {
    const button = h('button', text, 'quiet');
    if (text === 'Refresh' || text === 'Retry') button.dataset.errorRetry = '';
    button.type = 'button';
    button.addEventListener('click', () => {
      if (button.type !== 'submit') {
        if (text === 'Refresh') {
          this.#error.textContent = '';
          this.#error.hidden = true;
        }
        if (independent)
          void Promise.resolve(run()).catch((error) => {
            this.#error.textContent = (error as Error).message;
            this.#error.hidden = false;
          });
        else void this.#act(run);
      }
    });
    return button;
  }
  async #act(run: () => unknown, activity?: 'create' | 'join') {
    if (this.#busy) return;
    retryDismissedErrors(this.#dialog);
    this.#busy = true;
    this.#error.hidden = true;
    const labels = new Map<HTMLButtonElement, string>();
    const active = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
      '.hub-list-header button, .hub-host button, .hub-room button',
    )) {
      labels.set(button, button.textContent ?? '');
      button.disabled = true;
      if ((activity === 'join' || button === active) && button.textContent === 'Join')
        button.textContent = 'Joining…';
      else if (activity === 'create' && button.textContent === 'Host lobby')
        button.textContent = 'Creating…';
    }
    try {
      await run();
    } catch (e) {
      this.#error.textContent = (e as Error).message;
      this.#error.hidden = false;
    } finally {
      this.#busy = false;
      for (const [button, label] of labels) button.textContent = label;
      for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
        '.hub-list-header button, .hub-host button, .hub-room button',
      ))
        button.disabled = false;
      this.#renderRows();
    }
  }
  #enter() {
    this.close();
    this.#entered();
  }
  open() {
    if (this.#room?.snapshot && !this.#room.disconnected) {
      this.#entered();
      return;
    }
    this.#seasonCountdown.start();
    if (!this.#dialog.open) this.#dialog.showModal();
    if (this.options.rankedActivity) this.#community?.start();
    if (this.options.rankedActivity) this.#selectView(this.#view);
    this.#resultUI?.reopen();
    this.#notifications?.wake();
    coverNativeMenu(true);
    this.#account.mount(this.#social, this.#back);
    this.#account.account?.queue.setVisible(true);
    this.#reconnectUI?.render();
    if (!this.options.localPreview && !this.#rankedActive && !this.#resultUI?.isOpen)
      this.#guide.welcome();
    if (this.options.localPreview || this.options.casualAvailable === false) {
      this.#list.replaceChildren(
        h(
          'div',
          this.options.localPreview
            ? 'Local preview · Ranked test clients'
            : 'Casual lobbies are not enabled in this preview yet.',
          'hub-empty',
        ),
      );
      this.#dialog
        .querySelectorAll<HTMLButtonElement>('[data-cup-admission]')
        .forEach((b) => (b.disabled = true));
      return;
    }
    void this.#act(async () => {
      const room = this.#room ?? this.#ensure();
      if (!this.#restored && !room.ranked && !this.#rankedActive) {
        this.#restored = true;
        this.options.beforeCasual?.();
        await room.restore(menuIdentity());
        if (room.snapshot) {
          this.#enter();
          return;
        }
      }
      await this.refresh();
    });
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      if (!this.#busy)
        void this.refresh().catch(() => {
          if (!this.#dialog.open) return;
          this.#error.textContent =
            'Could not refresh public lobbies. Your lobby code and hosting controls are still available.';
          this.#error.hidden = false;
        });
    }, 15000);
  }
  close() {
    this.#seasonCountdown.stop();
    this.#community?.stop();
    this.#account.closeSocial();
    if (this.options.rankedActivity) {
      this.#leaderboard?.close();
      this.#history?.close();
    }
    this.#reconnectUI?.close();
    this.#guide.close();
    this.#patchNotes.close();
    this.#account.account?.queue.setVisible(false);
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#account.unmount();
    this.#dialog.close();
    coverNativeMenu(false);
  }
  async refresh() {
    if (this.#refreshing) return;
    if (this.#dialog.open && !this.#onlineBusy && Date.now() - this.#onlineAt >= 30000) {
      const api = this.#account.account?.ranked;
      if (api) {
        this.#onlineBusy = true;
        this.#onlineAt = Date.now();
        void api
          .onlineCount()
          .then((count) => {
            if (!Number.isSafeInteger(count) || count < 0)
              throw new Error('Invalid presence count');
            this.#online.textContent = `${count} online`;
            this.#online.setAttribute('aria-label', `${count} players online`);
            this.#online.classList.add('available');
            this.#online.removeAttribute('title');
          })
          .catch(() => {
            if (this.#online.classList.contains('available')) {
              this.#online.title = 'Last known player count; update unavailable';
              this.#online.setAttribute(
                'aria-label',
                this.#online.textContent + ', last known count; update unavailable',
              );
              return;
            }
            this.#online.textContent = 'Online: —';
            this.#online.setAttribute('aria-label', 'Online players unavailable');
            this.#online.classList.remove('available');
          })
          .finally(() => {
            this.#onlineBusy = false;
          });
      }
    }
    this.#refreshing = true;
    const button = this.#dialog.querySelector<HTMLButtonElement>('.hub-refresh');
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing…';
    }
    try {
      // Listing rooms must not replace a ranked room whose initial request is
      // still in flight. That would detach its handoff before the draft opens.
      this.#rows = await (this.#room ?? this.#ensure()).listings();
      if (
        this.#error.textContent ===
        'Could not refresh public lobbies. Your lobby code and hosting controls are still available.'
      ) {
        this.#error.textContent = '';
        this.#error.hidden = true;
      }
      this.#renderRows();
    } finally {
      this.#refreshing = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Refresh';
      }
    }
  }
  update() {
    if (
      this.options.rankedActivity &&
      this.isOpen &&
      this.#viewUser !== (this.#account.account?.user?.id ?? null)
    )
      this.#selectView(this.#view);
    const state = this.#controller.nativeState,
      before = this.#rankedBefore;
    if (
      this.#room?.ranked &&
      state?.phase === 'complete' &&
      before?.match === state.id &&
      this.#account.account?.user?.id === before.player &&
      !this.#resultShown.has(state.id)
    ) {
      try {
        this.#settlement?.enqueue((this.#room as RankedRoom).resultTranscript(state));
      } catch (e) {
        this.#error.textContent = (e as Error).message;
        this.#error.hidden = false;
        if (/recorded finish|omitted your/.test((e as Error).message)) {
          this.#resultShown.add(state.id);
          const account = this.#account.account!;
          void account.ranked.rejectResult(state.id, account.queue.instance).catch(() => {});
          this.#resultUI?.showIssue(
            'The result differs from your recorded finishes. No rating change has been confirmed.',
          );
        }
        return;
      }
      this.#resultShown.add(state.id);
      this.#resultUI?.open(state.id, before.player, before.profile);
    }
  }
  #renderRows() {
    this.#list.replaceChildren();
    const rows = this.#rows;
    this.#list.classList.toggle('is-empty', !rows.length);
    if (!rows.length) {
      const empty = h('div', undefined, 'hub-empty');
      empty.append(
        h('h3', 'No public lobbies available'),
        h('p', 'Host your own lobby or join an existing one using a lobby code.'),
      );
      this.#list.append(empty);
    }
    for (const row of rows) {
      const element = h('article', undefined, 'hub-room'),
        identity = h('div', undefined, 'hub-room-identity');
      identity.append(h('strong', row.title), h('small', row.host_name));
      const phase = h(
        'span',
        row.phase === 'racing'
          ? 'Racing'
          : ['bans', 'picks'].includes(row.phase)
            ? 'Drafting'
            : 'Waiting',
        'hub-phase',
      );
      const join = this.#button(
        row.version !== VERSION ? 'Update mod' : row.players >= 16 ? 'Full' : 'Join',
        async () => {
          if (this.#controller.connection)
            throw new Error('Leave your current multiplayer game before joining a lobby.');
          this.options.beforeCasual?.();
          await this.#ensure().join(row.id, menuIdentity());
          this.#enter();
        },
      );
      join.disabled = this.#busy || row.version !== VERSION || row.players >= 16;
      join.dataset.cupAdmission = '';
      join.dataset.incompatible = String(row.version !== VERSION || row.players >= 16);
      join.disabled ||= !!this.#rankedActive;
      const mode = h('span', row.mode === 'teams' ? 'Teams' : 'FFA', 'hub-mode');
      element.append(identity, mode, phase, h('span', `${row.players}/16`, 'hub-count'), join);
      this.#list.append(element);
    }
    for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>('[data-cup-admission]'))
      button.disabled ||= !!this.#rankedActive;
  }
}
