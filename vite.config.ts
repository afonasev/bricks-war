import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { isGameTuningPayload } from './src/domain/gameTuning';

const GAME_TUNING_ENDPOINT = '/__debug/game-tuning';
const NETWORK_PORT = Number(process.env.BRICKS_NETWORK_PORT ?? 4190);
const GAME_TUNING_FILE = new URL('./config/game-tuning.json', import.meta.url);
const packageInfo = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const DEPLOYMENT_BUILD_FILE = new URL('./config/deployment-build.json', import.meta.url);
interface DeploymentBuildInfo { version: string; deployedAt: string; }

async function readDeploymentBuildInfo(): Promise<DeploymentBuildInfo | null> {
  try {
    const metadata = JSON.parse(await readFile(DEPLOYMENT_BUILD_FILE, 'utf8')) as Partial<DeploymentBuildInfo>;
    return typeof metadata.version === 'string' && typeof metadata.deployedAt === 'string' ? metadata as DeploymentBuildInfo : null;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}
const faviconDataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const productionFavicon = faviconDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#080b18"/><path d="M6 6h8v8H6zm9 0h8v8h-8zM6 15h8v8H6zm9 9h8v-9h-8z" fill="#45e391"/><path d="M15 6h8v8h-8zm0 18h8v-9h-8z" fill="#31c9ff"/></svg>`,
);
const developmentFavicon = faviconDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="6" fill="#080b18" stroke="#ffd83d" stroke-width="3"/><path d="M6 6h8v8H6zm9 0h8v8h-8zM6 15h8v8H6zm9 9h8v-9h-8z" fill="#45e391"/><path d="M15 6h8v8h-8zm0 18h8v-9h-8z" fill="#31c9ff"/></svg>`,
);

function faviconPlugin(assetRevision: string): Plugin {
  return {
    name: 'environment-favicon',
    transformIndexHtml(html, context) {
      return html
        .replace('__BRICKS_WAR_FAVICON__', context.server ? developmentFavicon : productionFavicon)
        .replace('__BRICKS_WAR_ASSET_REVISION__', assetRevision);
    },
  };
}

function installGameTuningEndpoint(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (request, response, next) => {
    const incoming = request as unknown as AsyncIterable<Uint8Array | string> & {
      method?: string;
      socket: { remoteAddress?: string };
      url?: string;
    };
    const pathname = new URL(incoming.url ?? '/', 'http://localhost').pathname;
    if (pathname !== GAME_TUNING_ENDPOINT) {
      next();
      return;
    }
    const remoteAddress = incoming.socket.remoteAddress ?? '';
    const localRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    if (!localRequest) {
      response.statusCode = 403;
      response.end(JSON.stringify({ ok: false, error: 'Local requests only' }));
      return;
    }
    if (incoming.method === 'GET') {
      try {
        const payload: unknown = JSON.parse(await readFile(GAME_TUNING_FILE, 'utf8'));
        if (!isGameTuningPayload(payload)) throw new Error('Invalid game tuning file');
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ ok: true, file: 'config/game-tuning.json', tuning: payload }));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Load failed' }));
      }
      return;
    }
    if (incoming.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, POST');
      response.end(JSON.stringify({ ok: false, error: 'GET or POST required' }));
      return;
    }
    try {
      const decoder = new TextDecoder();
      let body = '';
      let size = 0;
      for await (const chunk of incoming) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        size += text.length;
        if (size > 64 * 1024) throw new Error('Payload is too large');
        body += text;
      }
      body += decoder.decode();
      const payload: unknown = JSON.parse(body);
      if (!isGameTuningPayload(payload)) throw new Error('Invalid game tuning payload');
      await writeFile(GAME_TUNING_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, file: 'config/game-tuning.json' }));
    } catch (error) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Save failed' }));
    }
  });
}

function gameTuningFilePlugin(): Plugin {
  return {
    name: 'game-tuning-file',
    configureServer: installGameTuningEndpoint,
    configurePreviewServer: installGameTuningEndpoint,
  };
}

function phaserReadonlyFeatureDetectorPlugin(): Plugin {
  return {
    name: 'phaser-readonly-feature-detector',
    transform(code, id) {
      if (!id.endsWith('/phaser/dist/phaser.esm.js')) return null;
      const guarded = code
        .replace(
          'navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia || navigator.oGetUserMedia;',
          'try { navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia || navigator.oGetUserMedia; } catch {}',
        )
        .replace(
          'window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL;',
          'try { window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL; } catch {}',
        )
        .replace(
          'navigator.vibrate = navigator.vibrate || navigator.webkitVibrate || navigator.mozVibrate || navigator.msVibrate;',
          'try { navigator.vibrate = navigator.vibrate || navigator.webkitVibrate || navigator.mozVibrate || navigator.msVibrate; } catch {}',
        );
      if (guarded === code) throw new Error('Phaser FeatureDetector source changed; readonly-property guard was not applied');
      return { code: guarded, map: null };
    },
  };
}

export default defineConfig(async ({ command }) => {
  const deployment = command === 'build' ? await readDeploymentBuildInfo() : null;
  const version = command === 'serve' ? `${packageInfo.version}-dev` : (deployment?.version ?? packageInfo.version);
  const assetRevision = command === 'serve' ? packageInfo.version : (deployment?.version ?? packageInfo.version);
  const deployedAt = command === 'serve' ? '' : (deployment?.deployedAt ?? '');
  return {
  base: './',
  server: { proxy: { '/api/network': { target: `http://127.0.0.1:${NETWORK_PORT}` }, '/network/socket': {target:`ws://127.0.0.1:${NETWORK_PORT}`,ws:true} } },
  preview: { proxy: { '/api/network': { target: `http://127.0.0.1:${NETWORK_PORT}` }, '/network/socket': {target:`ws://127.0.0.1:${NETWORK_PORT}`,ws:true} } },
  define: {
    __BRICKS_WAR_VERSION__: JSON.stringify(version),
    __BRICKS_WAR_DEPLOYED_AT__: JSON.stringify(deployedAt),
  },
  plugins: [
    faviconPlugin(assetRevision),
    gameTuningFilePlugin(),
    phaserReadonlyFeatureDetectorPlugin(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        name: 'Bricks War',
        short_name: 'Bricks War',
        description: 'Локальная Tetris-арена для людей и ИИ',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#fff9ec',
        theme_color: '#080b18',
        icons: [
          { src: `pwa-192.png?v=${assetRevision}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `pwa-512.png?v=${assetRevision}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Singlefile sets assetsDir to empty; PWA's default regex would match
        // index.html and incorrectly omit its content revision.
        dontCacheBustURLsMatching: /^assets\/.*-[A-Za-z0-9_-]{8,}\./,
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        // Exact approved WAVs are inlined in the single-file game (currently 5.79 MB).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        skipWaiting: false,
      },
    }),
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    target: 'es2019',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  };
});
