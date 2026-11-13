import { pmlPlatform, standalonePlatform } from '../../src/client-platform.ts';
import { configureClientAssets } from '../../src/client-assets.ts';
import { configurePmlAccount } from '../../src/account-config.ts';
import { protectTransientDisconnect } from './rtc-recovery.ts';
import { protectGameContextMenu } from './game-context-menu.ts';
// @ts-ignore JavaScript diagnostics have runtime validation.
import { observeFetch, errorLocation, peerSnapshot, diagnosticErrorGate } from './client-diagnostics.mjs';
// @ts-ignore Passive browser rendering diagnostics.
import { observeClientGraphics } from './graphics-diagnostics.mjs';
// @ts-ignore JavaScript timing helpers.
import { timePeerOperations, timeSignalSocket, watchStartupStalls } from './startup-timing.mjs';
import { Controller } from '../../src/controller.ts';
import { nativeRoute, casualSocket } from './native-routing.ts';
import { CupUI } from '../../src/ui.ts';
import { registerCarVisibility, CupTransport } from '../../src/native.ts';
import { installRankedPanel } from './ranked-panel.ts';
import { registerCupMenu, launchNativeRace } from '../../src/native-cup-menu.ts';
import { registerLobbyNavigation } from '../../src/native-lobby.ts';
import { registerNativePlayerList, rankedPlayerList } from '../../src/native-player-list.ts';
import { registerVersionCheck } from '../../src/version-check.ts';
import * as Cup from '../../src/cup.ts';
import { standardPreset } from '../../src/presets.ts';
import { registerStandaloneBranding } from './branding.ts';
import { configureStandaloneAccount } from '../../src/account-config.ts';
import { startupRequest } from './startup-requests.ts';
import { installNativeInstanceRecovery } from './native-instance.ts';
import { rankedRoomIsActive } from './room-watch.ts';
// This entry is built only by the local prototype builder, never the PML release.
const w = window as any;
w.polycupBoot && (w.polycupBoot.entered = true);
w.polycupBoot?.stage('configuration');
const externalPml = w.polycupPml;
const platform = externalPml ? pmlPlatform(externalPml.environment) : standalonePlatform(location.origin);
const serviceOrigin = platform.serviceOrigin;
const serviceURL = (path: string) => externalPml ? new URL(path, serviceOrigin).href : path;
const shellMode = await startupRequest<any>(serviceURL('/mode'), { json: true, timeoutMs: 8000 });
if (!shellMode || typeof shellMode.ranked !== 'boolean') throw Error('Invalid startup configuration');
const useHub =
  (externalPml || w.polycupClientShell === 'hub') &&
  shellMode.ranked &&
  !new URL(location.href).searchParams.has('host');
if (useHub && shellMode.account) {
 if(externalPml){configurePmlAccount(shellMode.account,serviceOrigin);configureClientAssets(serviceOrigin);}
 else configureStandaloneAccount(shellMode.account);
}
if (useHub && shellMode.environment === 'pilot') {
  const label = document.createElement('div');
  label.className = 'polycup-environment-label';
  label.textContent = 'Pilot · test progress only';
  label.setAttribute('role', 'note');
  document.body.append(label);
}
// Skip the base game's tutorial; players enter PolyCup from the main menu.
if ((useHub || (new URL(location.href).searchParams.has('host') || new URL(location.href).searchParams.has('camera-editor'))) && !localStorage.getItem('polytrack_v5_prod_startup_info'))
  localStorage.setItem(
    'polytrack_v5_prod_startup_info',
    JSON.stringify({ lastVersion: '0.6.3', isTutorialCompleted: true }),
  );
// Preloaded hosts must not animate the menu while waiting for an assignment.
// Retain callbacks so resuming does not break native render-loop ownership.
const nativeRaf = w.requestAnimationFrame.bind(w),
  nativeCancelRaf = w.cancelAnimationFrame.bind(w);
