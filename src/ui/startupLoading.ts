export const STARTUP_LOADING_MINIMUM_MS = 2_000;

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

/** Initial HTML already owns the surface; same-document menu navigation never creates it. */
export async function startAfterLoading(root: HTMLElement, start: () => void): Promise<boolean> {
  const loading = document.getElementById('startup-loading');
  if (!loading) return false; // An earlier startup failure already exposed recovery.
  while (loading.isConnected && loading.dataset.shownAt === undefined) await nextFrame();
  if (!loading.isConnected) return false;
  const deadline = Number(loading.dataset.shownAt) + STARTUP_LOADING_MINIMUM_MS;
  while (loading.isConnected && performance.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, Math.ceil(deadline - performance.now())));
  }
  if (!loading.isConnected) return false;
  // The app activates gamepad polling/focus on start. Start and reveal in one task,
  // after the minimum, so no programmatic input can navigate a covered menu.
  root.inert = false;
  root.removeAttribute('aria-busy');
  try { start(); } finally { loading.remove(); }
  return true;
}
