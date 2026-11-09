import type { PolyModLoader } from './game-types.ts';
import { PhysicsIntegrity } from './physics-integrity.ts';
import { RANKED_CLIENT_PROTOCOL } from './client-platform.ts';
const {PolyMod,MixinType}=await import(new URL('PolyTypes.js',document.baseURI).href);
class PolyCup extends PolyMod {
 #physics=new PhysicsIntegrity();
 constructor(){super();for(const hook of ['preInit','init','postInit','onGameLoad'] as const)Object.defineProperty(this,hook,{value:PolyCup.prototype[hook].bind(this)});}
 async preInit(loader:PolyModLoader){
  if(loader.polyVersion!=='0.6.3')throw Error('PolyCup requires PolyTrack 0.6.3');
  if((window as any).polycupPml)throw Error('PolyCup is already loaded');
  this.#physics.install(loader);
  (window as any).polycupPml={loader,insert:MixinType.INSERT,environment:__POLYCUP_PML_ENVIRONMENT__,physics:this.#physics};
  (window as any).polycupBuild={protocol:RANKED_CLIENT_PROTOCOL,version:__POLYCUP_APPLICATION_VERSION__};
  await import('../prototype/standalone/entry.ts');
 }
 init(){(window as any).polycupRuntime.init();}
 postInit(){}
 onGameLoad(){}
}
declare const __POLYCUP_PML_ENVIRONMENT__: 'production'|'pilot';
declare const __POLYCUP_APPLICATION_VERSION__: string;
export const polyMod=new PolyCup();
