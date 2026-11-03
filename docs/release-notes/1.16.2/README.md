# Bridge 1.16.2

## Fixed
- Removed the fixed total duration limit for signed installer and native-component payload downloads. Explicit cancel/activity cancellation, byte limits, trusted redirects and signature/hash checks remain.
- Metadata and the three-second startup discovery budget retain their own bounds.

Fresh installations use this normal all-users bridge installer, then accept migration 1.16.3. An old legacy client can require one manual installation of this bridge if its embedded timeout prevents it from downloading the fix itself. An already-native installation continues through signed component updates; do not overwrite its native namespace with this legacy-layout installer.

Packaged macOS offline/muted startup passed. Real public transport checks are recorded in the maintenance report. Windows execution/UAC and human acceptance remain NotRun/pending; full game suite was not authorized.
