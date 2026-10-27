const RAW = 'https://raw.githubusercontent.com';
const IMAGE_PATH = /^\/afonasev\/bricks-war\/[a-f0-9]{40}\/docs\/release-notes\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i;
export const RELEASE_IMAGE_LIMIT = 4 * 1024 * 1024;

/** Release images are public raster screenshots pinned to our source revision. */
export function releaseImageUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const url = new URL(value);
    if (url.origin !== RAW || url.username || url.password || url.search || url.hash
      || !IMAGE_PATH.test(url.pathname) || url.pathname.split('/').some(part => part === '.' || part === '..')) return null;
    return url.href;
  } catch { return null; }
}

export function releaseImageSource(value, native = false) {
  const url = releaseImageUrl(value);
  return url && (native ? '/__release-image?url=' + encodeURIComponent(url) : url);
}

function rasterType(bytes) {
  if ([137,80,78,71,13,10,26,10].every((value,i) => bytes[i] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start,end) => String.fromCharCode(...bytes.slice(start,end));
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return 'image/gif';
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'image/webp';
  return null;
}

/** Bounded, cancellable image-only transport; caller supplies the existing activity gate. */
export async function releaseImageResponse(value, fetcher = fetch, signal) {
  const url = releaseImageUrl(value);
  if (!url) return new Response('Forbidden', {status:403});
  const response = await fetcher(url, {redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
  if (!response.ok || !response.body) { await response.body?.cancel(); return new Response('Image unavailable',{status:502}); }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)
    || Number(response.headers.get('content-length') ?? 0) > RELEASE_IMAGE_LIMIT) {
    await response.body.cancel(); return new Response('Unsupported image',{status:415});
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {value:bytes,done} = await reader.read();
      if (done) break;
      size += bytes.length;
      if (size > RELEASE_IMAGE_LIMIT) return new Response('Image too large',{status:413});
      chunks.push(bytes);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  if (rasterType(bytes) !== type) return new Response('Unsupported image',{status:415});
  return new Response(bytes,{headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=86400'}});
}
