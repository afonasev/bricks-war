import {isPublicSource} from './public-source.mjs';
import { installerDownloadSection } from './download-presentation.mjs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const destination = process.argv[2];
if (!destination) throw Error('Pass a clean public repository checkout path');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
const selected = files.filter(isPublicSource);
for (const file of selected) {
  const target = resolve(destination, file); await mkdir(dirname(target), { recursive: true }); await copyFile(file, target);
}
await writeFile(resolve(destination, 'SOURCE_REVISION'), execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }));
const nativeConfig = await readFile(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
const nativeVersion = nativeConfig.match(/^  version: (\d+\.\d+\.\d+)$/m)?.[1];
if (!nativeVersion) throw Error('Native version missing from electron-builder.yml');
// Preserve the currently published installer block during a source-only export.
// The release workflow switches it only after complete installers are published.
let publishedDownloads = '';
try {
  const previousReadme = await readFile(resolve(destination, 'README.md'), 'utf8');
  publishedDownloads = previousReadme.match(/<!-- bricks-war-downloads:start -->[\s\S]*?<!-- bricks-war-downloads:end -->/)?.[0] ?? '';
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(resolve(destination, 'README.md'), `# Bricks War

${publishedDownloads || installerDownloadSection(nativeVersion)}

Browser and desktop block-puzzle arena with local and network play, human players and AI opponents.

- Play: https://bricks.afonasev.tech/
- [Quick start in seven languages](docs/player-guide.md)
- [Credits and asset provenance](docs/credits.md)

## Development

Requires Node.js 24 or newer.

\`\`\`sh
npm ci
npm run dev
npm test
npm run build
\`\`\`

The web build is in \`dist/\`. Native packaging and signed game updates are documented in [Desktop distribution](docs/desktop-distribution.md). Official release signing keys are private and are not included.

## License

MIT; see [LICENSE](LICENSE).
`);
console.log(`Exported ${selected.length} tracked source files to ${destination}`);
