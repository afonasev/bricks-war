# Independent bootstrap source primitive

This crate supplies the Electron-independent trust, launch and durable state boundary for `seamless-launcher-updates`. It is **not installed or published**. Existing installers/shortcuts and legacy Electron shell replacement still use their previous path. The required installed-migration child must connect them before claiming seamless installed updates.

The stable `bricks-bootstrap` root has the compiled `electron/content-public-key.pem`; it has no runtime key override and no dependency on a working Electron installation. Separately signed `launcher` and `client` trees live under `<root>/<component>/slots/<SHA256-of-signed-payload>/`. Logical active/previous slots retain entire trees. A launcher payload can contain a versioned copy of this binary with signed arguments `["core"]`; it validates/starts the client and reports its own health only after the client proves health. Thus root → core → Electron uses distinct health contracts. The root never overwrites itself or mutates a signed outer `.app`.

```
bricks-bootstrap stage ABS_ROOT client SIGNED_SOURCE_TREE
bricks-bootstrap activate ABS_ROOT client -- -muted
bricks-bootstrap stage ABS_ROOT launcher SIGNED_CORE_TREE
bricks-bootstrap activate ABS_ROOT launcher -- -muted
bricks-bootstrap run ABS_ROOT launcher -- -muted
bricks-bootstrap recover ABS_ROOT client
bricks-bootstrap status ABS_ROOT client
```

`stage` is a preparation primitive, not a consent UI: only trusted coordinator/installer code may invoke it after the existing frozen-target consent. No networking, release selection or late dialogs are implemented here. Root only starts signed entrypoints and arguments plus the original caller's launch flags. `core` is an internal signed launcher entry mode using `BRICKS_BOOTSTRAP_ROOT`; ordinary installed shortcuts must eventually target the stable native root rather than `core` directly.

## Signed tree ABI 1

`bootstrap-manifest.json` is an envelope `{payload: "exact JSON string", signature: "base64 Ed25519"}`. Payload fields: `schema:1`, `game:"bricks-war"`, `channel:"stable"`, `component:"launcher"|"client"`, `platform:"darwin"|"win32"`, `arch:"arm64"|"x86_64"|"universal"`, `version:"x.y.z"`, positive monotonic `sequence`, `root_abi:1`, executable `entry`, signed `args` and complete `files` inventory. Native Windows arch currently uses Rust's `x86_64` string. A regular entry is `{path,size,sha256,executable}`; an explicitly signed macOS framework alias is `{path,link}`. Symlinks must resolve inside the payload, and physical files cannot be reached through a symlink parent. Windows payloads have no symlinks/reparse entries. All file paths use an ASCII portable namespace, rejecting traversal, ADS/device aliases, case collisions, trailing dots/spaces and unknown files. Unknown JSON fields fail closed. Empty directories do not authorize any extra files.

Validation runs before copying, after copying and immediately before execution. Source may be untrusted; destination must be private/protected against concurrent untrusted mutation. Signed bytes cannot protect a writable executable after its final hash check.

## State and recovery

Each lane uses an exclusive process lock and bounded `state.json`. New records are written to a unique sibling, flushed, atomically replaced and the parent synced on Unix. Windows uses `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` after flushing the file. Actual storage/power-loss behavior remains a platform test; process fault injection is not a physical power-loss test.

Preparation renames a fully verified/flushed immutable tree before publishing its ready identity. Activation first saves the target/nonce transaction; child PID/start/boot identity is saved next. Only a receipt matching nonce, signed payload digest and immediate child PID while the child is alive commits the active reference. Startup waits up to **90 seconds**, using a monotonic clock. A receipt from a prior version/process cannot commit. Early exit/timeout/stale receipt stops the candidate, durably records its failed digest and launches the retained verified active tree. After commit, cleanup errors cannot undo activation. A later corrupt/nonstarting active tree can select the verified previous tree. Failed digests cannot be prepared automatically; a corrected newly signed identity is required.

Receipts are private **original-user** files, outside an all-users install directory (`BRICKS_BOOTSTRAP_HEALTH_ROOT`, otherwise the current user's application-data directory). The child receives `BRICKS_BOOTSTRAP_NONCE`, `BRICKS_BOOTSTRAP_DIGEST` and `BRICKS_BOOTSTRAP_RECEIPT`. Electron consumes these before spawning helpers and writes its exact receipt only after its existing healthy event. The core replaces the child's contract and proxies health with its own PID to the root. This is a startup health proof, not a renderer/device acceptance claim.

Recovery never guesses that uncommitted health is committed. It validates the previous active identity, records the interrupted candidate digest and removes the pending reference. It refuses recovery while the recorded PID/start/boot identity or a process executable inside that tree is alive, covering the spawn-to-PID-record gap. It never kills a PID inferred from an old journal. Normal running processes are journaled too, including after commit. All working/pending trees remain present; no automatic evidence expiry or payload garbage collection is implemented.

## Platform boundary still open

The source fixture uses a private sandbox, **not** Program Files or `/Applications`. Elevated native processes refuse all payload launches. Windows per-machine protection still requires the upcoming installer/helper integration: fixed protected install root, ACL/owner checks, protected staging copy, independent signature/hash checks under elevation, handle-based reparse/TOCTOU protection, health-bound protected reference commit and unelevated original-session game launch. This crate's path checks alone do not establish that elevated trust boundary. No claim is made that an arbitrary user-supplied path is safe for an admin helper. Existing legacy PowerShell/NSIS flow must not be silently substituted for this missing contract.

Also open: both installed entrypoint migrations, code signing/notarization, root distribution/update policy, platform-specific application lifecycle/descendant processes, real UAC denial/alternate credentials, actual app bundle replacement, all-users concurrency and real power-loss tests. The existing three-second discovery budget is separate from native signature verification and the 90-second startup-health horizon. Full installed behavior remains owned by the parent initiative.

## Focused QA

Build/check targets go outside Git: `CARGO_TARGET_DIR="$BRICKS_QA_HOME/<unique-run>/target" cargo test --locked --manifest-path native/bootstrap/Cargo.toml`. `node scripts/desktop/smoke-native-bootstrap.mjs` builds an explicitly fixture-only binary with a compiled ephemeral public key, signs tiny native app/core fixtures and exercises actual processes. The `fixture` feature requires compile-time `BRICKS_BOOTSTRAP_TEST_KEY`; only this feature enables abrupt checkpoint exits. Never ship a fixture-feature binary. Production default builds use the source-pinned release key.

The harness preserves output/report/logs under the external QA store and never edits an installed game, production key, profile, shortcut or service. All autonomous game launch flags use `-muted`. Actual Windows execution and installed/device acceptance are reported separately from source compilation and these fixtures.