const parkedFrames = new Map<number, FrameRequestCallback>();
let parkedId = 0;
w.requestAnimationFrame = (callback: FrameRequestCallback) => {
  if (w.polycupStandby) {
    const id = --parkedId;
    parkedFrames.set(id, callback);
    return id;
  }
  return nativeRaf((at: number) => {
    if (w.polycupStandby) parkedFrames.set(--parkedId, callback);
    else callback(at);
  });
};
w.cancelAnimationFrame = (id: number) => (id < 0 ? parkedFrames.delete(id) : nativeCancelRaf(id));
w.setHostStandby = (paused: boolean) => {
  w.polycupStandby = paused;
  if (!paused) {
    const callbacks = [...parkedFrames.values()];
    parkedFrames.clear();
    for (const cb of callbacks) nativeRaf(cb);
  }
};
let roomId = new URL(location.href).searchParams.get('room') ?? '';
const bootAt = performance.now();
const diagnosticClient = crypto.randomUUID();
const diagnosticFetch = w.fetch.bind(w);
let diagnosticContext = (): Record<string, unknown> => ({});
const allowDiagnostic = diagnosticErrorGate();
const report = (event: string, detail: any = {}) => {
  if (!roomId || !allowDiagnostic(roomId, event, detail)) return;
  void diagnosticFetch(serviceURL('/diagnostics'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(w.polycupNetwork?.diagnosticToken
        ? { 'x-polycup-diagnostic': w.polycupNetwork.diagnosticToken }
        : {}),
    },
    body: JSON.stringify({
      room: roomId,
      event,
      client: diagnosticClient,
      elapsedMs: Math.round(performance.now() - bootAt),
      online: navigator.onLine,
      hidden: document.hidden,
      ...diagnosticContext(),
      ...detail,
    }),
    ...(event === 'page_hidden' ? {keepalive:true} : {}),
  }).catch(() => {});
};
let stopStartupTiming = () => {};
w.polycupStartupStage = (phase: string) => report('stage', {phase});
const startStartupTiming = () => {
  stopStartupTiming();
  stopStartupTiming = watchStartupStalls(report);
};
w.addEventListener('error', (e: ErrorEvent) => report('client_error', { message: e.message, location:errorLocation(e.error) }));
w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
  report('client_rejection', { message: String(e.reason?.message ?? e.reason), location:errorLocation(e.reason) }),
);
w.addEventListener('offline', () => report('network_offline'));
w.addEventListener('online', () => report('network_online'));
w.addEventListener('pagehide', () => report('page_hidden'));
document.addEventListener('visibilitychange', () => report('visibility', { hidden: document.hidden }));
if (!new URL(location.href).searchParams.has('host')) observeClientGraphics(report, {
  room: () => roomId,
  active: () => ['loading', 'warmup', 'countdown', 'racing'].includes(String(diagnosticContext().cupPhase)),
});
const NativePeer = w.RTCPeerConnection;
const NativeSocket = w.WebSocket;
const nativeFetch = w.fetch.bind(w),
  nativeOpen = w.XMLHttpRequest.prototype.open;
