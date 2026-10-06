import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';

/** Real production worker/shell pair, served A then B on the same origin. */
export async function startClientUpdateServer(port = 0) {
  const root = resolve('dist');
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const sw = await readFile(resolve(root, 'sw.js'), 'utf8');
  const revision = sw.match(/url:"index.html",revision:"([^"]+)"/)?.[1];
  if (!revision) throw new Error('Production shell must have a content revision, never revision:null');
  const shells = Object.fromEntries(['A', 'B'].map(id => [id, html.replace('</head>', `<meta name="qa-release" content="${id}"></head>`)]));
  const workers = Object.fromEntries(['A', 'B'].map(id => [id, sw.replace(revision, createHash('md5').update(shells[id]).digest('hex'))]));
  let release = 'A';
  const requests = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    requests.push({ path, release });
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/__qa/release' && req.method === 'POST') {
      release = new URL(req.url, 'http://localhost').searchParams.get('id') === 'B' ? 'B' : 'A';
      res.end(release); return;
    }
    try {
      if (path === '/' || path === '/index.html') {
        res.setHeader('Content-Type', 'text/html'); res.end(shells[release]); return;
      }
      if (path === '/sw.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end(workers[release]); return;
      }
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Client update QA server did not bind a TCP port');
  return { origin: `http://127.0.0.1:${address.port}`, requests, setRelease: id => { release = id; }, close: () => new Promise(resolve => server.close(resolve)) };
}
