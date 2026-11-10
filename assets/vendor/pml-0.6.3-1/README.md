# PolyModLoader source bundled with PolyCup

Copyright (C) 2026 the polytrackmods team. GNU GPL version 3 or later; see LICENSE.md.

Upstream: https://github.com/polytrackmods/PolyModLoader/tree/6ba4f099a7b9b11ba88c7152d2246240ba04a6d7
Release: v0.6.3-1. The upstream compiled loader and types match the pinned game archive after normalizing CRLF/LF line endings.

The TypeScript sources are unchanged. PolyCup makes one change to the compiled loader: `fetch("/package.json")` becomes `fetch(new URL("package.json", import.meta.url))`. This resolves metadata beside the loader in immutable release directories. The included build script applies this change after compiling. Its modification date is 30 October 2026. There are no changes to PolyTypes.js.

Download this directory preserving its layout. With Node.js and npm installed:

    npm ci
    npm run build

The output is dist/PolyModLoader.js and dist/PolyTypes.js. TypeScript is pinned to 6.0.3 in package-lock.json. Declaration files are generated too. No game files, accounts or server credentials are needed to rebuild these loader modules.

This directory covers the PolyModLoader modules only. It does not publish or assign a licence to PolyCup's private application source. PolyTrack's native code and assets are by Kodub and retain their original terms.
