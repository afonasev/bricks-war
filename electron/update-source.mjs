export const CONTENT_REPOSITORY = 'afonasev/bricks-war';
export const CONTENT_FEED = 'https://afonasev.github.io/bricks-war/desktop/game/latest.json';
const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

export function contentAssetUrl(sequence, sha256) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^[a-f0-9]{64}$/.test(sha256)) throw Error('Invalid content asset');
  return `https://github.com/${CONTENT_REPOSITORY}/releases/download/content-${sequence}/${sha256}`;
}

function trustedRedirect(value, original) {
  const url = new URL(value, original);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw Error('Untrusted update redirect');
  if (!(url.origin === 'https://github.com' && url.pathname === new URL(original).pathname && !url.search)
    && !CDN_HOSTS.has(url.hostname)) throw Error('Untrusted update redirect');
  return url.href;
}

/** Each redirect is checked before fetching; renderer input never supplies an origin. */
export function githubContentDownload(fetcher) {
  return async (path, limit, file) => {
    if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid download limit');
    const assetUrl = path === 'latest.json' ? null : contentAssetUrl(file?.sequence, file?.sha256);
    const original = path === 'latest.json' ? CONTENT_FEED
      : path === 'manifest.json' ? assetUrl.slice(0, assetUrl.lastIndexOf('/') + 1) + 'manifest.json' : assetUrl;
    let url = original;
    const signal = file?.signal ? AbortSignal.any([AbortSignal.timeout(30_000), file.signal]) : AbortSignal.timeout(30_000);
    for (let hops = 0; hops <= 5; hops++) {
      const response = await fetcher(url, { bypassCustomProtocolHandlers: true, redirect: 'manual', cache: 'no-store', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (original === CONTENT_FEED || !location || hops === 5) throw Error('Invalid update redirect');
        url = trustedRedirect(location, original);
        continue;
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Update unavailable'); }
      if (Number(response.headers.get('content-length') ?? 0) > limit) {
        await response.body.cancel(); throw Error('Oversized update');
      }
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > limit) throw Error('Oversized update');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      return Buffer.concat(chunks);
    }
    throw Error('Too many update redirects');
  };
}
