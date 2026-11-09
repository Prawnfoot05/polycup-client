import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
export async function dependencyNotices(inputs){
  const packages=new Map();
  for(const name of Object.keys(inputs)){
    if(!name.replaceAll('\\','/').includes('node_modules/'))continue;
    let dir=path.dirname(path.resolve(name));
    while(dir!==path.dirname(dir)){
      try{const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));if(pkg.name&&pkg.version){packages.set(pkg.name+'@'+pkg.version,{dir,pkg});break;}}catch(e){if(e.code!=='ENOENT')throw e;}
      dir=path.dirname(dir);
    }
  }
  const sections=['Third-party notices for dependencies bundled into the PolyCup browser application. PolyTrack native game assets retain their original in-game notices. PolyModLoader source and GPL text are provided separately on the source page.'];
  for(const [name,{dir,pkg}] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
    const names=(await readdir(dir)).filter(n=>/^(?:licen[cs]e|notice|copying)(?:\.|$)/i.test(n));
    if(!names.length)throw Error('Missing bundled dependency licence: '+name);
    sections.push('\n=== '+name+' ('+String(pkg.license??'see text')+') ===\n');
    for(const file of names.sort())sections.push(await readFile(path.join(dir,file),'utf8'));
  }
  sections.push('\n=== OpenSkill-derived rating code ===\n'+await readFile('supabase/OPEN_SKILL_LICENSE.txt','utf8'));
  return sections.join('\n').replaceAll('\r\n','\n')+'\n';
}
