import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** Only player-facing bilingual entries enter release bodies; Git is the inventory. */
export function releaseNotes(commits, annotations = {}) {
  const groups = { Added:[], Improved:[], Fixed:[] };
  for (const commit of commits) {
    const entry = annotations[commit.hash];
    if (entry?.internal === true) continue;
    const ru = entry?.ru ?? /^Release-Note-RU:\s*(.+)$/m.exec(commit.body)?.[1];
    const en = entry?.en ?? /^Release-Note-EN:\s*(.+)$/m.exec(commit.body)?.[1];
    const internal = /^Release-Internal:\s*true$/m.test(commit.body);
    if (internal) continue;
    if (!ru || !en) throw Error(`Bilingual player notes or explicit internal classification required for ${commit.hash}`);
    const category = entry?.category ?? (/^fix(?:\(|:)/.test(commit.subject) ? 'Fixed' : /^feat(?:\(|:)/.test(commit.subject) ? 'Added' : 'Improved');
    if (!groups[category]) throw Error('Unknown release note category');
    groups[category].push({ru:ru.trim(),en:en.trim()});
  }
  const headings = {Added:'Новое',Improved:'Улучшения',Fixed:'Исправления'};
  const language = code => Object.entries(groups).filter(([,entries])=>entries.length).map(([category,entries]) => `### ${code==='ru'?headings[category]:category}\n${[...new Set(entries.map(e=>e[code]))].map(note=>`- ${note}`).join('\n')}`).join('\n\n');
  if (!Object.values(groups).some(entries=>entries.length)) throw Error('No player-facing changes in this release');
  return `## Русский\n${language('ru')}\n\n## English\n${language('en')}\n`;
}
export async function generateReleaseNotes(previousSource, source = 'HEAD', cwd = process.cwd()) {
  const args = ['log','--reverse','--format=%H%x00%s%x00%b%x00%x1e',previousSource ? `${previousSource}..${source}` : source];
  const raw = execFileSync('git',args,{cwd,encoding:'utf8'});
  const commits = raw.split('\x1e').map(value=>value.trim()).filter(Boolean).map(value=>{const [hash,subject,body]=value.split('\x00');return {hash,subject,body};});
  const annotations = process.env.BRICKS_RELEASE_NOTES ? JSON.parse(await readFile(process.env.BRICKS_RELEASE_NOTES,'utf8')) : {};
  return releaseNotes(commits,annotations);
}
