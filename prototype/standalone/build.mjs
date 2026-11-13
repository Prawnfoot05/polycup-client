import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { unpack } from '../../scripts/asar.mjs';
import { packageLoaderSource, removeApplicationSourceArtifacts } from '../../scripts/package-loader-source.mjs';
import { dependencyNotices } from '../../scripts/package-dependency-notices.mjs';
import { startupShell } from './startup-shell.mjs';
import { RANKED_CLIENT_PROTOCOL, CUP_WIRE_VERSION } from '../../src/client-platform.ts';
const pml = process.argv.includes('--pml');
const hub = process.argv.includes('--hub');
// A 0.6 client requires the coordinated replay/presence/progression host.
const protocol = RANKED_CLIENT_PROTOCOL;
const {version} = JSON.parse(await readFile('prototype/standalone/package.json','utf8'));
if (JSON.parse(await readFile('package.json','utf8')).version !== version) throw Error('Standalone/PML versions differ');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid standalone release version');
const root = path.resolve(pml ? 'output/standalone/site-pml' : 'output/standalone/site');
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'favicon.svg'), await readFile('assets/polycup-monogram.svg'));
await writeFile(path.join(root, 'favicon.png'), await readFile('assets/polycup-favicon.png'));
const bannerCatalog = JSON.parse(await readFile('src/banner-catalog.json', 'utf8'));
const bannerDigest = createHash('sha256');
const trackBanners = JSON.parse(await readFile('src/track-banner-catalog.json', 'utf8'));
const trackNames = new Set();
for (const art of trackBanners) {
  const name = String(art.track ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!name || trackNames.has(name) || !/^[a-z0-9-]+\.(?:webp|png|jpg)$/.test(art.file))
    throw Error('Invalid or duplicate track banner');
  trackNames.add(name);
  const bytes = await readFile(path.join('assets/track-banners', art.file));
  bannerDigest.update(name).update(art.file).update(bytes);
  await mkdir(path.join(root, 'track-banners'), { recursive: true });
  await writeFile(path.join(root, 'track-banners', art.file), bytes);
}
await mkdir(path.join(root,'cosmetics/banners'), {recursive:true});
for (const banner of bannerCatalog) {
  if (!/^[a-z0-9-]+$/.test(banner.id)) throw Error('Invalid curated banner ID');
  const folder = banner.requirement === 'open' ? 'tracks' : banner.requirement;
  await mkdir(path.join(root,'cosmetics/banners',folder), {recursive:true});
  const bytes = await readFile(`assets/cosmetics/banners/${folder}/${banner.id}.png`);
  bannerDigest.update(banner.id).update(bytes);
  await writeFile(path.join(root,'cosmetics/banners',folder,banner.id+'.png'), bytes);
  await unlink(path.join(root,'cosmetics/banners',banner.id+'.png')).catch(e=>{if(e.code!=='ENOENT')throw e});
}
const cosmeticCatalog=JSON.parse(await readFile('src/cosmetic-catalog.json','utf8'));
for(const base of cosmeticCatalog)for(const item of [base,...(base.variants??[])]){
 if(!item.art)continue;
 if(!/^(?:frames|achievements)\/[a-z0-9-]+\.(?:svg|png)$/.test(item.art))throw Error('Invalid curated reward artwork');
 const bytes=await readFile('assets/cosmetics/'+item.art);
 bannerDigest.update(base.id+':'+(item.key??'base')).update(bytes);
 await mkdir(path.dirname(path.join(root,'cosmetics',item.art)),{recursive:true});
 await writeFile(path.join(root,'cosmetics',item.art),bytes);
}
await removeApplicationSourceArtifacts(root);
const archive = await readFile('.research/pml-0.6.3-1.asar');
if (
  createHash('sha256').update(archive).digest('hex') !==
  '5c09a6ab0146797c147b603e0367f14d15e235be77392ca96df66ea81d3b12f8'
)
  throw Error('Unrecognized baseline');
