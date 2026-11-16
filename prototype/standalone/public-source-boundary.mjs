// Only upstream loader source is public. PolyCup application source stays private.
export const publicLoaderFiles = new Set([
  'source/index.html','source/LICENSE.md','source/README.md','source/package.json',
  'source/package-lock.json','source/build.mjs','source/src/PolyModLoader.ts',
  'source/src/PolyTypes.ts','source/src/tsconfig.json','source/THIRD-PARTY-NOTICES.txt',
]);
export function assertPrivateApplicationRelease(files,build={}){
  if('applicationSource' in build)throw Error('Private application source cannot be published');
  for(const name of files){
    if((name.startsWith('source/')&&!publicLoaderFiles.has(name))||
      /^(?:src|scripts|prototype|supabase|account-site|output|\.research|\.git)\//.test(name)||
      /\.(?:tar\.gz|tgz|zip|asar|age|agekey|pem|key)$|\.env(?:\.|$)/i.test(name))
      throw Error('Private application source or operator file in release: '+name);
  }
}
