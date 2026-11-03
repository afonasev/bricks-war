/** Explicit tracked-file allowlist; never include local build output or keys. */
export const isPublicSource = file => /^(src|server|electron|native|public|scripts|tests|config)\//.test(file)
  || /^tools\//.test(file) && !/^tools\/(flow|test_flow)\.py$/.test(file)
  || !file.includes('/') && /^(package.*\.json|tsconfig.*\.json|vite.*\.ts|vitest.*\.ts|playwright.*\.ts|index\.html|\.gitignore|Makefile)$/.test(file)
  || file.startsWith('docs/release-notes/')
  || ['.github/workflows/installer-downloads.yml', '.github/scripts/installer_downloads.py', '.github/scripts/test_installer_downloads.py'].includes(file)
  || ['electron-builder.native.yml', 'docs/desktop-native-migration.md', 'electron-builder.yml', 'docs/desktop-distribution.md', 'docs/player-guide.md', 'docs/credits.md'].includes(file);
