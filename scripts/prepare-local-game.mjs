import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unpack} from './asar.mjs';

const url='https://git.polymodloader.com/polytrackmods/PolyModLoader/releases/download/v0.6.3-1/app.asar';
const expected='5c09a6ab0146797c147b603e0367f14d15e235be77392ca96df66ea81d3b12f8';
const file='.research/pml-0.6.3-1.asar';
let bytes;
try{bytes=await readFile(file);}catch(e){
 if(e.code!=='ENOENT')throw e;
 const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Pinned baseline download failed: HTTP '+response.status);
 bytes=Buffer.from(await response.arrayBuffer());
}
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned baseline checksum mismatch');
await mkdir('.research/PolyModLoader',{recursive:true});
await writeFile(file,bytes);
const font=unpack(bytes).get('forced_square.woff2');
if(!font)throw Error('Pinned baseline font missing');
await writeFile('.research/PolyModLoader/forced_square.woff2',font);
console.log('Pinned upstream baseline verified; game/font remain in ignored .research/.');
