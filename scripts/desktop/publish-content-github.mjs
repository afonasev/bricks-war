import { generateReleaseNotes } from './release-notes.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentReleasePlan, publishContentRelease } from './content-release.mjs';
import { CONTENT_REPOSITORY, CONTENT_FEED, githubContentDownload } from '../../electron/update-source.mjs';
import { validateManifest } from '../../electron/content.mjs';

const plan = await contentReleasePlan('build/desktop-content', await readFile('electron/content-public-key.pem', 'utf8'));
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify({ dryRun: true, tag: plan.tag, gameVersion: plan.manifest.gameVersion,
    sequence: plan.manifest.sequence, assets: plan.assets.length, feed: CONTENT_FEED }, null, 2));
} else {
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (git(process.cwd(), 'rev-parse', 'HEAD').trim() !== plan.manifest.commit
    || git(process.cwd(), 'status', '--porcelain', '--untracked-files=normal', '--',
      'src', 'server', 'electron', 'public', 'scripts', 'package.json', 'package-lock.json', 'electron-builder.yml').trim())
    throw Error('Publish only prepared content from the current clean committed source');
  // This is deliberately read-only: Pages setup is a separately authorized release step.
  const pages = JSON.parse(gh('api', `repos/${CONTENT_REPOSITORY}/pages`));
  if (pages.cname || pages.build_type !== 'legacy' || pages.source?.branch !== 'gh-pages' || pages.source?.path !== '/')
    throw Error('Configure GitHub Pages to publish gh-pages / before publishing content');
  const publicRevision = gh('api', `repos/${CONTENT_REPOSITORY}/contents/SOURCE_REVISION?ref=main`, '--jq', '.content');
  if (Buffer.from(publicRevision, 'base64').toString().trim() !== plan.manifest.commit)
    throw Error('Publish the matching reviewed source snapshot before publishing game content');
  const scratch = await mkdtemp(join(tmpdir(), 'bricks-github-content-'));
  try {
    const checkout = join(scratch, 'pages');
    gh('repo', 'clone', CONTENT_REPOSITORY, checkout, '--', '--depth=1', '--branch=gh-pages');
    const pointer = join(checkout, 'desktop/game/latest.json');
    const key = await readFile('electron/content-public-key.pem', 'utf8');
    let previous;
    try { previous = JSON.parse(await readFile(pointer, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      const old = validateManifest(previous, key, 2);
      if (old.sequence > plan.manifest.sequence || old.sequence === plan.manifest.sequence
        && JSON.stringify(previous) !== JSON.stringify(plan.envelope)) throw Error('Refusing discovery rollback or sequence reuse');
    }
    const notes = await generateReleaseNotes(previous ? validateManifest(previous,key,2).commit : undefined,plan.manifest.commit);
    const find = async (tag, id) => {
      if (id) return JSON.parse(gh('api', `repos/${CONTENT_REPOSITORY}/releases/${id}`));
      // Listing a known endpoint distinguishes a missing release from authentication/network failure.
      const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${CONTENT_REPOSITORY}/releases?per_page=100`)).flat();
      return releases.find(release => release.tag_name === tag) ?? null;
    };
    const download = githubContentDownload(fetch);
    await publishContentRelease(plan, {
      find,
      create: async tag => {
        const request = join(scratch, 'create-release.json');
        await writeFile(request, JSON.stringify({ tag_name: tag, target_commitish: 'main', draft: true,
          prerelease: false, make_latest: 'false',
          name: `Game content ${plan.manifest.gameVersion} (${plan.manifest.sequence})`,
          body: notes }));
        // The release list can lag creation; use the authoritative POST response.
        return JSON.parse(gh('api', '--method', 'POST', `repos/${CONTENT_REPOSITORY}/releases`, '--input', request));
      },
      upload: async (tag, asset) => {
        const path = join(scratch, asset.name); await copyFile(asset.path, path);
        gh('release', 'upload', tag, path, '--repo', CONTENT_REPOSITORY);
      },
      publish: async tag => { gh('release', 'edit', tag, '--repo', CONTENT_REPOSITORY, '--draft=false', '--prerelease=false', '--latest=false'); },
      download: async (tag, asset) => {
        return download(asset.name, asset.size, { sequence: plan.manifest.sequence, sha256: asset.sha256 });
      },
      switchPointer: async () => {
        await mkdir(join(checkout, 'desktop/game'), { recursive: true });
        await writeFile(pointer, JSON.stringify(plan.envelope));
        await writeFile(join(checkout, '.nojekyll'), '');
        git(checkout, 'add', 'desktop/game/latest.json', '.nojekyll');
        if (git(checkout, 'status', '--porcelain').trim()) {
          git(checkout, 'commit', '-m', `Publish signed content ${plan.manifest.gameVersion} sequence ${plan.manifest.sequence}`);
          // No force: a competing publisher must re-read the current pointer.
          git(checkout, 'push', 'origin', 'HEAD:gh-pages');
        }
      },
    });
    // Pages deploy is asynchronous. Report pending until the actual public pointer matches.
    let confirmed = false;
    for (let attempt = 0; attempt < 18; attempt++) {
      try {
        const bytes = await download('latest.json', 512_000);
        const actual = validateManifest(JSON.parse(bytes), key, 2);
        if (actual.sequence === plan.manifest.sequence && JSON.parse(bytes).signature === plan.envelope.signature) { confirmed = true; break; }
      } catch { /* Pages may still be deploying. */ }
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }
    if (!confirmed) throw Error('Pages pointer pushed; public readback pending. Retry the same prepared content; do not delete its release.');
    console.log(`Published verified GitHub content ${plan.manifest.gameVersion}, sequence ${plan.manifest.sequence}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
