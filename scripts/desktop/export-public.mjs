import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const destination = process.argv[2];
if (!destination) throw Error('Pass a clean public repository checkout path');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const selected = files.filter(file => /^(src|server|electron|public|scripts|tests|config)\//.test(file)
  || /^tools\//.test(file) && !/^tools\/(flow|test_flow)\.py$/.test(file)
  || !file.includes('/') && /^(package.*\.json|tsconfig.*\.json|vite.*\.ts|vitest.*\.ts|playwright.*\.ts|index\.html|\.gitignore|Makefile)$/.test(file)
  || file === 'docs/desktop-distribution.md');
for (const file of selected) {
  const target = resolve(destination, file); await mkdir(dirname(target), { recursive: true }); await copyFile(file, target);
}
await writeFile(resolve(destination, 'SOURCE_REVISION'), execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }));
await writeFile(resolve(destination, 'README.md'), `# Bricks War

Browser and desktop block-puzzle arena with local and network play, human players and AI opponents.

- Play: https://bricks.afonasev.tech/
- Installers: https://github.com/afonasev/bricks-war/releases/latest

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
