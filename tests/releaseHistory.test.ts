import {describe,it,expect,vi} from 'vitest';
import {localizedReleaseNotes,webReleaseHistory} from '../src/ui/releaseHistory';
describe('published release history',()=>{
 it('keeps category lists, selects locale and reports fallback/missing notes',()=>{
  const body='## Русский\n### Новое\n- Правила\n\n## English\n### Added\n- Rules';
  expect(localizedReleaseNotes(body,'ru')).toEqual({text:'### Новое\n- Правила',fallback:false});
  expect(localizedReleaseNotes(body,'de')).toEqual({text:'### Added\n- Rules',fallback:true});
  expect(localizedReleaseNotes('','en')).toMatchObject({notesUnavailable:'release'});
 });
 it('reads every returned page and published content version, excludes shell/drafts, and deduplicates versions',async()=>{
  const release=(n:number)=>({tag_name:`content-${n}`,name:`Game content 1.${n}.0`,body:'## English\n- Changes',published_at:'2026-10-20'});
  const pages=[Array.from({length:100},(_,i)=>release(i+1)),[release(101),release(101),{...release(102),draft:true},{...release(103),prerelease:true},{tag_name:'v1.0.0'}]];
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(pages.shift()))) as unknown as typeof fetch;
  const rows=await webReleaseHistory('en',undefined,fetcher);
  expect(rows).toHaveLength(101);expect(rows.at(-1)?.version).toBe('1.101.0');
  expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenLastCalledWith('https://api.github.com/repos/afonasev/bricks-war/releases?per_page=100&page=2',expect.objectContaining({credentials:'omit'}));
 });
 it('rejects errors and invalid payloads instead of showing success',async()=>{
  await expect(webReleaseHistory('ru',undefined,vi.fn(async()=>new Response('',{status:503})) as typeof fetch)).rejects.toThrow('HTTP 503');
  await expect(webReleaseHistory('ru',undefined,vi.fn(async()=>new Response('{}')) as typeof fetch)).rejects.toThrow('Invalid release history');
 });
 it('passes cancellation and returns an explicit empty list for an empty history',async()=>{
  const controller=new AbortController();controller.abort();
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.signal?.aborted).toBe(true);throw new DOMException('Aborted','AbortError');}) as typeof fetch;
  await expect(webReleaseHistory('en',controller.signal,fetcher)).rejects.toThrow('Aborted');
  expect(await webReleaseHistory('en',undefined,vi.fn(async()=>new Response('[]')) as typeof fetch)).toEqual([]);
 });
});
