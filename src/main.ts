import './styles.css';
import { installBrowserInteractions } from './ui/browserInteractions';
import { registerPwaServiceWorker } from './pwa/register';
import { BricksWarApp } from './ui/app';
import { desktop } from './platform/desktop';
import { clientUpdate } from './pwa/clientUpdate';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('App root is missing');

installBrowserInteractions();
new BricksWarApp(root).start();
if (desktop) { clientUpdate.startDesktop(); void desktop.healthy(); }
else void registerPwaServiceWorker().catch(() => undefined);
