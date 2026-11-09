import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root,'dist'),{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'-p',path.join(root,'src')],{stdio:'inherit'});
const file=path.join(root,'dist/PolyModLoader.js');
const source=await readFile(file,'utf8'),from='fetch("/package.json")';
if(source.split(from).length!==2)throw Error('Unexpected loader package fetch');
// PolyCup modification, 30 October 2026: resolve metadata beside the immutable loader.
await writeFile(file,source.replace(from,'fetch(new URL("package.json", import.meta.url))'));
console.log('Built dist/PolyModLoader.js and dist/PolyTypes.js');
