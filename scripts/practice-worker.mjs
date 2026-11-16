import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
export const PRACTICE_WORKER_MARKER = '(($o.length = 0), (onmessage = r));';
export const PRACTICE_WORKER_HANDLER = 'const r = i.data;';
export const PRACTICE_WORKER_MESSAGES = `
if(r.messageType===Ki.CreateCar && r.carRecording?.polycupRespawn){rollingPlaybackSources.set(r.carId,r.carRecording.polycupRespawn);r.carRecording=r.carRecording.native;}
if(r.rollingEnable||r.rollingRespawn||r.rollingRecording){rollingCommand(r);return;}
if(r.messageType===Ki.DeleteCar){rollingEnabled.delete(r.carId);rollingCars.delete(r.carId);rollingCreates.delete(r.carId);rollingPlaybackSources.delete(r.carId);rollingPlaybacks.delete(r.carId);postMessage({rollingProto:true,removed:true,carId:r.carId});}
`;
export async function practiceWorkerSource() {
  const bundle = await build({
    entryPoints: ['src/practice-respawn/replay.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PolyCupRolling',
    target: 'es2022',
  });
  return (
    bundle.outputFiles[0].text + '\n' + (await readFile('src/practice-respawn/worker.txt', 'utf8'))
  );
}
export const practiceWorkerPlugin = {
  name: 'practice-worker-source',
  setup(b) {
    b.onResolve({ filter: /^polycup:practice-worker$/ }, () => ({
      path: 'practice-worker',
      namespace: 'polycup',
    }));
    b.onLoad({ filter: /.*/, namespace: 'polycup' }, async () => ({
      contents: JSON.stringify({
        source: await practiceWorkerSource(),
        handler: PRACTICE_WORKER_MESSAGES,
      }),
      loader: 'json',
    }));
  },
};
