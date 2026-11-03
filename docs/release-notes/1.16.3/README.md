# Native migration 1.16.3

## Fixed
- Migration from bridge 1.16.2 and subsequent signed native component transfers can finish beyond two minutes on slow connections.
- Cancellation still stops a pending payload and returns the installed working game; incomplete, oversized or corrupt bytes never create readiness.

Stable migration-only release; fresh downloads remain on bridge 1.16.2. Actual packaged macOS cancellation and bridge→production native migration passed with a controlled 125003-ms stream delay, retained profile and the exact signed client identity. The 90-second post-download health contract remains unchanged.

Already installed older clients retain their own code until they acquire the fix; publication cannot retroactively remove that old deadline. Windows execution/UAC and human acceptance remain NotRun/pending. Cross-platform source preparation and public byte checks do not establish Windows installation acceptance.
