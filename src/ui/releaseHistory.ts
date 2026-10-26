import type { Locale } from '../i18n/locale';
export interface ReleaseHistoryRow {
  version: string; date: string | null; text: string; fallback: boolean; installed: boolean;
  component?: 'shell'; notesUnavailable?: 'installed' | 'release';
}
const markers: Record<Locale,string> = {ru:'Русский',en:'English',fr:'Français',de:'Deutsch',es:'Español',ja:'日本語','zh-Hans':'简体中文'};
/** Locale headings delimit translations; category headings stay in their section. */
export function localizedReleaseNotes(body: string, locale: Locale): Pick<ReleaseHistoryRow,'text'|'fallback'|'notesUnavailable'> {
  const headings=[...body.matchAll(/^## (Русский|English|Français|Deutsch|Español|日本語|简体中文)\s*$/gm)];
  const sections=new Map(headings.map((heading,i)=>[heading[1]!,body.slice(heading.index!+heading[0].length,headings[i+1]?.index).trim()]));
  const selected=sections.get(markers[locale]);
  if(selected) return {text:selected,fallback:false};
  const text=sections.get('English')||body.trim();
  return {text,fallback:true,...(!text?{notesUnavailable:'release' as const}:{})};
}
/** Read-only published history. No update, download, install or authentication command. */
export async function webReleaseHistory(locale: Locale, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ReleaseHistoryRow[]> {
  const controller=new AbortController(); const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) controller.abort();
  const timeout=setTimeout(abort,10000);
  const rows=new Map<string,ReleaseHistoryRow>();
  try {
    for(let page=1;page<=10;page++) {
      const response=await fetcher(`https://api.github.com/repos/afonasev/bricks-war/releases?per_page=100&page=${page}`,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',signal:controller.signal});
      if(!response.ok) throw new Error(`Release history HTTP ${response.status}`);
      const entries:unknown=await response.json();if(!Array.isArray(entries)) throw new Error('Invalid release history');
      for(const item of entries) {
        if(!item||typeof item.tag_name!=='string'||!/^content-\d+$/.test(item.tag_name)||item.draft||item.prerelease) continue;
        const version=typeof item.name==='string'&&item.name ? item.name.replace(/^Game content /,'') : item.tag_name;
        if(!rows.has(version)) rows.set(version,{version,date:typeof item.published_at==='string'?item.published_at:null,installed:false,...localizedReleaseNotes(typeof item.body==='string'?item.body:'',locale)});
      }
      if(entries.length<100) break;
    }
    return [...rows.values()];
  } finally { clearTimeout(timeout);signal?.removeEventListener('abort',abort); }
}
