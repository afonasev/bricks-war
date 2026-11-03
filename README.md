# Bricks War

<!-- bricks-war-downloads:start -->
## Download / Скачать

| Windows | macOS |
| --- | --- |
| **[Download EXE](https://github.com/afonasev/bricks-war/releases/download/v1.16.0/Bricks-War-1.16.0-win-x64.exe)** | **[Download DMG](https://github.com/afonasev/bricks-war/releases/download/v1.16.0/Bricks-War-1.16.0-mac-universal.dmg)** |

[Installer releases / Только установщики](https://github.com/afonasev/bricks-war/releases?q=tag%3Av1%20prerelease%3Afalse) · [Play in browser / Играть в браузере](https://bricks.afonasev.tech/)

Installer version: **1.16.0**. The installed game receives newer game content through its updater.
<!-- bricks-war-downloads:end -->

Browser and desktop block-puzzle arena with local and network play, human players and AI opponents.

- Play: https://bricks.afonasev.tech/
- [Quick start in seven languages](docs/player-guide.md)
- [Credits and asset provenance](docs/credits.md)

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

The web build is in `dist/`. Native packaging and signed game updates are documented in [Desktop distribution](docs/desktop-distribution.md). Official release signing keys are private and are not included.

## License

MIT; see [LICENSE](LICENSE).
