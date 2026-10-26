import { formatBuildInfo } from './buildInfo';

/** Shared menu identity, separate from action buttons. */
export function releaseMetadataMarkup(): string {
  return `<div class="release-metadata"><span class="release-version"><span class="release-build-info">${formatBuildInfo()}</span> ·</span><span class="release-footer-credits">© 2026 Evgeniy Afonasev · afonasev.tech</span></div>`;
}
