import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_FEED, contentAssetUrl, githubContentDownload } from '../../electron/update-source.mjs';
const hash = 'a'.repeat(64);
const file = { sequence: 42, sha256: hash };

test('discovery uses Pages, assets use immutable GitHub URLs and bounded CDN redirects', async () => {
  const calls = [];
  const download = githubContentDownload(async (url, options) => {
    calls.push({ url, options });
    if (url === CONTENT_FEED) return new Response('feed');
    if (url === contentAssetUrl(42, hash)) return new Response(null, { status: 302,
      headers: { location: 'https://release-assets.githubusercontent.com/asset?signature=abc' } });
    return new Response('game');
  });
  assert.equal((await download('latest.json', 10)).toString(), 'feed');
  assert.equal((await download('42/assets/game.js', 4, file)).toString(), 'game');
  assert.equal(calls[1].url, contentAssetUrl(42, hash));
  assert.equal(calls[2].url, 'https://release-assets.githubusercontent.com/asset?signature=abc');
  for (const call of calls) {
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.bypassCustomProtocolHandlers, true);
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal);
    assert.ok(!call.url.includes('afonasev.tech'));
  }
});
test('untrusted redirect destinations are rejected before a second request', async () => {
  for (const location of ['http://release-assets.githubusercontent.com/a', 'https://evil.test/a',
    'https://user@release-assets.githubusercontent.com/a', 'https://github.com/other/repo',
    'https://release-assets.githubusercontent.com:444/a', 'https://release-assets.githubusercontent.com.evil.test/a']) {
    let count = 0;
    const download = githubContentDownload(async () => {
      count++; return new Response(null, { status: 302, headers: { location } });
    });
    await assert.rejects(download('42/index.html', 100, file), /Untrusted/);
    assert.equal(count, 1);
  }
});
test('feed redirects and endless CDN redirects fail closed', async () => {
  let calls = 0;
  const download = githubContentDownload(async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/a' } });
  });
  await assert.rejects(download('latest.json', 100), /redirect/);
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(download('42/index.html', 100, file), /redirect/);
  assert.equal(calls, 6);
});
test('byte limit covers both Content-Length and actual streamed bytes', async () => {
  for (const headers of [{ 'content-length': '200' }, {}]) {
    const download = githubContentDownload(async () => new Response('too large', { headers }));
    await assert.rejects(download('42/index.html', 3, file), /Oversized/);
  }
  await assert.rejects(githubContentDownload(async () => new Response(null, { status: 503 }))('latest.json', 100), /unavailable/);
});
test('invalid signed asset identity cannot cause a request', async () => {
  let calls = 0;
  const download = githubContentDownload(async () => { calls++; return new Response(''); });
  await assert.rejects(download('1/x', 10, { sequence: -1, sha256: hash }));
  await assert.rejects(download('1/x', 10, { sequence: 1, sha256: '../bad' }));
  await assert.rejects(download('latest.json', -1));
  assert.equal(calls, 0);
});
