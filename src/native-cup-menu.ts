import { hasLayoutBox } from './visibility.ts';
import { REPLAY_NEUTRAL_STYLE } from './replay-style.ts';
import { REPLAY_EVENT } from './native-replay.ts';
import type { LoadedTrack, NativeConnection, PolyModLoader } from './game-types.ts';
import trophy from '../assets/toolbar-trophy.svg';
import discordMark from '../assets/discord-mark.svg';
export const CUP_MENU_EVENT = 'polycup-open-menu';
const RACE_EVENT = 'polycup-start-native-race';
const PROFILE_EVENT = 'polycup-menu-profile';
const RETURN_EVENT = 'polycup-return-menu';
const PRACTICE_EVENT = 'polycup-practice-control';

export function practiceControl(action: 'state' | 'hold' | 'resume' | 'open' | 'complete') {
  const detail: { action: string; active?: boolean; driving?: boolean; ready?: Promise<void> } = {
    action,
  };
  window.dispatchEvent(new CustomEvent(PRACTICE_EVENT, { detail }));
  return detail;
}

export function coverNativeMenu(covered: boolean) {
  if (!document.getElementById('polycup-menu-cover-style')) {
    const style = document.createElement('style');
    style.id = 'polycup-menu-cover-style';
    style.textContent = `
      body.polycup-menu-covered .menu-ui { visibility:hidden!important; pointer-events:none!important; }
      .menu-ui > .main-buttons-container:not(.polycup-exclusive-menu):has(.polycup-menu-button) { padding-inline:24px; box-sizing:border-box; gap:4px; }
      .menu-ui > .main-buttons-container:not(.polycup-exclusive-menu):has(.polycup-menu-button) > .button-image { min-width:0; flex:0 1 200px; }
      .menu-ui > .main-buttons-container:not(.polycup-exclusive-menu):has(.polycup-menu-button) > .button-image > img { display:block; margin-inline:auto; width:min(96px,60%); height:auto; aspect-ratio:1; }
    `;
    document.head.append(style);
  }
  document.body.classList.toggle('polycup-menu-covered', covered);
}

