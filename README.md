# PolyCup

PolyCup 0.6.1 browser client, based on PolyTrack 0.6.3 and PolyModLoader.

```sh
npm ci
npm run prepare:game
npm run build
npm run build:pml
```

Requires Node.js 24. Site: `output/standalone/site-pml/`; PML package: `output/pml-release/`. Running online features requires a compatible PolyCup backend; private hosting tools are not included.

PolyCup application code: GPL-3.0-or-later. See [LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md). PolyTrack game files are fetched locally and are not included in this repository.
