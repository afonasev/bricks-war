import { validateShell } from '../../electron/shell-update.mjs';
import { compareVersions, supportsContent } from '../../electron/compatibility.mjs';

/** Read-only publication gate: both supported platforms must have a complete trusted shell. */
export async function requirePublishedShell(content, releases, readEnvelope, publicKey) {
  const candidates = releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name)
    && r.assets?.some(a=>a.name === 'shell-manifest.json'))
    .sort((a,b)=>compareVersions(b.tag_name.slice(1),a.tag_name.slice(1)));
  for (const release of candidates) {
    const envelope = await readEnvelope(release.tag_name);
    let compatible = true;
    for (const [platform,arch,minimumOS] of [['darwin','arm64','13.0.0'],['win32','x64','10.0.0']]) {
      let shell;
      try { shell = validateShell(envelope,publicKey,platform,arch,'0.0.0',minimumOS); }
      catch (error) { if (error.code !== 'INCOMPATIBLE') throw error; compatible=false; break; }
      if (shell.version !== release.tag_name.slice(1) || !supportsContent(content,shell.contentAbi ?? 2,shell.version)
        || !release.assets.some(a=>a.name===shell.file.name && a.size===shell.file.size && a.digest===`sha256:${shell.file.sha256}`)
        || (compareVersions(shell.version,content.gameVersion)<0 && shell.contentSequence>=content.sequence)) {
        compatible=false; break;
      }
    }
    if (compatible) return release.tag_name;
  }
  throw Error('Publish complete compatible Windows and macOS application packages before dependent game content');
}
