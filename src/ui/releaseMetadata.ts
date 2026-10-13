import { formatBuildInfo } from './buildInfo';

/** Shared menu identity, separate from action buttons. */
export function releaseMetadataMarkup(): string {
  return `<div class="release-metadata"><span class="release-build-info">${formatBuildInfo()}</span><span class="release-footer-credits">© 2026 Evgeniy Afonasev · afonasev.tech · Made with Codex</span></div>`;
}
