# PolyCup

PolyCup 0.6.3, by Kiki. Ranked and casual multiplayer for PolyTrack 0.6.3, built with PolyModLoader.

One-round ranked races, casual FFA and teams, practice while queued, match replays, track leaderboards, and player profiles with social features and unlockable rewards.

[Play in your browser](https://polycup.online/) · [Discord](https://discord.gg/BpZp5sZ5jg) · [Changelog](CHANGELOG.md)

This repository contains the standalone client source and bundled loader source. The compatible [PML distribution](https://github.com/Prawnfoot05/PolyCup) shares the live service.

## Build

Requires Node.js 24.

```sh
npm ci
npm run prepare:game
npm run build
```

Output: `output/standalone/site-pml/`. PolyTrack game files are fetched locally and are not included in this repository. Online features require a compatible PolyCup backend; backend services, deployment tools, private configuration and player data are not included.

Unofficial community project based on PolyTrack by [Kodub](https://www.kodub.com/) and [PolyModLoader](https://polymodloader.com/). Not affiliated with or endorsed by Kodub. Application code is GPL-3.0-or-later; see [LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md) for scope and credits.
