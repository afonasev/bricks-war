# Desktop distribution

The game and native shell have separate release channels. The initial installer includes a signed offline game bundle. Game content is downloaded and verified in the background; activation requires the player's Update action in the safe main menu. Local/network matches are never reloaded by discovery. A failed startup rolls back to the previous working bundle; settings use a persistent desktop profile.

## Release commands

- Initial setup once: `npm run desktop:keygen`. Preserve the private Ed25519 key at `~/.config/bricks-war/content-private-key.pem` (override `BRICKS_CONTENT_PRIVATE_KEY` if needed). Only the public key belongs in Git. Do not replace it for an ordinary release: existing clients pin it.
- Ordinary game release: `make deploy`; prepare/sign current game content and publish it alongside the web release once the desktop channel exists. Installers are not rebuilt.
- Native/large/security release: deliberately update shell `extraMetadata.version` in `electron-builder.yml`; update shell ABI/minimum compatibility together when changing the bridge. `npm run desktop:build` builds Universal macOS DMG/ZIP and Windows x64 NSIS.
- Publish the verified source snapshot to the public repository, then run `npm run desktop:release` to create a release and verify every GitHub asset digest. Under the integration lease, `npm run desktop:publish` switches the VPS catalog to those verified GitHub assets; `desktop:publish:content` keeps existing installers. It switches the catalog atomically after checking GitHub asset hashes, retaining a metadata-only VPS bridge for older native clients. Installer binaries are not stored on VPS.
- `npm run test:desktop` checks update integrity/recovery and window preference validation. `node scripts/desktop/smoke.mjs` requires the signing key and a prepared bundle, creates only build-local profiles/feeds, and checks offline play, guarded A→B activation, settings persistence, fullscreen/windowed controls and Exit.

The publisher uses `gfe` (`DEPLOY_HOST` override) and a dedicated `/opt/bricks-war-desktop/release-*` directory. `/opt/bricks-war/desktop` points to the current distribution. The normal web tar upload does not overwrite this channel. The website shows a download action only when the public latest catalog advertises a supported installer; a ready PWA update takes priority. Phones and installed native clients do not show the download action.

Resolution is the preferred window content size, bounded by the monitor work area. Fullscreen uses the current monitor rather than changing the OS display mode. Preferences survive Exit/relaunch.

## Platform gates

Windows fresh installs default to the system Program Files folder (normally `C:\Program Files\Bricks War`) and require administrator approval. The destination remains editable. The final page offers checked desktop-shortcut and launch checkboxes together; no user/system selection is displayed. Manual reinstall repairs a missing shortcut. Silent installs create the shortcut unless `/NoDesktopShortcut` is supplied. Updater installs retain the existing shortcut choice. The NSIS extension is `scripts/desktop/installer-options.nsh`.

Developer ID signing/notarization is required for a production macOS native-shell update journey. Unsigned builds can exercise signed game-content updates but do not prove macOS shell auto-update. Real installation/update on Windows, Intel Mac and Apple Silicon Mac, and human visual acceptance, remain separate from cross-packaging and automated tests.

Public source export: `node scripts/desktop/export-public.mjs /path/to/clean/public-checkout` after committing source. Review the exported diff before pushing; internal evidence/planning and private keys are excluded. The public checkout retains its own LICENSE and history.