const observedFetch = observeFetch(nativeFetch, report, {origin:serviceOrigin, room:()=>roomId});
const routeNative = (raw: string) => {
 const url=new URL(raw,document.baseURI);
 if(externalPml){
  const owns=!!w.polycupPrototype?.controller?.room || !!w.polycupPrototype?.rankedMatch;
  if(owns && url.origin==='https://vps.kodub.com' && (/^\/v6\/multiplayer\//.test(url.pathname)||url.pathname==='/v6/iceServers')){
   const target=new URL(serviceOrigin);url.host=target.host;url.protocol=target.protocol;
  }
  return url.href;
 }
 return nativeRoute(url.href,serviceOrigin,shellMode.nativeOrigin,!!w.polycupCasual&&!w.polycupCasualNetwork);
};
w.fetch = (input: any, init: any) => {
  const original = input instanceof Request ? input.url : String(input);
  const next = routeNative(original);
  return observedFetch(
    next === new URL(original, document.baseURI).href
      ? input
      : input instanceof Request
        ? new Request(next, input)
        : next,
    init,
  );
};
w.XMLHttpRequest.prototype.open = function (...args: any[]) {
  args[1] = routeNative(String(args[1]));
  return nativeOpen.apply(this, args);
};
w.WebSocket = new Proxy(NativeSocket, {
  construct(Type, args) {
    const url = new URL(
      externalPml ? (()=>{const u=new URL(String(args[0]));if((!!w.polycupPrototype?.controller?.room||!!w.polycupPrototype?.rankedMatch)&&u.host==='vps.kodub.com'&&/^\/v6\/multiplayer\/(host|join)$/.test(u.pathname)){const target=new URL(serviceOrigin);u.host=target.host;u.protocol='wss:';}return u.href;})() : casualSocket(String(args[0]), serviceOrigin, shellMode.nativeOrigin, !!w.polycupCasual && !w.polycupCasualNetwork),
    );
    args[0] = url.href;
    if (
      url.host === new URL(serviceOrigin).host &&
      /\/multiplayer\/(host|join)$/.test(url.pathname) &&
      w.polycupNetwork?.token
    ) {
      url.searchParams.set('ticket', w.polycupNetwork.token);
      args[0] = url.href;
    }
    const socket = new Type(...args);
    if (/\/multiplayer\/(host|join)$/.test(url.pathname))
      timeSignalSocket(socket, report, crypto.randomUUID());
    return socket;
  },
});
w.RTCPeerConnection = new Proxy(NativePeer, {
  construct(Type, args) {
    const configure = (config: any) =>
      w.polycupNetwork && (!w.polycupCasual || w.polycupCasualNetwork)
        ? {
            ...config,
            iceServers: w.polycupNetwork.iceServers,
            iceTransportPolicy: w.polycupNetwork.iceTransportPolicy,
          }
        : config;
    if(externalPml && !w.polycupCasual && !w.polycupPrototype?.rankedMatch) return new Type(...args);
    args[0] = configure(args[0]);
    const pc = new Type(...args);
    pc.polycupDiagnosticId = crypto.randomUUID();
    timePeerOperations(pc, report);
    const set = pc.setConfiguration.bind(pc);
    pc.setConfiguration = (config: any) => set(configure(config));
    report('stage', { phase: 'rtc_created', span: pc.polycupDiagnosticId });
    pc.addEventListener('connectionstatechange', () =>
      report('stage', { phase: 'rtc_' + pc.connectionState, span: pc.polycupDiagnosticId }),
    );
    pc.addEventListener('iceconnectionstatechange', () =>
      report('stage', { phase: 'ice_' + pc.iceConnectionState, span: pc.polycupDiagnosticId }),
    );
    const sampledStates = new Set<string>();
    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      if (!['connected','disconnected','failed','closed'].includes(state) || sampledStates.has(state)) return;
      sampledStates.add(state);
      void peerSnapshot(pc).then((detail: any) => report('peer_snapshot', {span:pc.polycupDiagnosticId,...detail})).catch(()=>{});
    });
    const rankedLease = w.polycupPrototype?.rankedMatch?.lease;
    if (w.polycupNetwork && (!w.polycupCasual || w.polycupCasualNetwork))
      protectTransientDisconnect(pc, phase => {
        report('stage', { phase, span: pc.polycupDiagnosticId });
        if (rankedLease && w.polycupPrototype?.rankedMatch?.lease === rankedLease && w.polycupPrototype.dedicated && phase === 'rtc_recovering')
          w.polycupPrototype.controller.allowFinishRecovery();
        if (rankedLease && w.polycupPrototype?.rankedMatch?.lease === rankedLease && !w.polycupPrototype.dedicated)
          window.dispatchEvent(new CustomEvent('polycup-ranked-transport', {detail:{phase, peer:pc}}));
      });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && rankedLease && w.polycupPrototype?.rankedMatch?.lease === rankedLease && !w.polycupPrototype.dedicated)
        window.dispatchEvent(new CustomEvent('polycup-ranked-transport', {detail:{phase:'rtc_recovery_expired',peer:pc}}));
    });
    const create = pc.createDataChannel.bind(pc);
    pc.createDataChannel = (...params: any[]) => {
      let channel;
      try { channel = create(...params); }
      catch (error: any) {
        report('client_error', { message: `Data channel ${params[1]?.id ?? '?'} (${String(params[0]).slice(0,48)}): ${error?.name}; RTC=${pc.connectionState}, ICE=${pc.iceConnectionState}, SCTP=${pc.sctp?.state ?? 'none'}` });
        throw error;
      }
      if (params[0] === 'reliable') {
        channel.addEventListener('open', () => report('stage', { phase: 'reliable_open', span: pc.polycupDiagnosticId }));
        channel.addEventListener('message', () => report('stage', { phase: 'native_first_message', span: pc.polycupDiagnosticId }), {once:true});
        channel.addEventListener('close', () => report('stage', {phase:'reliable_closed',span:pc.polycupDiagnosticId}));
        channel.addEventListener('error', () => report('stage', {phase:'reliable_error',span:pc.polycupDiagnosticId}));
      }
      return channel;
    };
    return pc;
  },
});
const globals: { token: string; func: string }[] = [];
const runtime: any = {
  polyVersion: '0.6.3',
  globals,
  attachPml(loader: any, insert: number) {
    for (const name of ['getFromPolyTrack', 'registerClassMixin', 'registerFuncMixin'])
      runtime[name] = (...args: any[]) =>
        loader[name](
          ...args.map((arg) =>
            arg && typeof arg === 'object' && 'func' in arg ? { ...arg, type: insert } : arg,
          ),
        );
    for (const patch of globals) loader.registerGlobalMixin({ ...patch, type: insert });
    loader.registerSettingCategory('PolyCup');
    loader.registerSetting('Show opponents', 'PolyCupShowOpponents', 'boolean', true);
    runtime.loader = loader;
  },
  registerGlobalMixin(m: any) {
    globals.push(m);
  },
  getFromPolyTrack(_source: string) {
    throw Error('Game adapter not initialized');
  },
  registerClassMixin(scope: string, method: string, m: any) {
    const original = runtime.getFromPolyTrack(scope)[method].toString();
    if (!original.includes(m.token)) throw Error('Unsupported native method: ' + method);
    let text = original.replace(m.token, m.token + m.func);
    if (!/^(async\s+)?function\b/.test(text))
      text = text.startsWith('async ')
        ? text.replace('async ', 'async function ')
        : 'function ' + text;
    runtime.getFromPolyTrack(`${scope}[${JSON.stringify(method)}]=(${text})`);
  },
  registerFuncMixin(path: string, m: any) {
    const old = runtime.getFromPolyTrack(path).toString();
    if (!old.includes(m.token)) throw Error('Unsupported native function');
    runtime.getFromPolyTrack(`${path}=(${old.replace(m.token, m.token + m.func)})`);
  },
  init() {
    // Native settings enums have no PML extension fields in this build.
    const access = runtime.getFromPolyTrack;
    runtime.getFromPolyTrack = (source: string) =>
      access(
        source
          .replace(
            "ua.get(g).getKeyBindings(ge.A.PolyCupChat).map(key=>key ? ve(key) : '').filter(Boolean)",
            "['KeyY']",
          )
          .replace(
            "ua.get(g).getKeyBindings(ge.A.PolyCupToggleGhosts).map(key=>key ? ve(key) : '').filter(Boolean)",
            "['KeyG']",
          )
          .replace('ua.get(g).getSettingBoolean(P.A.PolyCupAutoSpectate)', 'true'),
      );
    registerVersionCheck(runtime, 0);
    class StandaloneController extends Controller {
      protected override rankedChatKey(id: number) {
        const account = w.polycupPrototype?.bindings?.get(id);
        return account ? 'ranked:' + account : super.rankedChatKey(id);
      }
      override get ranked() {
        return !!w.polycupPrototype?.rankedMatch || super.ranked;
      }
    }
    const c = new StandaloneController(() => {
      if (w.polycupDedicatedIdleGame && w.polycupPrototype?.dedicated) return;
      w.polycupPrototype?.ui?.render();
    });
    w.polycupPrototype = { controller: c, runtime, launchNativeRace, Cup, standardPreset };
    const isDrivingGame = runtime.getFromPolyTrack('(g)=>g instanceof Is && !Xa.get(g)?.isPaused');
    protectGameContextMenu(() => !document.querySelector('dialog[open]') && !!isDrivingGame(runtime.menuGame()));
    w.polycupPrototype.visibleNativePlayers = (connection: any, players: any[]) =>
      rankedPlayerList(connection, players, c.connection,
        w.polycupPrototype?.rankedMatch ? c.nativeState?.roster.map(player => player.id) : null);
    diagnosticContext = () => ({
      cupPhase:c.nativeState?.phase ?? 'menu', round:c.nativeState?.runtime?.round ?? 0,
      nativeId:c.localPlayerId, peers:c.lobby.length,
      trackId:c.nativeState?.runtime?.trackId, sessionId:c.nativeState?.runtime?.sessionId,
    });
    const practiceTrack=runtime.getFromPolyTrack('(game)=>Sa.get(game)?.name??""');
    w.polycupPrototype.practiceTrack=()=>practiceTrack(runtime.menuGame());
    c.init(runtime);
    if(externalPml?.physics) c.setPhysicsSource(()=>externalPml.physics.report);
    const pendingStartup: { phase: string; durationMs: number; peers: number }[] = [];
    c.setStartupObserver((phase, detail) => {
      if (phase === 'handoff_start') pendingStartup.length = 0;
      const snapshot = c.room?.snapshot;
      const expected = snapshot?.data.launch
        ? `casual:${snapshot.id}:${snapshot.data.launch.id}` : '';
      // Admission authorizes diagnostics. Retain earlier preparation timings
      // until that lease exists, and never attribute a retry to the old launch.
      if (w.polycupCasual && expected && expected !== roomId) {
        if (pendingStartup.length < 48) pendingStartup.push({ phase, ...detail });
        return;
      }
      report('stage', { phase, ...detail, message: `peers=${detail.peers}` });
    });
    if(shellMode.casualSignalling){
      let renewing=false;
      const admit=async(signal?:AbortSignal)=>{
        const room=c.room;
        if(!room || room.ranked || !room.snapshot?.data.launch) return;
        const auth=await room.connectionSession();
        const response=await observedFetch(serviceURL('/casual/admission'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.token},body:JSON.stringify({room:auth.room,instance:auth.instance,launch:auth.launch}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
        const value=await response.json();
        if(!response.ok) throw Error(value.error || 'Could not prepare the Cup connection.');
        if(c.room!==room || room.snapshot?.data.launch?.id!==auth.launch) throw Error('The Cup connection changed.');
        roomId=`casual:${auth.room}:${auth.launch}`;
        w.polycupNetwork=value.network;
        w.polycupCasualNetwork=true;
        for (const detail of pendingStartup.splice(0))
          report('stage', { ...detail, message: `peers=${detail.peers}` });
      };
      c.beforeWaitingRaceConnect=admit;
      setInterval(()=>{if(renewing || !w.polycupCasualNetwork || !c.room?.snapshot?.data.launch)return;renewing=true;void admit().catch(()=>{}).finally(()=>{renewing=false;});},10000);
    }
    const panel = document.createElement('div');
    panel.id = 'prototype-menu';
    const hubOptions = useHub
      ? {
          rankedActivity: panel,
          rankedActive: () =>
            !!w.polycupPrototype?.queueBusy ||
            (w.polycupPrototype?.queueState?.state !== 'idle' && !!w.polycupPrototype?.queueState),
          localPreview: !shellMode.live,
          casualAvailable: !!(shellMode.casualSignalling || shellMode.nativeOrigin),
          beforeCasual: () => {
            if (
              w.polycupPrototype?.queueState?.state &&
              w.polycupPrototype.queueState.state !== 'idle'
            )
              throw Error('Leave ranked before joining a casual Cup.');
            w.polycupPrototype.resetRankedConnection();
            w.polycupCasual = true;
            w.polycupCasualNetwork = false;
            w.polycupNetwork = undefined;
          },
        }
      : {};
    w.polycupPrototype.ui = new CupUI(c, hubOptions);
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.code === 'KeyY') w.polycupPrototype.ui.chatHotkey(event);
      if (event.code === 'KeyG') w.polycupPrototype.ui.ghostHotkey(event);
    });
    w.polycupPrototype.ui.render();
    c.setFinishObserver((phase, detail) => report('stage', { phase, ...detail }));
    const fail = c.fail.bind(c);
    c.fail = (e: any) => {
      report('controller_error', { message: e?.message ?? String(e), errorName:e?.name, location:errorLocation(e) });
      return fail(e);
    };
    const disposed = c.connectionDisposed.bind(c);
    c.connectionDisposed = connection => {
      if (c.connection === connection) report('connection_disposed');
      return disposed(connection);
    };
    const kick = c.kickPlayer.bind(c);
    c.kickPlayer = id => {
      report('kick_requested', {target:id});
      const result = kick(id);
      Promise.resolve(result).then(()=>report('kick_applied',{target:id}),()=>{});
      return result;
    };
    let last = '';
    setInterval(() => {
      const state = c.nativeState;
      const key = JSON.stringify([state?.phase, state?.runtime?.round, c.error, c.lobby.length]);
      if (key !== last) {
        last = key;
        if (state?.phase === 'racing' || state?.phase === 'complete' || c.error) stopStartupTiming();
        report('stage', {
          phase: state?.phase ?? 'menu',
          round: state?.runtime?.round ?? 0,
          peers: c.lobby.length,
        });
      }
    }, 500);
    const proto = w.polycupPrototype;
    proto.bindings = new Map();
    const admissionChannel = new CupTransport(
      (id, message: any) => {
        if (
          !proto.dedicated &&
          id === 0 &&
          message.type === 'room-members' &&
          Array.isArray(message.members) &&
          message.members.length <= 12
        ) {
          proto.bindings = new Map(
            message.members.filter(
              (p: any) =>
                Array.isArray(p) && Number.isSafeInteger(p[0]) && typeof p[1] === 'string',
            ),
          );
          return;
        }
        if (
          !proto.dedicated ||
          message.type !== 'room-ticket' ||
          message.launch !== proto.rankedMatch?.lease
        )
          return;
        if (proto.bindingPending?.has(id) || proto.bindings.has(id)) return;
        proto.bindingPending ??= new Set();
        proto.bindingPending.add(id);
        void w
          .__hostBind(message.ticket, id)
          .then((binding: any) => {
            proto.bindings.set(id, binding.player);
            if (binding.previous !== null && binding.previous !== id)
              c.verifiedRankedReconnect(binding.previous, id);
            report('racer_joined');
          })
          .catch(() => {})
          .finally(() => proto.bindingPending.delete(id));
      },
      () => {},
      { channelId: 44 },
    );
    setInterval(() => {
      if (!proto.rankedMatch || !c.connection) return;
      admissionChannel.sync(c.native.peers(c.connection));
      if (proto.dedicated) {
        const members = [...proto.bindings.entries()].filter(([id]) =>
          c.lobby.some((p) => p.id === id),
        );
        if (Date.now() - (proto.lastIdentityBroadcast ?? 0) > 1000) {
          proto.lastIdentityBroadcast = Date.now();
          for (const p of c.native.peers(c.connection))
            if (proto.bindings.has(p.id))
              admissionChannel.send(p.id, { type: 'room-members', members } as any);
        }
      }
      if (!proto.dedicated && proto.rankedTicket)
        admissionChannel.send(0, {
          type: 'room-ticket',
          launch: proto.rankedMatch.lease,
          ticket: proto.rankedTicket,
        });
    }, 200);
    const fastHosts = new WeakSet<object>();
    const immediateCupSessions = (connection: any) => {
      if (fastHosts.has(connection)) return;
      fastHosts.add(connection);
      const normal = connection.startNewSession.bind(connection);
      connection.startNewSession = (...args: any[]) => {
        // Keep EndSession and ordered track transfer; PolyCup owns readiness/countdown.
        normal(...args);
        connection.startNewSessionImmediate(...args);
      };
    };
    const observe = c.observeGame.bind(c);
    // Experimental server-only spectator loop bypass. Native connection callbacks,
    // Cup's 100-ms clock and recording transport stay live; racers never use it.
    const normalGameUpdate = (c.native.Game as any).prototype.update;
    (c.native.Game as any).prototype.update = function (...args: any[]) {
      if (w.polycupDedicatedIdleGame && proto.dedicated && proto.hostNativeReady) {
        c.observeGame(this);
        w.polycupSkippedGameUpdates = (w.polycupSkippedGameUpdates || 0) + 1;
        return;
      }
      return normalGameUpdate.apply(this, args);
    };
    c.observeGame = (game: any) => {
      observe(game);
      if (w.polycupCasualNetwork && c.connection instanceof c.native.Host)
        immediateCupSessions(c.connection);
      if (proto.dedicated && c.info?.connection) {
        const renderer = c.native.renderer(game);
        renderer.update = () => {};
      }
    };
    const receive = c.receive.bind(c);
    c.receive = (id: any, m: any) => {
      if (proto.dedicated && proto.rankedMatch && m.type !== 'hello' && !proto.bindings.has(id))
        return;
      if (
        proto.dedicated &&
        proto.rankedMatch &&
        ['join', 'leave', 'ban', 'pick', 'remove-pick', 'draft-ready'].includes(m.type)
      )
        return;
      if (m.type === 'hello-ack') proto.handshake = true;
      return receive(id, m);
    };
    const normalRecord = c.native.worldRecord,
      normalBest = c.native.personalBest,
      normalUploads = c.native.leaderboardUploads;
    proto.resetRankedConnection = () => {
      proto.rankedConnectAbort?.abort();
      proto.rankedConnectAbort = null;
      if (!proto.rankedMatch) return;
      admissionChannel.dispose();
      proto.rankedMatch = null;
      proto.rankedTicket = null;
      proto.bindings.clear();
      proto.bindingPending?.clear();
      proto.handshake = false;
      proto.failedShown = false;
      proto.settledResult = null;
      roomId = '';
      c.native.worldRecord = normalRecord;
      c.native.personalBest = normalBest;
      c.native.leaderboardUploads = normalUploads;
      const connection = c.connection;
      if (connection) {
        c.captureReplayRun(true);
        connection.dispose();
        c.connectionDisposed(connection);
        window.dispatchEvent(new Event('polycup-return-menu'));
      }
    };
    proto.setRoom = (id: string) => (roomId = id);
    proto.prepare = (fixture = false) => {
      if (fixture) {
        const tracks = runtime.getFromPolyTrack(
          `(()=>{const Sun=i(7929).A;return Array.from({length:16},(_,index)=>{const t=new Ul.A(0,new Sun());const finish=-24-index*4;t.addPart(0,0,0,5,0,0,0,null,0);for(let z=-4;z>finish;z-=4)t.addPart(0,0,z,0,0,0,0,null,null);t.addPart(0,0,finish,6,0,0,0,null,null);return {trackData:t,trackMetadata:{name:'Local physics test '+index,author:'PolyCup QA',lastModified:null}};});})()`,
        );
        c.availableTracks = () =>
          tracks.map((t: any) => ({
            id: t.trackData.getId(),
            name: t.trackMetadata.name,
            category: 'official',
            thumbnail: '',
            load: async () => t,
          }));
      }
      // Real tracks on the live service retain native WR/PB reads. Generated
      // fixtures and the offline prototype must stay isolated from leaderboards.
      c.native.worldRecord = !fixture && shellMode.live
        ? normalRecord : async () => ({ status: 'unavailable' });
      c.native.personalBest = !fixture && shellMode.live
        ? normalBest : async () => ({ status: 'unavailable' });
      // Real player runs keep native upload eligibility and the Cup's upload
      // setting. Dedicated spectators and synthetic/offline runs never submit.
      c.native.leaderboardUploads = !fixture && shellMode.live && !proto.dedicated
        ? normalUploads
        : (game: any) => runtime.getFromPolyTrack('(g)=>ya.set(g,false)')(game);
    };
    proto.host = async (id: string, fixture = false, assignment: any = null) => {
      roomId = id;
      proto.dedicated = true;
      proto.hostNativeReady = false;
      proto.rankedMatch = assignment;
      proto.prepare(fixture);
      const entries = c
        .availableTracks()
        .filter((t: any) => ['official', 'community'].includes(t.category));
      const chosen = assignment
        ? entries.find((t: any) => t.id === assignment.match.selected_track)
        : (entries.find((t: any) => t.name === 'Summer 1') ?? entries[0]);
      if (!chosen) throw Error('Assigned ranked track is not installed.');
      const track = await chosen.load();
      proto.selectedTrack = track;
      report('stage', { phase: 'host_native_connect' });
      if (c.connection) window.dispatchEvent(new Event('polycup-return-menu'));
      await launchNativeRace('host', new AbortController().signal, track);
      c.create('Dedicated prototype ' + id.slice(0, 6));
      const preset = standardPreset();
      Object.assign(preset.rules, {
        selection: 'random',
        singleTrack: true,
        bansPerRacer: 0,
        picksPerRacer: 0,
        pointsToWin: 30,
        points: [10, 7, 4, 2, 0, 0, 0, 0],
        roundsPerTrack: 3,
        warmup: 'first-visit',
        warmupTiming: 'fixed',
        warmupSeconds: fixture ? 10 : 30,
        roundBreakSeconds: fixture ? 3 : 5,
        finishTimeoutSeconds: 10,
        uploadLeaderboardTimes: false,
      });
      c.setPreset(preset);
      if (assignment) {
        for (const key of Object.keys(preset.rules))
          if (assignment.match.rules[key] !== undefined)
            (preset.rules as any)[key] = assignment.match.rules[key];
        preset.rules.uploadLeaderboardTimes = false;
        c.setPreset(preset);
      }
      // Freeze this room's track. The host is never added to the roster.
      c.availableTracks = () => [
        {
          id: track.trackData.getId(),
          name: track.trackMetadata.name,
          category: 'official',
          thumbnail: '',
          load: async () => track,
        },
      ];
      c.connection!.renewInvite();
      if (assignment) immediateCupSessions(c.connection);
      proto.hostNativeReady = true;
      report('host_ready');
    };
    proto.beginRanked = async (members: any[]) => {
      const assignment = proto.rankedMatch,
        preset = standardPreset();
      for (const key of Object.keys(preset.rules))
        if (assignment.match.rules[key] !== undefined)
          (preset.rules as any)[key] = assignment.match.rules[key];
      preset.rules.uploadLeaderboardTimes = false;
      const state = Cup.newCup('Ranked · Season 0', preset);
      state.id = assignment.match.id;
      state.roster = members.map((m) => ({
        id: m.native,
        name: c.lobby.find((p) => p.id === m.native)?.nickname ?? 'Racer',
      }));
      const track = proto.selectedTrack;
      state.tracks = [{ id: track.trackData.getId(), name: track.trackMetadata.name }];
      state.draft = { stage: 'picks', order: state.roster.map((p) => p.id), bans: {} };
      const loadedSession = c.gameInfo.sessionId;
      await c.acceptWaitingRace(state, new Map([[track.trackData.getId(), track]]), true);
      report('stage', { phase: c.nativeState?.runtime?.sessionId === loadedSession
        ? 'ranked_session_reused' : 'ranked_session_restarted' });
    };
    proto.joinRanked = async (admission: any) => {
      if (c.waitingRoom) throw Error('Leave your casual Cup before joining ranked.');
      proto.resetRankedConnection();
      w.polycupCasual = false;
      w.polycupNetwork = admission.network;
      proto.rankedMatch = { lease: admission.launch };
      proto.rankedTicket = admission.ticket;
      roomId = admission.match;
      proto.failedShown = false;
      proto.prepare();
      startStartupTiming();
      report('stage', { phase: 'client_native_connect' });
      if (c.connection) window.dispatchEvent(new Event('polycup-return-menu'));
      const abort = new AbortController();
      proto.rankedConnectAbort = abort;
      try { await launchNativeRace('join', abort.signal, undefined, admission.code); }
      finally { if (proto.rankedConnectAbort === abort) proto.rankedConnectAbort = null; }
      report('native_connected');
      document.getElementById('prototype-menu')?.setAttribute('hidden', '');
    };
    proto.join = async (id: string, code: string) => {
      roomId = id;
      proto.failedShown = false;
      proto.handshake = false;
      proto.prepare();
      window.dispatchEvent(new Event('polycup-return-menu'));
      await new Promise((r) => setTimeout(r, 1000));
      await launchNativeRace('join', new AbortController().signal, undefined, code);
      report('native_connected');
      for (let n = 0; n < 100 && !c.nativeState; n++) await new Promise((r) => setTimeout(r, 100));
      if (!c.nativeState) throw Error('Host state did not arrive');
      for (let n = 0; n < 100 && !proto.handshake; n++)
        await new Promise((r) => setTimeout(r, 100));
      if (!proto.handshake) throw Error('Host handshake did not complete');
      if (c.nativeState.phase === 'registration') await c.action('join');
      report('racer_joined');
      document.getElementById('prototype-menu')?.setAttribute('hidden', '');
    };
    if(new URL(location.href).searchParams.has('camera-editor') && !shellMode.live){
      proto.ready=true;
      const opening=setInterval(()=>{if(!runtime.menuDebug?.().loaded||runtime.menuDebug().transition)return;clearInterval(opening);void import('./camera-editor.ts').then(m=>m.installCameraEditor(proto));},100);
      return;
    }
    if(!new URL(location.href).searchParams.has('host'))void import('./camera-intro.ts').then(m=>m.installCameraIntros(proto));
    if (!useHub)
      panel.style.cssText =
        'position:fixed;top:16px;left:16px;z-index:99999;background:#1b2342;color:white;padding:16px;font:16px sans-serif;max-width:440px;border-top:4px solid #ffd76b';
    panel.innerHTML =
      '<b>PolyCup standalone — local prototype</b><p>Dedicated spectator hosts. Local test results only.</p><button id="prototype-create">Create match</button><div id="prototype-rooms"></div><div id="prototype-error" role="status" aria-live="polite"></div><small>PolyTrack by Kodub · Local QA build</small>';
    if (!useHub) document.body.append(panel);
    void Promise.resolve(shellMode).then((mode) => {
      proto.secured = mode.secured;
      proto.modeReady = true;
      if (mode.ranked && !new URL(location.href).searchParams.has('host'))
        installRankedPanel(proto, panel, report, mode.live, useHub, platform);
    });
    const style = document.createElement('style');
    style.textContent =
      '#prototype-menu button{padding:8px 12px;margin:4px;border:0;background:#ffd76b;color:#17213d;cursor:pointer}#prototype-menu button:disabled{opacity:.5;cursor:wait}#prototype-error{margin:8px 0;line-height:1.4}#prototype-menu small{color:#aebed8}';
    document.head.append(style);
    let busy = false;
    const act = async (message: string, action: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      panel.querySelector('#prototype-error')!.textContent = message;
      panel.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        await action();
        panel.querySelector('#prototype-error')!.textContent = '';
      } catch (e: any) {
        panel.querySelector('#prototype-error')!.textContent = e.message;
      } finally {
        busy = false;
        panel.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    };
    panel.querySelector('#prototype-create')!.addEventListener('click', async () => {
      await act('Starting a dedicated host…', async () => {
        const r = await fetch('/rooms', { method: 'POST' });
        const room = await r.json();
        if (!r.ok) throw Error(room.error);
        await proto.join(room.id, room.code);
      });
    });
    let listingRooms = false, deniedStatusRoom = '';
    const list = async () => {
      if (listingRooms) return;
      listingRooms = true;
      const watchedRoom = roomId;
      try {
        if (!proto.modeReady || w.polycupCasual || new URL(location.href).searchParams.has('host')) return;
        const rooms = proto.secured
          ? !proto.dedicated && watchedRoom !== deniedStatusRoom && proto.rankedRequest &&
                rankedRoomIsActive(watchedRoom, proto.queueState, c.nativeState?.phase)
            ? [await proto.rankedRequest('room-status', { match: watchedRoom })]
            : []
          : await (await fetch('/rooms')).json();
        if (roomId !== watchedRoom) return;
        const current = rooms.find((r: any) => r.id === watchedRoom);
        if (!proto.dedicated && current?.status === 'failed' && !proto.failedShown) {
          proto.failedShown = true;
          report('host_failure_observed');
          c.connection?.dispose();
          window.dispatchEvent(new Event('polycup-return-menu'));
          const error = current.error + ' Reference: ' + current.id.slice(0, 8);
          if (proto.returnFromHostFailure) proto.returnFromHostFailure(error);
          else {
            panel.removeAttribute('hidden');
            panel.querySelector('#prototype-error')!.textContent = error;
          }
        }
        const box = panel.querySelector('#prototype-rooms')!;
        box.replaceChildren();
        for (const room of rooms.filter((r: any) => r.status === 'waiting')) {
          const b = document.createElement('button');
          b.disabled = busy;
          b.textContent = 'Join ' + room.id.slice(0, 6) + ' (' + room.racers + ' racers)';
          b.onclick = () =>
            void act('Connecting to the match…', () => proto.join(room.id, room.code));
          box.append(b);
        }
      } catch (error: any) {
        // Abandonment/expired access is terminal for this status watch. Do not
        // hammer admission every three seconds after the server has rejected it.
        if (roomId === watchedRoom && /^Ranked admission unavailable\.?$/.test(error?.message ?? '')) deniedStatusRoom = watchedRoom;
      } finally { listingRooms = false; }
    };
    setInterval(list, 3000);
    void list();
    report('game_initialized');
    w.polycupPrototype.ready = true;
  },
};
w.polycupRuntime = runtime;
installNativeInstanceRecovery(runtime, 0, report);
registerCarVisibility(runtime, 0);
registerLobbyNavigation(runtime, 0);
registerNativePlayerList(runtime, 0);
registerCupMenu(runtime, 0, !externalPml);
if(!externalPml) registerStandaloneBranding(runtime, 0);
runtime.registerGlobalMixin({
  type: 0,
  token: '"Are you sure you want to quit?",\n                        )),',
  func: `(e=window.polycupPrototype?.sprintInProgress?.() ? 'Leave this ranked match?\\n\\nLeaving or disconnecting counts as a loss.' : e),`,
});
globals.push({
  token: 'ee = 0;',
  func: `window.polycupRuntime.menuDebug=()=>({loaded:t.hasLoaded(),transition:o.isTransitioning,type:$?.constructor?.name,native:!!Za.get($)?.multiplayerConnection});window.polycupRuntime.menuGame=()=> $;`,
});
if(externalPml){
 runtime.attachPml(externalPml.loader,externalPml.insert);
} else {
const usesPml = w.polycupClientRuntime === 'pml';
w.polycupBoot?.stage('game');
let game = await startupRequest<string>(usesPml ? './pml-game-source.js' : './game-source.js');
game = game
  .replaceAll('https://vps.kodub.com', location.origin)
  .replaceAll('wss://vps.kodub.com', location.origin.replace('http', 'ws'));

function insert(token: string, code: string) {
  if (game.split(token).length !== 2) throw Error('Unsupported game marker: ' + token.slice(0, 70));
  game = game.replace(token, token + code);
}
if (!usesPml) {
  insert(
    '(p.insertStyleElement = h()));',
    'window.polycupRuntime.getFromPolyTrack=(source)=>eval(source);',
  );
  for (const patch of globals) insert(patch.token, patch.func);
  // All native declarations exist before initialization starts.
  const start = '((M.ppV.enabled = !1),';
  if (!game.includes(start)) throw Error('Native boot marker missing');
  game = game.replace(start, 'window.polycupRuntime.init();' + start);
  // Advertise a fixed compatible build; there is no arbitrary mod loader.
  game = game.replaceAll('mods: [],', 'mods: ["polytrack-world-cup:0.4.1"],');
} else {
  // Blob module imports resolve explicitly against this pinned local build.
  game = game
    .replaceAll(
      "'./PolyModLoader.js'",
      JSON.stringify(new URL('PolyModLoader.js', document.baseURI).href),
    )
    .replaceAll("'./PolyTypes.js'", JSON.stringify(new URL('PolyTypes.js', document.baseURI).href));
}
const script = document.createElement('script');
if (usesPml) script.type = 'module';
script.src = URL.createObjectURL(new Blob([game], { type: 'text/javascript' }));
script.onerror = () => w.polycupBoot?.fail('game-module');
w.polycupBoot?.stage('assets');
document.head.append(script);
// Native game networking is restricted to this local service in the prototype.

}
