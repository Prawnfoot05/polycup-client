import { hasLayoutBox } from '../../src/visibility.ts';
import { nativeHudHidden } from '../../src/native-hud.ts';
import {protectUITouches} from '../../src/touch-ui.ts';
import {installErrorDismissal,retryDismissedErrors} from '../../src/dismissible-errors.ts';
import {statusIcon} from '../../src/status-icon.ts';

/** Queue UI outlives the hub and native screen changes. It owns no queue state. */
export class QueueControls {
  readonly root = document.createElement('aside');
  readonly shadow: ShadowRoot;
  #status = document.createElement('button');
  #title = document.createElement('strong');
  #detail = document.createElement('small');
  #practice = document.createElement('button');
  #cancel = document.createElement('button');
  #error = document.createElement('span');
  #since = 0;
  #lastError = '';
  #layout = '';
  #touchSpace: {node:HTMLElement;original:string;lift:number}|null=null;
  constructor(open: () => void, practice: () => void, cancel: () => void) {
    this.root.id = 'polycup-queue-controls';
    this.root.setAttribute('popover', 'manual');
    this.root.setAttribute('aria-label', 'Ranked matchmaking');
    this.root.hidden = true;
    this.shadow = this.root.attachShadow({mode:'open'});
    protectUITouches(this.shadow);
    const style = document.createElement('style');
    style.textContent = `
      :host{position:fixed;inset:16px 16px auto auto;margin:0;padding:0;border:0;background:transparent;color:#fff;max-width:calc(100vw - 24px);font:italic 700 var(--queue-font,20px)/1.1 ForcedSquare,Arial,sans-serif;font-synthesis:weight style;overflow:visible}
      :host([data-native-hud-hidden]){visibility:hidden!important;pointer-events:none!important}
      :host([hidden]){display:none!important}
      .strip{display:flex;align-items:stretch;gap:5px;padding:0;background:none}
      button{position:relative;isolation:isolate;box-sizing:border-box;min-height:44px;padding:8px 14px;border:0;background:none;color:#fff;font:inherit;cursor:pointer}
      button::before{content:'';position:absolute;inset:0;z-index:-1;background:var(--button-color,#112052);transform:skewX(-12deg)}
      button:hover::before{background:var(--button-hover-color,#334b77)}button:focus-visible{outline:none;text-decoration:underline;text-underline-offset:4px}button:focus-visible::before{box-shadow:inset 0 -3px #ffd76b}button:disabled{opacity:.6;cursor:wait}
      .status{padding:8px 14px;text-align:left;min-width:150px;white-space:nowrap}.status::before{background:var(--surface-color,#28346a);opacity:.95}
      strong{display:block;font:inherit}small{display:block;margin-top:3px;font:italic 700 var(--queue-detail,15px)/1.1 ForcedSquare,Arial,sans-serif;color:#afbade}
      .cancel{width:44px;min-width:44px;padding:10px}.cancel svg{display:block;width:22px;height:22px;margin:auto}.cancel svg path{stroke-width:3}
      :host([data-hud]) .strip{display:grid;grid-template-columns:minmax(0,1fr) 44px}:host([data-hud]) .status{min-width:0}
      :host([data-hud]){max-width:calc(100vw - 16px);overflow:hidden}
      :host([data-hud]) .strip{gap:0;padding-left:9px;background:var(--surface-color,#28346a);clip-path:polygon(9px 0,100% 0,100% 100%,0 100%);animation:queue-enter .22s ease-out both}
      :host([data-hud=bottom]) .strip{clip-path:polygon(0 0,100% 0,100% 100%,9px 100%)}
      :host([data-hud]) button{min-height:var(--queue-height,44px)}:host([data-hud]) .status{padding:7px 12px}
      :host([data-hud]) .cancel{width:44px;min-width:44px;padding:8px}:host([data-hud]) .cancel::before{inset:5px 0 5px 0;transform:skewX(-12deg)}
      @keyframes queue-enter{from{transform:translateX(calc(100% + 16px))}to{transform:translateX(0)}}
      @media(prefers-reduced-motion:reduce){:host([data-hud]) .strip{animation:none}}
      .error{display:block;max-width:330px;color:#ff9caa;background:#192042;padding:8px 12px;font:400 15px/1.3 ForcedSquare,Arial,sans-serif}.error:empty{display:none}
      [hidden]{display:none!important}
      @media(max-width:480px){:host{right:12px;top:12px;font-size:17px}.status{min-width:0;flex:1}button{padding:8px 10px}}
    `;
    const strip = document.createElement('div');
    strip.className = 'strip';
    this.#title.textContent = 'Searching';
    this.#status.className = 'status';
    this.#status.setAttribute('aria-label','Open matchmaking');
    this.#status.title='Open matchmaking';
    this.#status.append(this.#title,this.#detail);
    this.#status.onclick = open;
    this.#practice.textContent = 'Practice';this.#practice.onclick = practice;
    this.#cancel.className='cancel';this.#cancel.setAttribute('aria-label','Cancel queue');this.#cancel.title='Cancel queue';this.#cancel.append(statusIcon('cross'));this.#cancel.onclick = cancel;
    this.#error.className='error';this.#error.setAttribute('role','status');
    strip.append(this.#status,this.#practice,this.#cancel);
    this.shadow.append(style,strip,this.#error);installErrorDismissal(this.shadow);document.body.append(this.root);
  }
  retryErrors() {retryDismissedErrors(this.shadow);}
  #clearTouchSpace() {
    if(this.#touchSpace){this.#touchSpace.node.style.translate=this.#touchSpace.original;this.#touchSpace=null;}
  }
  #reserveTouchSpace(bottom: boolean) {
    const node=bottom?document.querySelector<HTMLElement>('.game-ui:not(.hidden) .touch-controls-ui > .right-container'):null;
    if(!hasLayoutBox(node)){this.#clearTouchSpace();return;}
    if(this.#touchSpace?.node!==node){this.#clearTouchSpace();this.#touchSpace={node,original:node.style.translate,lift:0};}
    const space=this.#touchSpace!;
    const scale=node.getBoundingClientRect().height/node.offsetHeight||1;
    const children=[...node.children].map(e=>e.getBoundingClientRect());
    const bottomEdge=Math.max(...children.map(r=>r.bottom))+space.lift*scale;
    const lift=Math.max(0,bottomEdge-this.root.getBoundingClientRect().top+8)/scale;
    if(Math.abs(lift-space.lift)>.1){node.style.translate=lift?'0 '+(-lift)+'px':space.original;space.lift=lift;}
  }
  #place(practicing: boolean) {
    // Mirror the real toolbar, including Options changes and the native touch override.
    // Its `up` class is authoritative even while the toolbar itself fades out.
    const toolbar=practicing?document.querySelector<HTMLElement>('.game-ui:not(.hidden) .game-toolbar-ui,.preview-toolbar-ui'):null;
    const anchor=toolbar?.getBoundingClientRect();
    if(!toolbar || !anchor?.width){
      this.#clearTouchSpace();if(this.#layout==='menu')return;this.#layout='menu';this.root.removeAttribute('data-hud');this.root.removeAttribute('style');return;
    }
    const nativeStyle=getComputedStyle(toolbar);
    const scale=Number.parseFloat(nativeStyle.getPropertyValue('--ui-scale-factor'))||1;
    const viewportWidth=document.documentElement.clientWidth,viewportHeight=document.documentElement.clientHeight;
    const font=Math.max(14,Math.min(22,26*scale)),detail=Math.max(12,Math.min(16,20*scale)),width=Math.min(viewportWidth-16,Math.max(210,Math.min(280,320*scale)));
    const preview=toolbar.classList.contains('preview-toolbar-ui');
    const top=preview||toolbar.classList.contains('up');
    // Use the screen's native safe area rather than the toolbar's animated X coordinate.
    const right=Math.max(0,Number.parseFloat(nativeStyle.left)||0);
    const edge=Math.max(0,top?anchor.top:viewportHeight-anchor.bottom);
    const key=[viewportWidth,viewportHeight,top,right,edge,width,font,this.root.getBoundingClientRect().height].join('|');
    if(key===this.#layout){this.#reserveTouchSpace(!top);return;}this.#layout=key;this.root.dataset.hud=top?'top':'bottom';
    this.root.style.setProperty('--queue-font',font+'px');this.root.style.setProperty('--queue-detail',detail+'px');this.root.style.setProperty('--queue-height',Math.max(44,60*scale)+'px');this.root.style.width=width+'px';
    const left=Math.max(0,viewportWidth-right-width);
    const y=preview&&top&&anchor.right>left?anchor.bottom+4:top?anchor.top:anchor.bottom-this.root.getBoundingClientRect().height;
    this.root.style.inset=Math.max(0,y)+'px auto auto '+left+'px';
    this.#reserveTouchSpace(!top);
  }
  update(queued: boolean, visible: boolean, waiting: number, busy: boolean, practicing: boolean, error='', joinedAt=0, label='Searching') {
    this.root.toggleAttribute('data-native-hud-hidden', practicing && nativeHudHidden());
    if(queued&&!this.#since)this.#since=Date.now();
    if(queued&&joinedAt)this.#since=joinedAt;
    if(!queued)this.#since=0;
    const seconds=Math.max(0,Math.floor((Date.now()-this.#since)/1000));
    const detail = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${waiting} waiting`;
    const title=busy?'Cancelling…':label;if(this.#title.textContent!==title)this.#title.textContent=title;
    if(this.#detail.textContent!==detail)this.#detail.textContent=detail;
    if(this.#practice.hidden!==practicing)this.#practice.hidden=practicing;
    if(this.#practice.disabled!==busy)this.#practice.disabled=busy;
    if(this.#cancel.disabled!==busy)this.#cancel.disabled=busy;
    if(error!==this.#lastError){this.#lastError=error;this.#error.textContent=error;}
    const show=queued&&visible;
    if(show!==!this.root.hidden){this.root.hidden=!show;if(show)this.root.showPopover();else if(this.root.matches(':popover-open'))this.root.hidePopover();this.#layout='';}
    if(show)this.#place(practicing);else this.#clearTouchSpace();
  }
}
