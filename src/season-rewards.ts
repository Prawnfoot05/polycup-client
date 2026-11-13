import {element as h} from './dom.ts';
import {RewardReveal,type RewardUnlock} from './reward-reveal.ts';
import css from './match-finish.css';
export interface SeasonReward {season:string;name:string;rewards:RewardUnlock[]}
export class SeasonRewards {
 #dialog=h('dialog',undefined,'match-finish season-rewards polycup-surface');
 #reveal=new RewardReveal();
 #busy=false; #last=''; #at=0;
 constructor(shadow:ShadowRoot,private safe:()=>boolean,private user:()=>string|null){
  this.#dialog.append(this.#reveal.element);
  this.#dialog.addEventListener('cancel',e=>{e.preventDefault();this.#reveal.acknowledge()});
  shadow.append(h('style',css+`.season-rewards{border:0;padding:0;width:min(800px,calc(100vw - 32px));height:min(570px,calc(100dvh - 32px));background:#10192f;color:var(--pc-text)}.season-rewards::backdrop{background:#080e22bd}.season-rewards .reward-reveal-close{position:absolute;right:12px;top:10px;min-width:44px;background:transparent;font-size:28px}`),this.#dialog);
 }
 async check(user:string|null,api:{seasonRewards:()=>Promise<SeasonReward[]>;ackSeasonRewards:(season:string)=>Promise<unknown>}|undefined){
  if(!user||!api||this.#busy||this.#dialog.open||!this.safe()||(this.#last===user&&Date.now()-this.#at<30000))return;
  this.#busy=true;this.#last=user;this.#at=Date.now();
  try{
   const pending=await api.seasonRewards();
   if(!this.safe()||this.#last!==user||this.user()!==user)return;
   const reward=pending[0];if(!reward)return;
   const shown=this.#reveal.show('season:'+user+':'+reward.season,reward.rewards,()=>{this.#dialog.close();void api.ackSeasonRewards(reward.season).catch(()=>{});this.#at=0},reward.name+' rewards');
   if(shown)this.#dialog.showModal();
   else await api.ackSeasonRewards(reward.season);
  }catch{/* A failed read is retried; it must never block the hub. */}
  finally{this.#busy=false}
 }
 close(){if(this.#dialog.open)this.#dialog.close();this.#last='';this.#at=0}
}


