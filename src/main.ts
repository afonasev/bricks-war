import './styles.css';
import './toyWorkshop.css';
import './adaptiveArena.css';
import './i18n/language.css';
import './ui/pausePreferences.css';
import { installBrowserInteractions } from './ui/browserInteractions';
import { registerPwaServiceWorker } from './pwa/register';
import { BricksWarApp } from './ui/app';
import { desktop } from './platform/desktop';
import { clientUpdate } from './pwa/clientUpdate';
import { startAfterLoading } from './ui/startupLoading';
import './ui/workshopMenus.css';
import './ui/inputGlyph.css';
import './ui/ownedMenuFocus.css';
import './ui/lobbyCardGeometry.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('App root is missing');

async function start(): Promise<void> {
  const started = await startAfterLoading(root!, () => {
    installBrowserInteractions();
    new BricksWarApp(root!).start();
  });
  if (!started) return;
  if (desktop) { clientUpdate.startDesktop(); void desktop.healthy(); }
  else void registerPwaServiceWorker().catch(() => undefined);
}
void start();
