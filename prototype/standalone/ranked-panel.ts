import { hasLayoutBox } from '../../src/visibility.ts';
import { winStreak, winStreakCSS, streakLength } from '../../src/win-streak.ts';
import { installErrorDismissal, retryDismissedErrors } from '../../src/dismissible-errors.ts';
import { playerName } from '../../src/cosmetics.ts';
import { playerLooks } from '../../src/player-looks.ts';
import themeCSS from '../../src/interface-theme.css';
import { statusIcon } from '../../src/status-icon.ts';
import { profilePictureCSS } from '../../src/profile-picture.ts';
import acceptCSS from './accept-prompt.css';
import { profilePicture } from '../../src/profile-picture.ts';
import { MatchFinishUI, type FinishRow, type FinishView } from '../../src/match-finish-ui.ts';
import { resultRows } from '../../src/results.ts';
import panelCSS from './ranked-panel.css';
import { RankedLoading } from './ranked-loading.ts';
import { rankBadge } from '../../src/rank-badge.ts';
import rankStyles from '../../src/ranked-queue.css';
import { installClientUpdates } from './client-updates.ts';
import { RankedInputOutbox } from '../../src/ranked-inputs.ts';
import { RankedHistoryUI } from '../../src/ranked-history-ui.ts';
import { SharedChatUI } from '../../src/shared-chat-ui.ts';
import { RankedResultsChat } from '../../src/results-chat.ts';
import { protectUITouches } from '../../src/touch-ui.ts';
import { PollRetry } from './poll-retry.ts';
import { practiceControl, menuIdentity } from '../../src/native-cup-menu.ts';
import { QueueControls } from './queue-controls.ts';
import { requireNativeInstance } from './native-instance.ts';
import { rankedEndpoint, standalonePlatform, type ClientPlatform } from '../../src/client-platform.ts';
import { configureOfficialPositions } from '../../src/official-position.ts';

