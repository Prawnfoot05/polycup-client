import worker from 'polycup:practice-worker';
// @ts-ignore Validated native 0.6.3 Practice runtime modules.
import { installPracticeRespawns } from './practice-respawn/client.mjs';

/** Register before native initialization in both bundled and external PML clients. */
export function registerPracticeRespawns(runtime: any, insert: unknown) {
  const sim = [
    { type: insert, token: '(($o.length = 0), (onmessage = r));', func: worker.source },
    { type: insert, token: 'const r = i.data;', func: worker.handler },
  ];
  runtime.practiceWorkerMixins = sim;
  runtime.registerGlobalMixin({
    type: insert,
    token: 'get cameraOrbit() {',
    func: `
 window.polycupPracticeCarAccess?.(this,{id:ee.get(this),reset:()=>Q.get(this).reset(this.getPosition(),this.getQuaternion(),this.getSpeedKmh()),visible:()=>me.get(this).visible,opacity:()=>{let opacity=1;me.get(this).traverse(object=>{if(object.material)for(const material of(Array.isArray(object.material)?object.material:[object.material]))opacity=Math.min(opacity,material.opacity);});return opacity;}});
 `,
  });
  runtime.registerGlobalMixin({
    type: insert,
    token: 's.addFinishCallback((e) => {',
    func: `
 window.polycupRuntime?.rankedPracticeRun?.finish(this);
 if(window.polycupPracticeRespawns?.used(e)){window.polycupPracticeRespawns.finished(this,e);if(!window.polycupPracticeRespawns.context(this)?.multiplayer)return;}
 `,
  });
  installPracticeRespawns(runtime);
}