const files = unpack(archive);
const loaderSourceDigest = pml ? await packageLoaderSource(root,files) : '';
if (pml) {
  for (const name of [
    'PolyModLoader.js',
    'PolyTypes.js',
    'PolyGlyphs.woff2',
    'package.json',
    'LICENSE.md',
  ]) {
    if (files.has(name)) {
      const bytes =
        name === 'PolyModLoader.js'
          ? files
              .get(name)
              .toString()
              .replace('fetch("/package.json")', 'fetch(new URL("package.json", import.meta.url))')
          : files.get(name);
      await writeFile(path.join(root, name), bytes);
    }
  }
}
for (const [name, bytes] of files) {
  if (
    !/^(audio\/|images\/|lib\/|models\/|tracks\/|[0-9]+\.bundle\.js$|simulation_worker\.bundle\.js$|polytrack_physics\.wasm$|forced_square\.|error_screen\.bundle\.js$)/.test(
      name,
    )
  )
    continue;
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
let game = files.get('main.bundle.js').toString();
const from = game.indexOf('let globalFunc = () => {');
const to = game.lastIndexOf('ActivePolyModLoader.preInitMods()');
if (from < 0 || to < 0) throw Error('Unsupported wrapper');
game = game.slice(from + 'let globalFunc = () => {'.length, to);
game = game.slice(0, game.lastIndexOf('};'));
if (game.includes('ActivePolyModLoader')) throw Error('Unexpected loader dependency');
game = game.replace(
  /if \(!e\)\s*throw new Error\(\s*"Automatic publicPath is not supported in this browser",?\s*\);/,
  'if (!e) e = new URL("main.bundle.js", document.baseURI).href;',
);
// The native renderer update only updates lighting/shadows and draws. Keep the
// surrounding game tick, physics worker, network, timers and input capture intact.
const renderAnchor='update(e) {\n                (0, i.gn)(this, I, "f").copy(e.getSunPosition());';
function hostRenderGuard(source){
  if(source.split(renderAnchor).length!==2)throw Error('Native render hook changed; refusing an unchecked server optimization');
  return source.replace(renderAnchor,'update(e) {\n                if(window.polycupDedicatedNoRender){window.polycupSkippedDraws=(window.polycupSkippedDraws||0)+1;return;}\n                (0, i.gn)(this, I, "f").copy(e.getSunPosition());');
}
game=hostRenderGuard(game);
await writeFile(path.join(root, 'game-source.js'), '(()=>{' + game + '})();');
if (pml) {
  // Preserve the pinned loader's real lifecycle and hook implementation. The
  // application supplies one bundled mod; no library/import-from-storage step.
  const original = hostRenderGuard(files.get('main.bundle.js').toString());
  const body = original.slice(original.indexOf('let globalFunc = () => {'));
  const bootstrap = `import { ActivePolyModLoader } from './PolyModLoader.js';
import { PolyMod, MixinType } from './PolyTypes.js';
// The loader's module sets its own notice config; restore this site's mod identity before native initialization.
window.polytrackModConfiguration={modName:'PolyCup',author:'Prawnfoot05'};
window.polyModLoader = ActivePolyModLoader;
const polyMod = new PolyMod();
Object.assign(polyMod, {modID:'polytrack-world-cup',modName:'PolyCup',modVersion:${JSON.stringify(CUP_WIRE_VERSION)},modDependencies:[],loaded:true});
polyMod.preInit = (loader) => window.polycupRuntime.attachPml(loader, MixinType.INSERT);
polyMod.init = () => window.polycupRuntime.init();
ActivePolyModLoader.getAllMods().push(polyMod);
Promise.resolve().then(() => {
ActivePolyModLoader.getFromPolyTrackGlobal = source => eval(source);
${body}
`;
  await writeFile(path.join(root, 'pml-game-source.js'), bootstrap);
}
const browserBuild = await build({
  entryPoints: ['prototype/standalone/entry.ts'],
  outfile: path.join(root, 'polycup.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  metafile: true,
  define: {__POLYCUP_APPLICATION_VERSION__: JSON.stringify(version)},
  loader: { '.css': 'text', '.svg': 'text', '.png': 'dataurl' },
});
const notices = await dependencyNotices(browserBuild.metafile.inputs);
await mkdir(path.join(root,'source'),{recursive:true});
await writeFile(path.join(root,'source/THIRD-PARTY-NOTICES.txt'),notices);
await writeFile(path.join(root,'camera-sweeps.json'),await readFile('prototype/standalone/camera-sweeps.json'));
await mkdir(path.join(root,'auth'),{recursive:true});
for(const name of ['index.html','return.js','return.css'])
  await writeFile(path.join(root,'auth',name),await readFile('account-site/auth/'+name));
const metadata = {
  version,
  accountEnvironment: 1,
  id: createHash('sha256')
    .update(bannerDigest.digest())
    .update(await readFile(path.join(root, 'polycup.js')))
    .update(await readFile(path.join(root,'camera-sweeps.json')))
    .update(await readFile('account-site/auth/return.js'))
    .update(await readFile('account-site/auth/index.html'))
    .update(await readFile('account-site/auth/return.css'))
    .update(archive)
    .update(loaderSourceDigest)
    .update(notices)
    .update(await readFile(new URL(import.meta.url)))
    .update(await readFile('prototype/standalone/startup-shell.mjs'))
    .update(await readFile('assets/polycup-monogram.svg'))
    .update(await readFile('assets/polycup-favicon.png'))
    .update(JSON.stringify({ pml, hub, protocol }))
    .digest('hex')
    .slice(0, 16),
  protocol,
  runtime: pml ? 'pml' : 'adapter',
  shell: hub ? 'hub' : 'qa',
};
await writeFile(path.join(root, 'build.json'), JSON.stringify(metadata));
await writeFile(
  path.join(root, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" sizes="128x128" href="favicon.png"><link rel="icon" type="image/svg+xml" href="favicon.svg"><title>PolyCup</title><script>window.polycupBuild=${JSON.stringify(metadata)};window.polycupClientShell=${JSON.stringify(hub ? 'hub' : 'qa')};window.polycupClientRuntime=${JSON.stringify(pml ? 'pml' : 'adapter')};window.polytrackModConfiguration={modName:'PolyCup',author:'Prawnfoot05'};</script></head><body><canvas id="screen"></canvas><div id="ui"></div><div id="transition-layer"></div>${startupShell()}</body></html>`,
);
console.log('Built local standalone prototype: ' + root);