export function installRankedPanel(
  proto: any,
  panel: HTMLElement,
  report: (event: string, detail?: any) => void,
  live = false,
  inHub = false,
  platform: ClientPlatform = standalonePlatform(location.origin),
) {
  configureOfficialPositions(platform);
  const tokenKey = 'polycup.prototype.account';
  const loading = new RankedLoading();
  const finish = new MatchFinishUI();
  finish.dialog.id = 'prototype-rating';
  const garageNames = new Map<string, { native: number; name: string }>();
  const garageSnapshots = new Map<string, { profile: ReturnType<typeof menuIdentity>; busy: boolean; done: boolean; next: number }>();
  function saveGarageSnapshot(match: string) {
    if (!live || !proto.ui.account?.user) return;
    let snapshot = garageSnapshots.get(match);
    if (!snapshot) {
      if (garageSnapshots.size >= 8) garageSnapshots.delete(garageSnapshots.keys().next().value!);
      snapshot = { profile: menuIdentity(), busy: false, done: false, next: 0 };
      garageSnapshots.set(match, snapshot);
    }
    if (snapshot.busy || snapshot.done || Date.now() < snapshot.next) return;
    snapshot.busy = true;
    const pending = snapshot;
    // Admission has bound this instance. Save alongside connection setup, never
    // hold up the race. Keep the original snapshot stable on a lost-response retry.
    void proto.ui.account.ranked.saveGarageSnapshot(match, instance, pending.profile)
      .then((saved: boolean) => { pending.done = saved; })
      .catch(() => { report('client_error', { message: 'Garage replay snapshot will retry.' }); })
      .finally(() => { pending.busy = false; pending.next = Date.now() + 5000; });
  }

  let postgameQueued = false;
  let raceHosting = true;
  let finalView: FinishView | undefined;
  let resultChat: { match: string; ui: SharedChatUI } | undefined;
  const matchChat = (match: string) => {
    if (!live || !proto.ui.account?.user || !match) return undefined;
    if (resultChat?.match !== match) {
      resultChat?.ui.stop();
      resultChat = {
        match,
        ui: new SharedChatUI(new RankedResultsChat(proto.ui.account.chat('ranked:' + match), proto.controller, match, id => presentations.get(id)), 'Match chat', undefined, 'frames'),
      };
    }
    return resultChat.ui;
  };
  const presentations = new Map<string, any>();
  let presentationMatch = '';
  // Leaving results dismisses their presentation, not settlement.
  // Late ratings remain in history; never reopen them over a later activity.
  const dismissedPendingResults = new Set<string>();
  const connectionNotice = document.createElement('div');
  connectionNotice.id = 'polycup-ranked-connection';
  connectionNotice.setAttribute('role', 'status');
  connectionNotice.hidden = true;
  connectionNotice.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:10000;padding:.7rem 1rem;background:#192343;color:#ffdb70;border-top:2px solid #ffdb70;pointer-events:none;max-width:80vw';
  document.body.append(connectionNotice);
  window.addEventListener('polycup-return-menu', () => { connectionNotice.hidden = true; });
  function endLostConnection() {
    if (!active || resultOpen || finish.isOpen || !proto.rankedMatch) return;
    connectionNotice.hidden = true;
    report('stage', {phase:'ranked_connection_ended',match:active});
    proto.controller.captureReplayRun(true);
    // Stop the native session: a racer must never keep driving after losing
    // their authoritative connection and mistake that local run for a result.
    pendingFinish('Connection lost. Your race has stopped; waiting for the server result.');
    proto.controller.connection?.dispose();
    window.dispatchEvent(new Event('polycup-return-menu'));
  }
  window.addEventListener('polycup-ranked-transport', ((event: CustomEvent) => {
    if (!active || resultOpen || finish.isOpen || !proto.rankedMatch) return;
    if (event.detail.phase === 'rtc_recovering') {
      connectionNotice.textContent = 'Connection interrupted · Reconnecting…';
      connectionNotice.hidden = false;
    } else if (event.detail.phase === 'rtc_recovered') connectionNotice.hidden = true;
    else if (event.detail.phase === 'rtc_recovery_expired') endLostConnection();
  }) as EventListener);
  let entered = '',
    loadingBusy = false;
  proto.loading = loading;
  const sprintInProgress = () =>
    !resultOpen &&
    !!proto.rankedMatch &&
    proto.controller.nativeState?.preset?.rules?.singleRound &&
    !['registration', 'complete'].includes(proto.controller.nativeState?.phase);
  proto.sprintInProgress = sprintInProgress;
  window.addEventListener('beforeunload', (event) => {
    if (sprintInProgress()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  let token = localStorage.getItem(tokenKey) || '',
    player = '',
    instance = sessionStorage.getItem('polycup.prototype.instance') || crypto.randomUUID();
  sessionStorage.setItem('polycup.prototype.instance', instance);
  let active = '',
    connecting = false,
    joined = '',
    busy = false,
    polling = false,
    resultOpen = false;
  let revision = 0,
    nextIdlePoll = 0;
  let pollError = '';
  let deniedResultAdmission = '';
  const pollRetry = new PollRetry();
  const showMenu = (visible: boolean) => {
    // A late idle/admission reply must not open a newer modal above the result.
    if (visible && (resultOpen || finish.isOpen)) return;
    const changed = panel.hidden === visible;
    panel.hidden = !visible;
    if (inHub && changed) proto.ui.setMainMenuOpen(visible);
  };
  panel.replaceChildren();
  const title = document.createElement('b');
  title.textContent = inHub ? 'Ranked' : 'PolyCup · Local ranked prototype';
  const identity = document.createElement('div');
  identity.className = 'standalone-rank-identity';
  const badgeBox = document.createElement('div'),
    statsBox = document.createElement('small');
  badgeBox.append(rankBadge(null));
  function setStats(matches: string, winRate: string) {
    const played = document.createElement('span'),
      wins = document.createElement('span');
    played.textContent = matches;
    wins.textContent = winRate;
    statsBox.replaceChildren(played, wins);
  }
  setStats('— matches', '— win rate');
  identity.append(title, badgeBox, statsBox);
  const rankedLinks = document.createElement('div');
  rankedLinks.className = 'standalone-ranked-links';
  rankedLinks.hidden = inHub;
  if (inHub) {
    const guide = document.createElement('button');
    guide.textContent = '?';
    guide.setAttribute('aria-label', 'Ranked tiers');
    guide.className = 'standalone-rank-guide';
    guide.onclick = () => panel.dispatchEvent(new Event('polycup-rank-guide'));
    title.append(guide);
  }
  let profileAt = 0,
    profileOwner = '',
    profileBusy = false;
  async function refreshProfile() {
    const id = proto.ui.account?.user?.id;
    if (!live || !id || profileBusy || (id === profileOwner && Date.now() - profileAt < 30000))
      return;
    profileOwner = id;
    profileAt = Date.now();
    profileBusy = true;
    try {
      const [profile, stats] = await Promise.all([
        proto.ui.account.ranked.profile(id),
        proto.ui.account.ranked.stats(id),
      ]);
      if (proto.ui.account?.user?.id !== id) return;
      badgeBox.replaceChildren(rankBadge(profile));
      setStats(
        `${stats.matches} ${stats.matches === 1 ? 'match' : 'matches'}`,
        `${Math.round(Number(stats.win_rate ?? 0))}% win rate`,
      );
      if (streakLength(stats.current_win_streak))
        statsBox.lastElementChild?.append(winStreak(stats.current_win_streak));
    } catch {
      statsBox.textContent = 'Rating unavailable';
    } finally {
      profileBusy = false;
    }
  }
  const status = document.createElement('p');
  status.id = 'prototype-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Connecting…';
  const find = document.createElement('button');
  find.textContent = 'Find ranked';
  find.id = 'prototype-find';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel queue';
  cancel.hidden = true;
  const practice = document.createElement('button');
  practice.textContent = 'Practice';practice.hidden = true;
  practice.onclick = () => void openPractice();
  const message = document.createElement('div');
  message.id = 'prototype-error';
  message.setAttribute('role', 'status');
  const detail = document.createElement('small');
  detail.textContent = 'Local QA accounts · No live rating changes';
  const rooms = document.createElement('div');
  rooms.id = 'prototype-rooms';
  rooms.hidden = true;
  const queueActions = document.createElement('div');
  queueActions.className = 'standalone-queue-actions';
  queueActions.append(status, find, practice, cancel);
  panel.append(inHub ? identity : title, rankedLinks, queueActions, message, rooms, detail);
  installErrorDismissal(panel);
  if (inHub) {
    detail.hidden = true;
    const skin = document.createElement('style');
    skin.textContent = rankStyles + panelCSS + winStreakCSS;
    panel.append(skin);
  }
  if (live) {
    detail.textContent = 'Local client · Live Supabase test queue';
    const account = document.createElement('button');
    account.textContent = 'Account';
    account.onclick = () => proto.ui.openAccount();
    if (!inHub) panel.append(account);
    if (inHub) {
      proto.openRankedHistory = (id = player, name = 'Your matches') =>
        panel.dispatchEvent(new CustomEvent('polycup-history', { detail: { id, name } }));
    } else {
      const historyRoot = document.createElement('div');
      document.body.append(historyRoot);
      const history = new RankedHistoryUI(historyRoot.attachShadow({ mode: 'open' }), undefined, () => proto.ui.account?.user?.id ?? player);
      proto.openRankedHistory = (id = player, name = 'Your matches') =>
        history.open(proto.ui.account.ranked, id, name);
      const historyButton = document.createElement('button');
      historyButton.textContent = 'Match history';
      historyButton.onclick = () => proto.openRankedHistory();
      rankedLinks.append(historyButton);
    }
  }
  const dialog = document.createElement('dialog');
  protectUITouches(dialog);
  dialog.id = 'prototype-match';
  dialog.style.cssText =
    'background:var(--pc-panel);color:var(--pc-text);border:0;padding:24px;width:min(460px,calc(100vw - 24px));min-width:0;box-sizing:border-box;max-height:calc(100dvh - 24px);overflow:auto;font:400 20px ForcedSquare,Arial,sans-serif;text-align:center';
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => event.preventDefault());
  for (const type of ['keydown','keyup']) dialog.addEventListener(type,event=>event.stopPropagation());
  installErrorDismissal(dialog);
  const style = document.createElement('style');
  style.textContent = `
    #prototype-match::backdrop,#prototype-rating::backdrop{background:#0a1126bb;backdrop-filter:blur(3px)}
    #prototype-match h2,#prototype-rating h2{font:italic 400 32px/1.15 ForcedSquare,Arial,sans-serif;margin:0 0 16px}
    #prototype-rating h2{font-size:38px;color:#ffd76b}
    #prototype-match p,#prototype-rating p{color:var(--pc-muted);line-height:1.4;margin:12px 0 22px}
    #prototype-match button,#prototype-rating button{min-height:48px;padding:10px 18px;margin:4px;border:0;background:var(--pc-action);color:var(--pc-text);font:italic 400 20px ForcedSquare,Arial,sans-serif;cursor:pointer;clip-path:var(--cut)}
    #prototype-match button.primary,#prototype-rating button:last-of-type{background:var(--pc-gold);color:var(--pc-canvas);font-weight:700;font-synthesis:weight style}
    #prototype-match button:disabled,#prototype-rating button:disabled{opacity:.6;cursor:wait}
    #prototype-match button:focus-visible,#prototype-rating button:focus-visible{outline:none;box-shadow:inset 0 -3px currentColor;text-decoration:underline;text-underline-offset:4px}
  `;
  style.textContent += themeCSS + profilePictureCSS + acceptCSS;
  document.head.append(style);

  const controls = new QueueControls(() => {panel.hidden=false;proto.ui.setMainMenuOpen(true);}, () => void openPractice(), () => void action('cancel'));
  let acceptHadHub = false, queueJoinedAt = 0;
  async function openPractice() {
    if(busy || proto.queueState?.state === 'matched')return;
    controls.retryErrors();
    try {
      if(postgameQueued){finish.close();postgameQueued=false;resultOpen=false;finalView=undefined;}
      proto.ui.setMainMenuOpen(false);
      panel.hidden=false;
      await practiceControl('open').ready;
    } catch(e: any) {message.textContent=e.message;showMenu(true);}
  }
  function syncQueueControls() {
    const q=proto.queueState, state=practiceControl('state');
    const hubOpen=!!(panel.closest('dialog') as HTMLDialogElement | null)?.open;
    practiceControl(q?.state==='matched' || hubOpen ? 'hold' : 'resume');
    const hide=q?.state!=='queued',label='Practice';
    if(practice.hidden!==hide)practice.hidden=hide;
    if(practice.disabled!==busy)practice.disabled=busy;
    if(practice.textContent!==label)practice.textContent=label;
    controls.update(q?.state==='queued',!hasLayoutBox(panel)&&!postgameQueued&&!resultOpen&&!dialog.open&&loading.root.hidden,
      Number(q?.waiting??0),busy,!!state.active,message.textContent??'',queueJoinedAt,q?.host_capacity===0?'Waiting for server':'Searching');
  }
  setInterval(syncQueueControls,100);

  let confirmUntil = 0,
    confirmMatch = '';
  const paintPlayers = (players: any[]) => {
    const group = document.createElement('div');
    group.className = 'accept-players';
    for (const p of players) {
      const slot = document.createElement('span');
      slot.className = 'accept-player' + (p.accepted ? ' is-ready' : '');
      slot.title = p.accepted ? 'Accepted' : 'Waiting';
      slot.setAttribute('aria-label', slot.title);
      const silhouette = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      silhouette.classList.add('accept-silhouette');
      silhouette.setAttribute('viewBox', '0 0 32 32');
      silhouette.setAttribute('aria-hidden', 'true');
      silhouette.innerHTML =
        '<circle cx="16" cy="10" r="6" fill="currentColor"/><path d="M5 29v-5c0-6 5-8 11-8s11 2 11 8v5Z" fill="currentColor"/>';
      slot.append(silhouette);
      if (p.accepted) slot.append(statusIcon('check'));
      group.append(slot);
    }
    return group;
  };
  async function request(path: string, body: any = {}) {
    const owner = live ? proto.ui.account?.user?.id : player;
    if (path === 'queue' && ['join', 'accept'].includes(body.action)) await requireNativeInstance();
    if (live && owner !== proto.ui.account?.user?.id) throw Error('Account changed. Please try again.');
    if (live) token = (await proto.ui.account?.accessToken()) || '';
    const response = await fetch(rankedEndpoint(platform, path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        instance,
        clientProtocol: (window as any).polycupBuild?.protocol,
        ...body,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    if (live && owner !== proto.ui.account?.user?.id)
      throw new Error('Account changed. Please try again.');
    if (!response.ok)
      throw Object.assign(Error(value.error || 'Ranked request failed'), { code: value.code });
    return value;
  }
  proto.rankedRequest = request;
  const build = (window as any).polycupBuild;
  const updates = build && platform.distribution === 'standalone'
    ? installClientUpdates(
        panel,
        build,
        () =>
          !resultOpen &&
          (busy ||
            connecting ||
            (!!proto.controller.connection && proto.controller.nativeState?.phase !== 'complete') ||
            (!!proto.queueState && proto.queueState.state !== 'idle')),
      )
    : null;
  proto.updates = updates;
  updates?.setServiceNotice(raceHosting ? '' : 'Pilot racing is paused.');
  let inputPolicy: Promise<boolean> | undefined;
  const inputUser = () => (live ? (proto.ui.account?.user?.id ?? null) : player || null);
  const outbox = new RankedInputOutbox(
    {
      inputReviewEnabled: () =>
        (inputPolicy ??= request('input-policy').catch((e) => {
          inputPolicy = undefined;
          throw e;
        })),
      // A recovered live match has a new instance lease. Older completed matches
      // retain the original lease stored with their pending recording.
      submitInputRun: (match, recordedInstance, run) =>
        request('input', {
          match,
          instance: active === match ? instance : recordedInstance,
          run,
        }),
    },
    inputUser,
    localStorage,
  );
  const replayOutbox = new RankedInputOutbox({inputReviewEnabled:async()=>true,
    submitInputRun:(match,recordedInstance,run)=>live
      ? proto.ui.account.ranked.submitReplayRun(match,active===match?instance:recordedInstance,run)
      : request('replay-input',{match,instance:active===match?instance:recordedInstance,run})},
    inputUser,localStorage,'polycup.ranked.replay-outbox.v1',5000,(item,state)=>{
      void (live
        ? proto.ui.account.ranked.reportReplayIssue(item.match,active===item.match?instance:item.instance,item.run.round,state)
        : request('replay-issue',{match:item.match,instance:item.instance,round:item.run.round,state})).catch(()=>{});
    });
  proto.controller.setReplayRunHandler((run:import('../../src/ranked-inputs.ts').InputRun)=>{
    const match=proto.controller.nativeState?.id;
    if(!player || inputUser()!==player || !match || match!==joined)return;
    replayOutbox.enqueue({match,player,instance,run});
  });
  window.addEventListener('pagehide',()=>proto.controller.captureReplayRun(true));
  proto.controller.setInputRunHandler((run: import('../../src/ranked-inputs.ts').InputRun) => {
    const match = proto.controller.nativeState?.id;
    if (!player || inputUser() !== player || !match || match !== joined) return;
    outbox.enqueue({ match, player, instance, run });
  });
  // Runs off the race/result path; retries must never hold up Play again.
  setInterval(() => {void outbox.flush();void replayOutbox.flush();}, 2000);
  window.addEventListener('online', () => {void outbox.flush();void replayOutbox.flush();});
  async function action(kind: string) {
    if (busy) return;
    const acceptIntent = kind === 'accept' && proto.queueState?.match?.status === 'reserved';
    const actionOwner = inputUser();
    retryDismissedErrors(panel);
    retryDismissedErrors(dialog);
    controls.retryErrors();
    busy = true;
    proto.queueBusy = true;
    proto.ui.refreshMainMenuAdmission();
    revision++;
    nextIdlePoll = 0;
    pollRetry.reset();
    find.disabled = true;
    message.textContent = '';
    if (dialog.open && ['accept', 'decline'].includes(kind)) {
      dialog.querySelector('.accept-error')?.remove();
      dialog.querySelectorAll('button').forEach((b) => (b.disabled = true));
      const button = dialog.querySelector<HTMLButtonElement>('[data-accept-action=accept]');
      if (button && kind === 'accept') button.textContent = 'Accepting…';
    }
    try {
      if (kind === 'join') {
        if (!raceHosting) throw Error('Pilot racing is paused.');
        if (proto.controller.waitingRoom || proto.controller.connection)
          throw Error('Leave your current Cup before joining ranked.');
        await updates?.beforeQueue();
      }
      let reply = await request('queue', { action: kind });
      // A decline can reach the server before our in-flight Accept. Preserve
      // that explicit search intent even when the old reservation is gone.
      // Silence/timeouts and explicit declines never take this branch.
      if (acceptIntent && reply.state === 'idle' && actionOwner === inputUser() && reply.race_hosting !== false)
        reply = await request('queue', { action: 'join' });
      render(reply);
    } catch (e: any) {
      const text = ['TimeoutError', 'AbortError', 'TypeError'].includes(e.name)
        ? 'Could not confirm your choice. Please try again.'
        : e.message;
      message.textContent = text;
      if (dialog.open && ['accept', 'decline'].includes(kind)) {
        const error = document.createElement('p');
        error.className = 'accept-error';
        error.setAttribute('role', 'alert');
        error.textContent = text;
        dialog.append(error);
      }
    } finally {
      busy = false;
      proto.queueBusy = false;
      updates?.render();
      proto.ui.refreshMainMenuAdmission();
      find.disabled = !raceHosting;
      if (dialog.open) {
        const accepted = proto.queueState?.match?.players?.find(
          (p: any) => p.id === player,
        )?.accepted;
        dialog.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
          button.disabled = button.dataset.acceptAction === 'accept' && !!accepted;
          if (button.dataset.acceptAction === 'accept')
            button.textContent = accepted ? 'Accepted' : 'Accept';
        });
      }
    }
  }
  async function cancelPostgameQueue() {
    if (busy) return;
    busy = true;
    revision++;
    nextIdlePoll = 0;
    pollRetry.reset();
    try {
      render(await request('queue', { action: 'cancel' }));
    } finally {
      busy = false;
    }
  }
  function render(q: any) {
    void refreshProfile();
    raceHosting = q.race_hosting !== false;
    find.disabled = busy || !raceHosting;
    const previous = proto.queueState;
    proto.queueState = q;
    // A cancelled loading attempt no longer owns a connection or loading UI.
    // Abort it before an outstanding admission/join response can revive it.
    if (active && !entered && !finish.isOpen &&
        (q.state !== 'matched' || q.match?.id !== active)) {
      revision++;
      proto.resetRankedConnection?.();
      active = joined = '';
      connecting = false;
      loading.hide();
      dialog.close();
      practiceControl('resume');
      if (!practiceControl('state').active) showMenu(true);
    }
    if(q.state==='queued'&&Number.isFinite(Date.parse(q.joined_at)))
      queueJoinedAt=Date.now()-Math.max(0,Date.parse(q.server_time??new Date().toISOString())-Date.parse(q.joined_at));
    else if(q.state==='idle')queueJoinedAt=0;
    panel.dataset.queueState = q.state;
    if (q.state !== 'matched' && previous?.match?.status === 'reserved') {
      active = joined = entered = '';
      dialog.close();
      loading.hide();
      practiceControl('resume');
      if (!resultOpen && !finish.isOpen) {
        if (acceptHadHub && !practiceControl('state').active && !proto.controller.connection)
          showMenu(true);
        else panel.hidden = false;
      }
      message.textContent =
        q.state === 'queued' ? 'Match didn’t start. You’re still queued.' : 'Match didn’t start.';
    }
    if (
      q.state === 'matched' &&
      q.match.status !== 'reserved' &&
      previous?.match?.id === q.match.id &&
      previous.match.status === 'reserved' &&
      !confirmUntil
    ) {
      confirmUntil = Date.now() + 500;
      confirmMatch = q.match.id;
      const readyHeading = dialog.querySelector('h2');
      if (readyHeading) readyHeading.textContent = 'Match ready';
      dialog
        .querySelector('.accept-players')
        ?.replaceWith(paintPlayers(q.match.players.map((p: any) => ({ ...p, accepted: true }))));
      const count = dialog.querySelector('.accept-count');
      if (count)
        count.textContent = q.match.players.length + '/' + q.match.players.length + ' accepted';
      dialog.querySelectorAll('button').forEach((b) => (b.disabled = true));
      setTimeout(() => {
        confirmUntil = 0;
        if (proto.queueState?.match?.id === confirmMatch) render(proto.queueState);
      }, 500);
      return;
    }
    if (confirmUntil > Date.now() && q.match?.id === confirmMatch) return;
    // Remember the return destination before a postgame offer closes results.
    // The ranked panel is still hidden from the preceding race at that point.
    if (q.state === 'matched' && q.match.status === 'reserved' && !dialog.open)
      acceptHadHub = postgameQueued || !!(panel.closest('dialog') as HTMLDialogElement | null)?.open || hasLayoutBox(panel);
    if (q.state === 'matched' && (previous?.match?.id !== q.match.id ||
        (previous.match.status === 'reserved' && q.match.status !== 'reserved')))
      proto.ui.prepareMatchHandoff?.();
    if (q.state === 'matched') proto.ui.closeResultRecords?.();
    if (postgameQueued) {
      if (q.state === 'queued') {
        finish.setQueue('Searching · ' + q.waiting + ' waiting', cancelPostgameQueue, false, () => void openPractice());
        return;
      }
      if (q.state === 'idle') {
        postgameQueued = false;
        if (finalView) finish.show(finalView);
        return;
      }
      if (q.state === 'matched') {
        finish.close();
        resultOpen = false;
        postgameQueued = false;
        finalView = undefined;
      }
    }
    updates?.render();
    proto.ui.refreshMainMenuAdmission();
    find.hidden = q.state !== 'idle';
    cancel.hidden = q.state !== 'queued';
    status.hidden = false;
    if (q.state === 'queued') {
      status.textContent =
        q.host_capacity === 0 ? 'Waiting for a race server' : 'Searching for players';
      const detail = document.createElement('small');
      detail.textContent =
        q.host_capacity === 0
          ? 'You’ll be matched automatically'
          : String(q.waiting) + ' ' + (q.waiting === 1 ? 'player' : 'players') + ' queued';
      status.append(detail);
      status.title =
        'Four players immediately; three after 15 seconds or two after 30 seconds, when a server is available.';
      return;
    }
    if (q.state === 'idle') {
      if (!connecting) {
        loading.hide();
        if (previous?.state === 'matched' && previous.match?.status !== 'reserved' && !practiceControl('state').active && !proto.controller.connection) showMenu(true);
      }
      status.textContent = raceHosting || updates ? '' : 'Pilot racing is paused';
      status.title = '';
      status.hidden = raceHosting || !!updates;
      if (dialog.open) dialog.close();
      return;
    }
    active = q.match.id;
    if (['drafting', 'racing'].includes(q.match.status)) loading.setChat(matchChat(active));
    if (q.match.abandoned && !resultOpen && proto.rankedMatch) endLostConnection();
    if (presentationMatch !== active) {
      presentations.clear();
      garageNames.clear();
      presentationMatch = active;
    }
    for (const p of q.match.players ?? []) {
      const account = p.account ?? p.id;
      if (account && !presentations.has(account)) presentations.set(account, p);
    }
    if (finish.isOpen || q.match.status === 'review') {
      if (q.match.status === 'review') pendingFinish();
      return;
    }
    if (q.match.status === 'reserved') {
      practiceControl('hold');
      status.textContent = 'Match found';
      const self = q.match.players.find((p: any) => p.id === player),
        count = q.match.players.filter((p: any) => p.accepted).length;
      const focusAction = (document.activeElement as HTMLElement | null)?.dataset.acceptAction;
      dialog.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = self.accepted ? 'Waiting for other players' : 'Match found';
      const text = document.createElement('p');
      text.textContent = `${count}/${q.match.players.length} accepted`;
      text.className = 'accept-count';
      const clock = document.createElement('p');
      clock.className = 'accept-clock';
      clock.textContent =
        Math.max(
          0,
          Math.ceil(
            (Date.parse(q.match.deadline) - Date.parse(q.server_time ?? new Date().toISOString())) /
              1000,
          ),
        ) + 's remaining';
      const accept = document.createElement('button');
      accept.className = 'primary';
      accept.dataset.acceptAction = 'accept';
      accept.textContent = self.accepted ? 'Accepted' : 'Accept';
      accept.disabled = self.accepted || busy;
      accept.onclick = () => void action('accept');
      const decline = document.createElement('button');
      decline.textContent = 'Decline';
      decline.dataset.acceptAction = 'decline';
      decline.onclick = () => void action('decline');
      dialog.append(heading, paintPlayers(q.match.players), text, clock, decline, accept);
      if (!dialog.open) dialog.showModal();
      if (focusAction)
        dialog
          .querySelector<HTMLButtonElement>(
            '[data-accept-action=' + focusAction + ']:not(:disabled)',
          )
          ?.focus();
    } else if (['drafting', 'racing'].includes(q.match.status)) {
      if (dialog.open) dialog.close();
      status.textContent = 'Preparing your match…';
      if (entered !== active) {
        showMenu(false);
        proto.controller.requestPanel(false);
        if (loading.root.hidden)
          loading.show(
            active,
            q.match.players.map((p: any) => ({ account: p.id, name: p.name })),
            '',
          );
        void refreshLoading();
      }
      void connect();
    } else {
      loading.hide();
      if (q.match.status === 'cancelled') backToMenu();
      else pendingFinish();
    }
  }
  async function refreshLoading() {
    if (loadingBusy || !active || entered === active) return;
    loadingBusy = true;
    try {
      const expected = active;
      const expectedRevision = revision;
      const a = await request('admission', { match: expected });
      if (active !== expected || revision !== expectedRevision || entered === expected ||
          proto.queueState?.state !== 'matched' || proto.queueState.match?.id !== expected) return;
      if (!['drafting', 'racing'].includes(a.status)) {
        loading.hide();
        if (a.status === 'cancelled') backToMenu();
        else if (['completed', 'review', 'disputed'].includes(a.status)) pendingFinish();
        return;
      }
      const track = proto.controller.availableTracks().find((t: any) => t.id === a.track);
      for (const p of a.players ?? []) presentations.set(p.account, p);
      loading.show(
        active,
        a.players.map((p: any) => ({ ...p, win_streak: a.streaks?.[p.account] ?? 0 })),
        track?.name || (a.track ? 'Ranked track' : 'Selecting track'),
        a.loading,
        a.code ? 'Connecting racers' : 'Preparing match',
        track?.thumbnail,
      );
    } catch (e: any) {
      message.textContent = e.message;
    } finally {
      loadingBusy = false;
    }
  }
  setInterval(() => {
    const s = proto.controller.nativeState;
    if (active && garageSnapshots.has(active)) saveGarageSnapshot(active);
    if (active)
      for (const racer of proto.controller.lobby) {
        const account = proto.bindings?.get(racer.id);
        if (account) garageNames.set(account, { native: racer.id, name: racer.nickname });
      }
    if (
      active &&
      entered !== active &&
      s?.id === active &&
      ['warmup', 'countdown', 'racing', 'complete'].includes(s.phase)
    ) {
      entered = active;
      loading.hide();
      proto.controller.finishWaitingRace();
    }
    if (active && s?.id === active && s.phase === 'complete' && !resultOpen) pendingFinish();
  }, 100);
  async function connect() {
    if (connecting || joined === active || !active) return;
    connecting = true;
    const expected = active;
    const expectedRevision = revision;
    try {
      const admission = await request('admission', { match: expected });
      if(active!==expected || revision!==expectedRevision || proto.queueState?.state!=='matched' || proto.queueState.match?.id!==expected)return;
      for (const p of admission.players ?? []) presentations.set(p.account, p);
      if (!['drafting', 'racing'].includes(admission.status)) return;
      saveGarageSnapshot(expected);
      if (!admission.code) {
        status.textContent = 'Preparing dedicated host…';
        return;
      }
      status.textContent = 'Connecting to race…';
      report('stage', { phase: 'assignment_received' });
      await proto.joinRanked(admission);
      if(active!==expected || revision!==expectedRevision)return;
      joined = expected;
      practiceControl('complete');
    } catch (e: any) {
      if(active!==expected || revision!==expectedRevision)return;
      message.textContent = e.message;
      loading.hide();
      practiceControl('resume');
      if (!practiceControl('state').active) showMenu(true);
    } finally {
      if (revision === expectedRevision) connecting = false;
    }
  }
  const garageRows = (): FinishRow[] => {
    const state = proto.controller.nativeState;
    if (!state || state.id !== active || state.phase !== 'complete') return [];
    return resultRows(state).map((r: any) => {
      const account = proto.bindings?.get(r.id) ?? String(r.id);
      garageNames.set(account, { native: r.id, name: r.name });
      const p = presentations.get(account),
        label = document.createElement('span');
      label.className = 'player-with-portrait';
      label.append(
        profilePicture(p?.name ?? r.name, p?.avatar_url),
        Object.assign(document.createElement('span'), { textContent: p?.name ?? r.name }),
      );
      return {
        id: account,
        place: r.place,
        name: label,
        rank: p?.rank,
        dnf: r.dnf,
        time_ms: r.time_ms,
      };
    });
  };
  const backToMenu = () => {
    connectionNotice.hidden = true;
    if (active) {
      dismissedPendingResults.add(active);
      if (dismissedPendingResults.size > 32)
        dismissedPendingResults.delete(dismissedPendingResults.values().next().value!);
    }
    finish.close();
    resultOpen = false;
    finalView = undefined;
    active = joined = entered = '';
    revision++;
    proto.resetRankedConnection?.();
    connecting = false;
    proto.controller.connection?.dispose();
    window.dispatchEvent(new Event('polycup-return-menu'));
    showMenu(true);
    nextIdlePoll = 0;
  };
  function pendingFinish(notice = '') {
    if (finish.isOpen || !active || dismissedPendingResults.has(active)) return;
    loading.hide();
    showMenu(false);
    proto.controller.requestPanel(false);
    const localRows = garageRows();
    const localTrack = proto.controller.nativeState?.id === active
      ? proto.controller.nativeState.tracks?.[0] : undefined;
    let trackArt: string | Promise<string> | undefined;
    try {
      trackArt = proto.controller.availableTracks().find((t: any) => t.id === localTrack?.id)?.thumbnail;
    } catch { /* Optional artwork must not hold up results. */ }
    finish.show({
      key: active,
      ranked: true,
      title: 'Match finished',
      subtitle: '',
      track: localTrack?.name,
      trackId: localTrack?.id,
      trackArt,
      rows: localRows.length ? localRows : [...presentations].map(([account, p]) => {
        const name = document.createElement('span');
        name.className = 'player-with-portrait';
        name.append(profilePicture(p.name, p.avatar_url), playerName(p.name));
        return { id: account, name, place: null, rank: p.rank };
      }),
      self: player,
      pending: true,
      notice,
      chat: matchChat(active),
      actions: [{ label: 'Back to menu', run: backToMenu }],
    });
  }
  window.addEventListener('polycup-concede', async () => {
    if (!sprintInProgress() || busy) return;
    if (
      !confirm(
        'Concede this match? This counts as a normal rated loss.',
      )
    )
      return;
    busy = true;
    try {
      await request('concede', { match: active });
      pendingFinish();
      proto.controller.connection?.dispose();
      window.dispatchEvent(new Event('polycup-return-menu'));
      await results();
    } catch (e: any) {
      message.textContent = e.message;
    } finally {
      busy = false;
    }
  });
  async function results() {
    if (resultOpen || !active || dismissedPendingResults.has(active)) return;
    const expectedRevision = revision,
      expectedActive = active;
    const current = () => revision === expectedRevision && active === expectedActive && !resultOpen;
    let r = await request('result', { match: expectedActive }),
      unrated = false;
    if (!current()) return;
    if (!r && active && deniedResultAdmission !== active) {
      const expected = active;
      let terminal;
      try { terminal = await request('admission', { match: expected }); }
      catch (error: any) {
        if (!current() || active !== expected) return;
        if (/^Ranked admission unavailable\.?$/.test(error?.message ?? '')) {
          // Leaving revokes race admission, not delivery of the final result.
          // Keep checking the result; do not retry the denied admission or send
          // this expected state through network-outage exponential backoff.
          deniedResultAdmission = expected;
          endLostConnection();
          return;
        }
        throw error;
      }
      if (!current() || active !== expected) return;
      if (terminal.status === 'cancelled') {
        dialog.close();
        loading.hide();
        backToMenu();
        return;
      }
      if (terminal.status === 'unrated') {
        unrated = true;
        const local = garageRows();
        r = {
          match_id: expected,
          players: (terminal.players?.length
            ? terminal.players
            : [...presentations].map(([account, p]) => ({ ...p, account }))
          ).map((p: any) => ({
            player_id: p.account,
            display_name: p.name,
            avatar_url: p.avatar_url,
            rank: p.rank,
            rating_before: p.rank?.rating ?? null,
            rating_after: p.rank?.rating ?? null,
            place: null,
            dnf:
              /no.*finish|all.*dnf/i.test(terminal.reason ?? '') ||
              !!local.find((row) => row.id === p.account)?.dnf,
          })),
          reason: terminal.reason,
        };
      }
    }
    // Older services may ignore the match selector. An unrelated unread result
    // must never replace the current match's pending/settled screen.
    if (!r || r.match_id !== expectedActive) return;
    const own = r.players.find((p: any) => p.player_id === player);
    if (!own && !unrated) return;
    resultOpen = true;
    connectionNotice.hidden = true;
    dismissedPendingResults.delete(r.match_id);
    showMenu(false);
    loading.hide();
    dialog.close();
    const newlySettled = proto.settledResult?.match_id !== r.match_id;
    proto.settledResult = r;
    if (newlySettled) window.dispatchEvent(new Event('polycup-ranked-result'));
    if (live && own && !unrated) void playerLooks.refreshProgression(player, true);
    garageRows();
    const rows: FinishRow[] = r.players.map((p: any) => {
      const name = document.createElement('span');
      name.className = 'player-with-portrait';
      name.append(profilePicture(p.display_name, p.avatar_url), playerName(p.display_name));
      return {
        id: p.player_id,
        name,
        place: p.place,
        rank: p.rank,
        before: p.rating_before,
        after: p.rating_after,
        abandoned: p.abandoned,
        dnf: p.dnf,
        time_ms: p.time_ms,
        winStreak: p.win_streak,
        streakBefore: p.streak_before,
        streakBonus: p.streak_bonus,
        baseGain: p.base_gain,
      };
    });
    const leave = async (requeue: boolean) => {
      if (requeue && !raceHosting) throw Error('Pilot racing is paused.');
      if (requeue) await updates?.beforeQueue();
      if (!unrated) await request('result', { ack: r.match_id });
      message.textContent = '';
      profileAt = 0;
      if (!requeue) {
        backToMenu();
        await tick();
        return;
      }
      revision++;
      active = joined = entered = '';
      proto.controller.connection?.dispose();
      window.dispatchEvent(new Event('polycup-return-menu'));
      postgameQueued = true;
      finish.setQueue('Joining queue…', async () => {}, true);
      pollRetry.reset();
      busy = true;
      try {
        render(await request('queue', { action: 'join' }));
        nextIdlePoll = 0;
      } catch (e) {
        postgameQueued = false;
        if (finalView) finish.show(finalView);
        throw e;
      } finally {
        busy = false;
      }
    };
    const winner = r.players.filter((p: any) => p.place === 1 && !p.abandoned);
    const name = winner.length === 1 ? winner[0].display_name : '';
    const nativeTrack = proto.controller.nativeState?.id === r.match_id
      ? proto.controller.nativeState.tracks?.[0] : undefined;
    const resultTrackEntry = proto.controller.availableTracks().find((t: any) => t.id === (r.track_id ?? nativeTrack?.id));
    const resultTrack = resultTrackEntry?.name ??
      nativeTrack?.name;
    finalView = {
      key: r.match_id,
      chat: matchChat(r.match_id),
      ranked: true,
      self: player,
      rows,
      xpGained: own?.xp_gained ?? 0,
      xpBefore: own?.xp_before,
      xpAfter: own?.xp_after,
      unlocks: own?.unlocks,
      title: unrated
        ? 'Match ended'
        : winner.length > 1
          ? 'Draw'
          : name
            ? name + ' wins'
            : 'Match finished',
      subtitle: unrated
        ? 'No rating change'
        : own?.abandoned
          ? 'You conceded or left the match.'
          : (resultTrack ?? ''),
      track: resultTrack,
      trackId: r.track_id ?? nativeTrack?.id,
      trackArt: resultTrackEntry?.thumbnail,
      openTrackRecords: r.track_id || proto.controller.nativeState?.tracks?.[0]?.id ? async () => {
        const track=r.track_id || proto.controller.nativeState?.tracks?.[0]?.id;
        // Keep the postgame screen and any queued search alive underneath records.
        // Closing this modal returns directly to the same result, without an ack
        // or a queue mutation. Match found closes records before taking focus.
        if (proto.ui.openResultTrackRecords?.(track,player,r.season?.id)) return;
        await leave(false);
        proto.ui.openTrackRecords(track,player,r.season?.id);
      } : undefined,
      notice: unrated ? r.reason || 'This match ended without a rated result.' : '',
      actions: [
        { label: 'Back to menu', run: () => leave(false) },
        { label: 'Play again', primary: true, run: () => leave(true) },
      ],
    };
    finish.show(finalView);
    updates?.render();
  }
  find.onclick = () => void action('join');
  cancel.onclick = () => void action('cancel');
  proto.returnFromHostFailure = (error: string) => {
    revision++;
    active = joined = entered = '';
    connecting = false;
    loading.hide();
    dialog.close();
    nextIdlePoll = 0;
    message.textContent = error;
    // Entry's native-menu handoff does not open the integrated hub itself.
    panel.hidden = true;
    showMenu(true);
    void tick();
  };
  async function authenticate() {
    if (live) token = (await proto.ui.account?.accessToken()) || '';
    if (token) {
      try {
        player = (await request('identity')).player;
      } catch (e) {
        token = '';
        if (live) throw e;
      }
    }
    if (!token && !live) {
      const identity = await (await fetch(rankedEndpoint(platform, 'register'), { method: 'POST' })).json();
      token = identity.token;
      player = identity.player;
      localStorage.setItem(tokenKey, token);
    }
    if (!token) {
      status.textContent = inHub
        ? 'Sign in with Discord to play ranked.'
        : 'Sign in to join the test queue';
      find.disabled = true;
      return;
    }
    find.disabled = !raceHosting;
    proto.accountId = player;
  }
  void authenticate()
    .then(() => tick())
    .catch((e) => (message.textContent = e.message));
  async function tick() {
    if (live && player && player !== proto.ui.account?.user?.id) {
      revision++;
      player = '';
      token = '';
      active = '';
      joined = '';
      entered = '';
      inputPolicy = undefined;
      profileOwner = '';
      profileAt = 0;
      badgeBox.replaceChildren(rankBadge(null));
      setStats('— matches', '— win rate');
      resultOpen = false;
      loading.hide();
      dialog.close();
      finish.close();
      garageNames.clear();
      presentations.clear();
      presentationMatch = '';
      dismissedPendingResults.clear();
      postgameQueued = false;
      finalView = undefined;
      proto.queueState = { state: 'idle' };
      proto.controller.connection?.dispose();
      showMenu(true);
      nextIdlePoll = 0;
      pollRetry.reset();
    }
    if (polling || busy) return;
    if (!pollRetry.ready(Date.now())) return;
    if (live && !(finish.isOpen && !resultOpen) && proto.queueState?.state === 'idle' && Date.now() < nextIdlePoll) return;
    const expected = revision;
    polling = true;
    try {
      if (!player) await authenticate();
      if (!player) return;
      const nativeGuard = (window as any).polycupNativeInstance;
      const queued = proto.queueState;
      if (nativeGuard && !nativeGuard.valid() &&
          (queued?.state === 'queued' || (queued?.state === 'matched' && queued.match.status === 'reserved')) &&
          !(await nativeGuard.check())) {
        if (expected !== revision) return;
        const reply = await request('queue', { action: queued.state === 'matched' ? 'decline' : 'cancel' });
        if (expected !== revision) return;
        render(reply);
        message.textContent = 'Search stopped: another PolyCup window is active. Close it before queueing again.';
        return;
      }
      const q = await request('queue', { action: 'poll' });
      if (expected !== revision) return;
      if (message.textContent === pollError) message.textContent = '';
      pollError = '';
      find.disabled = busy;
      render(q);
      nextIdlePoll = q.state === 'idle' && !(finish.isOpen && !resultOpen) ? Date.now() + 5000 : 0;
      if (!live || q.state !== 'matched' || q.match.status === 'review' || finish.isOpen)
        await results();
      pollRetry.reset();
    } catch (e: any) {
      if (expected !== revision) return;
      pollRetry.failed(Date.now(), (finish.isOpen && !resultOpen) || (!!proto.queueState && proto.queueState.state !== 'idle'));
      if (/another window|another instance/i.test(e.message)) {
        status.textContent = 'Restoring ranked session…';
        pollError = 'Waiting for the previous game connection to close.';
        find.disabled = true;
      } else if (
        e.code === '57014' ||
        /statement timeout|canceling statement/i.test(e.message) ||
        ['TimeoutError', 'AbortError', 'TypeError'].includes(e.name)
      ) {
        pollError = 'Ranked is taking longer to respond. Retrying…';
      } else pollError = e.message;
      message.textContent = pollError;
    } finally {
      polling = false;
    }
  }
  setInterval(() => void tick(), 1000);
}
