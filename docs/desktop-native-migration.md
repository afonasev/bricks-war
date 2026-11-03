# Native migration source recipe

This is an opt-in source SDK, not a published migration. The default installer/release workflow remains legacy-compatible. Do not advertise native-only packages to old installed clients before their compatible migration is available.

`scripts/desktop/native-package.mjs` exports signing/assembly functions. Inputs are already packaged client apps, the independent native launcher core, a native root compiled with the same public key, and an externally supplied Ed25519 release key. Outputs must be outside the repository. Each component has its own monotonic sequence, signed immutable inventory and exact digest. Production packaging rejects fixture roots. The root embeds its ABI/platform/architecture/key fingerprint so a cross-built Windows executable can be inspected without running it.

## Windows first migration

Build the production root for the target Windows architecture. Set `BRICKS_BOOTSTRAP_ICON` to an ICO converted from the existing game icon; the build script links that resource. This preserves the icon when the original app EXE becomes the native shim. Neither the production pinned key nor release key is overridden by runtime environment variables.

Sign a launcher tree with entry `core.exe` and args `['core']`, and a client tree whose top-level entry is the historical product EXE and whose signed `profileProbe` contract is enabled. `assembleWindowsLayout` produces:

- `legacy-app/`: the exact prepackaged client used by the first migration installer.
- `native/`: stable helper, signed seed slots and initial references.
- `installer-seed.json`: signed descriptor pinning the helper, both component identities and original app entry bytes.
- `native-registry.nsh`: fixed production registration namespace; fixture keys use an isolated QA namespace.

The opt-in `electron-builder.native.yml` is used with `--prepackaged <layout>/legacy-app` and `BRICKS_NATIVE_LAYOUT=<layout>`. No shipping installer is built by the SDK. On macOS, run NSIS with `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8`; `C.UTF-8` is not a supported macOS locale and caused compiler/encoding failures in QA. The elevated installer runs the embedded helper from its private plugin directory, creates a new protected namespace and verifies the signed bytes independently. It atomically replaces only the descriptor-bound original EXE with the identical native root shim. Existing shortcuts keep their targets and arguments. A protected pre-overwrite baseline restores that original EXE and original install/uninstall registration; user backup directories and mutable elevated restore scripts are not used. Ordinary launch refuses elevation before invoking the signed profile probe. Updater workers and elevated IPC use the canonical protected `native/bricks-bootstrap.exe`.

Before removing the old client, customInit freezes/audits the existing HKLM-registered all-users installation and builds a protected sibling `<install>.bricks-rollback` with a bounded hash inventory, original registration values and a registered fixed restore helper. The migration recipe keeps that existing path and disables directory selection; it is not a fresh-install recipe. The PowerShell parent verifies the recovery registry owner/DACL before RunAs; the native restore accepts no caller source/destination. It stops no foreign game: original-session candidate cleanup is unelevated, and native restore refuses any remaining installed process. The complete baseline is retained for explicit recovery, including interruption between restore renames. Automatic reboot recovery of this first-install directory swap is not claimed.

Windows activation requires signed updater ABI2 and selected-file `protectedRollbackAbi: 1`. Shipped ABI1 helpers reject this envelope; do not advertise native migration to them through their unchanged unsafe restore code. An independently delivered compatible bridge and isolated Windows first-migration verification are release gates. The default release writer emits legacy ABI1 and does not grant protected capability. Read-only published-client/content compatibility inspection remains able to recognize existing ABI1 packages.

This one-time recipe refuses an existing native namespace. Normal subsequent updates use the signed component protocol, not another full installer. A failed first install can leave a protected namespace/registration for diagnosis; it is not silently deleted or repurposed.

The privileged broker accepts bounded signed-source operations only, authenticates the original logon/session and process, pins non-reparse local paths with handles and independently verifies protected copies. It never launches a game. The original-user worker launches candidates, relays two exact nonce/digest/PID proofs and waits for the full health contract. Commit records the compound decision before individual references; restart completes that decision. Ordinary launch and recovery observations write only per-user state. No slot used by another session is reclaimed.

## macOS first migration

`assembleMacRoot` builds a separate outer `.app` using the existing icon and unchanged signed payload bundles. The signed client profile probe returns the actual historical Electron userData before windows/audio. Signed launcher/client slots then live under that original profile; local health/download/worker state lives under per-user application state. Signing/notarization of the new outer root is a separate release gate. In-place mutation of a signed outer `.app` is not part of this protocol.

## Evidence and remaining gates

Use `scripts/desktop/smoke-installed-launcher.mjs` for an isolated macOS native-root/real-Electron pair update, original localStorage/profile retention, consent beyond 90 seconds, muted launch and offline reuse. `smoke-native-bootstrap.mjs` has explicit installed and durable-commit scenarios; its activation horizon remains 90 seconds. Fixtures use ephemeral keys and external QA directories.

Cross-compilation and portable fixtures do not establish Windows UAC, alternate-admin, ACL/reparse/session behavior or physical installation acceptance. Those remain NotRun until the isolated Windows matrix runs. Actual migration through the already shipped old helper, signing/notarization and published asset eligibility also remain separate gates. A failed compiler or runtime attempt remains FAIL in the change evidence. Full game QA and publication require their separate commands.

The protected rollback baseline uses Users read/execute permissions. Before preparing it, the helper requires explicit public read grants on each original object and rejects effective deny/private/ambiguous ACLs without creating a baseline. This is deliberately conservative for custom installations. Baseline reuse/restore requires the protected read-admission marker; an older baseline without that marker is not automatically trusted by the current helper. Actual ACL behavior must be verified in the isolated Windows matrix.

## Guarded production migration release

The first native release uses stable non-latest v1.16.1. Fresh installs use v1.16.0, then consent to the in-game migration. Windows installation/UAC is explicitly deferred to post-publication human testing; it remains NotRun. The migration-only installer still requires the protected installed baseline.

Build freshly versioned clients with the native config, separately `--dir --mac --universal` and `--dir --win --x64`, output `build/native-clients`, then run `node scripts/desktop/build-native-release.mjs <external-output> <universal-root> <windows-root>`. The SDK signs component inventories, assembles immutable roots, packages both platforms, and signs an exact-byte build receipt. Publish with `BRICKS_INSTALLER_DIRECTORY=<external-output>/installers node scripts/desktop/github-release.mjs --native-migration`. The guarded publisher checks that receipt against HEAD, both signed archives and all installer bytes before granting ABI2/protectedRollbackAbi1, uploads native-manifest and migration-only assets, and uses latest=false. It never switches VPS generic metadata or ordinary download links.

The signed shell installationKind and migration-only asset keep content download presentation and installer-link automation on the complete fresh bridge. Public export includes tracked native source and the opt-in recipe. Signing keys and raw layouts stay external.

`smoke-production-native-migration.mjs <published-1.16.0-bridge.zip> <external-1.16.1-SDK-assembly>` retains the exact packaged migration and controlled failed-start recovery witness. It uses local signed preparation, distinct external QA profiles, `-muted`, the real helper, and the full 90-second horizon. Its source consolidates the recorded production-success and corrected fault runs; public transport and Windows acceptance remain separate.

The 1.16.0 bridge has a 120-second archive-transfer deadline. Publication readback observed a slow connection exceeding that budget for the 381-MB Windows migration EXE. Keep the manual migration EXE as the recovery path over the existing all-users 1.16.0 install; a fresh PC still starts with 1.16.0. Do not claim Windows automatic migration acceptance from cross-packaging or public download checks.
