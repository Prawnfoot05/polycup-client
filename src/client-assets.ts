// Only the PML adapter needs an explicit asset origin (its module URL is a blob).
let base: string | undefined;
export function configureClientAssets(origin: string) {
 if (!['https://polycup.online','https://pilot.polycup.online'].includes(origin)) throw Error('Invalid asset origin');
 base=origin+'/';
}
export function clientAsset(path: string, fallback: string) { return new URL(path,base??fallback).href; }
