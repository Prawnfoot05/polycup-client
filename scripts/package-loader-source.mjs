import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export async function removeApplicationSourceArtifacts(root){
  // These exact files came from the unshipped source-release proposal. Never remove directories.
  for(const name of ['polycup-source.tar.gz','polycup-source.sha256','COPYRIGHT.md','POLYCUP-LICENSE.txt','SOURCE-README.md']){
    try{await unlink(path.join(root,'source',name));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
}
export async function packageLoaderSource(root,baseline){
  const destination=path.join(root,'source'),vendor='assets/vendor/pml-0.6.3-1';
  const names=['src/PolyModLoader.ts','src/PolyTypes.ts','src/tsconfig.json','LICENSE.md','README.md','package.json','package-lock.json','build.mjs'];
  const digest=createHash('sha256');
  for(const name of names){
    const bytes=await readFile(path.join(vendor,name));
    await mkdir(path.dirname(path.join(destination,name)),{recursive:true});
    await writeFile(path.join(destination,name),bytes);
    digest.update(name).update(bytes);
  }
  // Fail closed if a different native loader is substituted without updating its source package.
  const expected={'PolyModLoader.js':'61f64b8cbab16f4241ff5f6c0d8b8510b6fbf056ac441838eee06c33ccf28d0d','PolyTypes.js':'95cfd271441900c5ddeec310fcc415a75536501bffa590edceec7be52ef8a5e4'};
  for(const [name,hash] of Object.entries(expected)){
    if(createHash('sha256').update(baseline.get(name).toString().replaceAll('\r\n','\n')).digest('hex')!==hash)throw Error('Loader source baseline changed');
  }
  const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PolyCup — loader source and licences</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;background:#151e36;color:#e8edf8;font:17px/1.6 system-ui;overflow-wrap:anywhere}a{color:#ffdc79}li{margin:8px 0}h1{font-size:28px}</style><h1>Loader source and licences</h1><p>PolyTrack is created by <a href="https://www.kodub.com/">Kodub</a>. PolyCup is an unofficial mod. <a href="https://www.crazygames.com/game/polytrack">Play the original PolyTrack</a>.</p><p>The bundled PolyModLoader is copyright © 2026 the polytrackmods team, licensed under GNU GPL v3 or later. This package contains the loader's source, the PolyCup modification and build instructions. The PolyCup client source is provided in this repository under GPL v3 or later.</p><ul>${names.map(n=>`<li><a href="${n}" download>${n}</a></li>`).join('')}</ul><p><a href="THIRD-PARTY-NOTICES.txt" download>Dependency notices</a> · <a href="https://github.com/polytrackmods/PolyModLoader/tree/6ba4f099a7b9b11ba88c7152d2246240ba04a6d7">Upstream release source</a> · <a href="../LICENSE.md" download>Loader licence</a> · <a href="../">Back to PolyCup</a></p><p>Contact, privacy and account-deletion requests: <a href="mailto:suchworth@gmail.com">suchworth@gmail.com</a>.</p>`;
  await writeFile(path.join(destination,'index.html'),page);
  return digest.update(page).digest('hex');
}