/** The mod preserves native entry points; standalone groups PolyCup and native practice. */
export function registerCupMenu(pml: PolyModLoader, insert: unknown, exclusive = false) {
  if (pml.polyVersion !== '0.6.3') return;
  pml.registerGlobalMixin({
    type: insert,
    token: 't = k.get("Lost connection to server");',
    func: `if(document.body.dataset.polycupNativeRace){t=null;delete document.body.dataset.polycupNativeRace;}`,
  });
  pml.registerGlobalMixin({
    type: insert,
    token: '(0, R.gn)(this, Gh, "f").push(S));',
    func: `
      {
        const cup = document.createElement('button');
        cup.className = 'button button-image polycup-menu-button';
        const icon = document.createElement('img');
        icon.src = ${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(trophy)}`)};
        icon.alt = ''; icon.style.filter = 'brightness(0) invert(1)';
        const label = document.createElement('p'); label.textContent = 'PolyCup';
        cup.append(icon,label);
        cup.addEventListener('click', () => { n.playUIClick(); window.dispatchEvent(new Event('${CUP_MENU_EVENT}')); });
        Bh.get(this).append(cup); Gh.get(this).push(cup);
      }
    `,
  });
  pml.registerGlobalMixin({
    type: insert,
    token: 'ee = 0;',
    func: `
    const polycupHasLayoutBox = ${hasLayoutBox.toString()};
    let polycupRaceRequest = null;
    let polycupReturning = null;
    let polycupPracticeHold = false;
    let polycupReplayPause = null;
    let polycupReplayRequest = null;
    // Native Watch normally exits into solo driving. Match replays return to
    // history instead. This guarded branch leaves ordinary native Watch intact.
    const polycupReplayOpen=eval('('+X.toString().replace('J(e, t, n, i, null, !1);',
      'document.body.dataset.polycupReplay ? K(false,null) : J(e,t,n,i,null,!1);')+')');
    // A DNF must stop at its received horizon. Pad only the viewer's presentation
    // with its frozen final pose; do not simulate controls beyond that horizon.
    let polycupReplayPhysicsReady=false;
    const polycupInstallReplayPhysics=()=>{
    if(polycupReplayPhysicsReady)return;polycupReplayPhysicsReady=true;
    const polycupReplayCars=new Map(),polycupCreateCar=v.createCar.bind(v),polycupStartCar=v.startCar.bind(v),polycupDeleteCar=v.deleteCar.bind(v);
    v.createCar=(...args)=>{
      const through=args[4]?.polycupDnfThrough;
      if(!through)return polycupCreateCar(...args);
      const original=args[5],info={through,end:through};
      args[5]=state=>{if(state.frames<=through)original(state);};
      const car=polycupCreateCar(...args);polycupReplayCars.set(car.id,info);return car;
    };
    v.startCar=(id,end)=>{const info=polycupReplayCars.get(id);if(info){info.end=end.numberOfFrames;end=new xt.A(Math.min(info.end,info.through+16));}return polycupStartCar(id,end);};
    v.deleteCar=id=>{polycupReplayCars.delete(id);return polycupDeleteCar(id);};
    };
    const polycupNativePlaying = Ps;
    Ps = function() {
      // Pause native solo simulation (including ghosts), never a multiplayer race.
      if (polycupPracticeHold && document.body.dataset.polycupPractice && !Za.get(this)?.multiplayerConnection) return false;
      return polycupNativePlaying.call(this);
    };
    window.addEventListener('${REPLAY_EVENT}', event => {
      const request=event.detail;
      if(!request || typeof request.complete!=='function')return;
      request.accepted=true;
      if(polycupReplayRequest || polycupRaceRequest || Za.get($)?.multiplayerConnection || document.body.dataset.polycupNativeRace){request.complete('Leave your current match before watching a replay.');return;}
      let cancelled=false, replayGame=null, interval=null, finished=false;
      const finish=reason=>{
        if(finished)return;finished=true;clearInterval(interval);
        if(polycupReplayRequest===ticket)polycupReplayRequest=null;
        delete document.body.dataset.polycupReplay;
        request.ended(reason);
      };
      const ticket={cancel:()=>{cancelled=true;finish('interrupted');}};
      polycupReplayRequest=ticket;request.cancel=ticket.cancel;
      (async()=>{
        const until=performance.now()+45000;
        const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
        try {
          let load;
          x.forEachTrack((id,metadata,category,environment,callback)=>{if(id===request.track)load=callback;});
          if(!load)throw Error('This replay track is not available in this game version.');
          const track=await Promise.race([load(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Replay track loading timed out. Try again.')),30000))]);
          while(o.isTransitioning || !t.hasLoaded()){if(cancelled || performance.now()>until)throw Error('Replay loading timed out. Try again.');await pause();}
          if(cancelled || Za.get($)?.multiplayerConnection || polycupRaceRequest)throw Error('Replay cancelled.');
          polycupInstallReplayPhysics();
          const ghosts=request.ghosts.map(ghost=>{const recording=new ie.A(ghost.inputs);if(ghost.dnf)recording.polycupDnfThrough=ghost.nativeFinish;
            const saved=typeof ghost.style==='string'?Zt.A.deserializeSafe(ghost.style):null;return{recording,
            carStyle:saved&&saved.serialize()===ghost.style?saved:Zt.A.deserializeSafe('${REPLAY_NEUTRAL_STYLE}'),
            nickname:ghost.name,time:new xt.A(ghost.finish),isSelf:false,polycupDnf:ghost.dnf,polycupOffset:ghost.offset,polycupNativeEnd:ghost.nativeFinish};});
          request.started();
          document.body.dataset.polycupReplay='1';
          document.body.dataset.polycupPractice='1';
          document.body.dataset.polycupPracticeOpenedAt=String(performance.now());
          const before=$;
          polycupReplayOpen(track.trackMetadata,track.trackData,'custom',ghosts);
          while($===before || o.isTransitioning){if(cancelled || performance.now()>until)throw Error('Replay loading timed out. Try again.');await pause();}
          if(!($ instanceof Sg))throw Error('Replay cancelled.');
          replayGame=$;
          const portraits=new Map();
          sg.get(replayGame).forEach((ghost,index)=>{const thumb=window.polycupPrototype?.controller.native.carThumbnail(ghost.settings.carStyle);if(thumb)void thumb.then(url=>portraits.set(index,url)).catch(()=>{});});
          request.snapshot=()=>{
            if($!==replayGame)return null;
            const time=Math.round(lg.get(replayGame)*1000);
            return {time,selected:ag.get(replayGame),rows:sg.get(replayGame).map((ghost,index)=>{
              const end=ghost.settings.time.numberOfFrames,state=ghost.replay.getFrame(time),offset=ghost.settings.polycupOffset;
              const dnf=ghost.settings.polycupDnf&&time>=end,finished=!ghost.settings.polycupDnf&&time>=end&&ghost.finishSpeed!==null;
              const checkpoint=state?.nextCheckpointIndex??0;
              return {index,name:request.ghosts[index].name.replace(/ · DNF$/,''),portrait:portraits.get(index),checkpoint,
                crossing:checkpoint>0?(ghost.checkpointTimes[checkpoint-1]?.numberOfFrames??0)+offset:0,
                speed:state&&!dnf?Math.abs(finished?ghost.finishSpeed:state.speedKmh):null,
                finish:finished?end:null,status:dnf?'dnf':finished?'finished':state?'racing':'loading'};
            })};
          };
          const replayEnd=Math.max(...request.ghosts.map(ghost=>ghost.finish))+10000;
          for(const ghost of sg.get(replayGame)){
            const through=ghost.settings.polycupNativeEnd,offset=ghost.settings.polycupOffset,record=ghost.replay;
            const frame=record.getFrame.bind(record),last=record.getLastFrame.bind(record);
            record.getFrame=at=>{
              const atNative=Math.max(0,at-offset),state=frame(ghost.settings.polycupDnf?Math.min(atNative,through):atNative);
              if(!state || !offset)return state;
              return {...state,frames:at,finishFrames:state.finishFrames===null?null:state.finishFrames+offset};
            };
            if(offset)ghost.car.getControls=()=>ghost.settings.recording.getFrame(Math.max(0,ghost.car.getTime().numberOfFrames-offset));
            record.getLastFrame=()=>{const actual=last();if(!ghost.settings.polycupDnf || actual.numberOfFrames<through)return new xt.A(actual.numberOfFrames+offset);
              if(ghost.carId!==null){v.deleteCar(ghost.carId);ghost.carId=null;}
              return new xt.A(replayEnd);};
          }
          interval=setInterval(()=>{if(!o.isTransitioning && $!==replayGame)finish(Za.get($)?.multiplayerConnection || polycupRaceRequest ? 'interrupted' : 'exit');},100);
          request.complete(null);
        } catch(error){finish('interrupted');request.complete(error?.message||'Could not load replay.');}
      })();
    });
    window.addEventListener('${PRACTICE_EVENT}', event => {
      const d=event.detail;if(!d)return;
      const menu=document.querySelector('.main-buttons-container:has([data-polycup-action="practice"])');
      const solo=$ instanceof Is && !Za.get($)?.multiplayerConnection && !ss.get($);
      if(polycupHasLayoutBox(menu) && !o.isTransitioning && performance.now()-Number(document.body.dataset.polycupPracticeOpenedAt??0)>1500) delete document.body.dataset.polycupPractice;
      d.active=!!document.body.dataset.polycupPractice && !Za.get($)?.multiplayerConnection;
      d.driving=solo && d.active;
      const clear=()=>{if(solo){const input=qa.get($);if(input)for(const k of ['up','right','down','left','reset'])input[k]=false;}};
      if(d.action==='hold'&&!polycupPracticeHold){polycupPracticeHold=true;clear();if(solo&&d.active)Xa.get($).isPaused=true;if($ instanceof Sg && document.body.dataset.polycupReplay){polycupReplayPause={game:$,paused:og.get($),simulationPaused:ug.get($).isPaused};og.set($,true);ug.get($).isPaused=true;}}
      if(d.action==='resume'&&polycupPracticeHold){polycupPracticeHold=false;clear();if(polycupReplayPause?.game===$){og.set($,polycupReplayPause.paused);ug.get($).isPaused=polycupReplayPause.simulationPaused;}polycupReplayPause=null;}
      if(d.action==='complete'){polycupPracticeHold=false;polycupReplayPause=null;delete document.body.dataset.polycupPractice;}
      if(d.action==='open') d.ready=(async()=>{
        if(d.active)return;
        if(!polycupHasLayoutBox(menu)){
          const returned={};window.dispatchEvent(new CustomEvent('${RETURN_EVENT}',{detail:returned}));
          if(await returned.ready===false)throw Error('Returning to the menu timed out. Try again.');
        }
        const button=document.querySelector('[data-polycup-action="practice"]');
        if(!button)throw Error('Practice is still loading. Try again.');
        button.click();
      })();
    });
    window.addEventListener('${PROFILE_EVENT}', event => {
      const p = S.getCurrentUserProfile();
      event.detail.profile = { name: p.nickname || 'Player', country: p.countryCode || null, style: p.carStyle.serialize() };
      event.detail.trackLibrary = x;
    });
    window.addEventListener('${RETURN_EVENT}', event => {
      polycupReplayRequest?.cancel();
      const returnedRace=document.body.dataset.polycupNativeRace;
      if (polycupRaceRequest) polycupRaceRequest.cancel();
      // Native departure can still be scheduling its own disconnect dialog.
      // Return after that transition so it cannot cover the Cup finder later.
      if (polycupReturning) { if(event?.detail)event.detail.ready=polycupReturning;return; }
      polycupReturning = (async()=>{
        const until=performance.now()+10000;
        const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
        await pause();
        while(o.isTransitioning && performance.now()<until) await pause();
        if(o.isTransitioning) return false;
        const previous=$;
        K(false,null);
        while(($===previous || o.isTransitioning) && performance.now()<until) await pause();
        if(document.body.dataset.polycupNativeRace===returnedRace)delete document.body.dataset.polycupNativeRace;
        return $!==previous && !o.isTransitioning;
      })();
      const returning=polycupReturning;
      if(event?.detail)event.detail.ready=returning;
      returning.finally(()=>{if(polycupReturning===returning)polycupReturning=null;});
    });
    window.addEventListener('${RACE_EVENT}', async event => {
      polycupReplayRequest?.cancel();
      const request = event.detail;
      if (!request || typeof request.complete !== 'function') return;
      request.accepted = true;
      let waitingCancelled = false;
      request.cancel = () => { waitingCancelled = true; };
      if (polycupReturning && !await polycupReturning) { request.complete('Returning to the menu timed out. Try joining again.'); return; }
      if (waitingCancelled) { request.complete('Match start cancelled.'); return; }
      if (polycupRaceRequest || Za.get($)?.multiplayerConnection) { request.complete('Leave your current multiplayer game first.'); return; }
      document.body.dataset.polycupNativeRace=crypto.randomUUID();
      let connection = null, cancelled = false, timer = null, cleanupSession = () => {};
      const cancel = () => { cancelled = true; connection?.dispose(); };
      polycupRaceRequest = { cancel };
      request.cancel = cancel;
      const deadline = performance.now()+60000;
      try {
        while (o.isTransitioning || !t.hasLoaded()) {
          if (cancelled || performance.now()>deadline) throw new Error('Game loading timed out.');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        let metadata, trackData, sessionId, mode = 1;
        if (request.mode==='host') {
          if (!request.track?.trackData?.hasStartingPoint()) throw new Error('The first track could not be loaded.');
          metadata=request.track.trackMetadata; trackData=request.track.trackData;
          connection=new ii(k,T,16,S);
          sessionId=connection.startNewSessionImmediate(mode,metadata,trackData);
        } else {
          if (!/^[A-Z0-9]{8}$/.test(request.code)) throw new Error('Invalid race invitation.');
          connection=new vc(k,T,S,E);
          const cancellation=new Sr.A();
          const originalCancel=cancel;
          request.cancel=()=>{ cancellation.cancel(); originalCancel(); };
          polycupRaceRequest.cancel=request.cancel;
          // Subscribe before join: track delivery can precede joinInvite resolving.
          let lostConnection;
          const sessionReady=new Promise((resolve,reject)=>{
            const ready=(sessionId,gameMode,trackMetadata,trackData)=>{window.polycupStartupStage?.('native_session_received');resolve({sessionId,gameMode,trackMetadata,trackData});};
            const lost=()=>{ const error=new Error('Race connection was lost. Please retry.'); reject(error); lostConnection?.(error); };
            cleanupSession=()=>{connection.removeNewSessionCallback(ready);connection.removeConnectionLostCallback(lost);};
            connection.addNewSessionCallback(null,ready);connection.addConnectionLostCallback(lost);
          });
          // Observe early rejection even while signalling is still pending.
          sessionReady.catch(()=>{});
          const connectionLost=new Promise((_,reject)=>{lostConnection=reject;});
          const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Race connection timed out. Please retry.')),45000);});
          window.polycupStartupStage?.('native_join_start');
          await Promise.race([connection.joinInvite(request.code,cancellation),connectionLost,timeout]);
          window.polycupStartupStage?.('native_join_done');
          const session=await Promise.race([sessionReady,connectionLost,timeout]);
          window.polycupStartupStage?.('native_session_ready');
          cleanupSession();
          metadata=session.trackMetadata;trackData=session.trackData;sessionId=session.sessionId;mode=session.gameMode;
        }
        if (cancelled) throw new Error('Match start cancelled.');
        window.polycupStartupStage?.('native_world_start');
        J(metadata,trackData,'custom',[],{multiplayerConnection:connection,sessionId,gameMode:mode},false);
        while (Za.get($)?.multiplayerConnection !== connection) {
          if (cancelled || performance.now()>deadline) throw new Error('Race loading timed out.');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        window.polycupStartupStage?.('native_world_ready');
        request.complete(null,connection);
      } catch(error) { request.cancel(); request.complete(error?.message || 'Could not connect to the race.'); }
      finally { clearTimeout(timer); cleanupSession(); polycupRaceRequest=null; }
    });
  `,
  });
  if (!exclusive) pml.registerGlobalMixin({
    type: insert,
    token: '(0, R.gn)(this, Gh, "f").push(E),',
    func: `(() => {
      E.dataset.polycupAction='practice';
      E.addEventListener('click',()=>{document.body.dataset.polycupPractice='1';document.body.dataset.polycupPracticeOpenedAt=String(performance.now());});
    })(),`,
  });
  if (exclusive)
    pml.registerGlobalMixin({
      type: insert,
      token: '(0, R.gn)(this, Gh, "f").push(E),',
      // This anchor is inside a comma expression. Remove both the DOM entries
      // and their native keyboard-navigation entries after all buttons exist.
      func: `(() => {
      const buttons = Gh.get(this), container = Bh.get(this);
      for (const button of [b, S]) {
        button.remove();
        const index = buttons.indexOf(button);
        if (index >= 0) buttons.splice(index, 1);
      }
      const cup = container.querySelector('.polycup-menu-button');
      if (cup) {
        const actions=[[cup,'Play','play'],[E,'Practice','practice'],[A,'Garage','garage'],[x,'Settings','settings']];
        for(const [button,label,action] of actions){
          button.classList.remove('button-image');button.classList.add('polycup-menu-action');
          button.dataset.polycupAction=action;
          button.querySelectorAll('img').forEach(image=>image.remove());
          button.querySelector('p').textContent=label;
          container.append(button);
        }
        E.addEventListener('click',()=>{document.body.dataset.polycupPractice='1';document.body.dataset.polycupPracticeOpenedAt=String(performance.now());});
        // The native focus registry must follow the new visual order too.
        buttons.splice(0,buttons.length,...actions.map(([button])=>button));
      }
      container.classList.add('polycup-exclusive-menu');
      if (!container.querySelector('.polycup-community')) {
        const community=document.createElement('a'),icon=document.createElement('img'),label=document.createElement('span');
        community.className='button polycup-community';
        community.href='https://discord.gg/BpZp5sZ5jg';
        community.target='_blank';community.rel='noopener noreferrer';
        community.setAttribute('aria-label','PolyCup Discord (opens in a new tab)');
        icon.src=${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(discordMark.replace('currentColor', '#dbe6f8'))}`)};
        icon.alt='';label.textContent='PolyCup Discord';
        community.append(icon,label);container.append(community);
      }
      // Native menu construction may append Garage/Settings after this anchor.
      queueMicrotask(() => {
        const community=container.querySelector('.polycup-community');
        if (community) container.append(community);
      });
    })(),`,
    });
}
export function menuIdentity(): { name: string; country?: string | null; style?: string } {
  const detail: { profile?: { name: string; country?: string | null; style?: string } } = {};
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail }));
  return detail.profile ?? { name: 'Player' };
}
export function returnToNativeMenu() {
  window.dispatchEvent(new Event(RETURN_EVENT));
}
export function launchNativeRace(
  mode: 'host' | 'join',
  signal: AbortSignal,
  track?: LoadedTrack,
  code?: string,
): Promise<NativeConnection> {
  return new Promise((resolve, reject) => {
    const request = {
      mode,
      track,
      code,
      accepted: false,
      cancel: () => {},
      complete: (error?: string, connection?: NativeConnection) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error || !connection) reject(new Error(error || 'Race connection unavailable.'));
        else resolve(connection);
      },
    };
    const abort = () => {
      request.cancel();
      request.complete('Match start cancelled.');
    };
    const timer = setTimeout(() => {
      request.cancel();
      request.complete('Race connection timed out.');
    }, 65000);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    window.dispatchEvent(new CustomEvent(RACE_EVENT, { detail: request }));
    if (!request.accepted) request.complete('The game is still loading. Try again.');
  });
}
