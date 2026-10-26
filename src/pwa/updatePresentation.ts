import { text } from '../i18n/locale';
import type { ClientUpdateState } from './clientUpdate';

export function updatePresentation(state: ClientUpdateState) {
  const busy = ['checking','downloading','verifying','paused'].includes(state.phase ?? '');
  const ready = state.phase === 'ready';
  const failedCheck = state.phase === 'check-error';
  const failedInstall = state.phase === 'install-error';
  const shellRequired = state.phase === 'shell-required';
  return {
    visible: state.available || busy || state.error || failedCheck || shellRequired,
    disabled: state.applying || state.blocked || busy || failedCheck || failedInstall || shellRequired,
    announcement: state.version ? text('updateVersion', { version: state.version }) : text('updateAnnouncement'),
    label: state.applying ? text('updateApplying') : state.phase === 'downloading' ? text('updateDownloading', { progress: Math.floor(state.progress ?? 0) })
      : state.phase === 'verifying' ? text('updateVerifying') : state.phase === 'paused' ? text('updatePaused') : state.phase === 'checking' ? text('updateChecking')
      : shellRequired ? text('updateShellRequired') : failedInstall ? text('updateInstallFailed') : failedCheck ? text('updateCheckFailed') : ready ? text('updateRestart') : state.phase === 'download-error' ? text('updateRetry') : text('updateAction'),
    status: state.blocked ? text('updateBlocked')
      : shellRequired ? text('updateShellUnavailable')
      : failedInstall ? text('updateInstallHelp')
      : failedCheck ? text('updateCheckHelp')
      : ready ? text('updateReadyHelp')
      : state.error ? text(state.phase === undefined ? 'updateApplyHelp' : 'updateDownloadHelp')
      : state.phase === 'downloading' ? text('updatePlayingHelp')
      : state.version ? text('updateVersion', { version: state.version }) : '',
  };
}

/** The native menu keeps every update message inside its two actions. */
export function nativeUpdatePresentation(state: ClientUpdateState) {
  const presentation = updatePresentation(state);
  const cancel = !state.applying && ['downloading', 'verifying', 'paused'].includes(state.phase ?? '');
  return {
    visible: presentation.visible,
    disabled: cancel ? false : presentation.disabled,
    cancel,
    heading: state.version ? presentation.announcement : text('releaseHistory'),
    label: state.phase === 'shell-required' ? text('updateAction') : presentation.label,
    hint: cancel ? text('cancelDownload')
      : state.blocked || state.phase === 'shell-required' || state.phase === 'install-error' || state.phase === 'check-error' || state.error ? presentation.status
      : '',
  };
}
